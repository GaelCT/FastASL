export function formatRemaining(ms) {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function timestampMs(value, name) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${name} must be a valid timestamp`);
  }
  return parsed;
}

/**
 * Display server time by applying the creation-time offset to the local clock.
 * The injected scheduler makes wall-clock jumps and disposal deterministic in tests.
 */
export function createCountdown({
  expiresAt,
  serverNow,
  now = Date.now,
  setInterval: schedule = globalThis.setInterval,
  clearInterval: cancel = globalThis.clearInterval,
  onTick = () => {},
  onExpire = () => {},
  intervalMs = 250,
}) {
  const expiresAtMs = timestampMs(expiresAt, "expiresAt");
  const serverOffsetMs = timestampMs(serverNow, "serverNow") - now();
  let disposed = false;
  let expired = false;
  let intervalId;

  function clear() {
    if (intervalId !== undefined) {
      cancel(intervalId);
      intervalId = undefined;
    }
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    clear();
  }

  function tick() {
    if (disposed || expired) {
      return;
    }
    const serverNowMs = now() + serverOffsetMs;
    const remainingMs = Math.max(0, expiresAtMs - serverNowMs);
    onTick(remainingMs);
    if (remainingMs === 0) {
      expired = true;
      clear();
      onExpire();
    }
  }

  tick();
  if (!disposed && !expired) {
    intervalId = schedule(tick, intervalMs);
  }

  return { dispose, tick };
}
