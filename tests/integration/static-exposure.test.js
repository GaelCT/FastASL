import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
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
const LOGIN_PAGE = await readFile(join(PUBLIC_ROOT, "login.html"));
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

test("a public symlink or junction cannot expose a file outside public", async () => {
  const outsideDirectory = await mkdtemp(join(tmpdir(), "fastasl-outside-secret-"));
  const linkName = `phase-1-canary-${process.pid}-${Date.now()}.txt`;
  const linkPath = join(PUBLIC_ROOT, linkName);
  const secret = "PHASE_1_OUTSIDE_SECRET_SENTINEL";
  const secretPath = join(outsideDirectory, "secret.txt");
  const useWindowsJunction = process.platform === "win32";
  let linkCreated = false;

  try {
    await writeFile(secretPath, secret, "utf8");
    await symlink(
      useWindowsJunction ? outsideDirectory : secretPath,
      linkPath,
      useWindowsJunction ? "junction" : "file",
    );
    linkCreated = true;

    const canaryPath = useWindowsJunction ? `/${linkName}/secret.txt` : `/${linkName}`;
    const response = await request(createApp(config)).get(canaryPath);
    assert.equal(response.status, 404);
    assert.ok(!response.text.includes(secret));
  } finally {
    if (linkCreated) {
      await rm(linkPath, { force: true });
    }
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("a path swapped after validation serves only the already-opened public file", async () => {
  const outsideDirectory = await mkdtemp(join(dirname(PUBLIC_ROOT), ".fastasl-swap-secret-"));
  const fileName = `phase-1-swap-${process.pid}-${Date.now()}.txt`;
  const filePath = join(PUBLIC_ROOT, fileName);
  const secret = "PHASE_1_SWAPPED_OUTSIDE_SECRET_SENTINEL";
  const publicContent = "PHASE_1_ORIGINAL_PUBLIC_CONTENT";
  const secretPath = join(outsideDirectory, "secret.txt");
  let swapObserved = false;

  try {
    await writeFile(secretPath, secret, "utf8");
    await writeFile(filePath, publicContent, "utf8");

    const app = express();
    app.use(
      createPublicStaticMiddleware(PUBLIC_ROOT, {
        afterFileOpen: async () => {
          swapObserved = true;
          await rm(filePath);
          await rename(outsideDirectory, filePath);
        },
      }),
    );
    app.use(notFoundHandler);
    app.use(errorHandler);

    const response = await request(app).get(`/${fileName}`);
    assert.equal(swapObserved, true);
    assert.equal(response.status, 200);
    assert.equal(response.text, publicContent);
    assert.ok(!response.text.includes(secret));

    const swappedResponse = await request(app).get(`/${fileName}`);
    assert.equal(swappedResponse.status, 404);
    assert.ok(!swappedResponse.text.includes(secret));
  } finally {
    await rm(filePath, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("static GET and HEAD preserve file metadata and HEAD body semantics", async () => {
  const app = createApp(config);
  const response = await request(app).get("/login.html");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /^text\/html(?:;|$)/);
  assert.equal(response.headers["content-length"], String(LOGIN_PAGE.length));
  assert.equal(response.headers["accept-ranges"], "bytes");
  assert.ok(response.headers.etag);
  assert.ok(Number.isFinite(Date.parse(response.headers["last-modified"])));
  assert.equal(response.text, LOGIN_PAGE.toString("utf8"));

  const head = await request(app).head("/login.html");
  assert.equal(head.status, 200);
  assert.equal(head.headers["content-type"], response.headers["content-type"]);
  assert.equal(head.headers["content-length"], response.headers["content-length"]);
  assert.equal(head.headers.etag, response.headers.etag);
  assert.equal(head.headers["last-modified"], response.headers["last-modified"]);
  assert.equal(head.headers["accept-ranges"], "bytes");
  assert.equal(head.text, undefined);
});

test("static conditional requests return 304 without a body", async () => {
  const app = createApp(config);
  const original = await request(app).get("/login.html");

  for (const headers of [
    { "If-None-Match": original.headers.etag },
    { "If-Modified-Since": original.headers["last-modified"] },
  ]) {
    const response = await request(app).get("/login.html").set(headers);
    assert.equal(response.status, 304);
    assert.equal(response.text, "");
    assert.equal(response.headers["content-length"], undefined);
  }

  const head = await request(app)
    .head("/login.html")
    .set("If-None-Match", original.headers.etag);
  assert.equal(head.status, 304);
  assert.equal(head.text, undefined);
  assert.equal(head.headers["content-length"], undefined);
});

test("static single byte ranges return exact bytes and range metadata", async () => {
  const app = createApp(config);
  const size = LOGIN_PAGE.length;
  const cases = [
    { range: "bytes=0-9", start: 0, end: 9 },
    { range: "bytes=10-", start: 10, end: size - 1 },
    { range: "bytes=-7", start: size - 7, end: size - 1 },
  ];

  for (const { range, start, end } of cases) {
    const response = await request(app).get("/login.html").set("Range", range);
    assert.equal(response.status, 206, range);
    assert.equal(response.text, LOGIN_PAGE.subarray(start, end + 1).toString("utf8"), range);
    assert.equal(response.headers["content-range"], `bytes ${start}-${end}/${size}`, range);
    assert.equal(response.headers["content-length"], String(end - start + 1), range);
    assert.equal(response.headers["accept-ranges"], "bytes", range);
  }

  const head = await request(app).head("/login.html").set("Range", "bytes=0-9");
  assert.equal(head.status, 206);
  assert.equal(head.headers["content-range"], `bytes 0-9/${size}`);
  assert.equal(head.headers["content-length"], "10");
  assert.equal(head.text, undefined);
});

test("a weak If-Range entity tag ignores Range and returns the full file", async () => {
  const app = createApp(config);
  const original = await request(app).get("/login.html");
  assert.match(original.headers.etag, /^W\//);

  const response = await request(app)
    .get("/login.html")
    .set("Range", "bytes=0-9")
    .set("If-Range", original.headers.etag);

  assert.equal(response.status, 200);
  assert.equal(response.text, LOGIN_PAGE.toString("utf8"));
  assert.equal(response.headers["content-length"], String(LOGIN_PAGE.length));
  assert.equal(response.headers["content-range"], undefined);
});

test("malformed and unsatisfiable static ranges return a safe 416", async () => {
  const app = createApp(config);
  for (const range of ["bytes=invalid", "bytes=5-2", `bytes=${LOGIN_PAGE.length}-`]) {
    const response = await request(app).get("/login.html").set("Range", range);
    assert.equal(response.status, 416, range);
    assert.deepEqual(response.body, { error: "Request failed" }, range);
    assert.equal(response.headers["content-range"], `bytes */${LOGIN_PAGE.length}`, range);
    assert.ok(!response.text.includes(PUBLIC_ROOT), range);
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
