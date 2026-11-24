import assert from "node:assert/strict";
import test from "node:test";

import {
  validateMysqlTestConfig,
  withMysqlTestConnection,
} from "./support/harness.js";

function validConfig(overrides = {}) {
  return {
    NODE_ENV: "test",
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3306",
    MYSQL_DATABASE: "fastasl_test",
    MYSQL_USER: "fastasl_test",
    MYSQL_PASSWORD: "not-a-real-password",
    MYSQL_CONNECTION_LIMIT: "2",
    MYSQL_TEST_ALLOW_DESTRUCTIVE: "true",
    ...overrides,
  };
}

test("configuration is required before any connection or reset", () => {
  const config = validConfig();
  delete config.MYSQL_PASSWORD;

  assert.throws(
    () => validateMysqlTestConfig(config),
    /incomplete.*MYSQL_PASSWORD/,
  );
});

test("unsafe or malformed configuration fails clearly", () => {
  const cases = [
    [{ NODE_ENV: "development" }, /NODE_ENV=test/],
    [{ MYSQL_DATABASE: "fastasl" }, /MYSQL_DATABASE=fastasl_test/],
    [{ MYSQL_HOST: "db.example.test" }, /loopback MYSQL_HOST/],
    [
      { MYSQL_TEST_ALLOW_DESTRUCTIVE: "false" },
      /MYSQL_TEST_ALLOW_DESTRUCTIVE=true/,
    ],
    [{ MYSQL_USER: "root" }, /must not use the root user/],
    [{ MYSQL_PORT: "not-a-port" }, /MYSQL_PORT must be a positive/],
    [
      { MYSQL_CONNECTION_LIMIT: "0" },
      /MYSQL_CONNECTION_LIMIT must be a positive/,
    ],
  ];

  for (const [override, message] of cases) {
    assert.throws(() => validateMysqlTestConfig(validConfig(override)), message);
  }
});

test("real MySQL authenticates, selects, uses 8.4.9 and UTC, then closes", async () => {
  let capturedConnection;

  await withMysqlTestConnection(async (connection, config) => {
    capturedConnection = connection;
    const [rows] = await connection.query(
      `SELECT VERSION() AS version,
        @@global.time_zone AS globalTimeZone,
        @@session.time_zone AS sessionTimeZone,
        CURRENT_USER() AS authenticatedUser,
        DATABASE() AS databaseName,
        42 AS selectValue`,
    );

    assert.equal(rows.length, 1);
    assert.match(rows[0].version, /^8\.4\.9(?:[-.]|$)/);
    assert.equal(rows[0].globalTimeZone, "+00:00");
    assert.equal(rows[0].sessionTimeZone, "+00:00");
    assert.ok(rows[0].authenticatedUser.startsWith(`${config.user}@`));
    assert.doesNotMatch(rows[0].authenticatedUser, /^root@/i);
    assert.equal(rows[0].databaseName, "fastasl_test");
    assert.equal(rows[0].selectValue, 42);
  });

  await assert.rejects(capturedConnection.query("SELECT 1"), /closed/i);
});

test("connection and pool close when the test callback fails", async () => {
  let capturedConnection;
  const callbackFailure = new Error("intentional callback failure");

  await assert.rejects(
    withMysqlTestConnection(async (connection) => {
      capturedConnection = connection;
      throw callbackFailure;
    }),
    (error) => error === callbackFailure,
  );

  await assert.rejects(capturedConnection.query("SELECT 1"), /closed/i);
});
