import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import express from "express";
import { createApp } from "../../src/app.js";
import { errorHandler } from "../../src/middleware/error-handler.js";
import { notFoundHandler } from "../../src/middleware/not-found.js";
import { createPublicStaticMiddleware } from "../../src/middleware/public-static.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../../public/", import.meta.url));
const config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3000,
  LOG_LEVEL: "silent",
  REQUEST_BODY_LIMIT: "100kb",
};

const exposedPaths = [
  "/.env",
  "/package.json",
  "/package-lock.json",
  "/composer.json",
  "/backend/",
  "/backend/JWT.php",
  "/index.php",
  "/router.php",
  "/database/schema.sql",
  "/sql/schema.sql",
  "/docs/REBOOT_DECISIONS.md",
  "/docs/CODE_OWNERSHIP.json",
  "/README.md",
  "/src/server.js",
  "/../package.json",
  "/%2e%2e/package.json",
  "/..%2fpackage.json",
  "/%2e%2e%2fpackage.json",
  "/..%5cpackage.json",
  "/%2e%2e%5cpackage.json",
  "/assets/%2e%2e/%2e%2e/package.json",
  "/assets/..%2f..%2fpackage.json",
  "/%2Fpackage.json",
  "/%5Cpackage.json",
];

test("repository files, traversal, and encoded separators cannot be downloaded", async () => {
  const app = createApp(config);
  for (const path of exposedPaths) {
    const response = await request(app).get(path);
    assert.equal(response.status, 404, path);
    assert.deepEqual(response.body, { error: "Not found" }, path);
  }
});

test("a public symlink cannot expose a file outside public", async (t) => {
  const outsideDirectory = await mkdtemp(join(tmpdir(), "fastasl-outside-secret-"));
  const linkName = `phase-1-canary-${process.pid}-${Date.now()}.txt`;
  const linkPath = join(PUBLIC_ROOT, linkName);
  const secret = "PHASE_1_OUTSIDE_SECRET_SENTINEL";
  const secretPath = join(outsideDirectory, "secret.txt");
  let linkCreated = false;

  try {
    await writeFile(secretPath, secret, "utf8");
    try {
      await symlink(secretPath, linkPath, "file");
      linkCreated = true;
    } catch (error) {
      if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) {
        t.skip(`Symlink canary unverified: ${error.code}: ${error.message}`);
        return;
      }
      throw error;
    }

    const response = await request(createApp(config)).get(`/${linkName}`);
    assert.equal(response.status, 404);
    assert.ok(!response.text.includes(secret));
  } finally {
    if (linkCreated) {
      await rm(linkPath, { force: true });
    }
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("a path swapped after validation serves only the already-opened public file", async (t) => {
  const outsideDirectory = await mkdtemp(join(tmpdir(), "fastasl-swap-secret-"));
  const linkName = `phase-1-swap-${process.pid}-${Date.now()}.txt`;
  const linkPath = join(PUBLIC_ROOT, linkName);
  const secret = "PHASE_1_SWAPPED_OUTSIDE_SECRET_SENTINEL";
  const publicContent = "PHASE_1_ORIGINAL_PUBLIC_CONTENT";
  const secretPath = join(outsideDirectory, "secret.txt");
  let swapObserved = false;

  try {
    await writeFile(secretPath, secret, "utf8");
    try {
      await symlink(secretPath, linkPath, "file");
      await rm(linkPath);
    } catch (error) {
      if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) {
        t.skip(`Symlink swap canary unverified: ${error.code}: ${error.message}`);
        return;
      }
      throw error;
    }
    await writeFile(linkPath, publicContent, "utf8");

    const app = express();
    app.use(
      createPublicStaticMiddleware(PUBLIC_ROOT, {
        afterFileOpen: async () => {
          swapObserved = true;
          await rm(linkPath);
          await symlink(secretPath, linkPath, "file");
        },
      }),
    );
    app.use(notFoundHandler);
    app.use(errorHandler);

    const response = await request(app).get(`/${linkName}`);
    assert.equal(swapObserved, true);
    assert.equal(response.status, 200);
    assert.equal(response.text, publicContent);
    assert.ok(!response.text.includes(secret));

    const swappedResponse = await request(app).get(`/${linkName}`);
    assert.equal(swappedResponse.status, 404);
    assert.ok(!swappedResponse.text.includes(secret));
  } finally {
    await rm(linkPath, { force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("malformed URL encodings fail safely without filesystem disclosure", async () => {
  const app = createApp(config);
  for (const path of ["/%E0%A4%A", "/%ZZ", "/%00", "/package.json%00.txt"]) {
    const response = await request(app).get(path);
    assert.equal(response.status, 400, path);
    assert.deepEqual(response.body, { error: "Request failed" }, path);
    assert.ok(!response.text.includes(dirname(PUBLIC_ROOT)), path);
  }
});
