import { test } from "node:test";
import assert from "node:assert/strict";
import {
  completeRaceBodySchema,
  completeRaceResponseSchema,
  createRaceBodySchema,
  createRaceResponseSchema,
  emptyRaceQuerySchema,
  raceIdSchema,
} from "../../src/races/contracts.js";

function accepts(schema, value) {
  const result = schema.safeParse(value);
  assert.equal(result.success, true, result.error?.message);
  assert.deepEqual(result.data, value);
}

function rejects(schema, values) {
  for (const value of values) {
    assert.equal(
      schema.safeParse(value).success,
      false,
      `expected ${JSON.stringify(value)} to be rejected`,
    );
  }
}

test("createRaceBodySchema accepts only the two numeric practice durations", () => {
  accepts(createRaceBodySchema, { durationSeconds: 30 });
  accepts(createRaceBodySchema, { durationSeconds: 60 });

  rejects(createRaceBodySchema, [
    undefined,
    null,
    [],
    [{ durationSeconds: 30 }],
    "30",
    30,
    true,
    {},
    { durationSeconds: "30" },
    { durationSeconds: "60" },
    { durationSeconds: 0 },
    { durationSeconds: 15 },
    { durationSeconds: 30.5 },
    { durationSeconds: 61 },
    { durationSeconds: NaN },
    { durationSeconds: Infinity },
    { durationSeconds: -Infinity },
    { durationSeconds: 30, prompt: "client supplied" },
    { durationSeconds: 60, startedAt: "2026-11-22T00:00:00Z" },
  ]);
});

test("nonfinite numeric JSON equivalents are rejected at their respective boundaries", () => {
  for (const token of ["NaN", "Infinity", "-Infinity"]) {
    const text = `{"durationSeconds":${token}}`;
    assert.throws(() => JSON.parse(text), SyntaxError, text);
  }

  const overflowed = JSON.parse('{"durationSeconds":1e400}');
  assert.equal(overflowed.durationSeconds, Infinity);
  rejects(createRaceBodySchema, [overflowed]);
});

test("completeRaceBodySchema accepts empty and Unicode text up to 1000 UTF-16 code units", () => {
  accepts(completeRaceBodySchema, { typedText: "" });
  accepts(completeRaceBodySchema, { typedText: "ASL 🤟 é 漢字" });
  accepts(completeRaceBodySchema, { typedText: "a".repeat(1000) });
  accepts(completeRaceBodySchema, { typedText: "🤟".repeat(500) });

  rejects(completeRaceBodySchema, [
    undefined,
    null,
    [],
    {},
    { typedText: null },
    { typedText: 42 },
    { typedText: true },
    { typedText: [] },
    { typedText: {} },
    { typedText: "a".repeat(1001) },
    { typedText: "🤟".repeat(501) },
  ]);
});

test("completeRaceBodySchema rejects every client-authoritative or unknown field", () => {
  const forbiddenFields = [
    "prompt",
    "startedAt",
    "finishedAt",
    "durationSeconds",
    "wpm",
    "accuracy",
    "ranked",
    "inputMethod",
  ];

  for (const field of forbiddenFields) {
    rejects(completeRaceBodySchema, [{ typedText: "abc", [field]: "forged" }]);
  }
});

test("raceIdSchema accepts UUIDs and rejects malformed identifiers without coercion", () => {
  accepts(raceIdSchema, "123e4567-e89b-42d3-a456-426614174000");
  rejects(raceIdSchema, [
    undefined,
    null,
    42,
    "",
    "not-a-uuid",
    "123e4567-e89b-42d3-a456-42661417400",
    "123e4567-e89b-42d3-a456-4266141740000",
    "123e4567e89b42d3a456426614174000",
    " 123e4567-e89b-42d3-a456-426614174000",
  ]);
});

test("emptyRaceQuerySchema accepts only an object with no properties", () => {
  accepts(emptyRaceQuerySchema, {});
  rejects(emptyRaceQuerySchema, [
    undefined,
    null,
    [],
    "",
    0,
    { durationSeconds: "30" },
    { prompt: "forged" },
    { extra: undefined },
  ]);
});

const validRaceResponse = {
  race: {
    id: "123e4567-e89b-42d3-a456-426614174000",
    prompt: "practice makes progress",
    durationSeconds: 30,
    startedAt: "2026-11-22T12:00:00.000Z",
    expiresAt: "2026-11-22T12:00:30.000Z",
    serverNow: "2026-11-22T12:00:00.000Z",
    inputMethod: "keyboard",
    ranked: false,
  },
};

const validResultResponse = {
  result: {
    raceId: "123e4567-e89b-42d3-a456-426614174000",
    durationSeconds: 60,
    startedAt: "2026-11-22T12:00:00.000Z",
    finishedAt: "2026-11-22T12:00:30.000Z",
    expiresAt: "2026-11-22T12:01:00.000Z",
    elapsedMs: 30000,
    correctCharacters: 3,
    typedCharacters: 3,
    wpm: 1.2,
    accuracy: 100,
    inputMethod: "keyboard",
    ranked: false,
  },
};

test("createRaceResponseSchema enforces the complete strict creation DTO", () => {
  accepts(createRaceResponseSchema, validRaceResponse);
  accepts(createRaceResponseSchema, {
    race: { ...validRaceResponse.race, prompt: "x".repeat(2048) },
  });

  rejects(createRaceResponseSchema, [
    null,
    {},
    { ...validRaceResponse, extra: true },
    { race: { ...validRaceResponse.race, extra: true } },
    { race: { ...validRaceResponse.race, id: "bad" } },
    { race: { ...validRaceResponse.race, prompt: "" } },
    { race: { ...validRaceResponse.race, prompt: "x".repeat(2049) } },
    { race: { ...validRaceResponse.race, durationSeconds: 45 } },
    { race: { ...validRaceResponse.race, startedAt: "2026-11-22T12:00:00+00:00" } },
    { race: { ...validRaceResponse.race, expiresAt: "not a timestamp" } },
    { race: { ...validRaceResponse.race, serverNow: "2026-11-22" } },
    { race: { ...validRaceResponse.race, inputMethod: "camera" } },
    { race: { ...validRaceResponse.race, ranked: true } },
  ]);
});

test("completeRaceResponseSchema enforces the complete strict result DTO", () => {
  accepts(completeRaceResponseSchema, validResultResponse);
  accepts(completeRaceResponseSchema, {
    result: { ...validResultResponse.result, elapsedMs: 0, wpm: 0, accuracy: 0 },
  });

  rejects(completeRaceResponseSchema, [
    null,
    {},
    { ...validResultResponse, extra: true },
    { result: { ...validResultResponse.result, extra: true } },
    { result: { ...validResultResponse.result, raceId: "bad" } },
    { result: { ...validResultResponse.result, durationSeconds: "60" } },
    { result: { ...validResultResponse.result, startedAt: "2026-11-22T12:00:00+00:00" } },
    { result: { ...validResultResponse.result, finishedAt: null } },
    { result: { ...validResultResponse.result, expiresAt: "2026-11-22" } },
    { result: { ...validResultResponse.result, inputMethod: "classifier" } },
    { result: { ...validResultResponse.result, ranked: true } },
  ]);
});

test("response schemas reject nonfinite, negative, and out-of-range numeric outputs", () => {
  const invalidValues = [NaN, Infinity, -Infinity, -1, "1"];
  const numericFields = [
    "elapsedMs",
    "correctCharacters",
    "typedCharacters",
    "wpm",
    "accuracy",
  ];

  for (const field of numericFields) {
    for (const value of invalidValues) {
      rejects(completeRaceResponseSchema, [
        { result: { ...validResultResponse.result, [field]: value } },
      ]);
    }
  }

  rejects(completeRaceResponseSchema, [
    { result: { ...validResultResponse.result, accuracy: 100.01 } },
  ]);
});
