import { test } from "node:test";
import assert from "node:assert/strict";
import { initialRaceState, reduceRaceState } from "../../public/assets/js/race-state.js";

const race = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  prompt: "a😀<b>",
  durationSeconds: 30,
};

test("initial state and start transitions preserve operation identity", () => {
  const idle = initialRaceState(60);
  assert.deepEqual(idle, {
    status: "idle",
    operationId: 0,
    durationSeconds: 60,
    race: null,
    typedText: "",
    remainingMs: 0,
    clockOffsetMs: 0,
    result: null,
    error: null,
    storageUnavailable: false,
  });
  const starting = reduceRaceState(idle, { type: "START_REQUESTED", durationSeconds: 30 });
  assert.equal(starting.status, "starting");
  assert.equal(starting.operationId, 1);
  assert.equal(starting.durationSeconds, 30);
  const active = reduceRaceState(starting, { type: "START_SUCCEEDED", operationId: 1, race });
  assert.equal(active.status, "active");
  assert.equal(active.race, race);
  assert.equal(active.remainingMs, 30_000);
});

test("typing, editing, empty input, ticking, and exact results follow the active operation", () => {
  let state = reduceRaceState(initialRaceState(), { type: "START_REQUESTED", durationSeconds: 30 });
  state = reduceRaceState(state, { type: "START_SUCCEEDED", operationId: 1, race });
  state = reduceRaceState(state, { type: "TEXT_CHANGED", typedText: "a😀" });
  assert.equal(state.typedText, "a😀");
  state = reduceRaceState(state, { type: "TEXT_CHANGED", typedText: "" });
  assert.equal(state.typedText, "");
  state = reduceRaceState(state, { type: "TIMER_TICK", operationId: 1, remainingMs: 250 });
  assert.equal(state.remainingMs, 250);
  state = reduceRaceState(state, { type: "TIMER_TICK", operationId: 1, remainingMs: -100 });
  assert.equal(state.remainingMs, 0);
  state = reduceRaceState(state, { type: "COMPLETION_REQUESTED", operationId: 1 });
  assert.equal(state.status, "completing");
  const result = { wpm: 12.34, accuracy: 56.78 };
  state = reduceRaceState(state, { type: "COMPLETION_SUCCEEDED", operationId: 1, result });
  assert.equal(state.status, "results");
  assert.equal(state.result, result);
  assert.equal(state.typedText, "");
});

test("stale async events cannot overwrite a restarted race", () => {
  const starting = reduceRaceState(initialRaceState(), { type: "START_REQUESTED", durationSeconds: 30 });
  const restarted = reduceRaceState(starting, { type: "RESTART" });
  assert.equal(restarted.status, "idle");
  assert.equal(restarted.operationId, 2);
  assert.equal(
    reduceRaceState(restarted, { type: "START_SUCCEEDED", operationId: 1, race }),
    restarted,
  );

  const active = reduceRaceState(starting, { type: "START_SUCCEEDED", operationId: 1, race });
  const completing = reduceRaceState(active, { type: "COMPLETION_REQUESTED", operationId: 1 });
  const afterRestart = reduceRaceState(completing, { type: "RESTART" });
  assert.equal(
    reduceRaceState(afterRestart, {
      type: "COMPLETION_SUCCEEDED",
      operationId: 1,
      result: { wpm: 999 },
    }),
    afterRestart,
  );
});

test("resume restores the active snapshot and local expiry invalidates pending completion", () => {
  const resumed = reduceRaceState(initialRaceState(30), {
    type: "RESUME_SUCCEEDED",
    race,
    typedText: "same text",
    clockOffsetMs: -250,
    remainingMs: 12_000,
  });
  assert.equal(resumed.status, "active");
  assert.equal(resumed.operationId, 1);
  assert.equal(resumed.typedText, "same text");
  assert.equal(resumed.clockOffsetMs, -250);
  assert.equal(resumed.remainingMs, 12_000);

  const completing = reduceRaceState(resumed, {
    type: "COMPLETION_REQUESTED",
    operationId: 1,
  });
  const expired = reduceRaceState(completing, {
    type: "RACE_EXPIRED",
    operationId: 1,
    message: "Race expired",
  });
  assert.equal(expired.status, "error");
  assert.equal(expired.remainingMs, 0);
  assert.equal(expired.error.expired, true);
  assert.equal(expired.error.retryable, false);
  assert.equal(reduceRaceState(expired, {
    type: "COMPLETION_SUCCEEDED",
    operationId: 1,
    result: { wpm: 999 },
  }), expired);
});

test("manual completion retry keeps identical text and changes operation identity", () => {
  let state = reduceRaceState(initialRaceState(30), { type: "START_REQUESTED", durationSeconds: 30 });
  state = reduceRaceState(state, { type: "START_SUCCEEDED", operationId: 1, race });
  state = reduceRaceState(state, { type: "TEXT_CHANGED", typedText: "locked text" });
  state = reduceRaceState(state, { type: "COMPLETION_REQUESTED", operationId: 1 });
  state = reduceRaceState(state, {
    type: "OPERATION_FAILED",
    operationId: 1,
    message: "Retry",
    kind: "completion",
    retryable: true,
  });
  assert.equal(state.status, "error");
  assert.equal(state.typedText, "locked text");
  state = reduceRaceState(state, { type: "TIMER_TICK", operationId: 1, remainingMs: 5_000 });
  assert.equal(state.remainingMs, 5_000);
  assert.equal(reduceRaceState(state, { type: "TEXT_CHANGED", typedText: "edit" }), state);

  const retrying = reduceRaceState(state, { type: "COMPLETION_REQUESTED", operationId: 1 });
  assert.equal(retrying.status, "completing");
  assert.equal(retrying.operationId, 2);
  assert.equal(retrying.typedText, "locked text");
  assert.equal(reduceRaceState(retrying, {
    type: "COMPLETION_SUCCEEDED",
    operationId: 1,
    result: { wpm: 1 },
  }), retrying);
});

test("invalid lifecycle events are inert and restart clears errors/results", () => {
  const idle = initialRaceState();
  assert.equal(reduceRaceState(idle, { type: "TEXT_CHANGED", typedText: "ignored" }), idle);
  assert.equal(reduceRaceState(idle, { type: "UNKNOWN" }), idle);
  const starting = reduceRaceState(idle, { type: "START_REQUESTED", durationSeconds: 60 });
  const error = reduceRaceState(starting, {
    type: "OPERATION_FAILED",
    operationId: 1,
    message: "Safe failure",
  });
  assert.equal(error.status, "error");
  assert.deepEqual(error.error, {
    message: "Safe failure",
    expired: false,
    kind: "start",
    retryable: false,
  });
  const restarted = reduceRaceState(error, { type: "RESTART" });
  assert.equal(restarted.status, "idle");
  assert.equal(restarted.error, null);
  assert.equal(restarted.result, null);
});
