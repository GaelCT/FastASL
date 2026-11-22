import logger from "../lib/logger.js";

/**
 * Final Express error middleware.
 *
 * Logs unexpected errors server-side (with redaction applied by the shared
 * logger), restricts expected client-error logs to safe status/type metadata,
 * and returns a stable, non-sensitive JSON failure response.
 * Client responses must never contain stack traces, filesystem paths,
 * database details, or other internals.
 *
 * Phase 1 has no authentication or database, so this middleware performs
 * no domain-specific error mapping.
 *
 * @param {unknown} error
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} _next
 */
export function errorHandler(error, req, res, _next) {
  const rawStatus =
    typeof error === "object" && error !== null
      ? (error.status ?? error.statusCode)
      : undefined;
  const status =
    Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
      ? rawStatus
      : 500;

  const requestLogger = req.log ?? logger;
  if (status < 500) {
    const metadata = { status };
    const type =
      typeof error === "object" && error !== null ? error.type : undefined;
    if (typeof type === "string" && /^[a-z0-9._-]{1,100}$/i.test(type)) {
      metadata.type = type;
    }
    requestLogger.error(metadata, "Request client error");
  } else {
    requestLogger.error({ err: error }, "Unhandled request error");
  }

  res.status(status).json({
    error: status >= 500 ? "Internal server error" : "Request failed",
  });
}
