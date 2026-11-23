import { randomUUID } from "node:crypto";
import { RaceError } from "./errors.js";
import { choosePrompt as selectPracticePrompt } from "./prompts.js";
import { scoreAttempt } from "./scoring.js";

function raceError(code, status, message) {
  return new RaceError(code, status, message);
}

export function createRaceService({
  repository,
  now = Date.now,
  createId = randomUUID,
  choosePrompt = selectPracticePrompt,
}) {
  function createRace({ durationSeconds }) {
    const startedAtMs = now();
    const race = {
      id: createId(),
      prompt: choosePrompt(),
      durationSeconds,
      startedAtMs,
      expiresAtMs: startedAtMs + durationSeconds * 1000,
    };

    const insertion = repository.insert(race, startedAtMs);
    if (insertion === "duplicate") {
      throw new Error("Race ID collision");
    }
    if (insertion === "full") {
      throw raceError("RACE_FULL", 503, "Race capacity reached");
    }

    return { ...race };
  }

  function completeRace({ raceId, typedText }) {
    const race = repository.get(raceId);
    if (race === undefined) {
      throw raceError("RACE_NOT_FOUND", 404, "Race not found");
    }
    if (race.status === "completed") {
      throw raceError(
        "RACE_ALREADY_COMPLETED",
        409,
        "Race already completed",
      );
    }
    if (race.status === "expired") {
      throw raceError("RACE_EXPIRED", 410, "Race expired");
    }

    const finishedAtMs = now();
    const score = scoreAttempt({
      prompt: race.prompt,
      typedText,
      startedAtMs: race.startedAtMs,
      finishedAtMs,
    });
    const result = {
      raceId: race.id,
      durationSeconds: race.durationSeconds,
      startedAtMs: race.startedAtMs,
      finishedAtMs,
      expiresAtMs: race.expiresAtMs,
      ...score,
      inputMethod: "keyboard",
      ranked: false,
    };

    const transition = repository.completeIfActive(
      raceId,
      finishedAtMs,
      result,
    );
    if (transition.status === "not_found") {
      throw raceError("RACE_NOT_FOUND", 404, "Race not found");
    }
    if (transition.status === "already_completed") {
      throw raceError(
        "RACE_ALREADY_COMPLETED",
        409,
        "Race already completed",
      );
    }
    if (transition.status === "expired") {
      throw raceError("RACE_EXPIRED", 410, "Race expired");
    }

    return { ...transition.race.result };
  }

  return {
    createRace,
    completeRace,
  };
}
