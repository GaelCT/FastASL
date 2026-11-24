const RACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

// A dedicated worker keeps Chromium's native HTTP/network resource diagnostics
// out of the page console. This same module is the worker entry, so no blob URL,
// extra static file, CSP exception, or API-contract change is needed.
if (typeof globalThis.WorkerGlobalScope !== "undefined" &&
    globalThis instanceof globalThis.WorkerGlobalScope) {
  globalThis.onmessage = async ({ data }) => {
    try {
      const response = await globalThis.fetch(data.url, data.options);
      const text = await response.text();
      globalThis.postMessage({ status: response.status, text });
    } catch {
      globalThis.postMessage({ failed: true });
    }
  };
}

function fetchInWorker(path, { signal, ...options }) {
  return new Promise((resolve, reject) => {
    const worker = new globalThis.Worker(
      new URL("./api.js", import.meta.url),
      { type: "module" },
    );
    let settled = false;

    function cleanup() {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    }
    function settle(callback, value) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    }
    function abort() {
      settle(reject, new DOMException("The operation was aborted", "AbortError"));
    }

    worker.addEventListener("message", ({ data }) => {
      if (data?.failed) {
        settle(reject, new TypeError("Network request failed"));
        return;
      }
      settle(resolve, {
        status: data?.status,
        async json() {
          return JSON.parse(data.text);
        },
      });
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      settle(reject, new TypeError("Network request failed"));
    });
    worker.addEventListener("messageerror", () => {
      settle(reject, new TypeError("Network request failed"));
    });

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.postMessage({
      url: new URL(path, globalThis.location.href).href,
      options,
    });
  });
}

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
  if (typeof value !== "string") {
    return false;
  }
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) &&
    parsed.getUTCFullYear() === Number(match[1]) &&
    parsed.getUTCMonth() + 1 === Number(match[2]) &&
    parsed.getUTCDate() === Number(match[3]) &&
    parsed.getUTCHours() === Number(match[4]) &&
    parsed.getUTCMinutes() === Number(match[5]) &&
    parsed.getUTCSeconds() === Number(match[6]);
}

function isNonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRaceId(value) {
  return typeof value === "string" && RACE_ID_PATTERN.test(value);
}

export function isCreationRaceDto(race, requestedDuration) {
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
  const validDuration = requestedDuration === undefined
    ? (race?.durationSeconds === 30 || race?.durationSeconds === 60)
    : race?.durationSeconds === requestedDuration;
  if (!hasExactKeys(race, keys) ||
      !isRaceId(race.id) ||
      typeof race.prompt !== "string" ||
      race.prompt.length === 0 ||
      race.prompt.length > 2048 ||
      !validDuration ||
      !isTimestamp(race.startedAt) ||
      !isTimestamp(race.expiresAt) ||
      !isTimestamp(race.serverNow) ||
      race.inputMethod !== "keyboard" ||
      race.ranked !== false) {
    return false;
  }

  const startedAtMs = Date.parse(race.startedAt);
  return Date.parse(race.serverNow) === startedAtMs &&
    Date.parse(race.expiresAt) === startedAtMs + race.durationSeconds * 1000;
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

/** Create an API client. Tests may inject fetch; the browser uses its worker transport. */
export function createApi({
  fetchImpl = fetchInWorker,
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
          !isCreationRaceDto(payload.race, durationSeconds)) {
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
