/**
 * HUMAN-2 — Server lifecycle.
 *
 * The human implements this file. AI must not fill in the implementation,
 * overwrite it, or duplicate its logic elsewhere.
 *
 * What the human must implement here:
 *
 * 1.  Import validated configuration from src/config/env.js (HUMAN-3).
 *     Configuration must be loaded and validated BEFORE listening.
 * 2.  Import/create the Express application via createApp() from
 *     src/app.js (HUMAN-1).
 * 3.  Start the listener on the configured host and port
 *     (https://nodejs.org/api/http.html#serverlisten).
 * 4.  Handle startup failure (e.g. port in use) with a clear message and
 *     a non-zero exit.
 * 5.  Handle SIGINT and SIGTERM:
 *     https://nodejs.org/api/process.html#signal-events
 * 6.  On shutdown: stop accepting new connections, close idle ones, let
 *     in-flight requests finish, then allow the process to exit.
 *     https://nodejs.org/api/http.html#serverclose
 * 7.  Guard against duplicate shutdown handling.
 *
 * Do NOT add database/pool closure here — Phase 1 has no database.
 *
 * Separation rule (be able to explain this at review):
 *   - src/app.js creates/configures the Express application.
 *   - src/server.js owns the network process lifecycle.
 *   This separation lets integration tests import the app without
 *   binding a real TCP port.
 */

/**
 * Start the FastASL server process.
 *
 * @returns {void}
 */
export function main() {
  // TODO(HUMAN): implement in HUMAN-2.
  //
  // Intended shape (guidance only, not the implementation):
  //   const config = loadEnv();
  //   const app = createApp();
  //   const server = app.listen(config.PORT, config.HOST, onListening);
  //   register graceful SIGINT/SIGTERM handling for `server`.
  throw new Error("TODO(HUMAN): implement server lifecycle (HUMAN-2)");
}

// TODO(HUMAN): call main() when this module is executed directly, so that
// importing src/server.js never opens a listener by accident. See
// https://nodejs.org/api/modules.html#the-module-scope __filename /
// import.meta.url comparison patterns for ESM entrypoint detection.
