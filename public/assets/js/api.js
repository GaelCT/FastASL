const RACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/** A safe HTTP/network failure. Response bodies and internal messages are not exposed. */
export class ApiError extends Error {
  constructor(message, { status = 0, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.status = Number.isInteger(status) && status >= 400 && status <= 599
      ? status
      : 0;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function isTimestamp(value) {
  return typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isNonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRaceId(value) {
  return typeof value === "string" && RACE_ID_PATTERN.test(value);
}

function validRace(race, requestedDuration) {
  const keys = [
    "id",
    "prompt",
    "durationSeconds",
    "startedAt",
    "expiresAt",
    "serverNow",
    "inputMethod",
    "ranked",
  ];
  return hasExactKeys(race, keys) &&
    isRaceId(race.id) &&
    typeof race.prompt === "string" &&
    race.prompt.length > 0 &&
    race.prompt.length <= 2048 &&
    race.durationSeconds === requestedDuration &&
    isTimestamp(race.startedAt) &&
    isTimestamp(race.expiresAt) &&
    isTimestamp(race.serverNow) &&
    race.inputMethod === "keyboard" &&
    race.ranked === false;
}

function validResult(result, requestedRaceId) {
  const keys = [
    "raceId",
    "durationSeconds",
    "startedAt",
    "finishedAt",
    "expiresAt",
    "elapsedMs",
    "correctCharacters",
    "typedCharacters",
    "wpm",
    "accuracy",
    "inputMethod",
    "ranked",
  ];
  return hasExactKeys(result, keys) &&
    result.raceId === requestedRaceId &&
    isRaceId(result.raceId) &&
    (result.durationSeconds === 30 || result.durationSeconds === 60) &&
    isTimestamp(result.startedAt) &&
    isTimestamp(result.finishedAt) &&
    isTimestamp(result.expiresAt) &&
    isNonnegativeNumber(result.elapsedMs) &&
    isNonnegativeNumber(result.correctCharacters) &&
    isNonnegativeNumber(result.typedCharacters) &&
    isNonnegativeNumber(result.wpm) &&
    isNonnegativeNumber(result.accuracy) &&
    result.accuracy <= 100 &&
    result.inputMethod === "keyboard" &&
    result.ranked === false;
}

async function request(fetchImpl, path, { expectedStatus, signal, body }) {
  let response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw new ApiError("Network request failed", { cause: error });
  }

  const status = response?.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new ApiError("Invalid server response");
  }
  if (status !== expectedStatus) {
    throw new ApiError("Request failed", { status });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiError("Invalid server response", { status, cause: error });
  }
  return payload;
}

/** Create an API client. The default resolves global fetch lazily for easy browser use. */
export function createApi({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async createRace(durationSeconds, { signal } = {}) {
      if (durationSeconds !== 30 && durationSeconds !== 60) {
        throw new ApiError("Invalid race duration");
      }
      const payload = await request(fetchImpl, "/api/races", {
        expectedStatus: 201,
        signal,
        body: { durationSeconds },
      });
      if (!hasExactKeys(payload, ["race"]) ||
          !validRace(payload.race, durationSeconds)) {
        throw new ApiError("Invalid server response", { status: 201 });
      }
      return payload.race;
    },

    async completeRace(raceId, typedText, { signal } = {}) {
      if (!isRaceId(raceId) || typeof typedText !== "string" ||
          typedText.length > 1000) {
        throw new ApiError("Invalid completion request");
      }
      const payload = await request(
        fetchImpl,
        `/api/races/${encodeURIComponent(raceId)}/complete`,
        { expectedStatus: 200, signal, body: { typedText } },
      );
      if (!hasExactKeys(payload, ["result"]) ||
          !validResult(payload.result, raceId)) {
        throw new ApiError("Invalid server response", { status: 200 });
      }
      return payload.result;
    },
  };
}

const defaultApi = createApi();

export function createRace(durationSeconds, { signal } = {}) {
  return defaultApi.createRace(durationSeconds, { signal });
}

export function completeRace(raceId, typedText, { signal } = {}) {
  return defaultApi.completeRace(raceId, typedText, { signal });
}
