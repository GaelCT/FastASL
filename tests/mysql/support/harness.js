import mysql from "mysql2/promise";

const TEST_DATABASE = "fastasl_test";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const REQUIRED_VARIABLES = [
  "NODE_ENV",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_CONNECTION_LIMIT",
  "MYSQL_TEST_ALLOW_DESTRUCTIVE",
];

let activeSuiteLock;

function readPositiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive decimal integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`);
  }
  return parsed;
}

export function validateMysqlTestConfig(env = process.env) {
  const missing = REQUIRED_VARIABLES.filter(
    (name) => env[name] === undefined || String(env[name]).trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `MySQL test configuration is incomplete; set: ${missing.join(", ")}.`,
    );
  }

  if (env.NODE_ENV !== "test") {
    throw new Error('MySQL tests require NODE_ENV=test.');
  }
  if (env.MYSQL_DATABASE !== TEST_DATABASE) {
    throw new Error('MySQL tests require MYSQL_DATABASE=fastasl_test.');
  }
  if (!LOOPBACK_HOSTS.has(env.MYSQL_HOST)) {
    throw new Error(
      "MySQL tests require a loopback MYSQL_HOST (127.0.0.1 or ::1).",
    );
  }
  if (env.MYSQL_TEST_ALLOW_DESTRUCTIVE !== "true") {
    throw new Error(
      "MySQL tests require MYSQL_TEST_ALLOW_DESTRUCTIVE=true because only fastasl_test is reset.",
    );
  }
  if (env.MYSQL_USER.trim().toLowerCase() === "root") {
    throw new Error("MySQL application tests must not use the root user.");
  }

  return {
    host: env.MYSQL_HOST,
    port: readPositiveInteger(env.MYSQL_PORT, "MYSQL_PORT", 65535),
    database: env.MYSQL_DATABASE,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    connectionLimit: readPositiveInteger(
      env.MYSQL_CONNECTION_LIMIT,
      "MYSQL_CONNECTION_LIMIT",
      100,
    ),
  };
}

function createTestPool(config) {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    timezone: "Z",
    connectTimeout: 5000,
  });
}

async function getTestConnection(pool, config) {
  try {
    return await pool.getConnection();
  } catch (error) {
    const reason = error.code || error.message;
    throw new Error(
      `Unable to connect to real MySQL at ${config.host}:${config.port}/${config.database}: ${reason}. Check the local service and .env.test.`,
      { cause: error },
    );
  }
}

function quoteIdentifier(identifier) {
  return `\`${identifier.replaceAll("`", "``")}\``;
}

async function resetTestDatabase(connection) {
  // Reset objects only: the provisioned test database and its grants survive.
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    const [objects] = await connection.query(
      `SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME`,
      [TEST_DATABASE],
    );

    for (const object of objects) {
      if (object.tableType !== "VIEW") {
        continue;
      }
      await connection.query(
        `DROP VIEW IF EXISTS ${quoteIdentifier(TEST_DATABASE)}.${quoteIdentifier(object.tableName)}`,
      );
    }
    for (const object of objects) {
      if (object.tableType !== "BASE TABLE") {
        continue;
      }
      await connection.query(
        `DROP TABLE IF EXISTS ${quoteIdentifier(TEST_DATABASE)}.${quoteIdentifier(object.tableName)}`,
      );
    }
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  }
}

async function acquireTestLock(connection) {
  const [rows] = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [
    TEST_DATABASE,
  ]);
  if (rows[0].acquired !== 1) {
    throw new Error(
      "MySQL test advisory lock fastasl_test is already held; concurrent test suites are not allowed.",
    );
  }
}

async function releaseTestLock(connection) {
  await connection.query("SELECT RELEASE_LOCK(?)", [TEST_DATABASE]);
}

export async function acquireMysqlTestSuiteLock(env = process.env) {
  if (activeSuiteLock) {
    throw new Error("This process already holds the MySQL test suite lock.");
  }

  const config = validateMysqlTestConfig(env);
  const pool = createTestPool(config);
  let connection;
  try {
    connection = await getTestConnection(pool, config);
    await acquireTestLock(connection);
  } catch (error) {
    connection?.release();
    await pool.end();
    throw error;
  }

  const suiteLock = { connection, pool };
  activeSuiteLock = suiteLock;
  let released = false;

  return async () => {
    if (released) {
      return;
    }
    released = true;
    try {
      await releaseTestLock(connection);
    } finally {
      activeSuiteLock = undefined;
      connection.release();
      await pool.end();
    }
  };
}

export async function withMysqlTestConnection(callback, env = process.env) {
  const config = validateMysqlTestConfig(env);
  const pool = createTestPool(config);

  let connection;
  let lockAcquired = false;
  try {
    connection = await getTestConnection(pool, config);
    if (!activeSuiteLock) {
      await acquireTestLock(connection);
      lockAcquired = true;
    }
    await resetTestDatabase(connection);
    return await callback(connection, config);
  } finally {
    try {
      if (lockAcquired) {
        await releaseTestLock(connection);
      }
    } finally {
      connection?.release();
      await pool.end();
    }
  }
}
