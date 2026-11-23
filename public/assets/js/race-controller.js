import { initialRaceState, reduceRaceState } from "./race-state.js";
import { createCountdown } from "./timer-display.js";
import { ApiError } from "./api.js";

const START_FAILURE =
  "Could not start the race. Check your connection, then restart or return to the main menu.";
const FINISH_FAILURE =
  "Could not finish the race. Restart or return to the main menu; no result is shown.";
const EXPIRED = "Race expired. Restart to try again or return to the main menu.";

export function createRaceController({
  api,
  timer = createCountdown,
  onChange = () => {},
  durationSeconds = 60,
}) {
  let state = initialRaceState(durationSeconds);
  let countdown;
  let requestController;
  let disposed = false;

  function emit() {
    onChange(state);
  }

  function dispatch(event) {
    const next = reduceRaceState(state, event);
    if (next !== state) {
      state = next;
      emit();
    }
  }

  function stopCountdown() {
    countdown?.dispose();
    countdown = undefined;
  }

  function cancelRequest() {
    requestController?.abort();
    requestController = undefined;
  }

  function operationIsCurrent(operationId) {
    return !disposed && state.operationId === operationId;
  }

  function errorMessage(error, fallback) {
    if (error instanceof ApiError && error.status === 410) {
      return EXPIRED;
    }
    return fallback;
  }

  async function finish() {
    if (disposed || state.status !== "active") {
      return;
    }
    const operationId = state.operationId;
    const raceId = state.race.id;
    const typedText = state.typedText;
    stopCountdown();
    dispatch({ type: "COMPLETION_REQUESTED", operationId });
    requestController = new AbortController();

    try {
      const result = await api.completeRace(raceId, typedText, {
        signal: requestController.signal,
      });
      if (!operationIsCurrent(operationId) || state.status !== "completing") {
        return;
      }
      dispatch({ type: "COMPLETION_SUCCEEDED", operationId, result });
    } catch (error) {
      if (!operationIsCurrent(operationId) || state.status !== "completing") {
        return;
      }
      dispatch({
        type: "OPERATION_FAILED",
        operationId,
        message: errorMessage(error, FINISH_FAILURE),
        expired: error instanceof ApiError && error.status === 410,
      });
    }
  }

  async function start(duration = state.durationSeconds) {
    if (disposed || state.status !== "idle") {
      return;
    }
    const durationSeconds = Number(duration);
    dispatch({ type: "START_REQUESTED", durationSeconds });
    if (state.status !== "starting") {
      return;
    }
    const operationId = state.operationId;
    requestController = new AbortController();

    try {
      const race = await api.createRace(durationSeconds, {
        signal: requestController.signal,
      });
      if (!operationIsCurrent(operationId) || state.status !== "starting") {
        return;
      }
      dispatch({ type: "START_SUCCEEDED", operationId, race });
      const nextCountdown = timer({
        expiresAt: race.expiresAt,
        serverNow: race.serverNow,
        onTick(remainingMs) {
          if (operationIsCurrent(operationId)) {
            dispatch({ type: "TIMER_TICK", operationId, remainingMs });
            if (state.status === "active" && remainingMs === 0) {
              void finish();
            }
          }
        },
        onExpire() {
          void finish();
        },
      });
      if (operationIsCurrent(operationId) && state.status === "active") {
        countdown = nextCountdown;
      } else {
        nextCountdown.dispose();
      }
    } catch (error) {
      if (!operationIsCurrent(operationId) || state.status !== "starting") {
        return;
      }
      dispatch({
        type: "OPERATION_FAILED",
        operationId,
        message: errorMessage(error, START_FAILURE),
        expired: false,
      });
    }
  }

  function setTypedText(typedText) {
    if (!disposed) {
      dispatch({ type: "TEXT_CHANGED", typedText });
    }
  }

  function restart() {
    if (disposed) {
      return;
    }
    stopCountdown();
    cancelRequest();
    dispatch({ type: "RESTART" });
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    stopCountdown();
    cancelRequest();
  }

  emit();
  return { start, setTypedText, finish, restart, dispose };
}
