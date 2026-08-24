#!/usr/bin/env node
/**
 * Human-ownership checker for the FastASL reboot.
 *
 * Usage:
 *   npm run check:ownership -- <human-checkpoint-commit>
 *
 * What this script detects:
 *   1. Commits made AFTER the recorded checkpoint that changed any
 *      HUMAN-OWNED path listed in docs/CODE_OWNERSHIP.json.
 *   2. Working-tree changes to any HUMAN-OWNED path: staged changes,
 *      unstaged modifications, deletions from the index or worktree,
 *      and untracked human-owned paths.
 *
 * What this script does NOT detect:
 *   Semantic duplication of human-owned logic inside AI-owned files.
 *   Detecting that kind of violation requires a human reviewing the
 *   actual diffs of AI-owned files against the human implementation.
 *
 * The script never silently succeeds: a missing/invalid/non-ancestor
 * checkpoint, unreadable manifest, dirty human-owned paths, or
 * post-checkpoint commits touching them all produce a non-zero exit.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const MANIFEST_PATH = path.join(repoRoot, "docs", "CODE_OWNERSHIP.json");

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitExitCode(args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function main() {
  const checkpointArg = process.argv[2];

  if (!checkpointArg) {
    fail(
      'missing checkpoint argument. Run: npm run check:ownership -- <human-checkpoint-commit>',
    );
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch (error) {
    fail(`could not read ownership manifest at ${MANIFEST_PATH}: ${error.message}`);
    return;
  }

  const humanOwnedPaths = manifest?.ownership?.["HUMAN-OWNED"];
  if (!Array.isArray(humanOwnedPaths) || humanOwnedPaths.length === 0) {
    fail("manifest contains no HUMAN-OWNED paths");
    return;
  }

  let checkpoint;
  try {
    checkpoint = git(["rev-parse", "--verify", `${checkpointArg}^{commit}`]);
  } catch {
    fail(`checkpoint "${checkpointArg}" is not a valid commit`);
    return;
  }

  let head;
  try {
    head = git(["rev-parse", "HEAD"]);
  } catch (error) {
    fail(`could not resolve HEAD: ${error.message}`);
    return;
  }

  if (gitExitCode(["merge-base", "--is-ancestor", checkpoint, head]) !== 0) {
    fail(
      `checkpoint ${checkpoint} (${checkpointArg}) is not an ancestor of HEAD ${head}`,
    );
    return;
  }

  let changedFiles = [];
  if (head !== checkpoint) {
    try {
      changedFiles = git([
        "diff",
        "--name-only",
        "--no-renames",
        `${checkpoint}..${head}`,
      ])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error) {
      fail(`git diff failed: ${error.message}`);
      return;
    }
  }

  const committedViolations = humanOwnedPaths.filter((ownedPath) =>
    changedFiles.includes(ownedPath),
  );

  /** @type {Array<{path: string, detail: string}>} */
  const workingTreeViolations = [];
  for (const ownedPath of humanOwnedPaths) {
    let trackedInHead = false;
    try {
      trackedInHead =
        git(["ls-tree", "HEAD", "--name-only", "--", ownedPath]).length > 0;
    } catch (error) {
      fail(`could not inspect HEAD tree for ${ownedPath}: ${error.message}`);
      return;
    }
    if (!trackedInHead) {
      workingTreeViolations.push({
        path: ownedPath,
        detail:
          "not tracked in HEAD (missing from the commit tree or untracked)",
      });
      continue;
    }

    let porcelain = "";
    try {
      porcelain = git(["status", "--porcelain", "--", ownedPath]);
    } catch (error) {
      fail(`git status failed for ${ownedPath}: ${error.message}`);
      return;
    }
    if (porcelain.length > 0) {
      const codes = porcelain
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("; ");
      workingTreeViolations.push({
        path: ownedPath,
        detail: `dirty working-tree state (${codes})`,
      });
    }
  }

  console.log("Human-ownership check");
  console.log("=====================");
  console.log(`Checkpoint used: ${checkpoint} (${checkpointArg})`);
  console.log(`HEAD:            ${head}`);
  console.log(`Manifest:        docs/CODE_OWNERSHIP.json`);
  console.log(
    `Checkpoint is an ancestor of HEAD: yes`,
  );
  console.log("");
  console.log(`Human-owned paths inspected (${humanOwnedPaths.length}):`);
  for (const ownedPath of humanOwnedPaths) {
    console.log(`  - ${ownedPath}`);
  }
  console.log("");
  console.log(
    `Commits after checkpoint touched ${changedFiles.length} file(s).`,
  );

  if (committedViolations.length === 0 && workingTreeViolations.length === 0) {
    console.log("");
    console.log(
      "PASS: no human-owned path changed after the checkpoint and no human-owned path has staged, unstaged, deleted, or untracked working-tree changes.",
    );
    console.log(
      "Note: this guard detects direct path-level changes only. Semantic duplication of human-owned logic requires human diff review.",
    );
    return;
  }

  if (committedViolations.length > 0) {
    console.log("");
    console.log(
      `FAIL: ${committedViolations.length} human-owned path(s) changed in commits after the checkpoint:`,
    );
    for (const ownedPath of committedViolations) {
      console.log(`  - ${ownedPath}`);
    }
  }

  if (workingTreeViolations.length > 0) {
    console.log("");
    console.log(
      `FAIL: ${workingTreeViolations.length} human-owned path(s) have working-tree problems:`,
    );
    for (const violation of workingTreeViolations) {
      console.log(`  - ${violation.path}: ${violation.detail}`);
    }
  }

  console.log("");
  console.log(
    "AI must not modify human-owned files after the human checkpoint without an explicitly reviewed exception.",
  );
  process.exitCode = 1;
}

main();
