import { test } from "node:test";
import assert from "node:assert/strict";
import { PRACTICE_PROMPTS, choosePrompt } from "../../src/races/prompts.js";
import { scoreAttempt } from "../../src/races/scoring.js";

function score(prompt, typedText, elapsedMs = 30000) {
  return scoreAttempt({
    prompt,
    typedText,
    startedAtMs: 1000,
    finishedAtMs: 1000 + elapsedMs,
  });
}

function assertFiniteNonnegativeMetrics(result) {
  for (const [field, value] of Object.entries(result)) {
    assert.equal(typeof value, "number", field);
    assert.ok(Number.isFinite(value), `${field} must be finite`);
    assert.ok(value >= 0, `${field} must be nonnegative`);
    assert.equal(Object.is(value, -0), false, `${field} must not be negative zero`);
  }
}

test("scoreAttempt pins the exact ASCII scoring examples", () => {
  assert.deepEqual(score("abc", "abc"), {
    elapsedMs: 30000,
    correctCharacters: 3,
    typedCharacters: 3,
    wpm: 1.2,
    accuracy: 100,
  });

  assert.deepEqual(score("abc", "ax"), {
    elapsedMs: 30000,
    correctCharacters: 1,
    typedCharacters: 2,
    wpm: 0.4,
    accuracy: 33.33,
  });

  assert.deepEqual(score("abc", "abcx"), {
    elapsedMs: 30000,
    correctCharacters: 3,
    typedCharacters: 4,
    wpm: 1.2,
    accuracy: 75,
  });

  assert.deepEqual(score("", ""), {
    elapsedMs: 30000,
    correctCharacters: 0,
    typedCharacters: 0,
    wpm: 0,
    accuracy: 0,
  });

  assert.deepEqual(score("abc", "abc", 0), {
    elapsedMs: 0,
    correctCharacters: 3,
    typedCharacters: 3,
    wpm: 0,
    accuracy: 100,
  });
});

test("scoreAttempt penalizes omissions, extras, and positional mismatches", () => {
  assert.deepEqual(score("abc", ""), {
    elapsedMs: 30000,
    correctCharacters: 0,
    typedCharacters: 0,
    wpm: 0,
    accuracy: 0,
  });
  assert.equal(score("abc", "cab").correctCharacters, 0);
  assert.equal(score("abc", "cab").accuracy, 0);
  assert.equal(score("abc", "abcd").accuracy, 75);
  assert.equal(score("abc", "ab").accuracy, 66.67);
});

test("scoreAttempt returns zero WPM for zero correct characters with subnormal elapsed time", () => {
  const result = scoreAttempt({
    prompt: "abc",
    typedText: "",
    startedAtMs: 0,
    finishedAtMs: Number.MIN_VALUE,
  });

  assert.deepEqual(result, {
    elapsedMs: Number.MIN_VALUE,
    correctCharacters: 0,
    typedCharacters: 0,
    wpm: 0,
    accuracy: 0,
  });
  assertFiniteNonnegativeMetrics(result);
});

test("scoreAttempt compares Unicode code points positionally", () => {
  const result = score("a😀c", "a😀x");
  assert.equal(result.correctCharacters, 2);
  assert.equal(result.typedCharacters, 3);
  assert.equal(result.wpm, 0.8);
  assert.equal(result.accuracy, 66.67);

  const differentGlyphs = score("é", "e\u0301");
  assert.equal(differentGlyphs.correctCharacters, 0);
  assert.equal(differentGlyphs.typedCharacters, 2);
  assert.equal(differentGlyphs.accuracy, 0);

  assert.equal(score("ABC", "abc").correctCharacters, 0);
  assert.equal(score(" abc ", "abc").correctCharacters, 0);
});

test("scoreAttempt rounds WPM and accuracy to two decimal places", () => {
  const result = score("abcdefg", "abcdefx", 17000);
  assert.equal(result.correctCharacters, 6);
  assert.equal(result.typedCharacters, 7);
  assert.equal(result.wpm, 4.24);
  assert.equal(result.accuracy, 85.71);
});

test("scoreAttempt remains finite and nonnegative for extreme valid numeric timing", () => {
  const inputs = [
    {
      prompt: "abc",
      typedText: "abc",
      startedAtMs: -Number.MAX_VALUE,
      finishedAtMs: Number.MAX_VALUE,
    },
    {
      prompt: "abc",
      typedText: "abc",
      startedAtMs: 0,
      finishedAtMs: Number.MIN_VALUE,
    },
    {
      prompt: "🤟".repeat(20),
      typedText: "🤟".repeat(20),
      startedAtMs: -0,
      finishedAtMs: 0,
    },
    {
      prompt: "abc",
      typedText: "",
      startedAtMs: Number.MAX_VALUE,
      finishedAtMs: Number.MAX_VALUE,
    },
  ];

  for (const input of inputs) {
    assertFiniteNonnegativeMetrics(scoreAttempt(input));
  }
});

test("scoreAttempt rejects invalid input and timing with one fixed RangeError", () => {
  const valid = {
    prompt: "abc",
    typedText: "abc",
    startedAtMs: 0,
    finishedAtMs: 1,
  };
  const invalidInputs = [
    { ...valid, prompt: null },
    { ...valid, prompt: ["abc"] },
    { ...valid, typedText: 42 },
    { ...valid, typedText: {} },
    { ...valid, startedAtMs: "0" },
    { ...valid, finishedAtMs: null },
    { ...valid, startedAtMs: NaN },
    { ...valid, startedAtMs: Infinity },
    { ...valid, finishedAtMs: -Infinity },
    { ...valid, startedAtMs: 2, finishedAtMs: 1 },
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => scoreAttempt(input),
      (error) => {
        assert.ok(error instanceof RangeError);
        assert.equal(error.message, "Invalid scoring input");
        return true;
      },
    );
  }
});

test("PRACTICE_PROMPTS is the immutable approved lowercase ASCII catalog", () => {
  assert.deepEqual(PRACTICE_PROMPTS, [
    "practice makes progress",
    "steady hands build skill",
    "focus on each letter",
    "keep a calm rhythm",
  ]);
  assert.equal(Object.isFrozen(PRACTICE_PROMPTS), true);
  for (const prompt of PRACTICE_PROMPTS) {
    assert.match(prompt, /^[a-z ]+$/);
  }
});

test("choosePrompt supports deterministic selection injection", () => {
  const prompts = ["first", "second", "third"];
  const selected = choosePrompt(prompts, (maximum) => {
    assert.equal(maximum, prompts.length);
    return 1;
  });
  assert.equal(selected, "second");
});

test("default choosePrompt returns only catalog entries", () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.ok(PRACTICE_PROMPTS.includes(choosePrompt()));
  }
});
