import { initialRaceState, reduceRaceState } from "./race-state.js";
import { createCountdown } from "./timer-display.js";
import { ApiError } from "./api.js";

const START_FAILURE =
  "Could not start the race. Check your connection, then restart or return to the main menu.";
const FINISH_FAILURE =
  "Could not finish the race. Check your connection, then retry the same text or restart. No result is shown.";
const UNAVAILABLE =
  "This practice race is unavailable. Start a new race or return to the main menu.";
const ALREADY_COMPLETED =
  "This practice race was already completed. Start a new race; no new result is shown.";
const EXPIRED = "Race expired. Restart to try again or return to the main menu.";

export function createRaceController({
  api,
  store,
  timer = createCountdown,
  onChange = () => {},
  durationSeconds = 60,
  now = Date.now,
}) {
  let state = initialRaceState(durationSeconds);
  let countdown;
  let countdownGeneration = 0;
  let requestController;
  let expiryRequestOperationId;
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
    countdownGeneration += 1;
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

  function hasRunningClock() {
    return state.status === "active" || state.status === "completing" ||
      (state.status === "error" && state.error?.retryable === true);
  }

  function storageUnavailable() {
    dispatch({ type: "STORAGE_UNAVAILABLE" });
  }

  function clearSnapshot() {
    if (!store) {
      return;
    }
    try {
      if (!store.clear()) {
        storageUnavailable();
      }
    } catch {
      storageUnavailable();
    }
  }

  function saveSnapshot() {
    if (!store || state.status !== "active") {
      return;
    }
    const snapshot = {
      version: 1,
      race: state.race,
      typedText: state.typedText,
      clockOffsetMs: state.clockOffsetMs,
    };
    try {
      if (!store.save(snapshot)) {
        storageUnavailable();
      }
    } catch {
      storageUnavailable();
    }
  }

  function completionFailure(error, expirySubmission = false) {
    if (error instanceof ApiError && error.status === 404) {
      return { message: UNAVAILABLE, kind: "unavailable", retryable: false, expired: false };
    }
    if (error instanceof ApiError && error.status === 409) {
      return { message: ALREADY_COMPLETED, kind: "already-completed", retryable: false, expired: false };
    }
    if (error instanceof ApiError && error.status === 410) {
      return { message: EXPIRED, kind: "expired", retryable: false, expired: true };
    }
    if (expirySubmission) {
      return { message: EXPIRED, kind: "expired", retryable: false, expired: true };
    }
    return { message: FINISH_FAILURE, kind: "completion", retryable: true, expired: false };
  }

  function expireRace(operationId) {
    if (!operationIsCurrent(operationId) || !hasRunningClock()) {
      return;
    }
    dispatch({ type: "RACE_EXPIRED", operationId, message: EXPIRED });
    stopCountdown();
    cancelRequest();
    clearSnapshot();
  }

  function startCountdown() {
    const generation = ++countdownGeneration;
    const raceId = state.race.id;
    function clockIsCurrent() {
      return !disposed && countdownGeneration === generation &&
        state.race?.id === raceId && hasRunningClock();
    }

    const nextCountdown = timer({
      expiresAt: state.race.expiresAt,
      serverNow: state.race.serverNow,
      clockOffsetMs: state.clockOffsetMs,
      now,
      onTick(remainingMs) {
        if (!clockIsCurrent()) {
          return;
        }
        dispatch({ type: "TIMER_TICK", operationId: state.operationId, remainingMs });
        if (clockIsCurrent() && state.status === "active" && remainingMs === 0) {
          void finish();
        }
      },
      onExpire() {
        if (!clockIsCurrent()) {
          return;
        }
        if (state.status === "active") {
          void finish();
        }
        if (state.status === "completing" && expiryRequestOperationId === state.operationId) {
          return;
        }
        expireRace(state.operationId);
      },
    });
    if (clockIsCurrent()) {
      countdown = nextCountdown;
    } else {
      nextCountdown.dispose();
    }
  }

  async function finish() {
    const retryable = state.status === "error" && state.error?.retryable === true;
    if (disposed || !(state.status === "active" || retryable)) {
      return;
    }

    const expirySubmission = state.status === "active" && state.remainingMs === 0;
    dispatch({ type: "COMPLETION_REQUESTED", operationId: state.operationId });
    if (state.status !== "completing") {
      return;
    }
    const operationId = state.operationId;
    if (expirySubmission) {
      expiryRequestOperationId = operationId;
    }
    const raceId = state.race.id;
    const typedText = state.typedText;
    const abortController = new AbortController();
    requestController = abortController;

    try {
      const result = await api.completeRace(raceId, typedText, {
        signal: abortController.signal,
      });
      if (!operationIsCurrent(operationId) || state.status !== "completing") {
        return;
      }
      stopCountdown();
      dispatch({ type: "COMPLETION_SUCCEEDED", operationId, result });
      clearSnapshot();
    } catch (error) {
      if (!operationIsCurrent(operationId) || state.status !== "completing") {
        return;
      }
      const failure = completionFailure(error, expirySubmission);
      dispatch({ type: "OPERATION_FAILED", operationId, ...failure });
      if (!failure.retryable) {
        stopCountdown();
        clearSnapshot();
      }
    }
  }

  async function start(duration = state.durationSeconds) {
    if (disposed || state.status !== "idle") {
      return;
    }
    const requestedDuration = Number(duration);
    dispatch({ type: "START_REQUESTED", durationSeconds: requestedDuration });
    if (state.status !== "starting") {
      return;
    }
    const operationId = state.operationId;
    const abortController = new AbortController();
    requestController = abortController;

    try {
      const race = await api.createRace(requestedDuration, {
        signal: abortController.signal,
      });
      if (!operationIsCurrent(operationId) || state.status !== "starting") {
        return;
      }
      const clockOffsetMs = Date.parse(race.serverNow) - now();
      if (!Number.isFinite(clockOffsetMs)) {
        throw new ApiError("Invalid server response", { status: 201 });
      }
      dispatch({ type: "START_SUCCEEDED", operationId, race, clockOffsetMs });
      saveSnapshot();
      startCountdown();
    } catch {
      if (!operationIsCurrent(operationId) || state.status !== "starting") {
        return;
      }
      dispatch({
        type: "OPERATION_FAILED",
        operationId,
        message: START_FAILURE,
        kind: "start",
        retryable: false,
        expired: false,
      });
    }
  }

  function resume() {
    if (disposed || state.status !== "idle" || !store) {
      return;
    }
    let snapshot;
    try {
      snapshot = store.load();
    } catch {
      snapshot = undefined;
    }
    if (snapshot === undefined) {
      storageUnavailable();
      return;
    }
    if (snapshot === null) {
      return;
    }

    const remainingMs = Date.parse(snapshot.race.expiresAt) -
      (now() + snapshot.clockOffsetMs);
    if (remainingMs <= 0) {
      clearSnapshot();
      return;
    }
    dispatch({
      type: "RESUME_SUCCEEDED",
      race: snapshot.race,
      typedText: snapshot.typedText,
      clockOffsetMs: snapshot.clockOffsetMs,
      remainingMs,
    });
    startCountdown();
  }

  function setTypedText(typedText) {
    if (disposed) {
      return;
    }
    dispatch({ type: "TEXT_CHANGED", typedText });
    saveSnapshot();
  }

  function restart() {
    if (disposed) {
      return;
    }
    stopCountdown();
    cancelRequest();
    dispatch({ type: "RESTART" });
    clearSnapshot();
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
  return { start, resume, setTypedText, finish, restart, dispose };
}
