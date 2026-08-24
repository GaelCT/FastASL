/**
 * Middleware for requests that no earlier static or API route matched.
 *
 * Produces a small, safe 404 JSON response. It must never reveal
 * filesystem information, stack traces, or candidate route names.
 *
 * This middleware intentionally does not implement authentication
 * behavior and is not an SPA catch-all router.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
export function notFoundHandler(req, res) {
  res.status(404).json({ error: "Not found" });
}
