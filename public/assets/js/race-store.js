import { isCreationRaceDto } from "./api.js";

export const RACE_STORAGE_KEY = "fastasl.practice.v1";

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

function validSnapshot(value) {
  return hasExactKeys(value, ["version", "race", "typedText", "clockOffsetMs"]) &&
    value.version === 1 &&
    isCreationRaceDto(value.race) &&
    typeof value.typedText === "string" &&
    value.typedText.length <= 1000 &&
    typeof value.clockOffsetMs === "number" &&
    Number.isFinite(value.clockOffsetMs);
}

/**
 * Persist only an active practice snapshot. Every browser-storage operation is
 * optional and contained: undefined means access failed, null means no valid
 * snapshot, and save/clear return whether the operation succeeded.
 */
export function createRaceStore({ storage } = {}) {
  function getStorage() {
    return storage === undefined ? window.sessionStorage : storage;
  }

  function clear() {
    try {
      getStorage().removeItem(RACE_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function load() {
    let stored;
    try {
      stored = getStorage().getItem(RACE_STORAGE_KEY);
    } catch {
      return undefined;
    }
    if (stored === null) {
      return null;
    }

    try {
      const value = JSON.parse(stored);
      if (validSnapshot(value)) {
        return value;
      }
    } catch {
      // Invalid storage is cleared below without surfacing parser details.
    }
    return clear() ? null : undefined;
  }

  function save(snapshot) {
    if (!validSnapshot(snapshot)) {
      return false;
    }
    try {
      getStorage().setItem(RACE_STORAGE_KEY, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  }

  return { load, save, clear };
}
