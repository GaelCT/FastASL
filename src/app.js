/**
 * HUMAN-1 — Express application composition.
 *
 * The human implements this file. AI must not fill in the implementation,
 * overwrite it, or duplicate its logic elsewhere.
 *
 * What the human must implement here:
 *
 * 1.  Create the Express application. Do NOT call listen() in this file —
 *     network lifecycle belongs to src/server.js (HUMAN-2).
 * 2.  Disable the `x-powered-by` header
 *     (https://expressjs.com/en/api.html#app.settings.table).
 * 3.  Add bounded JSON body parsing
 *     (https://expressjs.com/en/api.html#express.json). Use the validated
 *     REQUEST_BODY_LIMIT from src/config/env.js once HUMAN-3 exists.
 * 4.  Mount Helmet early for baseline security headers
 *     (https://helmetjs.github.io/).
 * 5.  Mount request logging with pino-http using the shared redaction
 *     config from src/lib/logger.js.
 * 6.  Serve static files from exactly public/
 *     (https://expressjs.com/en/starter/static-files.html).
 *     NEVER pass the repository root to express.static().
 * 7.  Mount API routes under /api.
 * 8.  Mount the not-found middleware, then the error middleware last.
 *
 * Conceptual middleware order (the human should be able to justify the
 * final order):
 *
 *   create app -> disable x-powered-by -> security headers -> request
 *   logging -> body parsing -> static public/ -> /api routes -> 404 ->
 *   error handler
 *
 * Suggested first steps:
 *   import express from "express";
 *   import helmet from "helmet";
 * then build createApp() one middleware at a time, running `npm run lint`
 * and the integration tests as you go.
 */

/**
 * Create and configure the FastASL Express application.
 *
 * @returns {import("express").Express} The configured application (no
 *   active network listener).
 */
export function createApp() {
  // TODO(HUMAN): implement in HUMAN-1.
  throw new Error("TODO(HUMAN): implement Express app composition (HUMAN-1)");
}
