#!/usr/bin/env node
/**
 * Human-ownership checker for the FastASL reboot.
 *
 * Usage:
 *   npm run check:ownership -- <human-checkpoint-commit>
 *
 * Fails when any HUMAN-OWNED path from docs/CODE_OWNERSHIP.json was
 * changed by commits made AFTER the recorded human checkpoint. This
 * protects the human-owned implementation from being overwritten or
 * duplicated by later AI integration commits.
 *
 * The script never silently succeeds: a missing/invalid checkpoint,
 * unreadable manifest, or dirty result all produce a non-zero exit.
 */

import { execFileSync } from "node:child_process";
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

  const changedHumanOwned = humanOwnedPaths.filter((ownedPath) =>
    changedFiles.includes(ownedPath),
  );

  console.log("Human-ownership check");
  console.log("=====================");
  console.log(`Checkpoint used: ${checkpoint} (${checkpointArg})`);
  console.log(`HEAD:            ${head}`);
  console.log(`Manifest:        docs/CODE_OWNERSHIP.json`);
  console.log("");
  console.log(`Human-owned paths inspected (${humanOwnedPaths.length}):`);
  for (const ownedPath of humanOwnedPaths) {
    console.log(`  - ${ownedPath}`);
  }
  console.log("");
  console.log(`Commits after checkpoint touched ${changedFiles.length} file(s).`);

  if (changedHumanOwned.length === 0) {
    console.log("");
    console.log(
      "PASS: no human-owned implementation path changed after the checkpoint.",
    );
    return;
  }

  console.log("");
  console.log(
    `FAIL: ${changedHumanOwned.length} human-owned path(s) changed after the checkpoint:`,
  );
  for (const ownedPath of changedHumanOwned) {
    console.log(`  - ${ownedPath}`);
  }
  console.log("");
  console.log(
    "AI must not modify human-owned files after the human checkpoint without an explicitly reviewed exception.",
  );
  process.exitCode = 1;
}

main();
