import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../src/app.js";

const config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3000,
  LOG_LEVEL: "silent",
  REQUEST_BODY_LIMIT: "100kb",
};

function app() {
  return createApp(config);
}

test("health endpoint returns only the exact health contract", async () => {
  const response = await request(app()).get("/api/health");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /^application\/json(?:;|$)/);
  assert.deepEqual(response.body, { status: "ok" });
  assert.equal(response.text, '{"status":"ok"}');

  for (const disclosure of ["version", "environment", "database", "git", "secret"]) {
    assert.ok(!response.text.toLowerCase().includes(disclosure));
  }
});

test("all three existing truthful public pages load", async () => {
  for (const path of ["/login.html", "/dashboard.html", "/race.html"]) {
    const response = await request(app()).get(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers["content-type"], /^text\/html(?:;|$)/, path);
    assert.match(response.text, /<!doctype html>/i, path);
  }
});

test("unknown routes and unsupported health methods use the exact JSON 404", async () => {
  for (const path of ["/not-a-route", "/api/not-a-route"]) {
    const response = await request(app()).get(path);
    assert.equal(response.status, 404, path);
    assert.deepEqual(response.body, { error: "Not found" });
  }

  for (const method of ["post", "put", "patch", "delete"]) {
    const response = await request(app())[method]("/api/health");
    assert.equal(response.status, 404, method.toUpperCase());
    assert.deepEqual(response.body, { error: "Not found" });
  }
});

test("HEAD and OPTIONS health requests use explicit safe 404 responses", async () => {
  const head = await request(app()).head("/api/health");
  assert.equal(head.status, 404);
  assert.match(head.headers["content-type"], /^application\/json(?:;|$)/);
  assert.equal(head.text, undefined);

  const options = await request(app()).options("/api/health");
  assert.equal(options.status, 404);
  assert.match(options.headers["content-type"], /^application\/json(?:;|$)/);
  assert.equal(options.text, '{"error":"Not found"}');
  assert.deepEqual(options.body, { error: "Not found" });
});

test("representative Helmet headers are present on health and HTML", async () => {
  for (const path of ["/api/health", "/login.html"]) {
    const response = await request(app()).get(path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers["content-security-policy"], path);
    assert.equal(response.headers["x-content-type-options"], "nosniff", path);
    assert.ok(response.headers["strict-transport-security"], path);
    assert.equal(response.headers["x-powered-by"], undefined, path);
  }
});

test("static directories neither redirect nor produce an index", async () => {
  const response = await request(app()).get("/assets/");
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: "Not found" });
  assert.equal(response.headers.location, undefined);
});
