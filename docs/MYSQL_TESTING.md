# Real MySQL testing

The MySQL suite is a destructive, real-service smoke gate. It does not use an
in-memory database, a fake server, or test skips. It resets **only** the
`fastasl_test` database, so it must never share a database with development or
production data.

## Reviewed version and CI image

Use the MySQL **8.4.9 LTS** server patch locally and in CI. The reviewed CI
image is pinned by this multi-architecture manifest digest:

```text
mysql:8.4.9@sha256:c36050afdca850f23cef85703f84c7531a5ae155a11b5ee1c60acb09937c4084
```

Do not substitute a floating `8.4` or `latest` tag. The connection test
checks the server patch as well as authentication, `SELECT`, UTC, and cleanup.

## Native local setup (no Docker required)

Install MySQL Server 8.4.9 using the official MySQL installer or a native
package manager. Do not install a different patch and assume it is equivalent;
confirm the version before running the suite. The workflow itself never installs
system software or starts, stops, or restarts a database service.

Configure the server's system-wide option file with UTC, then use the normal
service lifecycle for the operating system:

```ini
[mysqld]
default-time-zone=+00:00
```

Typical human-operated lifecycle commands are below. Service names can differ
by installation; use the name shown by the installer or operating system.

```shell
# Ubuntu/Debian
sudo systemctl start mysql
sudo systemctl status mysql
sudo systemctl restart mysql
sudo systemctl stop mysql

# macOS with the native Homebrew MySQL 8.4 formula
brew services start mysql@8.4
brew services list
brew services restart mysql@8.4
brew services stop mysql@8.4
```

On Windows, use the MySQL installer/service console, or run `net start MySQL84`
and `net stop MySQL84` from an elevated terminal when `MySQL84` is the installed
service name.

### Create the disposable database and application user

For the one-time local setup, a person can sign in as the MySQL administrator.
Do not put a password on this command line or in a tracked file:

```shell
mysql --host=127.0.0.1 --user=root --password
```

Then run these statements, replacing the placeholder locally with a unique test
password. Root is used only for this administrative setup, never by application
tests.

```sql
CREATE DATABASE fastasl_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'fastasl_test'@'127.0.0.1'
  IDENTIFIED BY 'replace-with-a-local-only-test-password';
GRANT ALL PRIVILEGES ON fastasl_test.*
  TO 'fastasl_test'@'127.0.0.1';
```

`DROP`, `CREATE`, and `ALTER` privileges on `fastasl_test` are intentional: the
smoke harness drops tables and views inside that database for a clean run while
preserving the database itself and its grants. Do not grant this application
account privileges on any other database. If using `::1` instead of `127.0.0.1`,
create a matching narrowly scoped MySQL account for that loopback address.

Check the server without exposing the password in shell history:

```shell
mysql --host=127.0.0.1 --user=fastasl_test --password \
  --execute "SELECT VERSION(), @@global.time_zone, @@session.time_zone;"
```

Both time zones must be `+00:00`.

## Provision each issue worktree

Each issue worktree needs its own `.env.test`, even when those worktrees point
at the same local MySQL service. `.env.test` is ignored by Git; do not print,
stage, commit, or copy its real password into documentation.

From the worktree root:

```shell
cp .env.example .env.test
chmod 600 .env.test
```

On PowerShell, use `Copy-Item .env.example .env.test` and apply equivalent
user-only file permissions. Edit `.env.test` so the test section contains:

```dotenv
NODE_ENV=test
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=fastasl_test
MYSQL_USER=fastasl_test
MYSQL_PASSWORD=<the-local-only-test-password>
MYSQL_CONNECTION_LIMIT=10
MYSQL_TEST_ALLOW_DESTRUCTIVE=true
```

`MYSQL_HOST` must be the literal loopback address `127.0.0.1` or `::1`.
`MYSQL_PORT` must be from 1 through 65535, and `MYSQL_CONNECTION_LIMIT` must be
an integer from 1 through 100. The database, user, password, connection limit,
and destructive-test opt-in are all required; the example deliberately ships
with an empty password and the destructive safeguard set to `false`.

Node loads `.env.test` only for `test:mysql`. Values already present in the
process environment take precedence, so inspect the shell environment if a
checked value appears stale. Never use `.env` or production credentials for this
suite.

## Run and clean up

Install the exact dependency lockfile and run the gates from the worktree root:

```shell
npm ci
npm ls mysql2 --depth=0
npm test
npm run test:mysql
npm run check
```

`npm test` remains database-free and includes only `tests/unit/*.test.js` and
`tests/integration/*.test.js`. `test:mysql` runs the real suite serially.
`check` runs lint, the database-free tests, and then `test:mysql`; a missing or
unavailable MySQL service therefore fails the full gate.

The harness acquires one dedicated connection from a bounded pool, then acquires
the server-wide `fastasl_test` advisory lock with a zero-second timeout. It holds
the lock through the object reset and callback, and releases the lock,
connection, and pool in `finally`, on success and failure. A concurrent suite on
the same MySQL service fails immediately with a held-lock error rather than
resetting objects underneath the active suite. A failed callback is rethrown
rather than hidden. A service connection failure identifies the loopback host,
port, and database without printing the password.

Missing variables, a non-test `NODE_ENV`, a database other than `fastasl_test`,
a non-loopback host, the `root` user, malformed numeric values, or a disabled
destructive safeguard fail before any reset. There is no skip or fake fallback.
A second local worktree attempting to run the suite against the same MySQL
service receives the held-lock failure and never reaches the reset or callback.
Wait for the active suite to finish, then rerun the failed command.

After testing, stop the native service through the lifecycle command above if it
is not needed. To remove the disposable local objects entirely, a person can use
the administrative client and run `DROP DATABASE fastasl_test;` and
`DROP USER 'fastasl_test'@'127.0.0.1';`. This manual teardown is not part of the
automated test command.

## CI behavior

GitHub Actions starts an isolated, disposable MySQL service with CI-only root
and application passwords, publishes container port 3306, sets UTC, and waits
for `mysqladmin ping` health checks. Application tests use only the non-root
`fastasl_test` account. After the service is healthy, CI runs the same
`npm run check` command without skipping MySQL. The workflow preserves
`permissions: contents: read`.

## Optional Docker Compose alternative

Docker Compose is **not implemented** in this card. There is intentionally no
Compose file to run. A future separately reviewed card may add an optional
Compose path using the same server patch and image digest, but it is neither
required for native local testing nor a substitute for the real MySQL gate.
