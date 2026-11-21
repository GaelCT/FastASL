import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import defaultLogger, { createLogger } from "./lib/logger.js";

/** Start a listener and reject if startup fails before the listening event. */
export async function startServer({
  config = loadEnv(),
  app = createApp(config),
  logger = createLogger({ level: config.LOG_LEVEL }),
} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = app.listen(config.PORT, config.HOST);

    function onListening() {
      server.removeListener("error", onError);
      logger.info({ address: server.address() }, "Server listening");
      resolvePromise(server);
    }

    function onError(error) {
      server.removeListener("listening", onListening);
      rejectPromise(error);
    }

    server.once("listening", onListening);
    server.once("error", onError);
  });
}

/** Register SIGINT/SIGTERM handlers and return an idempotent shutdown action. */
export function registerShutdown(server, { signals = process, logger = console } = {}) {
  let shutdownPromise;

  function shutdown(signal) {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      signals.removeListener("SIGINT", onSignal);
      signals.removeListener("SIGTERM", onSignal);

      try {
        await new Promise((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) {
              rejectClose(error);
            } else {
              resolveClose();
            }
          });
          if (typeof server.closeIdleConnections === "function") {
            server.closeIdleConnections();
          }
        });
        logger.info({ signal }, "Server shutdown complete");
      } catch (error) {
        logger.error({ err: error, signal }, "Server shutdown failed");
      }
    })();

    return shutdownPromise;
  }

  function onSignal(signal) {
    void shutdown(signal);
  }

  signals.on("SIGINT", onSignal);
  signals.on("SIGTERM", onSignal);
  return shutdown;
}

/** Start the real server and arrange graceful process shutdown. */
export async function main(options = {}) {
  let logger = options.logger ?? defaultLogger;
  try {
    const config = options.config ?? loadEnv();
    if (!options.logger) {
      logger = createLogger({ level: config.LOG_LEVEL });
    }
    const app = options.app ?? createApp(config);
    const server = await startServer({ config, app, logger });
    registerShutdown(server, { logger });
    return server;
  } catch (error) {
    logger.error({ err: error }, "Server startup failed");
    process.exitCode = 1;
    return null;
  }
}

const isDirectEntry =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectEntry) {
  await main();
}
