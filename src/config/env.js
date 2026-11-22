import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z
    .string()
    .regex(/^\S{1,255}$/, "Must contain 1-255 non-whitespace characters")
    .default("127.0.0.1"),
  PORT: z
    .string()
    .regex(/^[1-9][0-9]*$/, "Must be a canonical decimal integer")
    .transform(Number)
    .refine((port) => port <= 65535, "Must be between 1 and 65535")
    .default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  REQUEST_BODY_LIMIT: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)kb$/, "Must be an integer from 1kb through 100kb")
    .default("100kb"),
});

/**
 * Validate Phase 1 environment configuration without mutating the source or
 * including supplied environment values in validation errors.
 *
 * @param {object} [source]
 * @returns {{ NODE_ENV: string, HOST: string, PORT: number,
 *   LOG_LEVEL: string, REQUEST_BODY_LIMIT: string }}
 */
export function loadEnv(source = process.env) {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
