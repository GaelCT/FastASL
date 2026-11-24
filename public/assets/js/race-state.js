export function initialRaceState(durationSeconds = 60) {
  return {
    status: "idle",
    operationId: 0,
    durationSeconds,
    race: null,
    typedText: "",
    remainingMs: 0,
    clockOffsetMs: 0,
    result: null,
    error: null,
    storageUnavailable: false,
  };
}

function currentOperation(state, event) {
  return event.operationId === state.operationId;
}

function completionCanRetry(state) {
  return state.status === "error" && state.error?.retryable === true;
}

/** Pure transitions for the race lifecycle; stale async completions are ignored. */
export function reduceRaceState(state, event) {
  switch (event.type) {
    case "START_REQUESTED":
      if (state.status !== "idle") {
        return state;
      }
      return {
        ...initialRaceState(event.durationSeconds),
        status: "starting",
        operationId: state.operationId + 1,
        storageUnavailable: state.storageUnavailable,
      };

    case "START_SUCCEEDED":
      if (state.status !== "starting" || !currentOperation(state, event)) {
        return state;
      }
      return {
        ...state,
        status: "active",
        race: event.race,
        remainingMs: event.race.durationSeconds * 1000,
        clockOffsetMs: event.clockOffsetMs ?? 0,
        error: null,
      };

    case "RESUME_SUCCEEDED":
      if (state.status !== "idle") {
        return state;
      }
      return {
        ...state,
        status: "active",
        operationId: state.operationId + 1,
        durationSeconds: event.race.durationSeconds,
        race: event.race,
        typedText: event.typedText,
        remainingMs: Math.max(0, event.remainingMs),
        clockOffsetMs: event.clockOffsetMs,
        result: null,
        error: null,
      };

    case "TEXT_CHANGED":
      if (state.status !== "active" || typeof event.typedText !== "string") {
        return state;
      }
      return { ...state, typedText: event.typedText };

    case "TIMER_TICK":
      if (!(state.status === "active" || state.status === "completing" ||
            completionCanRetry(state)) || !currentOperation(state, event)) {
        return state;
      }
      return { ...state, remainingMs: Math.max(0, event.remainingMs) };

    case "COMPLETION_REQUESTED": {
      if (!(state.status === "active" || completionCanRetry(state)) ||
          !currentOperation(state, event)) {
        return state;
      }
      const retrying = completionCanRetry(state);
      return {
        ...state,
        status: "completing",
        operationId: state.operationId + (retrying ? 1 : 0),
        remainingMs: Math.max(0, state.remainingMs),
        error: null,
      };
    }

    case "COMPLETION_SUCCEEDED":
      if (state.status !== "completing" || !currentOperation(state, event)) {
        return state;
      }
      return {
        ...state,
        status: "results",
        typedText: "",
        result: event.result,
        remainingMs: 0,
        error: null,
      };

    case "OPERATION_FAILED": {
      if (!["starting", "completing"].includes(state.status) ||
          !currentOperation(state, event)) {
        return state;
      }
      const starting = state.status === "starting";
      return {
        ...state,
        status: "error",
        result: null,
        error: {
          message: event.message,
          expired: event.expired === true,
          kind: event.kind ?? (starting ? "start" : "completion"),
          retryable: event.retryable === true,
        },
      };
    }

    case "RACE_EXPIRED":
      if (!(state.status === "active" || state.status === "completing" ||
            completionCanRetry(state)) || !currentOperation(state, event)) {
        return state;
      }
      return {
        ...state,
        status: "error",
        remainingMs: 0,
        result: null,
        error: {
          message: event.message,
          expired: true,
          kind: "expired",
          retryable: false,
        },
      };

    case "STORAGE_UNAVAILABLE":
      return state.storageUnavailable ? state : { ...state, storageUnavailable: true };

    case "RESTART":
      return {
        ...initialRaceState(state.durationSeconds),
        operationId: state.operationId + 1,
        storageUnavailable: state.storageUnavailable,
      };

    default:
      return state;
  }
}
