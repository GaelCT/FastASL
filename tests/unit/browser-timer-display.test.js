import { test } from "node:test";
import assert from "node:assert/strict";
import { createCountdown, formatRemaining } from "../../public/assets/js/timer-display.js";

test("formatRemaining rounds up, formats minutes, and clamps invalid/negative values", () => {
  assert.equal(formatRemaining(60_000), "1:00");
  assert.equal(formatRemaining(59_001), "1:00");
  assert.equal(formatRemaining(59_000), "0:59");
  assert.equal(formatRemaining(1), "0:01");
  assert.equal(formatRemaining(0), "0:00");
  assert.equal(formatRemaining(-1), "0:00");
  assert.equal(formatRemaining(Number.NaN), "0:00");
  assert.equal(formatRemaining(Number.POSITIVE_INFINITY), "0:00");
});

function harness({ now = 10_000, serverNow = 12_000, expiresAt = 42_000 } = {}) {
  let currentTime = now;
  let scheduled;
  let intervalMs;
  let clearCount = 0;
  const ticks = [];
  let expired = 0;
  const countdown = createCountdown({
    serverNow: new Date(serverNow).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    now: () => currentTime,
    setInterval(callback, ms) {
      scheduled = callback;
      intervalMs = ms;
      return 17;
    },
    clearInterval(id) {
      assert.equal(id, 17);
      clearCount += 1;
    },
    onTick: (remaining) => ticks.push(remaining),
    onExpire: () => { expired += 1; },
  });
  return {
    countdown,
    ticks,
    get expired() { return expired; },
    get clearCount() { return clearCount; },
    get intervalMs() { return intervalMs; },
    advance(ms) { currentTime += ms; scheduled?.(currentTime); },
  };
}

test("countdown derives server time from the initial offset and ticks every 250ms", () => {
  const clock = harness();
  assert.deepEqual(clock.ticks, [30_000]);
  assert.equal(clock.intervalMs, 250);
  clock.advance(250);
  assert.deepEqual(clock.ticks, [30_000, 29_750]);
  clock.countdown.dispose();
});

test("a stored clock offset resumes without renegotiating server time", () => {
  let currentTime = 10_000;
  const ticks = [];
  const countdown = createCountdown({
    expiresAt: 42_000,
    clockOffsetMs: -5_000,
    now: () => currentTime,
    setInterval() { return 1; },
    clearInterval() {},
    onTick: (remaining) => ticks.push(remaining),
  });
  assert.deepEqual(ticks, [37_000]);
  currentTime += 1_000;
  countdown.tick();
  assert.deepEqual(ticks, [37_000, 36_000]);
  countdown.dispose();
});

test("a long wall-clock jump clamps to zero and expires exactly once", () => {
  const clock = harness();
  clock.advance(120_000);
  assert.deepEqual(clock.ticks, [30_000, 0]);
  assert.equal(clock.expired, 1);
  assert.equal(clock.clearCount, 1);
  clock.countdown.tick();
  clock.countdown.dispose();
  assert.deepEqual(clock.ticks, [30_000, 0]);
  assert.equal(clock.expired, 1);
  assert.equal(clock.clearCount, 1);
});

test("zero at creation expires once without scheduling an interval", () => {
  let scheduled = 0;
  let expired = 0;
  const ticks = [];
  const countdown = createCountdown({
    serverNow: 5_000,
    expiresAt: 5_000,
    now: () => 5_000,
    setInterval() { scheduled += 1; },
    onTick: (value) => ticks.push(value),
    onExpire: () => { expired += 1; },
  });
  assert.deepEqual(ticks, [0]);
  assert.equal(expired, 1);
  assert.equal(scheduled, 0);
  countdown.dispose();
});

test("disposal prevents all future ticks and expiration", () => {
  const clock = harness();
  clock.countdown.dispose();
  clock.countdown.dispose();
  clock.advance(60_000);
  assert.deepEqual(clock.ticks, [30_000]);
  assert.equal(clock.expired, 0);
  assert.equal(clock.clearCount, 1);
});
