import { test } from "node:test";
import assert from "node:assert/strict";
import { createRaceController } from "../../public/assets/js/race-controller.js";
import { ApiError } from "../../public/assets/js/api.js";

const RACE_ID = "123e4567-e89b-42d3-a456-426614174000";
function race(durationSeconds = 30) {
  return {
    id: RACE_ID,
    prompt: "server <b>prompt</b> 😀",
    durationSeconds,
    startedAt: "2026-11-22T12:00:00.000Z",
    serverNow: "2026-11-22T12:00:00.000Z",
    expiresAt: new Date(Date.parse("2026-11-22T12:00:00.000Z") + durationSeconds * 1000).toISOString(),
    inputMethod: "keyboard",
    ranked: false,
  };
}
const result = {
  raceId: RACE_ID,
  durationSeconds: 30,
  wpm: 12.34,
  accuracy: 56.78,
  correctCharacters: 2,
  typedCharacters: 3,
  elapsedMs: 1234,
  inputMethod: "keyboard",
  ranked: false,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness({ createRace, completeRace } = {}) {
  const states = [];
  const timers = [];
  const calls = { creates: [], completions: [] };
  const api = {
    createRace: createRace ?? (async (durationSeconds, options) => {
      calls.creates.push({ durationSeconds, options });
      return race(durationSeconds);
    }),
    completeRace: completeRace ?? (async (...args) => {
      calls.completions.push(args);
      return result;
    }),
  };
  const controller = createRaceController({
    api,
    onChange: (state) => states.push(state),
    timer(options) {
      const handle = { options, disposed: 0, dispose() { this.disposed += 1; } };
      timers.push(handle);
      return handle;
    },
  });
  return { states, timers, calls, controller, api };
}

for (const durationSeconds of [30, 60]) {
  test(`start creates a real ${durationSeconds}-second race and starts its server-time countdown`, async () => {
    const h = harness();
    await h.controller.start(durationSeconds);
    assert.equal(h.calls.creates.length, 1);
    assert.equal(h.calls.creates[0].durationSeconds, durationSeconds);
    assert.equal(h.states.at(-1).status, "active");
    assert.equal(h.states.at(-1).race.prompt, race(durationSeconds).prompt);
    assert.equal(h.states.at(-1).remainingMs, durationSeconds * 1000);
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].options.expiresAt, race(durationSeconds).expiresAt);
    h.timers[0].options.onTick(1234);
    assert.equal(h.states.at(-1).remainingMs, 1234);
  });
}

test("editing and explicit early finish submit exact text and render exact server results", async () => {
  const h = harness();
  await h.controller.start(30);
  h.controller.setTypedText("a😀<b>");
  h.controller.setTypedText("a😀");
  await h.controller.finish();
  assert.equal(h.calls.completions.length, 1);
  assert.equal(h.calls.completions[0][0], RACE_ID);
  assert.equal(h.calls.completions[0][1], "a😀");
  assert.equal(h.states.at(-1).status, "results");
  assert.equal(h.states.at(-1).result, result);
  assert.equal(h.states.at(-1).result.wpm, 12.34);
  assert.equal(h.timers[0].disposed, 1);
});

test("empty input completes with the server zero result rather than browser scoring", async () => {
  const zero = { ...result, wpm: 0, accuracy: 0, correctCharacters: 0, typedCharacters: 0 };
  const h = harness({ completeRace: async () => zero });
  await h.controller.start(30);
  await h.controller.finish();
  assert.equal(h.states.at(-1).status, "results");
  assert.equal(h.states.at(-1).result, zero);
});

test("timer expiry submits exactly once and a later finish is inert", async () => {
  const h = harness();
  await h.controller.start(30);
  h.timers[0].options.onTick(0);
  h.timers[0].options.onExpire();
  h.timers[0].options.onExpire();
  await h.controller.finish();
  await Promise.resolve();
  assert.equal(h.calls.completions.length, 1);
  assert.equal(h.states.at(-1).status, "results");
});

test("start and finish failures are safe, truthful, and recover only through explicit restart", async () => {
  const startFailure = harness({
    createRace: async () => { throw new ApiError("Request failed", { status: 500 }); },
  });
  await startFailure.controller.start(30);
  assert.equal(startFailure.states.at(-1).status, "error");
  assert.match(startFailure.states.at(-1).error.message, /Could not start/);
  assert.equal(startFailure.states.at(-1).result, null);
  startFailure.controller.restart();
  assert.equal(startFailure.states.at(-1).status, "idle");

  const finishFailure = harness({
    completeRace: async () => { throw new TypeError("SENSITIVE NETWORK DETAIL"); },
  });
  await finishFailure.controller.start(30);
  await finishFailure.controller.finish();
  assert.equal(finishFailure.states.at(-1).status, "error");
  assert.match(finishFailure.states.at(-1).error.message, /no result is shown/);
  assert.equal(finishFailure.states.at(-1).error.message.includes("SENSITIVE"), false);
});

test("expected 410 completion reports Race expired without fabricating a result", async () => {
  const h = harness({
    completeRace: async () => { throw new ApiError("Request failed", { status: 410 }); },
  });
  await h.controller.start(30);
  await h.controller.finish();
  assert.equal(h.states.at(-1).status, "error");
  assert.match(h.states.at(-1).error.message, /^Race expired/);
  assert.equal(h.states.at(-1).error.expired, true);
  assert.equal(h.states.at(-1).result, null);
});

test("restart aborts outstanding work and stale creation cannot restart the timer", async () => {
  const pending = deferred();
  const h = harness({ createRace: async () => pending.promise });
  const starting = h.controller.start(30);
  h.controller.restart();
  pending.resolve(race());
  await starting;
  assert.equal(h.states.at(-1).status, "idle");
  assert.equal(h.timers.length, 0);
});

test("dispose stops countdown, aborts requests, and ignores later events", async () => {
  const h = harness();
  await h.controller.start(30);
  h.controller.dispose();
  h.controller.setTypedText("ignored");
  await h.controller.finish();
  h.timers[0].options.onTick(0);
  h.timers[0].options.onExpire();
  assert.equal(h.timers[0].disposed, 1);
  assert.equal(h.calls.completions.length, 0);
  assert.equal(h.states.at(-1).status, "active");
});
