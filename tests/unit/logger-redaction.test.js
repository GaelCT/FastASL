import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createLogger, REDACTED_VALUE } from "../../src/lib/logger.js";

const SENTINELS = {
  password: "SECRET_PASSWORD_SENTINEL",
  passwordHash: "SECRET_PASSWORD_HASH_SENTINEL",
  cookie: "SECRET_COOKIE_SENTINEL",
  authorization: "SECRET_AUTHORIZATION_SENTINEL",
  setCookie: "SECRET_SET_COOKIE_SENTINEL",
  sessionId: "SECRET_SESSION_SENTINEL",
  secret: "SECRET_SECRET_SENTINEL",
  token: "SECRET_TOKEN_SENTINEL",
  accessToken: "SECRET_ACCESS_TOKEN_SENTINEL",
  refreshToken: "SECRET_REFRESH_TOKEN_SENTINEL",
};

function createLogSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  return {
    stream,
    text() {
      return chunks.join("");
    },
  };
}

async function waitForFlush(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("serialized log output never flushed");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("sensitive values are absent from serialized log output", async () => {
  const sink = createLogSink();
  const logger = createLogger({ level: "info", stream: sink.stream });

  logger.info(
    {
      password: SENTINELS.password,
      passwordHash: SENTINELS.passwordHash,
      secret: SENTINELS.secret,
      token: SENTINELS.token,
      accessToken: SENTINELS.accessToken,
      refreshToken: SENTINELS.refreshToken,
      sessionId: SENTINELS.sessionId,
    },
    "top-level credential probe",
  );

  logger.info(
    {
      user: { account: { password: SENTINELS.password, secret: SENTINELS.secret } },
      session: { sessionId: SENTINELS.sessionId },
      auth: { token: SENTINELS.token, refreshToken: SENTINELS.refreshToken },
      req: {
        headers: {
          authorization: SENTINELS.authorization,
          cookie: SENTINELS.cookie,
        },
      },
      res: {
        headers: {
          "set-cookie": [SENTINELS.setCookie],
        },
      },
    },
    "nested credential probe",
  );

  await waitForFlush(() => sink.text().includes("nested credential probe"));

  const serialized = sink.text();
  for (const [field, sentinel] of Object.entries(SENTINELS)) {
    assert.ok(
      !serialized.includes(sentinel),
      `expected ${field} sentinel to be redacted from serialized logs`,
    );
  }

  for (const marker of ["top-level credential probe", "nested credential probe"]) {
    assert.ok(serialized.includes(marker), `expected log event "${marker}" to be present`);
  }
});

test("redacted placeholders appear in place of sensitive values", async () => {
  const sink = createLogSink();
  const logger = createLogger({ level: "info", stream: sink.stream });

  logger.info({ password: SENTINELS.password }, "placeholder probe");
  await waitForFlush(() => sink.text().includes("placeholder probe"));

  const lines = sink
    .text()
    .split("\n")
    .filter((line) => line.includes("placeholder probe"));
  assert.equal(lines.length, 1);

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.password, REDACTED_VALUE);
});
