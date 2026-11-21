import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { errorHandler } from "../../src/middleware/error-handler.js";

const config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3000,
  LOG_LEVEL: "silent",
  REQUEST_BODY_LIMIT: "100kb",
};

function assertSafeError(response, status, message) {
  assert.equal(response.status, status);
  assert.match(response.headers["content-type"], /^application\/json(?:;|$)/);
  assert.deepEqual(response.body, { error: message });
  for (const forbidden of ["SyntaxError", "body-parser", "stack", "C:\\", "/FastASL", "SENSITIVE_REQUEST_BODY"]) {
    assert.ok(!response.text.includes(forbidden), `${forbidden} must not be disclosed`);
  }
}

test("malformed JSON returns the safe 400 contract", async () => {
  const response = await request(createApp(config))
    .post("/api/health")
    .set("Content-Type", "application/json")
    .send('{"SENSITIVE_REQUEST_BODY":');

  assertSafeError(response, 400, "Request failed");
});

test("JSON over the configured limit returns the safe 413 contract", async () => {
  const response = await request(createApp(config))
    .post("/api/health")
    .set("Content-Type", "application/json")
    .send({ SENSITIVE_REQUEST_BODY: "x".repeat(101 * 1024) });

  assertSafeError(response, 413, "Request failed");
});

test("non-JSON and non-object JSON inputs do not alter Phase 1 routing", async () => {
  const textResponse = await request(createApp(config))
    .post("/api/health")
    .set("Content-Type", "text/plain")
    .send("SENSITIVE_REQUEST_BODY");
  assertSafeError(textResponse, 404, "Not found");

  for (const [value, status, message] of [
    [[], 404, "Not found"],
    [null, 400, "Request failed"],
    ["text", 400, "Request failed"],
    [42, 400, "Request failed"],
    [true, 400, "Request failed"],
  ]) {
    const response = await request(createApp(config))
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(value));
    assertSafeError(response, status, message);
  }
});

test("other safe client errors retain their status and generic payload", async () => {
  const app = express();
  app.get("/client-error", (_req, _res, next) => {
    const error = new Error("SENSITIVE_REQUEST_BODY parser detail");
    error.status = 422;
    next(error);
  });
  app.use(errorHandler);

  const response = await request(app).get("/client-error");
  assertSafeError(response, 422, "Request failed");
});

test("unexpected failures retain the generic 500 contract", async () => {
  const app = express();
  app.get("/unexpected", () => {
    throw new Error("SENSITIVE_REQUEST_BODY C:\\private\\stack");
  });
  app.use(errorHandler);

  const response = await request(app).get("/unexpected");
  assertSafeError(response, 500, "Internal server error");
});
