import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { main, registerShutdown, startServer } from "../../src/server.js";

const quietLogger = {
  info() {},
  error() {},
};

function testConfig() {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 0,
    LOG_LEVEL: "silent",
    REQUEST_BODY_LIMIT: "100kb",
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("startServer listens on the injected host and port without registering signals", async () => {
  const server = http.createServer((_req, res) => res.end("ok"));
  const app = { listen: (...args) => server.listen(...args) };

  const listening = await startServer({ config: testConfig(), app, logger: quietLogger });
  try {
    assert.equal(listening, server);
    assert.equal(server.address().address, "127.0.0.1");
    assert.ok(server.address().port > 0);
    assert.equal(process.listenerCount("SIGINT"), 0);
    assert.equal(process.listenerCount("SIGTERM"), 0);
  } finally {
    await closeServer(server);
  }
});

test("startServer rejects asynchronous startup errors", async () => {
  const server = new EventEmitter();
  const app = {
    listen() {
      queueMicrotask(() => server.emit("error", new Error("port unavailable")));
      return server;
    },
  };

  await assert.rejects(
    startServer({ config: testConfig(), app, logger: quietLogger }),
    /port unavailable/,
  );
  assert.equal(server.listenerCount("listening"), 0);
});

test("startServer propagates synchronous listener setup errors", async () => {
  const app = {
    listen() {
      throw new Error("synchronous startup failure");
    },
  };
  await assert.rejects(
    startServer({ config: testConfig(), app, logger: quietLogger }),
    /synchronous startup failure/,
  );
});

class FakeServer extends EventEmitter {
  closeCount = 0;
  idleCloseCount = 0;

  close(callback) {
    this.closeCount += 1;
    this.closeCallback = callback;
  }

  closeIdleConnections() {
    this.idleCloseCount += 1;
  }

  finishClose(error) {
    this.closeCallback(error);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} gracefully closes once, retains listeners for duplicates, and cleans up afterward`, async (t) => {
    const signals = process;
    const initialSigintListeners = signals.listenerCount("SIGINT");
    const initialSigtermListeners = signals.listenerCount("SIGTERM");
    const server = new FakeServer();
    const messages = [];
    const logger = { info: (...args) => messages.push(args), error: (...args) => messages.push(args) };
    const shutdown = registerShutdown(server, { signals, logger });
    let closeFinished = false;

    t.after(async () => {
      const pending = shutdown(signal);
      if (!closeFinished && server.closeCallback) {
        closeFinished = true;
        server.finishClose();
      }
      await pending;
    });

    signals.emit(signal);
    signals.emit(signal);
    const duplicate = shutdown(signal);
    assert.equal(server.closeCount, 1);
    assert.equal(server.idleCloseCount, 1);
    assert.equal(signals.listenerCount("SIGINT"), initialSigintListeners + 1);
    assert.equal(signals.listenerCount("SIGTERM"), initialSigtermListeners + 1);

    server.finishClose();
    closeFinished = true;
    await duplicate;
    await shutdown(signal);
    assert.equal(server.closeCount, 1);
    assert.equal(messages.length, 1);
    assert.equal(signals.listenerCount("SIGINT"), initialSigintListeners);
    assert.equal(signals.listenerCount("SIGTERM"), initialSigtermListeners);
  });
}

test("shutdown waits for in-flight close and reports close failures", async () => {
  const signals = new EventEmitter();
  const server = new FakeServer();
  const errors = [];
  const shutdown = registerShutdown(server, {
    signals,
    logger: { info() {}, error: (...args) => errors.push(args) },
  });

  let settled = false;
  const pending = shutdown("SIGINT").then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(signals.listenerCount("SIGINT"), 1);
  assert.equal(signals.listenerCount("SIGTERM"), 1);
  server.finishClose(new Error("close failed"));
  await pending;
  assert.equal(errors.length, 1);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

test("importing server.js never opens a listener", () => {
  const serverPath = fileURLToPath(new URL("../../src/server.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(pathToFileURL(serverPath).href)});`],
    { encoding: "utf8", timeout: 20000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
});

test("main reports startup failures with a nonzero exit code", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    const result = await main({
      config: testConfig(),
      app: { listen() { throw new Error("expected main failure"); } },
      logger: quietLogger,
    });
    assert.equal(result, null);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});
