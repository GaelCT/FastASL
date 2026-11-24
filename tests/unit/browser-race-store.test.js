import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRaceStore,
  RACE_STORAGE_KEY,
} from "../../public/assets/js/race-store.js";

const RACE = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  prompt: "practice <img src=x> 😀",
  durationSeconds: 30,
  startedAt: "2026-11-22T12:00:00.000Z",
  serverNow: "2026-11-22T12:00:00.000Z",
  expiresAt: "2026-11-22T12:00:30.000Z",
  inputMethod: "keyboard",
  ranked: false,
};

function snapshot() {
  return {
    version: 1,
    race: { ...RACE },
    typedText: "typed <b>text</b> 😀",
    clockOffsetMs: -1234.5,
  };
}

function memoryStorage(initial) {
  const values = new Map(initial ? [[RACE_STORAGE_KEY, initial]] : []);
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("valid active snapshots round-trip under the versioned storage key", () => {
  const storage = memoryStorage();
  const store = createRaceStore({ storage });
  const value = snapshot();

  assert.equal(store.save(value), true);
  assert.equal(storage.values.size, 1);
  assert.deepEqual(JSON.parse(storage.values.get(RACE_STORAGE_KEY)), value);
  assert.deepEqual(store.load(), value);
  assert.equal(store.clear(), true);
  assert.equal(storage.values.size, 0);
  assert.equal(store.load(), null);
});

test("load clears malformed JSON, non-object values, and every unknown snapshot shape", () => {
  const invalidValues = [
    "{not json",
    "null",
    "[]",
    "true",
    "1",
    "\"text\"",
    JSON.stringify({}),
    JSON.stringify({ ...snapshot(), version: 2 }),
    JSON.stringify({ ...snapshot(), extra: true }),
    JSON.stringify({ ...snapshot(), race: null }),
    JSON.stringify({ ...snapshot(), race: { ...RACE, wpm: 999 } }),
    JSON.stringify({ ...snapshot(), race: { ...RACE, id: "not-a-uuid" } }),
    JSON.stringify({ ...snapshot(), race: { ...RACE, startedAt: "2026-02-30T12:00:00Z" } }),
    JSON.stringify({ ...snapshot(), race: { ...RACE, serverNow: "2026-11-22T12:00:00.001Z" } }),
    JSON.stringify({ ...snapshot(), race: { ...RACE, expiresAt: "2026-11-22T12:00:29.999Z" } }),
    JSON.stringify({ ...snapshot(), race: { ...RACE, durationSeconds: 45 } }),
    JSON.stringify({ ...snapshot(), race: { ...RACE, durationSeconds: "30" } }),
    JSON.stringify({ ...snapshot(), race: { ...RACE, inputMethod: "camera" } }),
    JSON.stringify({ ...snapshot(), race: { ...RACE, ranked: true } }),
    JSON.stringify({ ...snapshot(), typedText: 42 }),
    JSON.stringify({ ...snapshot(), typedText: "x".repeat(1001) }),
    JSON.stringify({ ...snapshot(), clockOffsetMs: null }),
    JSON.stringify({ ...snapshot(), clockOffsetMs: "0" }),
  ];

  for (const stored of invalidValues) {
    const storage = memoryStorage(stored);
    const store = createRaceStore({ storage });
    assert.equal(store.load(), null, stored);
    assert.equal(storage.values.has(RACE_STORAGE_KEY), false, stored);
  }
});

test("save rejects nonfinite offsets, overlong text, and authoritative score tampering", () => {
  const invalidSnapshots = [
    { ...snapshot(), clockOffsetMs: Number.NaN },
    { ...snapshot(), clockOffsetMs: Number.POSITIVE_INFINITY },
    { ...snapshot(), typedText: "x".repeat(1001) },
    { ...snapshot(), race: { ...RACE, accuracy: 100 } },
  ];
  for (const value of invalidSnapshots) {
    const storage = memoryStorage();
    const store = createRaceStore({ storage });
    assert.equal(store.save(value), false);
    assert.equal(storage.values.size, 0);
  }
});

test("storage read, write, and removal exceptions are contained without logging", () => {
  const readFailure = createRaceStore({
    storage: {
      getItem() { throw new DOMException("denied", "SecurityError"); },
      setItem() { throw new Error("must not leak"); },
      removeItem() { throw new Error("must not leak"); },
    },
  });
  assert.equal(readFailure.load(), undefined);
  assert.equal(readFailure.save(snapshot()), false);
  assert.equal(readFailure.clear(), false);

  const removeFailure = createRaceStore({
    storage: {
      getItem() { return "invalid"; },
      removeItem() { throw new Error("denied"); },
    },
  });
  assert.equal(removeFailure.load(), undefined);

  const writeFailure = createRaceStore({
    storage: {
      setItem() { throw new DOMException("full", "QuotaExceededError"); },
    },
  });
  assert.equal(writeFailure.save(snapshot()), false);
});
