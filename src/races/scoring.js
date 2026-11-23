const INVALID_SCORING_INPUT = "Invalid scoring input";

function roundMetric(value) {
  if (value === 0) {
    return 0;
  }

  // Valid finite inputs can still overflow intermediate floating-point math.
  if (!Number.isFinite(value)) {
    return Number.MAX_VALUE;
  }
  if (value >= Number.MAX_VALUE / 100) {
    return value;
  }

  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

export function scoreAttempt({
  prompt,
  typedText,
  startedAtMs,
  finishedAtMs,
}) {
  if (
    typeof prompt !== "string" ||
    typeof typedText !== "string" ||
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(finishedAtMs) ||
    finishedAtMs < startedAtMs
  ) {
    throw new RangeError(INVALID_SCORING_INPUT);
  }

  const promptCharacters = Array.from(prompt);
  const typedCharacters = Array.from(typedText);
  let correctCharacters = 0;

  for (let index = 0; index < typedCharacters.length; index += 1) {
    if (typedCharacters[index] === promptCharacters[index]) {
      correctCharacters += 1;
    }
  }

  const elapsed = finishedAtMs - startedAtMs;
  const elapsedMs = Number.isFinite(elapsed)
    ? elapsed === 0
      ? 0
      : elapsed
    : Number.MAX_VALUE;
  const denominator = Math.max(promptCharacters.length, typedCharacters.length);
  const accuracy =
    denominator === 0
      ? 0
      : roundMetric((100 * correctCharacters) / denominator);
  const wpm =
    elapsedMs === 0 || correctCharacters === 0
      ? 0
      : roundMetric((correctCharacters / 5) / (elapsedMs / 60000));

  return {
    elapsedMs,
    correctCharacters,
    typedCharacters: typedCharacters.length,
    wpm,
    accuracy,
  };
}
