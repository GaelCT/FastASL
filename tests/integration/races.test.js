import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createRaceRepository } from "../../src/races/in-memory-race-repository.js";
import { createRaceService } from "../../src/races/race-service.js";

const config = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 3000,
  LOG_LEVEL: "silent",
  REQUEST_BODY_LIMIT: "100kb",
};
const RACE_ID = "123e4567-e89b-42d3-a456-426614174000";
const UNKNOWN_RACE_ID = "123e4567-e89b-42d3-a456-426614174099";
const STARTED_AT_MS = Date.UTC(2026, 10, 22, 12, 0, 0);

function createHarness({
  prompt = "abc",
  now = STARTED_AT_MS,
  repository = createRaceRepository(),
  createId = () => RACE_ID,
} = {}) {
  let currentTime = now;
  const service = createRaceService({
    repository,
    now: () => currentTime,
    createId,
    choosePrompt: () => prompt,
  });

  return {
    app: createApp(config, { raceService: service }),
    repository,
    service,
    setNow(value) {
      currentTime = value;
    },
  };
}

async function createRace(harness, durationSeconds = 60) {
  const response = await request(harness.app)
    .post("/api/races")
    .send({ durationSeconds });
  assert.equal(response.status, 201, response.text);
  return response.body.race;
}

function assertError(response, status, message) {
  assert.equal(response.status, status, response.text);
  assert.match(response.headers["content-type"], /^application\/json(?:;|$)/);
  assert.deepEqual(response.body, { error: message });
  for (const forbidden of [
    "stack",
    "ZodError",
    "SENSITIVE_REQUEST_BODY",
    "C:\\",
    "/FastASL",
    "startedAtMs",
    "terminalAtMs",
  ]) {
    assert.equal(response.text.includes(forbidden), false, forbidden);
  }
}

async function postJson(path, rawBody, app = createApp(config)) {
  return request(app)
    .post(path)
    .set("Content-Type", "application/json")
    .send(rawBody);
}

for (const durationSeconds of [30, 60]) {
  test(`creation returns the exact strict ${durationSeconds}-second DTO`, async () => {
    const harness = createHarness({ prompt: "practice makes progress" });
    const response = await request(harness.app)
      .post("/api/races")
      .send({ durationSeconds });

    assert.equal(response.status, 201, response.text);
    const expectedStartedAt = new Date(STARTED_AT_MS).toISOString();
    const expectedExpiresAt = new Date(
      STARTED_AT_MS + durationSeconds * 1000,
    ).toISOString();
    assert.deepEqual(response.body, {
      race: {
        id: RACE_ID,
        prompt: "practice makes progress",
        durationSeconds,
        startedAt: expectedStartedAt,
        expiresAt: expectedExpiresAt,
        serverNow: expectedStartedAt,
        inputMethod: "keyboard",
        ranked: false,
      },
    });
    assert.equal(
      Date.parse(response.body.race.expiresAt) -
        Date.parse(response.body.race.startedAt),
      durationSeconds * 1000,
    );
    assert.equal(response.body.race.serverNow, response.body.race.startedAt);
    assert.equal("startedAtMs" in response.body.race, false);
    assert.equal("status" in response.body.race, false);
  });
}

test("completion returns exact authoritative timestamps and Unicode code-point scoring", async () => {
  const harness = createHarness({ prompt: "a😀c" });
  await createRace(harness);
  harness.setNow(STARTED_AT_MS + 30_000);

  const response = await request(harness.app)
    .post(`/api/races/${RACE_ID}/complete`)
    .send({ typedText: "a😀x" });

  assert.equal(response.status, 200, response.text);
  assert.deepEqual(response.body, {
    result: {
      raceId: RACE_ID,
      durationSeconds: 60,
      startedAt: new Date(STARTED_AT_MS).toISOString(),
      finishedAt: new Date(STARTED_AT_MS + 30_000).toISOString(),
      expiresAt: new Date(STARTED_AT_MS + 60_000).toISOString(),
      elapsedMs: 30_000,
      correctCharacters: 2,
      typedCharacters: 3,
      wpm: 0.8,
      accuracy: 66.67,
      inputMethod: "keyboard",
      ranked: false,
    },
  });
  assert.equal("typedText" in response.body.result, false);
  assert.equal("status" in response.body.result, false);
});

test("empty completion is accepted with zero scores rather than nonfinite numbers", async () => {
  const harness = createHarness();
  await createRace(harness, 30);
  harness.setNow(STARTED_AT_MS + 1_000);

  const response = await request(harness.app)
    .post(`/api/races/${RACE_ID}/complete`)
    .send({ typedText: "" });

  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.result.elapsedMs, 1_000);
  assert.equal(response.body.result.correctCharacters, 0);
  assert.equal(response.body.result.typedCharacters, 0);
  assert.equal(response.body.result.wpm, 0);
  assert.equal(response.body.result.accuracy, 0);
});

test("malformed, oversized, non-JSON, and non-object creation bodies fail safely", async () => {
  const malformed = await postJson("/api/races", '{"durationSeconds":');
  assertError(malformed, 400, "Request failed");

  const oversized = await request(createApp(config))
    .post("/api/races")
    .send({ durationSeconds: 30, padding: "x".repeat(101 * 1024) });
  assertError(oversized, 413, "Request failed");

  const nonJson = await request(createApp(config))
    .post("/api/races")
    .set("Content-Type", "text/plain")
    .send("SENSITIVE_REQUEST_BODY");
  assertError(nonJson, 400, "Request failed");

  for (const rawBody of ["[]", "null", '"text"', "42", "true"]) {
    const response = await postJson("/api/races", rawBody);
    assertError(response, 400, "Request failed");
  }
});

test("creation rejects missing, unknown, wrongly typed, and wrong-duration fields", async () => {
  const bodies = [
    {},
    { durationSeconds: "30" },
    { durationSeconds: "60" },
    { durationSeconds: 0 },
    { durationSeconds: 15 },
    { durationSeconds: 30.5 },
    { durationSeconds: 61 },
    { durationSeconds: null },
    { durationSeconds: true },
    { durationSeconds: 30, prompt: "client prompt" },
    { durationSeconds: 60, startedAt: "2026-11-22T00:00:00.000Z" },
    { durationSeconds: 30, extra: false },
  ];

  for (const body of bodies) {
    const response = await request(createApp(config)).post("/api/races").send(body);
    assertError(response, 400, "Request failed");
  }
});

test("creation rejects nonfinite JSON equivalents", async () => {
  for (const token of ["NaN", "Infinity", "-Infinity", "1e400"]) {
    const response = await postJson(
      "/api/races",
      `{"durationSeconds":${token}}`,
    );
    assertError(response, 400, "Request failed");
  }
});

test("both routes reject every nonempty query object", async () => {
  const harness = createHarness();
  await createRace(harness);

  for (const query of ["durationSeconds=30", "prompt=forged", "extra"]) {
    const creation = await request(harness.app)
      .post(`/api/races?${query}`)
      .send({ durationSeconds: 30 });
    assertError(creation, 400, "Request failed");

    const completion = await request(harness.app)
      .post(`/api/races/${RACE_ID}/complete?${query}`)
      .send({ typedText: "abc" });
    assertError(completion, 400, "Request failed");
  }

  assert.equal(harness.repository.get(RACE_ID).status, "active");
  harness.setNow(STARTED_AT_MS + 1_000);
  const valid = await request(harness.app)
    .post(`/api/races/${RACE_ID}/complete`)
    .send({ typedText: "abc" });
  assert.equal(valid.status, 200, valid.text);
});

test("completion rejects malformed and non-JSON bodies without consuming the race", async () => {
  const harness = createHarness();
  await createRace(harness);

  const malformed = await postJson(
    `/api/races/${RACE_ID}/complete`,
    '{"typedText":',
    harness.app,
  );
  assertError(malformed, 400, "Request failed");

  const nonJson = await request(harness.app)
    .post(`/api/races/${RACE_ID}/complete`)
    .set("Content-Type", "text/plain")
    .send("SENSITIVE_REQUEST_BODY");
  assertError(nonJson, 400, "Request failed");

  const invalidBodies = [
    "[]",
    "null",
    '"text"',
    "42",
    "true",
    "{}",
    '{"typedText":null}',
    '{"typedText":42}',
    '{"typedText":[]}',
    '{"typedText":{}}',
    JSON.stringify({ typedText: "a".repeat(1001) }),
  ];
  for (const rawBody of invalidBodies) {
    const response = await postJson(
      `/api/races/${RACE_ID}/complete`,
      rawBody,
      harness.app,
    );
    assertError(response, 400, "Request failed");
  }

  assert.equal(harness.repository.get(RACE_ID).status, "active");
  harness.setNow(STARTED_AT_MS + 1_000);
  const valid = await request(harness.app)
    .post(`/api/races/${RACE_ID}/complete`)
    .send({ typedText: "abc" });
  assert.equal(valid.status, 200, valid.text);
});

test("every client-authoritative completion field is rejected without consuming or changing the result", async () => {
  const harness = createHarness({ prompt: "abc" });
  await createRace(harness, 30);
  const forbiddenFields = [
    "wpm",
    "accuracy",
    "startedAt",
    "finishedAt",
    "expiresAt",
    "startedAtMs",
    "finishedAtMs",
    "elapsedMs",
    "durationSeconds",
    "prompt",
    "ranked",
    "inputMethod",
    "correctCharacters",
    "typedCharacters",
    "raceId",
  ];

  for (const field of forbiddenFields) {
    const response = await request(harness.app)
      .post(`/api/races/${RACE_ID}/complete`)
      .send({ typedText: "abc", [field]: "forged" });
    assertError(response, 400, "Request failed");
    assert.equal(harness.repository.get(RACE_ID).status, "active", field);
    assert.equal("result" in harness.repository.get(RACE_ID), false, field);
  }

  harness.setNow(STARTED_AT_MS + 15_000);
  const valid = await request(harness.app)
    .post(`/api/races/${RACE_ID}/complete`)
    .send({ typedText: "abc" });
  assert.equal(valid.status, 200, valid.text);
  assert.equal(valid.body.result.wpm, 2.4);
  assert.equal(valid.body.result.accuracy, 100);
  assert.equal(valid.body.result.elapsedMs, 15_000);
  assert.equal(valid.body.result.durationSeconds, 30);
  assert.equal(valid.body.result.ranked, false);
  assert.equal(valid.body.result.inputMethod, "keyboard");
});

test("malformed IDs return safe 400 responses", async () => {
  const malformedIds = [
    "not-a-uuid",
    "123e4567-e89b-42d3-a456-42661417400",
    "123e4567-e89b-42d3-a456-4266141740000",
    "123e4567e89b42d3a456426614174000",
  ];

  for (const id of malformedIds) {
    const response = await request(createApp(config))
      .post(`/api/races/${id}/complete`)
      .send({ typedText: "abc" });
    assertError(response, 400, "Request failed");
  }
});

test("unknown IDs return 404 and replay returns 409", async () => {
  const harness = createHarness();
  const missing = await request(harness.app)
    .post(`/api/races/${UNKNOWN_RACE_ID}/complete`)
    .send({ typedText: "abc" });
  assertError(missing, 404, "Not found");

  await createRace(harness, 30);
  harness.setNow(STARTED_AT_MS + 1_000);
  const first = await request(harness.app)
    .post(`/api/races/${RACE_ID}/complete`)
    .send({ typedText: "abc" });
  assert.equal(first.status, 200, first.text);

  const replay = await request(harness.app)
    .post(`/api/races/${RACE_ID}/complete`)
    .send({ typedText: "x" });
  assertError(replay, 409, "Request failed");
});

for (const finishOffset of [30_000, 30_001]) {
  test(`completion at expiry plus ${finishOffset - 30_000}ms returns 410`, async () => {
    const harness = createHarness();
    await createRace(harness, 30);
    harness.setNow(STARTED_AT_MS + finishOffset);

    const response = await request(harness.app)
      .post(`/api/races/${RACE_ID}/complete`)
      .send({ typedText: "abc" });
    assertError(response, 410, "Request failed");
    assert.equal(harness.repository.get(RACE_ID).status, "expired");
  });
}

test("unsupported race methods and unknown API paths retain the exact Phase 1 404", async () => {
  const app = createApp(config);
  for (const method of ["get", "put", "patch", "delete", "options"]) {
    for (const path of ["/api/races", `/api/races/${RACE_ID}/complete`]) {
      const response = await request(app)[method](path);
      assertError(response, 404, "Not found");
    }
  }

  for (const path of ["/api/not-a-route", "/api/races/not-a-route/extra"]) {
    const response = await request(app).post(path).send({ typedText: "abc" });
    assertError(response, 404, "Not found");
  }
});

test("repeated concurrent completion pairs produce exactly one 200 and one 409", async () => {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const harness = createHarness();
    await createRace(harness, 30);
    harness.setNow(STARTED_AT_MS + 1_000);

    const responses = await Promise.all(
      ["abc", "x"].map((typedText) =>
        request(harness.app)
          .post(`/api/races/${RACE_ID}/complete`)
          .send({ typedText }),
      ),
    );
    assert.deepEqual(
      responses.map(({ status }) => status).sort((a, b) => a - b),
      [200, 409],
      `iteration ${iteration}`,
    );
    const replay = responses.find(({ status }) => status === 409);
    assertError(replay, 409, "Request failed");
  }
});

test("concurrent creates never exceed repository bounds and capacity uses safe 503", async () => {
  const repository = createRaceRepository({ maxRaces: 5 });
  const service = createRaceService({
    repository,
    choosePrompt: () => "practice makes progress",
  });
  const app = createApp(config, { raceService: service });

  const responses = await Promise.all(
    Array.from({ length: 12 }, () =>
      request(app).post("/api/races").send({ durationSeconds: 30 }),
    ),
  );
  assert.equal(
    responses.filter(({ status }) => status === 201).length,
    5,
  );
  assert.equal(repository.size(), 5);
  for (const response of responses.filter(({ status }) => status !== 201)) {
    assertError(response, 503, "Internal server error");
  }
});

test("each default app composition receives an isolated fresh race service", async () => {
  const firstApp = createApp(config);
  const secondApp = createApp(config);
  const created = await request(firstApp)
    .post("/api/races")
    .send({ durationSeconds: 30 });
  assert.equal(created.status, 201, created.text);

  const missing = await request(secondApp)
    .post(`/api/races/${created.body.race.id}/complete`)
    .send({ typedText: "practice" });
  assertError(missing, 404, "Not found");
});

test("unexpected service failures reach the generic final error handler", async () => {
  const raceService = {
    createRace() {
      throw new Error("SENSITIVE_REQUEST_BODY C:\\private\\stack");
    },
    completeRace() {
      throw new Error("SENSITIVE_REQUEST_BODY /FastASL/private/stack");
    },
  };
  const app = createApp(config, { raceService });

  const creation = await request(app)
    .post("/api/races")
    .send({ durationSeconds: 30 });
  assertError(creation, 500, "Internal server error");

  const completion = await request(app)
    .post(`/api/races/${RACE_ID}/complete`)
    .send({ typedText: "abc" });
  assertError(completion, 500, "Internal server error");
});

test("invalid success DTOs become safe 500 responses rather than leaking internals", async () => {
  const internalRace = {
    id: "not-a-uuid",
    prompt: "abc",
    durationSeconds: 30,
    startedAtMs: STARTED_AT_MS,
    expiresAtMs: STARTED_AT_MS + 30_000,
  };
  const internalResult = {
    raceId: RACE_ID,
    durationSeconds: 30,
    startedAtMs: STARTED_AT_MS,
    finishedAtMs: STARTED_AT_MS + 1_000,
    expiresAtMs: STARTED_AT_MS + 30_000,
    elapsedMs: 1_000,
    correctCharacters: 3,
    typedCharacters: 3,
    wpm: 3.6,
    accuracy: 100,
    inputMethod: "keyboard",
    ranked: true,
  };
  const app = createApp(config, {
    raceService: {
      createRace: () => internalRace,
      completeRace: () => internalResult,
    },
  });

  const creation = await request(app)
    .post("/api/races")
    .send({ durationSeconds: 30 });
  assertError(creation, 500, "Internal server error");

  const completion = await request(app)
    .post(`/api/races/${RACE_ID}/complete`)
    .send({ typedText: "abc" });
  assertError(completion, 500, "Internal server error");
});
