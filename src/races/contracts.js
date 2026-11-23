import { z } from "zod";

export const createRaceBodySchema = z
  .object({
    durationSeconds: z.union([z.literal(30), z.literal(60)]),
  })
  .strict();

export const completeRaceBodySchema = z
  .object({
    typedText: z.string().max(1000),
  })
  .strict();

export const raceIdSchema = z.uuid();

export const emptyRaceQuerySchema = z.object({}).strict();

const utcTimestampSchema = z.iso.datetime();
const nonnegativeNumberSchema = z.number().nonnegative();
const keyboardInputMethodSchema = z.literal("keyboard");
const unrankedSchema = z.literal(false);

export const createRaceResponseSchema = z
  .object({
    race: z
      .object({
        id: raceIdSchema,
        prompt: z.string().min(1).max(2048),
        durationSeconds: z.union([z.literal(30), z.literal(60)]),
        startedAt: utcTimestampSchema,
        expiresAt: utcTimestampSchema,
        serverNow: utcTimestampSchema,
        inputMethod: keyboardInputMethodSchema,
        ranked: unrankedSchema,
      })
      .strict(),
  })
  .strict();

export const completeRaceResponseSchema = z
  .object({
    result: z
      .object({
        raceId: raceIdSchema,
        durationSeconds: z.union([z.literal(30), z.literal(60)]),
        startedAt: utcTimestampSchema,
        finishedAt: utcTimestampSchema,
        expiresAt: utcTimestampSchema,
        elapsedMs: nonnegativeNumberSchema,
        correctCharacters: nonnegativeNumberSchema,
        typedCharacters: nonnegativeNumberSchema,
        wpm: nonnegativeNumberSchema,
        accuracy: nonnegativeNumberSchema.max(100),
        inputMethod: keyboardInputMethodSchema,
        ranked: unrankedSchema,
      })
      .strict(),
  })
  .strict();
