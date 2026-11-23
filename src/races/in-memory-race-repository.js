function snapshot(value) {
  return structuredClone(value);
}

export function createRaceRepository({
  maxRaces = 100,
  retentionMs = 300_000,
} = {}) {
  const races = new Map();

  function cleanup(nowMs) {
    let numberRemoved = 0;

    for (const [id, race] of races) {
      if (race.status === "active" && nowMs >= race.expiresAtMs) {
        race.status = "expired";
        race.terminalAtMs = race.expiresAtMs;
      }

      if (
        race.status !== "active" &&
        nowMs >= race.terminalAtMs + retentionMs
      ) {
        races.delete(id);
        numberRemoved += 1;
      }
    }

    return numberRemoved;
  }

  function insert(race, nowMs) {
    cleanup(nowMs);

    if (races.has(race.id)) {
      return "duplicate";
    }
    if (races.size >= maxRaces) {
      return "full";
    }

    races.set(race.id, {
      ...snapshot(race),
      status: "active",
    });
    return "inserted";
  }

  function get(id) {
    const race = races.get(id);
    return race === undefined ? undefined : snapshot(race);
  }

  function completeIfActive(id, nowMs, completion) {
    cleanup(nowMs);
    const race = races.get(id);

    if (race === undefined) {
      return { status: "not_found" };
    }
    if (race.status === "completed") {
      return { status: "already_completed" };
    }
    if (race.status === "expired") {
      return { status: "expired" };
    }
    if (nowMs >= race.expiresAtMs) {
      race.status = "expired";
      race.terminalAtMs = race.expiresAtMs;
      return { status: "expired" };
    }

    race.status = "completed";
    race.terminalAtMs = nowMs;
    race.result = snapshot(completion);
    return { status: "ok", race: snapshot(race) };
  }

  function size() {
    return races.size;
  }

  return {
    insert,
    get,
    completeIfActive,
    cleanup,
    size,
  };
}
