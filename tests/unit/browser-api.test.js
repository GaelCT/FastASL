import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createApi } from "../../public/assets/js/api.js";

const RACE_ID = "123e4567-e89b-42d3-a456-426614174000";
const STARTED_AT = "2026-11-22T12:00:00.000Z";

function race(durationSeconds = 30) {
  return {
    id: RACE_ID,
    prompt: "practice <img src=x> 😀",
    durationSeconds,
    startedAt: STARTED_AT,
    expiresAt: new Date(Date.parse(STARTED_AT) + durationSeconds * 1000).toISOString(),
    serverNow: STARTED_AT,
    inputMethod: "keyboard",
    ranked: false,
  };
}

function result() {
  return {
    raceId: RACE_ID,
    durationSeconds: 30,
    startedAt: STARTED_AT,
    finishedAt: "2026-11-22T12:00:04.250Z",
    expiresAt: "2026-11-22T12:00:30.000Z",
    elapsedMs: 4250,
    correctCharacters: 0,
    typedCharacters: 0,
    wpm: 0,
    accuracy: 0,
    inputMethod: "keyboard",
    ranked: false,
  };
}

function response(status, body) {
  return { status, async json() { return body; } };
}

for (const durationSeconds of [30, 60]) {
  test(`createRace sends only the ${durationSeconds}-second request and strictly returns its DTO`, async () => {
    const calls = [];
    const signal = new AbortController().signal;
    const api = createApi({
      fetchImpl: async (...args) => {
        calls.push(args);
        return response(201, { race: race(durationSeconds) });
      },
    });

    const created = await api.createRace(durationSeconds, { signal });
    assert.deepEqual(created, race(durationSeconds));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "/api/races");
    assert.deepEqual(calls[0][1], {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationSeconds }),
      signal,
    });
  });
}

test("completeRace sends only typed text and returns exact authoritative Unicode/empty scores", async () => {
  const calls = [];
  const api = createApi({
    fetchImpl: async (...args) => {
      calls.push(args);
      return response(200, { result: result() });
    },
  });
  const completed = await api.completeRace(RACE_ID, "");
  assert.deepEqual(completed, result());
  assert.equal(calls[0][0], `/api/races/${RACE_ID}/complete`);
  assert.deepEqual(JSON.parse(calls[0][1].body), { typedText: "" });
  assert.equal(calls[0][1].credentials, "same-origin");
});

test("creation rejects malformed success DTOs, unknown fields, and client/server duration mismatch", async () => {
  const invalidRaces = [
    null,
    [],
    { ...race(), extra: true },
    { ...race(), id: "not-a-uuid" },
    { ...race(), prompt: "" },
    { ...race(), durationSeconds: 60 },
    { ...race(), startedAt: "not-a-date" },
    { ...race(), inputMethod: "camera" },
    { ...race(), ranked: true },
  ];
  for (const invalid of invalidRaces) {
    const api = createApi({ fetchImpl: async () => response(201, { race: invalid }) });
    await assert.rejects(api.createRace(30), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, "Invalid server response");
      assert.equal(error.message.includes("not-a-uuid"), false);
      return true;
    });
  }
  const extraTopLevel = createApi({
    fetchImpl: async () => response(201, { race: race(), result: result() }),
  });
  await assert.rejects(extraTopLevel.createRace(30), /Invalid server response/);
});

test("completion rejects nonfinite, out-of-range, mismatched, and malformed result DTOs", async () => {
  const invalidResults = [
    null,
    { ...result(), extra: "forged" },
    { ...result(), raceId: "123e4567-e89b-42d3-a456-426614174099" },
    { ...result(), durationSeconds: 45 },
    { ...result(), wpm: Number.POSITIVE_INFINITY },
    { ...result(), elapsedMs: -1 },
    { ...result(), accuracy: 100.01 },
    { ...result(), inputMethod: "camera" },
    { ...result(), ranked: true },
  ];
  for (const invalid of invalidResults) {
    const api = createApi({ fetchImpl: async () => response(200, { result: invalid }) });
    await assert.rejects(api.completeRace(RACE_ID, "abc"), /Invalid server response/);
  }
});

test("HTTP errors preserve only safe statuses and never expose response bodies", async () => {
  for (const status of [400, 404, 409, 410, 500, 503]) {
    const api = createApi({
      fetchImpl: async () => response(status, { error: "SENSITIVE SERVER DETAIL" }),
    });
    await assert.rejects(api.createRace(30), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message, "Request failed");
      assert.equal(error.message.includes("SENSITIVE"), false);
      return true;
    });
  }
});

test("network and malformed JSON failures become safe ApiErrors", async () => {
  const network = createApi({
    fetchImpl: async () => { throw new TypeError("private socket detail"); },
  });
  await assert.rejects(network.createRace(30), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.message, "Network request failed");
    return true;
  });

  const malformed = createApi({
    fetchImpl: async () => ({
      status: 201,
      async json() { throw new SyntaxError("private JSON detail"); },
    }),
  });
  await assert.rejects(malformed.createRace(30), /Invalid server response/);
});

test("invalid client arguments do not call fetch", async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async () => { calls += 1; } });
  for (const duration of [0, 15, "30", null]) {
    await assert.rejects(api.createRace(duration), /Invalid race duration/);
  }
  await assert.rejects(api.completeRace("bad", "abc"), /Invalid completion request/);
  await assert.rejects(api.completeRace(RACE_ID, "x".repeat(1001)), /Invalid completion request/);
  assert.equal(calls, 0);
});
