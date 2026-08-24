/**
 * HUMAN-3 — Environment contract.
 *
 * The human implements this file. AI must not fill in the implementation,
 * overwrite it, or duplicate its logic elsewhere.
 *
 * This is the ONLY application module allowed to read process.env
 * directly. Every other module receives validated configuration from the
 * export(s) defined here.
 *
 * Environment loading strategy:
 *   - `npm run dev` / `npm run start` use Node 24's built-in
 *     `--env-file-if-exists=.env`
 *     (https://nodejs.org/api/cli.html#--env-file-if-existsconfig).
 *   - Real environment variables supplied by the deployment environment
 *     take precedence over .env values.
 *   - No custom dotenv parser may be written or installed.
 *
 * What the human must define and implement with Zod
 * (https://zod.dev/):
 *
 *   NODE_ENV            Only development | test | production are valid.
 *                       Unknown values must FAIL, not silently fall back.
 *   HOST                Valid host representation with an intentional
 *                       default (e.g. loopback for development).
 *   PORT                A legal listening port (1-65535). Reject malformed
 *                       values ("abc", "-1", "70000", "080"?) — do not
 *                       accept a value merely because JS can coerce it to
 *                       a number.
 *   LOG_LEVEL           Restricted to reviewed Pino-compatible levels
 *                       (https://github.com/pinojs/pino/blob/main/docs/api.md#level-string).
 *   REQUEST_BODY_LIMIT  A bounded request-body policy. Bodies must never
 *                       be effectively unlimited.
 *
 * Invalid configuration behavior:
 *   Invalid supplied values must cause a CLEAR STARTUP FAILURE with a
 *   helpful message listing what was wrong. Do not silently replace an
 *   invalid production value with a default. Consider: PORT=abc,
 *   PORT=-1, PORT=70000, NODE_ENV=banana, LOG_LEVEL=madeup, and an
 *   invalid request limit — be able to explain exactly what happens for
 *   each at review.
 */

// TODO(HUMAN): add `import { z } from "zod";` when building the schema.

/**
 * Read process.env, validate it against the human-owned schema, and
 * return normalized configuration.
 *
 * @returns {{ NODE_ENV: string, HOST: string, PORT: number,
 *             LOG_LEVEL: string, REQUEST_BODY_LIMIT: string }}
 * @throws When any environment value fails validation.
 */
export function loadEnv() {
  // TODO(HUMAN): implement in HUMAN-3.
  throw new Error("TODO(HUMAN): implement environment validation (HUMAN-3)");
}
