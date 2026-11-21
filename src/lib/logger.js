import pino from "pino";

/**
 * Value written in place of any redacted field.
 */
export const REDACTED_VALUE = "[REDACTED]";

/**
 * Field names whose values must never appear in serialized logs,
 * at the top level or within representative nested objects.
 */
const SENSITIVE_FIELDS = [
  "password",
  "passwordHash",
  "sessionId",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
];

/**
 * Header names whose values must never appear in serialized logs.
 */
const SENSITIVE_HEADERS = ["authorization", "cookie", "set-cookie"];

/** How deep wildcard redaction paths reach (e.g. `*.*.*.password`). */
const MAX_WILDCARD_DEPTH = 4;

function wildcarded(paths, suffix) {
  paths.push(suffix);
  for (let depth = 1; depth <= MAX_WILDCARD_DEPTH; depth += 1) {
    const wildcards = Array.from({ length: depth }, () => "*").join(".");
    paths.push(`${wildcards}.${suffix}`);
  }
}

/**
 * Complete list of Pino redaction paths used by every FastASL logger.
 *
 * Covers request/response header captures emitted by pino-http
 * (`req.headers.*`, `res.headers.*`) plus sensitive named fields at the
 * top level and up to MAX_WILDCARD_DEPTH levels of nesting.
 */
export const LOG_REDACT_PATHS = (() => {
  const paths = [];

  for (const header of SENSITIVE_HEADERS) {
    paths.push(`req.headers.${header}`);
    paths.push(`res.headers.${header}`);
    wildcarded(paths, `headers."${header}"`);
    wildcarded(paths, `"${header}"`);
  }

  for (const field of SENSITIVE_FIELDS) {
    wildcarded(paths, field);
  }

  return paths;
})();

/**
 * Create a Pino logger with FastASL redaction applied.
 *
 * @param {object} [options]
 * @param {string} [options.level] Pino log level. Application callers pass
 *   the validated LOG_LEVEL from src/config/env.js.
 * @param {import("node:stream").Writable} [options.stream] Optional
 *   destination stream (used by tests to capture serialized output).
 * @returns {import("pino").Logger}
 */
export function createLogger(options = {}) {
  const { level = "info", stream } = options;
  return pino(
    {
      level,
      redact: {
        paths: LOG_REDACT_PATHS,
        censor: REDACTED_VALUE,
      },
    },
    stream,
  );
}

/**
 * Default application logger instance.
 */
const logger = createLogger();

export default logger;
