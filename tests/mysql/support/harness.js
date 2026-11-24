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
    ),
  };
}

async function resetTestDatabase(connection) {
  // TEST_DATABASE is validated above; never interpolate a caller-provided name.
  await connection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
  await connection.query(
    `CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await connection.query(`USE \`${TEST_DATABASE}\``);
}

export async function withMysqlTestConnection(callback, env = process.env) {
  const config = validateMysqlTestConfig(env);
  const pool = mysql.createPool({
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

  let connection;
  try {
    try {
      connection = await pool.getConnection();
    } catch (error) {
      const reason = error.code || error.message;
      throw new Error(
        `Unable to connect to real MySQL at ${config.host}:${config.port}/${config.database}: ${reason}. Check the local service and .env.test.`,
        { cause: error },
      );
    }

    await resetTestDatabase(connection);
    return await callback(connection, config);
  } finally {
    connection?.release();
    await pool.end();
  }
}
