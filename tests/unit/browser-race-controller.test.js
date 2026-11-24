import { test } from "node:test";
import assert from "node:assert/strict";
import { createRaceController } from "../../public/assets/js/race-controller.js";
import { ApiError, createApi } from "../../public/assets/js/api.js";
import { createRaceStore, RACE_STORAGE_KEY } from "../../public/assets/js/race-store.js";
import { createCountdown } from "../../public/assets/js/timer-display.js";

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

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

function harness({ createRace, completeRace, store, now = () => Date.parse("2026-11-22T12:00:01.000Z"), timer } = {}) {
  const states = [];
  const timers = [];
  const calls = { creates: [], completions: [] };
  const storage = memoryStorage();
  const raceStore = store ?? createRaceStore({ storage });
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
    store: raceStore,
    now,
    onChange: (state) => states.push(state),
    timer: timer ?? function(options) {
      const handle = { options, disposed: 0, dispose() { this.disposed += 1; } };
      timers.push(handle);
      return handle;
    },
  });
  return { states, timers, calls, controller, api, storage, store: raceStore };
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

for (const durationSeconds of [30, 60]) {
  test(`${durationSeconds}-second timer submits once at zero and enters the safe expired state`, async () => {
    const h = harness({
      completeRace: async (...args) => {
        h.calls.completions.push(args);
        throw new ApiError("Request failed", { status: 410 });
      },
    });
    await h.controller.start(durationSeconds);
    for (const remainingMs of [durationSeconds * 1000, 1_001, 1_000, 999, 1]) {
      h.timers[0].options.onTick(remainingMs);
      assert.equal(h.calls.completions.length, 0);
    }

    h.timers[0].options.onTick(0);
    h.timers[0].options.onExpire();
    h.timers[0].options.onExpire();
    await h.controller.finish();
    await Promise.resolve();

    assert.equal(h.calls.completions.length, 1);
    assert.equal(h.timers[0].disposed, 1);
    assert.equal(h.states.at(-1).status, "error");
    assert.equal(h.states.at(-1).error.expired, true);
    assert.equal(h.states.at(-1).error.retryable, false);
    assert.equal(h.states.at(-1).result, null);
    assert.equal(h.states.at(-1).remainingMs, 0);
    assert.equal(h.storage.values.has(RACE_STORAGE_KEY), false);
  });
}

test("a real countdown expiry sends one completion without aborting it in the same tick", async () => {
  const startedAtMs = Date.parse("2026-11-22T12:00:00.000Z");
  let currentTime = startedAtMs;
  let scheduledTick;
  let completionSignal;
  let completionRequests = 0;
  const pendingCompletion = deferred();
  const h = harness({
    now: () => currentTime,
    completeRace: async (_id, _text, { signal }) => {
      completionRequests += 1;
      completionSignal = signal;
      return pendingCompletion.promise;
    },
    timer(options) {
      return createCountdown({
        ...options,
        setInterval(callback) {
          scheduledTick = callback;
          return 17;
        },
        clearInterval() {},
      });
    },
  });
  await h.controller.start(30);
  h.controller.setTypedText("expiry text");
  currentTime += 30_000;

  scheduledTick();

  assert.equal(h.states.at(-1).status, "completing");
  assert.equal(completionRequests, 1);
  assert.equal(completionSignal.aborted, false);
  assert.equal(h.states.at(-1).result, null);
  assert.equal(h.storage.values.has(RACE_STORAGE_KEY), true);

  pendingCompletion.reject(new ApiError("Request failed", { status: 410 }));
  await new Promise((resolve) => setImmediate(resolve));
  await h.controller.finish();
  assert.equal(completionRequests, 1);
  assert.equal(h.states.at(-1).status, "error");
  assert.equal(h.states.at(-1).error.expired, true);
  assert.equal(h.states.at(-1).result, null);
  assert.equal(h.storage.values.has(RACE_STORAGE_KEY), false);
});

test("an offline expiry submission is terminal and cannot be retried after the deadline", async () => {
  const h = harness({
    completeRace: async (...args) => {
      h.calls.completions.push(args);
      throw new TypeError("offline");
    },
  });
  await h.controller.start(30);
  h.controller.setTypedText("offline expiry");
  h.timers[0].options.onTick(0);
  h.timers[0].options.onExpire();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(h.calls.completions.length, 1);
  assert.equal(h.states.at(-1).status, "error");
  assert.equal(h.states.at(-1).error.expired, true);
  assert.equal(h.states.at(-1).error.retryable, false);
  assert.equal(h.states.at(-1).result, null);
  assert.equal(h.storage.values.has(RACE_STORAGE_KEY), false);
  await h.controller.finish();
  assert.equal(h.calls.completions.length, 1);
});

test("start failures require restart while completion network failures remain explicitly retryable", async () => {
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
  assert.match(finishFailure.states.at(-1).error.message, /no result is shown/i);
  assert.equal(finishFailure.states.at(-1).error.message.includes("SENSITIVE"), false);
  assert.equal(finishFailure.states.at(-1).error.retryable, true);
  assert.equal(finishFailure.timers[0].disposed, 0);
  assert.equal(finishFailure.storage.values.has(RACE_STORAGE_KEY), true);
});

test("impossible creation timestamps become safe errors with restart recovery", async () => {
  const timestamp = "2026-02-29T12:00:00Z";
  const api = createApi({
    fetchImpl: async () => ({
      status: 201,
      async json() {
        return { race: { ...race(), startedAt: timestamp } };
      },
    }),
  });
  const h = harness({ createRace: (...args) => api.createRace(...args) });

  await h.controller.start(30);
  assert.equal(h.states.at(-1).status, "error");
  assert.equal(h.states.at(-1).race, null);
  assert.equal(h.states.at(-1).result, null);
  assert.match(h.states.at(-1).error.message, /Could not start/);
  assert.equal(h.states.at(-1).error.message.includes(timestamp), false);
  assert.equal(h.states.some((state) => state.status === "active"), false);
  assert.equal(h.timers.length, 0);

  h.controller.restart();
  assert.equal(h.states.at(-1).status, "idle");
});

test("impossible completion timestamps become safe errors with restart recovery", async () => {
  const timestamp = "2026-02-30T12:00:00Z";
  const api = createApi({
    fetchImpl: async () => ({
      status: 200,
      async json() {
        return {
          result: {
            ...result,
            startedAt: "2026-11-22T12:00:00.000Z",
            finishedAt: timestamp,
            expiresAt: "2026-11-22T12:00:30.000Z",
          },
        };
      },
    }),
  });
  const h = harness({ completeRace: (...args) => api.completeRace(...args) });

  await h.controller.start(30);
  await h.controller.finish();
  assert.equal(h.states.at(-1).status, "error");
  assert.equal(h.states.at(-1).result, null);
  assert.match(h.states.at(-1).error.message, /No result is shown/);
  assert.equal(h.states.at(-1).error.message.includes(timestamp), false);
  assert.equal(h.states.some((state) => state.status === "results"), false);

  h.controller.restart();
  assert.equal(h.states.at(-1).status, "idle");
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


test("valid snapshots resume prompt, text, and stored server offset without creating a race", () => {
  const h = harness();
  h.store.save({ version: 1, race: race(), typedText: "resume <b>😀</b>", clockOffsetMs: 0 });

  h.controller.resume();
  h.controller.resume();

  assert.equal(h.calls.creates.length, 0);
  assert.equal(h.states.at(-1).status, "active");
  assert.equal(h.states.at(-1).race.prompt, race().prompt);
  assert.equal(h.states.at(-1).typedText, "resume <b>😀</b>");
  assert.equal(h.states.at(-1).remainingMs, 29_000);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].options.clockOffsetMs, 0);
});

test("invalid and already-expired snapshots clear to idle without API submissions", () => {
  const invalid = harness();
  invalid.storage.values.set(RACE_STORAGE_KEY, JSON.stringify({ version: 1, race: race(), extra: true }));
  invalid.controller.resume();
  assert.equal(invalid.states.at(-1).status, "idle");
  assert.equal(invalid.storage.values.has(RACE_STORAGE_KEY), false);

  const expired = harness({ now: () => Date.parse("2026-11-22T12:00:30.000Z") });
  expired.store.save({ version: 1, race: race(), typedText: "old", clockOffsetMs: 0 });
  expired.controller.resume();
  assert.equal(expired.states.at(-1).status, "idle");
  assert.equal(expired.storage.values.has(RACE_STORAGE_KEY), false);
  assert.equal(expired.calls.creates.length, 0);
  assert.equal(expired.calls.completions.length, 0);
  assert.equal(expired.timers.length, 0);
});

test("storage denial keeps practice usable and exposes only the generic persistence notice", async () => {
  const deniedStore = createRaceStore({
    storage: {
      getItem() { throw new Error("private denial"); },
      setItem() { throw new Error("private denial"); },
      removeItem() { throw new Error("private denial"); },
    },
  });
  const h = harness({ store: deniedStore });
  h.controller.resume();
  assert.equal(h.states.at(-1).status, "idle");
  assert.equal(h.states.at(-1).storageUnavailable, true);

  await h.controller.start(30);
  h.controller.setTypedText("still works");
  await h.controller.finish();
  assert.equal(h.states.at(-1).status, "results");
  assert.equal(h.states.at(-1).result, result);
  assert.equal(h.states.at(-1).storageUnavailable, true);
});

test("typing and start persist only the active snapshot; results and restart clear it", async () => {
  const h = harness();
  await h.controller.start(30);
  h.controller.setTypedText("<b>typed 😀</b>");
  const stored = JSON.parse(h.storage.values.get(RACE_STORAGE_KEY));
  assert.deepEqual(Object.keys(stored).sort(), ["clockOffsetMs", "race", "typedText", "version"]);
  assert.equal(stored.typedText, "<b>typed 😀</b>");
  assert.equal("wpm" in stored, false);
  assert.equal("result" in stored, false);

  await h.controller.finish();
  assert.equal(h.storage.values.has(RACE_STORAGE_KEY), false);
  h.controller.restart();
  assert.equal(h.storage.values.has(RACE_STORAGE_KEY), false);
});

test("double start and combined finish triggers create only one request per operation", async () => {
  const pendingCreate = deferred();
  const starting = harness({
    createRace: async (durationSeconds, options) => {
      starting.calls.creates.push({ durationSeconds, options });
      return pendingCreate.promise;
    },
  });
  const firstStart = starting.controller.start(30);
  await starting.controller.start(30);
  pendingCreate.resolve(race());
  await firstStart;
  assert.equal(starting.calls.creates.length, 1);

  const pendingFinish = deferred();
  const finishing = harness({
    completeRace: async (...args) => {
      finishing.calls.completions.push(args);
      return pendingFinish.promise;
    },
  });
  await finishing.controller.start(30);
  const firstFinish = finishing.controller.finish();
  await finishing.controller.finish();
  finishing.timers[0].options.onTick(0);
  finishing.timers[0].options.onExpire();
  await finishing.controller.finish();
  pendingFinish.resolve(result);
  await firstFinish;
  assert.equal(finishing.calls.completions.length, 1);
});

test("network completion retry is manual, single-flight, and submits identical immutable text", async () => {
  let attempts = 0;
  const h = harness({
    completeRace: async (...args) => {
      h.calls.completions.push(args);
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("offline");
      }
      return result;
    },
  });
  await h.controller.start(30);
  h.controller.setTypedText("identical text");
  await h.controller.finish();
  assert.equal(h.states.at(-1).error.retryable, true);
  h.controller.setTypedText("not allowed");

  await h.controller.finish();
  await h.controller.finish();
  assert.equal(h.calls.completions.length, 2);
  assert.deepEqual(h.calls.completions.map((call) => call[1]), ["identical text", "identical text"]);
  assert.equal(h.states.at(-1).status, "results");
});

test("restart aborts pending completion and late results cannot overwrite or persist a new race", async () => {
  const pending = deferred();
  const signals = [];
  const h = harness({
    completeRace: async (_id, _text, { signal }) => {
      signals.push(signal);
      return pending.promise;
    },
  });
  await h.controller.start(30);
  h.controller.setTypedText("old text");
  const finishing = h.controller.finish();
  h.controller.restart();
  assert.equal(signals[0].aborted, true);

  await h.controller.start(30);
  h.controller.setTypedText("new text");
  pending.resolve({ ...result, wpm: 999 });
  await finishing;

  assert.equal(h.states.at(-1).status, "active");
  assert.equal(h.states.at(-1).typedText, "new text");
  assert.equal(h.states.at(-1).result, null);
  assert.equal(JSON.parse(h.storage.values.get(RACE_STORAGE_KEY)).typedText, "new text");
});

test("404, 409, and 410 completion failures are distinct terminal states without retry", async () => {
  const expectations = new Map([
    [404, /unavailable/i],
    [409, /already completed/i],
    [410, /expired/i],
  ]);
  for (const [status, message] of expectations) {
    const h = harness({
      completeRace: async (...args) => {
        h.calls.completions.push(args);
        throw new ApiError("Request failed", { status });
      },
    });
    await h.controller.start(30);
    await h.controller.finish();
    assert.equal(h.states.at(-1).status, "error");
    assert.match(h.states.at(-1).error.message, message);
    assert.equal(h.states.at(-1).error.retryable, false);
    assert.equal(h.states.at(-1).result, null);
    assert.equal(h.storage.values.has(RACE_STORAGE_KEY), false);
    await h.controller.finish();
    assert.equal(h.calls.completions.length, 1);
  }
});


test("the same server countdown governs a pending retry and expires it exactly once", async () => {
  const pendingRetry = deferred();
  const retrySignals = [];
  let attempts = 0;
  const h = harness({
    completeRace: async (_id, _text, { signal }) => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("offline");
      }
      retrySignals.push(signal);
      return pendingRetry.promise;
    },
  });
  await h.controller.start(30);
  h.controller.setTypedText("retry text");
  await h.controller.finish();
  const retrying = h.controller.finish();
  await Promise.resolve();

  h.timers[0].options.onTick(5_000);
  assert.equal(h.states.at(-1).status, "completing");
  assert.equal(h.states.at(-1).remainingMs, 5_000);
  h.timers[0].options.onTick(0);
  h.timers[0].options.onExpire();
  assert.equal(retrySignals[0].aborted, true);
  assert.equal(h.states.at(-1).status, "error");
  assert.equal(h.states.at(-1).error.expired, true);
  assert.equal(h.states.at(-1).result, null);

  pendingRetry.resolve(result);
  await retrying;
  assert.equal(h.states.at(-1).status, "error");
  assert.equal(h.states.at(-1).error.expired, true);
  assert.equal(h.storage.values.has(RACE_STORAGE_KEY), false);
});
