import { test } from "node:test";
import assert from "node:assert/strict";
import { createRaceRepository } from "../../src/races/in-memory-race-repository.js";

function makeRace(id, { startedAtMs = 0, expiresAtMs = 1_000 } = {}) {
  return {
    id,
    prompt: "practice makes progress",
    durationSeconds: 30,
    startedAtMs,
    expiresAtMs,
  };
}

function makeResult(raceId, finishedAtMs = 500) {
  return {
    raceId,
    durationSeconds: 30,
    startedAtMs: 0,
    finishedAtMs,
    expiresAtMs: 1_000,
    elapsedMs: finishedAtMs,
    correctCharacters: 3,
    typedCharacters: 3,
    wpm: 1.2,
    accuracy: 100,
    inputMethod: "keyboard",
    ranked: false,
  };
}

test("insert and get retain detached race snapshots", () => {
  const repository = createRaceRepository();
  const race = makeRace("race-1");

  assert.equal(repository.insert(race, 0), "inserted");
  race.prompt = "client mutation";
  race.expiresAtMs = 1;

  const firstSnapshot = repository.get("race-1");
  assert.deepEqual(firstSnapshot, {
    ...makeRace("race-1"),
    status: "active",
  });

  firstSnapshot.prompt = "snapshot mutation";
  firstSnapshot.expiresAtMs = 2;
  assert.deepEqual(repository.get("race-1"), {
    ...makeRace("race-1"),
    status: "active",
  });
  assert.equal(repository.get("missing"), undefined);
  assert.equal(repository.size(), 1);
});

test("duplicate IDs never overwrite the original, including at capacity", () => {
  const repository = createRaceRepository({ maxRaces: 2 });
  const original = makeRace("same-id");
  assert.equal(repository.insert(original, 0), "inserted");
  assert.equal(repository.insert(makeRace("other"), 0), "inserted");

  const duplicate = {
    ...makeRace("same-id"),
    prompt: "replacement",
    startedAtMs: 999,
  };
  assert.equal(repository.insert(duplicate, 1), "duplicate");
  assert.equal(repository.get("same-id").prompt, original.prompt);
  assert.equal(repository.get("same-id").startedAtMs, 0);
  assert.equal(repository.insert(makeRace("third"), 1), "full");
  assert.equal(repository.size(), 2);
});

test("the default capacity is 100 total records, including terminal records", () => {
  const repository = createRaceRepository();
  for (let index = 0; index < 100; index += 1) {
    assert.equal(repository.insert(makeRace(`race-${index}`), 0), "inserted");
  }
  assert.equal(
    repository.completeIfActive("race-0", 10, makeResult("race-0", 10)).status,
    "ok",
  );

  assert.equal(repository.insert(makeRace("overflow"), 10), "full");
  assert.equal(repository.size(), 100);
  assert.equal(repository.get("overflow"), undefined);
  assert.equal(repository.get("race-0").status, "completed");
});

test("completion writes a detached derived result exactly once", () => {
  const repository = createRaceRepository();
  const race = makeRace("race-1");
  const completion = makeResult("race-1");
  repository.insert(race, 0);

  const transition = repository.completeIfActive("race-1", 500, completion);
  assert.equal(transition.status, "ok");
  assert.equal(transition.race.status, "completed");
  assert.equal(transition.race.terminalAtMs, 500);
  assert.deepEqual(transition.race.result, completion);

  completion.wpm = 999;
  transition.race.prompt = "returned snapshot mutation";
  transition.race.result.accuracy = 0;

  const stored = repository.get("race-1");
  assert.equal(stored.prompt, race.prompt);
  assert.equal(stored.result.wpm, 1.2);
  assert.equal(stored.result.accuracy, 100);
  assert.deepEqual(repository.completeIfActive("race-1", 501, makeResult("race-1", 501)), {
    status: "already_completed",
  });
  assert.equal(repository.get("race-1").result.finishedAtMs, 500);
});

test("completion reports missing races without creating a record", () => {
  const repository = createRaceRepository();
  assert.deepEqual(repository.completeIfActive("missing", 0, {}), {
    status: "not_found",
  });
  assert.equal(repository.size(), 0);
});

test("completion at or after the deadline expires without storing a result", () => {
  for (const finishedAtMs of [1_000, 1_001]) {
    const repository = createRaceRepository();
    repository.insert(makeRace("race-1"), 0);

    assert.deepEqual(
      repository.completeIfActive("race-1", finishedAtMs, makeResult("race-1", finishedAtMs)),
      { status: "expired" },
    );
    const expired = repository.get("race-1");
    assert.equal(expired.status, "expired");
    assert.equal(expired.terminalAtMs, 1_000);
    assert.equal("result" in expired, false);
    assert.deepEqual(repository.completeIfActive("race-1", finishedAtMs + 1, {}), {
      status: "expired",
    });
  }
});

test("cleanup expires due active races and removes them only at the retention boundary", () => {
  const repository = createRaceRepository({ retentionMs: 100 });
  repository.insert(makeRace("race-1", { expiresAtMs: 100 }), 0);

  assert.equal(repository.cleanup(99), 0);
  assert.equal(repository.get("race-1").status, "active");
  assert.equal(repository.cleanup(100), 0);
  assert.equal(repository.get("race-1").status, "expired");
  assert.equal(repository.cleanup(199), 0);
  assert.equal(repository.size(), 1);
  assert.equal(repository.cleanup(200), 1);
  assert.equal(repository.get("race-1"), undefined);
  assert.equal(repository.size(), 0);
});

test("completed retention starts at finishedAtMs rather than expiresAtMs", () => {
  const repository = createRaceRepository({ retentionMs: 200 });
  repository.insert(makeRace("race-1"), 0);
  repository.completeIfActive("race-1", 500, makeResult("race-1"));

  assert.equal(repository.cleanup(699), 0);
  assert.equal(repository.get("race-1").status, "completed");
  assert.equal(repository.cleanup(700), 1);
  assert.equal(repository.get("race-1"), undefined);
});

test("one cleanup can expire and remove a sufficiently old active race", () => {
  const repository = createRaceRepository({ retentionMs: 300 });
  repository.insert(makeRace("race-1", { expiresAtMs: 100 }), 0);

  assert.equal(repository.cleanup(400), 1);
  assert.equal(repository.size(), 0);
});

test("terminal records still count against capacity until cleanup can remove them", () => {
  const repository = createRaceRepository({ maxRaces: 1, retentionMs: 300 });
  repository.insert(makeRace("first"), 0);
  repository.completeIfActive("first", 500, makeResult("first"));

  assert.equal(repository.insert(makeRace("second"), 500), "full");
  assert.equal(repository.size(), 1);
  assert.equal(repository.insert(makeRace("second"), 799), "full");
  assert.equal(repository.insert(makeRace("second"), 800), "inserted");
  assert.equal(repository.get("first"), undefined);
  assert.equal(repository.get("second").status, "active");
});

test("insert cleanup expires and removes an old active record before reusing capacity", () => {
  const repository = createRaceRepository({ maxRaces: 1, retentionMs: 100 });
  repository.insert(makeRace("first", { expiresAtMs: 10 }), 0);

  assert.equal(repository.insert(makeRace("second", { startedAtMs: 110 }), 110), "inserted");
  assert.equal(repository.get("first"), undefined);
  assert.equal(repository.get("second").startedAtMs, 110);
  assert.equal(repository.size(), 1);
});
