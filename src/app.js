import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { createHealthRouter } from "./routes/health.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { createPublicStaticMiddleware } from "./middleware/public-static.js";

const PUBLIC_ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const SAFE_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "content-length",
  "content-type",
  "host",
  "user-agent",
]);

/** Keep reviewed request metadata without queries or unlisted header values. */
function serializeRequest(req) {
  const serialized = pinoHttp.stdSerializers.req(req);
  return {
    id: serialized.id,
    method: serialized.method,
    url:
      typeof serialized.url === "string"
        ? serialized.url.split("?", 1)[0]
        : serialized.url,
    headers: Object.fromEntries(
      Object.entries(serialized.headers ?? {}).filter(([name]) =>
        SAFE_REQUEST_HEADERS.has(name),
      ),
    ),
    remoteAddress: serialized.remoteAddress,
    remotePort: serialized.remotePort,
  };
}

/** Compose the Express application without opening a network listener. */
export function createApp(config = loadEnv(), options = {}) {
  const app = express();
  const logger = options.logger ?? createLogger({ level: config.LOG_LEVEL });

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      serializers: { req: serializeRequest },
    }),
  );
  app.use(express.json({ limit: config.REQUEST_BODY_LIMIT }));
  app.use(createPublicStaticMiddleware(PUBLIC_ROOT));
  app.use("/api", createHealthRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
