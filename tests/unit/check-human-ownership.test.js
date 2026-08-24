import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECKER_SOURCE = join(REPO_ROOT, "scripts", "check-human-ownership.mjs");

/**
 * Build an isolated throwaway git repository containing the ownership
 * manifest, a copy of the real checker script, one human-owned placeholder
 * path (src/app.js), and one AI-owned path (src/lib/logger.js). Returns the
 * fixture directory plus small helpers.
 */
function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "fastasl-ownership-test-"));
  const run = (...args) =>
    execGit(dir, args);

  execGit(dir, ["init"]);
  execGit(dir, ["checkout", "-b", "main"]);
  execGit(dir, ["config", "user.email", "ownership-test@example.com"]);
  execGit(dir, ["config", "user.name", "Ownership Test"]);

  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "src", "lib"), { recursive: true });

  writeFileSync(
    join(dir, "docs-manifest.json"),
    JSON.stringify({
      version: 2,
      ownership: {
        "HUMAN-OWNED": ["src/app.js"],
        "AI-OWNED": [
          "src/lib/logger.js",
          "scripts/check-human-ownership.mjs",
        ],
        "SHARED-INTERFACE": [],
      },
    }),
  );
  // The checker reads docs/CODE_OWNERSHIP.json relative to its own location,
  // so place it accordingly inside the fixture.
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(
    join(dir, "docs", "CODE_OWNERSHIP.json"),
    readFileSync(join(dir, "docs-manifest.json"), "utf8"),
  );
  rmSync(join(dir, "docs-manifest.json"));

  writeFileSync(join(dir, "scripts", "check-human-ownership.mjs"), readFileSync(CHECKER_SOURCE, "utf8"));
  writeFileSync(join(dir, "src", "app.js"), "// human-owned placeholder\nexport {};\n");
  writeFileSync(join(dir, "src", "lib", "logger.js"), "// ai-owned placeholder\nexport {};\n");

  execGit(dir, ["add", "-A"]);
  execGit(dir, ["commit", "-m", "base"]);
  const checkpoint = execGit(dir, ["rev-parse", "HEAD"]).trim();

  return {
    dir,
    checkpoint,
    run,
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function execGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function runChecker(fixtureDir, args = []) {
  return spawnSync(
    process.execPath,
    [join(fixtureDir, "scripts", "check-human-ownership.mjs"), ...args],
    { cwd: fixtureDir, encoding: "utf8" },
  );
}

test("ownership checker: missing checkpoint fails", () => {
  const fixture = createFixtureRepo();
  try {
    const result = runChecker(fixture.dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing checkpoint argument/);
  } finally {
    fixture.dispose();
  }
});

test("ownership checker: invalid checkpoint fails", () => {
  const fixture = createFixtureRepo();
  try {
    const result = runChecker(fixture.dir, ["not-a-real-commit"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is not a valid commit/);
  } finally {
    fixture.dispose();
  }
});

test("ownership checker: non-ancestor checkpoint fails", () => {
  const fixture = createFixtureRepo();
  try {
    fixture.run("checkout", "--orphan", "stray");
    fixture.run("commit", "--allow-empty", "-m", "stray root commit");
    const strayHash = fixture.run("rev-parse", "stray").trim();
    fixture.run("checkout", "main");

    const result = runChecker(fixture.dir, [strayHash]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is not an ancestor of HEAD/);
  } finally {
    fixture.dispose();
  }
});

test("ownership checker: clean committed AI-only changes pass", () => {
  const fixture = createFixtureRepo();
  try {
    const loggerPath = join(fixture.dir, "src", "lib", "logger.js");
    appendFileSync(loggerPath, "// ai iteration\n");
    fixture.run("add", "src/lib/logger.js");
    fixture.run("commit", "-m", "ai-only change");

    const result = runChecker(fixture.dir, [fixture.checkpoint]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS/);
  } finally {
    fixture.dispose();
  }
});

test("ownership checker: committed human-owned change fails", () => {
  const fixture = createFixtureRepo();
  try {
    appendFileSync(join(fixture.dir, "src", "app.js"), "// ai edit\n");
    fixture.run("add", "src/app.js");
    fixture.run("commit", "-m", "bad: touched human file");

    const result = runChecker(fixture.dir, [fixture.checkpoint]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /changed in commits after the checkpoint/);
    assert.match(result.stdout, /src\/app\.js/);
  } finally {
    fixture.dispose();
  }
});

test("ownership checker: staged human-owned change fails", () => {
  const fixture = createFixtureRepo();
  try {
    appendFileSync(join(fixture.dir, "src", "app.js"), "// staged\n");
    fixture.run("add", "src/app.js");

    const result = runChecker(fixture.dir, [fixture.checkpoint]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /working-tree problems/);
    assert.match(result.stdout, /dirty working-tree state/);
  } finally {
    fixture.dispose();
  }
});

test("ownership checker: unstaged human-owned change fails", () => {
  const fixture = createFixtureRepo();
  try {
    appendFileSync(join(fixture.dir, "src", "app.js"), "// unstaged\n");

    const result = runChecker(fixture.dir, [fixture.checkpoint]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /working-tree problems/);
  } finally {
    fixture.dispose();
  }
});

test("ownership checker: untracked human-owned path fails", () => {
  const fixture = createFixtureRepo();
  try {
    // Remove from the index only: the file remains on disk but is now
    // untracked, and the deletion is staged.
    fixture.run("rm", "--cached", "src/app.js");

    const result = runChecker(fixture.dir, [fixture.checkpoint]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /working-tree problems/);
    assert.match(result.stdout, /src\/app\.js/);
  } finally {
    fixture.dispose();
  }
});
