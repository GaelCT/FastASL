import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../src/config/env.js";

const DEFAULTS = {
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  PORT: 3000,
  LOG_LEVEL: "info",
  REQUEST_BODY_LIMIT: "100kb",
};

test("loadEnv applies every Phase 1 default to an absent source", () => {
  assert.deepEqual(loadEnv({}), DEFAULTS);
});

test("loadEnv accepts and normalizes valid explicit values", () => {
  const source = {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    PORT: "65535",
    LOG_LEVEL: "silent",
    REQUEST_BODY_LIMIT: "1kb",
  };
  const snapshot = { ...source };

  assert.deepEqual(loadEnv(source), {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    PORT: 65535,
    LOG_LEVEL: "silent",
    REQUEST_BODY_LIMIT: "1kb",
  });
  assert.deepEqual(source, snapshot, "the supplied source must not be mutated");
});

test("loadEnv accepts every reviewed environment and log level", () => {
  for (const NODE_ENV of ["development", "test", "production"]) {
    assert.equal(loadEnv({ NODE_ENV }).NODE_ENV, NODE_ENV);
  }
  for (const LOG_LEVEL of ["fatal", "error", "warn", "info", "debug", "trace", "silent"]) {
    assert.equal(loadEnv({ LOG_LEVEL }).LOG_LEVEL, LOG_LEVEL);
  }
});

const invalidCases = [
  ["NODE_ENV", ["", "banana", "Development", " development"]],
  ["HOST", ["", " ", "two words", "host\tname", "a".repeat(256)]],
  ["PORT", ["", "abc", "-1", "0", "70000", "080", "01", "1.5", "+1", " 3000", "3000 "]],
  ["LOG_LEVEL", ["", "madeup", "INFO", " info"]],
  ["REQUEST_BODY_LIMIT", ["", "kb", "100", "0kb", "-1kb", "1.5kb", "01kb", "101kb", "1KB", "1Kb", " 1kb", "1kb ", "1000kb"]],
];

for (const [field, values] of invalidCases) {
  test(`loadEnv rejects malformed ${field} values without exposing their contents`, () => {
    for (const value of values) {
      assert.throws(
        () => loadEnv({ [field]: value }),
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Invalid environment configuration/);
          assert.ok(error.message.includes(field), `error should name ${field}`);
          if (value.length > 20) {
            assert.ok(!error.message.includes(value), "error must not echo a supplied secret-sized value");
          }
          return true;
        },
        `expected ${field}=${JSON.stringify(value)} to fail`,
      );
    }
  });
}

test("loadEnv reports all failing fields in one startup-safe error", () => {
  assert.throws(
    () => loadEnv({ PORT: "abc", LOG_LEVEL: "verbose" }),
    /Invalid environment configuration:.*PORT.*LOG_LEVEL/s,
  );
});
