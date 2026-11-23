import { Router } from "express";
import {
  completeRaceBodySchema,
  completeRaceResponseSchema,
  createRaceBodySchema,
  createRaceResponseSchema,
  emptyRaceQuerySchema,
  raceIdSchema,
} from "../races/contracts.js";
import { RaceError } from "../races/errors.js";
import { notFoundHandler } from "../middleware/not-found.js";

function isoTimestamp(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function creationDto(race) {
  return createRaceResponseSchema.parse({
    race: {
      id: race.id,
      prompt: race.prompt,
      durationSeconds: race.durationSeconds,
      startedAt: isoTimestamp(race.startedAtMs),
      expiresAt: isoTimestamp(race.expiresAtMs),
      serverNow: isoTimestamp(race.startedAtMs),
      inputMethod: "keyboard",
      ranked: false,
    },
  });
}

function completionDto(result) {
  return completeRaceResponseSchema.parse({
    result: {
      raceId: result.raceId,
      durationSeconds: result.durationSeconds,
      startedAt: isoTimestamp(result.startedAtMs),
      finishedAt: isoTimestamp(result.finishedAtMs),
      expiresAt: isoTimestamp(result.expiresAtMs),
      elapsedMs: result.elapsedMs,
      correctCharacters: result.correctCharacters,
      typedCharacters: result.typedCharacters,
      wpm: result.wpm,
      accuracy: result.accuracy,
      inputMethod: result.inputMethod,
      ranked: result.ranked,
    },
  });
}

function handleRaceError(error, res, next) {
  if (!(error instanceof RaceError)) {
    next(error);
    return;
  }

  switch (error.code) {
    case "RACE_NOT_FOUND":
      res.status(404).json({ error: "Not found" });
      return;
    case "RACE_ALREADY_COMPLETED":
      res.status(409).json({ error: "Request failed" });
      return;
    case "RACE_EXPIRED":
      res.status(410).json({ error: "Request failed" });
      return;
    case "RACE_FULL":
      res.status(503).json({ error: "Internal server error" });
      return;
    default:
      next(error);
  }
}

/** Expose the server-authoritative race lifecycle without opening a listener. */
export function createRaceRouter({ service }) {
  const router = Router();

  router.post("/", (req, res, next) => {
    const query = emptyRaceQuerySchema.safeParse(req.query);
    const body = createRaceBodySchema.safeParse(req.body);
    if (!query.success || !body.success) {
      res.status(400).json({ error: "Request failed" });
      return;
    }

    try {
      const race = service.createRace(body.data);
      res.status(201).json(creationDto(race));
    } catch (error) {
      handleRaceError(error, res, next);
    }
  });

  router.post("/:id/complete", (req, res, next) => {
    const query = emptyRaceQuerySchema.safeParse(req.query);
    const raceId = raceIdSchema.safeParse(req.params.id);
    const body = completeRaceBodySchema.safeParse(req.body);
    if (!query.success || !raceId.success || !body.success) {
      res.status(400).json({ error: "Request failed" });
      return;
    }

    try {
      const result = service.completeRace({
        raceId: raceId.data,
        typedText: body.data.typedText,
      });
      res.status(200).json(completionDto(result));
    } catch (error) {
      handleRaceError(error, res, next);
    }
  });

  router.all("/", notFoundHandler);
  router.all("/:id/complete", notFoundHandler);

  return router;
}
