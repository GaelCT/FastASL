import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test, { after, before } from "node:test";
import { promisify } from "node:util";

import {
  acquireMysqlTestSuiteLock,
  validateMysqlTestConfig,
  withMysqlTestConnection,
} from "./support/harness.js";

const execFileAsync = promisify(execFile);
let releaseSuiteLock;

before(async () => {
  releaseSuiteLock = await acquireMysqlTestSuiteLock();
});

after(async () => {
  if (!releaseSuiteLock) {
    return;
  }
  await releaseSuiteLock();
  await withMysqlTestConnection(async (connection) => {
    const [rows] = await connection.query("SELECT 1 AS value");
    assert.equal(rows[0].value, 1);
  });
});

function validConfig(overrides = {}) {
  return {
    NODE_ENV: "test",
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3306",
    MYSQL_DATABASE: "fastasl_test",
    MYSQL_USER: "fastasl_test",
    MYSQL_PASSWORD: "not-a-real-password",
    MYSQL_CONNECTION_LIMIT: "10",
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
    [
      { MYSQL_CONNECTION_LIMIT: "101" },
      /MYSQL_CONNECTION_LIMIT must be between 1 and 100/,
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

test("reset drops schema objects without dropping the database", async () => {
  await withMysqlTestConnection(async (connection) => {
    await connection.query(
      "CREATE TABLE reset_probe (id INT PRIMARY KEY) ENGINE = InnoDB",
    );
    await connection.query(
      "CREATE VIEW reset_probe_view AS SELECT id FROM reset_probe",
    );
  });

  await withMysqlTestConnection(async (connection) => {
    const [schemas] = await connection.query(
      "SELECT SCHEMA_NAME AS schemaName FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      ["fastasl_test"],
    );
    const [objects] = await connection.query(
      "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
      ["fastasl_test"],
    );

    assert.deepEqual(schemas, [{ schemaName: "fastasl_test" }]);
    assert.deepEqual(objects, []);
  });
});

test("a concurrent suite fails before its callback while this suite continues", async () => {
  const harnessUrl = new URL("./support/harness.js", import.meta.url).href;
  const program = `
    import { withMysqlTestConnection } from ${JSON.stringify(harnessUrl)};
    await withMysqlTestConnection(async () => {
      console.log("concurrent suite callback ran");
    });
  `;

  await assert.rejects(
    execFileAsync(process.execPath, ["--input-type=module", "--eval", program], {
      env: process.env,
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(
        error.stderr,
        /advisory lock fastasl_test is already held/,
      );
      assert.doesNotMatch(error.stdout, /concurrent suite callback ran/);
      return true;
    },
  );

  await withMysqlTestConnection(async (connection) => {
    const [rows] = await connection.query("SELECT 1 AS value");
    assert.equal(rows[0].value, 1);
  });
});
