import { test } from "node:test";
import assert from "node:assert/strict";
import { completeRaceBodySchema } from "../../src/races/contracts.js";
import { RaceError } from "../../src/races/errors.js";
import { createRaceRepository } from "../../src/races/in-memory-race-repository.js";
import { createRaceService } from "../../src/races/race-service.js";

const RACE_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_RACE_ID = "123e4567-e89b-42d3-a456-426614174001";

function createHarness({
  prompt = "abc",
  now: initialNow = 1_000,
  createId = () => RACE_ID,
  repository = createRaceRepository(),
} = {}) {
  let currentTime = initialNow;
  let nowCalls = 0;
  const service = createRaceService({
    repository,
    now: () => {
      nowCalls += 1;
      return currentTime;
    },
    createId,
    choosePrompt: () => prompt,
  });

  return {
    repository,
    service,
    nowCalls: () => nowCalls,
    setNow(value) {
      currentTime = value;
    },
  };
}

function assertRaceError(error, code, status) {
  assert.ok(error instanceof RaceError);
  assert.ok(error instanceof Error);
  assert.equal(error.name, "RaceError");
  assert.equal(error.code, code);
  assert.equal(error.status, status);
}

test("createRace uses only server-owned prompt, ID, duration, and timestamps", () => {
  const harness = createHarness({ prompt: "steady hands build skill" });
  const race = harness.service.createRace({
    durationSeconds: 60,
    id: OTHER_RACE_ID,
    prompt: "client prompt",
    startedAtMs: 0,
    expiresAtMs: 0,
  });

  assert.deepEqual(race, {
    id: RACE_ID,
    prompt: "steady hands build skill",
    durationSeconds: 60,
    startedAtMs: 1_000,
    expiresAtMs: 61_000,
  });
  assert.equal(harness.nowCalls(), 1);
  assert.equal(harness.repository.get(RACE_ID).prompt, "steady hands build skill");
  assert.equal(harness.repository.get(RACE_ID).expiresAtMs, 61_000);
});

test("a duplicate generated ID fails with the fixed collision error and never overwrites", () => {
  let idCalls = 0;
  const harness = createHarness({
    createId: () => {
      idCalls += 1;
      return RACE_ID;
    },
  });
  const original = harness.service.createRace({ durationSeconds: 30 });
  harness.setNow(2_000);

  assert.throws(
    () => harness.service.createRace({ durationSeconds: 60 }),
    (error) => {
      assert.equal(error.constructor, Error);
      assert.equal(error.message, "Race ID collision");
      return true;
    },
  );
  assert.equal(idCalls, 2);
  assert.deepEqual(harness.repository.get(RACE_ID), {
    ...original,
    status: "active",
  });
});

test("a full repository maps to the stable RACE_FULL error", () => {
  const ids = [RACE_ID, OTHER_RACE_ID];
  const harness = createHarness({
    repository: createRaceRepository({ maxRaces: 1 }),
    createId: () => ids.shift(),
  });
  harness.service.createRace({ durationSeconds: 30 });

  assert.throws(
    () => harness.service.createRace({ durationSeconds: 30 }),
    (error) => {
      assertRaceError(error, "RACE_FULL", 503);
      return true;
    },
  );
  assert.equal(harness.repository.size(), 1);
});

const scoringCases = [
  {
    name: "empty",
    prompt: "abc",
    typedText: "",
    correctCharacters: 0,
    typedCharacters: 0,
    wpm: 0,
    accuracy: 0,
  },
  {
    name: "partial",
    prompt: "practice",
    typedText: "prac",
    correctCharacters: 4,
    typedCharacters: 4,
    wpm: 1.6,
    accuracy: 50,
  },
  {
    name: "incorrect",
    prompt: "abc",
    typedText: "cab",
    correctCharacters: 0,
    typedCharacters: 3,
    wpm: 0,
    accuracy: 0,
  },
  {
    name: "extra",
    prompt: "abc",
    typedText: "abcx",
    correctCharacters: 3,
    typedCharacters: 4,
    wpm: 1.2,
    accuracy: 75,
  },
  {
    name: "Unicode code points",
    prompt: "a😀c",
    typedText: "a😀x",
    correctCharacters: 2,
    typedCharacters: 3,
    wpm: 0.8,
    accuracy: 66.67,
  },
];

for (const scoringCase of scoringCases) {
  test(`completeRace applies Card 1 scoring to ${scoringCase.name} attempts`, () => {
    const harness = createHarness({ prompt: scoringCase.prompt });
    harness.service.createRace({ durationSeconds: 60 });
    harness.setNow(31_000);

    const result = harness.service.completeRace({
      raceId: RACE_ID,
      typedText: scoringCase.typedText,
      prompt: "forged prompt",
      startedAtMs: 0,
      finishedAtMs: 0,
      wpm: 999,
      accuracy: 0,
      ranked: true,
    });

    assert.deepEqual(result, {
      raceId: RACE_ID,
      durationSeconds: 60,
      startedAtMs: 1_000,
      finishedAtMs: 31_000,
      expiresAtMs: 61_000,
      elapsedMs: 30_000,
      correctCharacters: scoringCase.correctCharacters,
      typedCharacters: scoringCase.typedCharacters,
      wpm: scoringCase.wpm,
      accuracy: scoringCase.accuracy,
      inputMethod: "keyboard",
      ranked: false,
    });
    assert.equal(harness.nowCalls(), 2);
    assert.deepEqual(harness.repository.get(RACE_ID).result, result);
  });
}

test("completion uses actual elapsed time and zero-WPM scoring at zero elapsed time", () => {
  const harness = createHarness();
  harness.service.createRace({ durationSeconds: 30 });
  const result = harness.service.completeRace({ raceId: RACE_ID, typedText: "abc" });

  assert.equal(result.elapsedMs, 0);
  assert.equal(result.wpm, 0);
  assert.equal(result.accuracy, 100);
  assert.equal(result.finishedAtMs, result.startedAtMs);
  assert.notEqual(result.elapsedMs, 30_000);
});

test("completion at or after expiry returns RACE_EXPIRED and stores no result", () => {
  for (const finishOffset of [30_000, 30_001]) {
    const harness = createHarness();
    harness.service.createRace({ durationSeconds: 30 });
    harness.setNow(1_000 + finishOffset);

    assert.throws(
      () => harness.service.completeRace({ raceId: RACE_ID, typedText: "abc" }),
      (error) => {
        assertRaceError(error, "RACE_EXPIRED", 410);
        return true;
      },
    );
    const stored = harness.repository.get(RACE_ID);
    assert.equal(stored.status, "expired");
    assert.equal("result" in stored, false);
    assert.equal(harness.nowCalls(), 2);
  }
});

test("missing and replayed completions expose stable internal errors", () => {
  const harness = createHarness();
  assert.throws(
    () => harness.service.completeRace({ raceId: RACE_ID, typedText: "abc" }),
    (error) => {
      assertRaceError(error, "RACE_NOT_FOUND", 404);
      return true;
    },
  );

  harness.service.createRace({ durationSeconds: 30 });
  harness.setNow(2_000);
  harness.service.completeRace({ raceId: RACE_ID, typedText: "abc" });
  assert.throws(
    () => harness.service.completeRace({ raceId: RACE_ID, typedText: "x" }),
    (error) => {
      assertRaceError(error, "RACE_ALREADY_COMPLETED", 409);
      return true;
    },
  );
});

test("Promise.all completions produce one success and one replay failure", async () => {
  const harness = createHarness();
  harness.service.createRace({ durationSeconds: 30 });
  harness.setNow(2_000);

  const outcomes = await Promise.all(
    ["abc", "x"].map((typedText) =>
      Promise.resolve().then(() => {
        try {
          return {
            status: "ok",
            result: harness.service.completeRace({ raceId: RACE_ID, typedText }),
          };
        } catch (error) {
          return { status: "error", error };
        }
      }),
    ),
  );

  const successes = outcomes.filter(({ status }) => status === "ok");
  const failures = outcomes.filter(({ status }) => status === "error");
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assertRaceError(failures[0].error, "RACE_ALREADY_COMPLETED", 409);
  assert.equal(successes[0].result.correctCharacters, 3);
  assert.deepEqual(harness.repository.get(RACE_ID).result, successes[0].result);
});

test("returned completion snapshots cannot mutate the stored result", () => {
  const harness = createHarness();
  harness.service.createRace({ durationSeconds: 30 });
  harness.setNow(16_000);
  const result = harness.service.completeRace({ raceId: RACE_ID, typedText: "abc" });
  const acceptedWpm = result.wpm;

  result.wpm = 999;
  result.ranked = true;
  assert.equal(harness.repository.get(RACE_ID).result.wpm, acceptedWpm);
  assert.equal(harness.repository.get(RACE_ID).result.ranked, false);
});

test("raw typed text is not retained in the terminal race record", () => {
  const harness = createHarness();
  const typedText = "raw submitted text 🤟";
  harness.service.createRace({ durationSeconds: 30 });
  harness.setNow(2_000);
  harness.service.completeRace({ raceId: RACE_ID, typedText });

  assert.equal(JSON.stringify(harness.repository.get(RACE_ID)).includes(typedText), false);
  assert.equal("typedText" in harness.repository.get(RACE_ID).result, false);
});

test("invalid boundary input rejected before service invocation leaves the race active", () => {
  const harness = createHarness();
  harness.service.createRace({ durationSeconds: 30 });
  const parsed = completeRaceBodySchema.safeParse({ typedText: null });

  assert.equal(parsed.success, false);
  if (parsed.success) {
    harness.service.completeRace({ raceId: RACE_ID, ...parsed.data });
  }
  assert.equal(harness.repository.get(RACE_ID).status, "active");
  assert.equal("result" in harness.repository.get(RACE_ID), false);

  harness.setNow(2_000);
  const result = harness.service.completeRace({ raceId: RACE_ID, typedText: "abc" });
  assert.equal(result.accuracy, 100);
});
