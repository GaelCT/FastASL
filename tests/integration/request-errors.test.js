import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { Writable } from "node:stream";
import { createApp } from "../../src/app.js";
import { createLogger } from "../../src/lib/logger.js";
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

function createLogSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  return {
    stream,
    text() {
      return chunks.join("");
    },
  };
}

async function waitForRequestLog(sink) {
  const startedAt = Date.now();
  while (!sink.text().includes("request completed")) {
    if (Date.now() - startedAt > 2000) {
      throw new Error("serialized request log output never flushed");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function serializedEntries(sink) {
  return sink
    .text()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("malformed JSON returns the safe 400 contract", async () => {
  const response = await request(createApp(config))
    .post("/api/health")
    .set("Content-Type", "application/json")
    .send('{"SENSITIVE_REQUEST_BODY":');

  assertSafeError(response, 400, "Request failed");
});

test("malformed JSON bodies and parser details stay out of serialized logs", async () => {
  const sentinel = "MALFORMED_BODY_LOG_SENTINEL";
  const sink = createLogSink();
  const logger = createLogger({ level: "info", stream: sink.stream });
  const app = createApp(config, { logger });

  const response = await request(app)
    .post("/api/health")
    .set("Content-Type", "application/json")
    .send(`{"token":"${sentinel}"`);

  assert.equal(response.status, 400);
  await waitForRequestLog(sink);

  const serialized = sink.text();
  assert.ok(!serialized.includes(sentinel), "malformed body sentinel must not be logged");

  const errorEntry = serializedEntries(sink).find(
    (entry) => entry.msg === "Request client error",
  );
  assert.ok(errorEntry, "expected a safe client-error log entry");
  assert.equal(errorEntry.status, 400);
  assert.equal(errorEntry.type, "entity.parse.failed");
  assert.equal(errorEntry.err, undefined);
});

test("request query strings stay out of serialized logs", async () => {
  const sentinel = "QUERY_STRING_LOG_SENTINEL";
  const sink = createLogSink();
  const logger = createLogger({ level: "info", stream: sink.stream });
  const app = createApp(config, { logger });

  const response = await request(app).get(`/api/health?token=${sentinel}`);

  assert.equal(response.status, 200);
  await waitForRequestLog(sink);

  const serialized = sink.text();
  assert.ok(!serialized.includes(sentinel), "query-string sentinel must not be logged");

  const requestEntry = serializedEntries(sink).find(
    (entry) => entry.msg === "request completed",
  );
  assert.ok(requestEntry, "expected a serialized request log entry");
  assert.equal(requestEntry.req.url, "/api/health");
  assert.equal(requestEntry.req.query, undefined);
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

test("unexpected errors carrying 5xx statuses normalize to the generic 500 contract", async () => {
  for (const [property, carriedStatus] of [
    ["status", 503],
    ["statusCode", 503],
    ["status", 599],
  ]) {
    const app = express();
    app.get("/unexpected", () => {
      const error = new Error("SENSITIVE_REQUEST_BODY upstream failure");
      error[property] = carriedStatus;
      throw error;
    });
    app.use(errorHandler);

    const response = await request(app).get("/unexpected");
    assertSafeError(response, 500, "Internal server error");
  }
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
