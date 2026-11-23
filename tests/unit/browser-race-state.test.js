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
    result: null,
    error: null,
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
  assert.deepEqual(error.error, { message: "Safe failure", expired: false });
  const restarted = reduceRaceState(error, { type: "RESTART" });
  assert.equal(restarted.status, "idle");
  assert.equal(restarted.error, null);
  assert.equal(restarted.result, null);
});
