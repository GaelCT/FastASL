export function initialRaceState(durationSeconds = 60) {
  return {
    status: "idle",
    operationId: 0,
    durationSeconds,
    race: null,
    typedText: "",
    remainingMs: 0,
    result: null,
    error: null,
  };
}

function currentOperation(state, event) {
  return event.operationId === state.operationId;
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
        error: null,
      };

    case "TEXT_CHANGED":
      if (state.status !== "active" || typeof event.typedText !== "string") {
        return state;
      }
      return { ...state, typedText: event.typedText };

    case "TIMER_TICK":
      if (state.status !== "active" || !currentOperation(state, event)) {
        return state;
      }
      return { ...state, remainingMs: Math.max(0, event.remainingMs) };

    case "COMPLETION_REQUESTED":
      if (state.status !== "active" || !currentOperation(state, event)) {
        return state;
      }
      return { ...state, status: "completing", remainingMs: Math.max(0, state.remainingMs) };

    case "COMPLETION_SUCCEEDED":
      if (state.status !== "completing" || !currentOperation(state, event)) {
        return state;
      }
      return {
        ...state,
        status: "results",
        result: event.result,
        remainingMs: 0,
        error: null,
      };

    case "OPERATION_FAILED":
      if (!["starting", "completing"].includes(state.status) ||
          !currentOperation(state, event)) {
        return state;
      }
      return {
        ...state,
        status: "error",
        result: null,
        error: {
          message: event.message,
          expired: event.expired === true,
        },
      };

    case "RESTART":
      return {
        ...initialRaceState(state.durationSeconds),
        operationId: state.operationId + 1,
      };

    default:
      return state;
  }
}
