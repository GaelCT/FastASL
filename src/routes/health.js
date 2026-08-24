/**
 * HUMAN-2 — Health route.
 *
 * The human implements this file. AI must not fill in the implementation,
 * overwrite it, or duplicate its logic elsewhere.
 *
 * What the human must implement here:
 *
 * 1.  Create an Express Router
 *     (https://expressjs.com/en/4x/api.html#router — same API in Express 5).
 * 2.  Add GET /health on the router. The app mounts this router under
 *     /api, so the public path becomes GET /api/health.
 * 3.  Return a minimal, stable, non-versioned JSON body that contains no
 *     environment secrets, no database information, and no git commit
 *     information.
 *
 * The exact response contract is human-owned: choose it deliberately,
 * then write the matching exact assertions in
 * tests/integration/health.test.js (HUMAN-3).
 *
 * Conceptual example (guidance only — the final body is the human's
 * decision):
 *
 *   { "status": "ok" }
 */

/**
 * Create the health router mounted under /api by src/app.js.
 *
 * @returns {import("express").Router}
 */
export function createHealthRouter() {
  // TODO(HUMAN): implement in HUMAN-2.
  throw new Error("TODO(HUMAN): implement health route (HUMAN-2)");
}
