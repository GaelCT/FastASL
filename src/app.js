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

/** Compose the Express application without opening a network listener. */
export function createApp(config = loadEnv()) {
  const app = express();
  const logger = createLogger({ level: config.LOG_LEVEL });

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: config.REQUEST_BODY_LIMIT }));
  app.use(createPublicStaticMiddleware(PUBLIC_ROOT));
  app.use("/api", createHealthRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
