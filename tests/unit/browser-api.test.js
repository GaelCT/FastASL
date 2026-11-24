import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, createApi } from "../../public/assets/js/api.js";

const RACE_ID = "123e4567-e89b-42d3-a456-426614174000";
const STARTED_AT = "2026-11-22T12:00:00.000Z";
const IMPOSSIBLE_TIMESTAMPS = [
  "2026-02-29T12:00:00Z",
  "2026-02-30T12:00:00Z",
  "2026-02-31T12:00:00Z",
];

function race(durationSeconds = 30) {
  return {
    id: RACE_ID,
    prompt: "practice <img src=x> 😀",
    durationSeconds,
    startedAt: STARTED_AT,
    expiresAt: new Date(Date.parse(STARTED_AT) + durationSeconds * 1000).toISOString(),
    serverNow: STARTED_AT,
    inputMethod: "keyboard",
    ranked: false,
  };
}

function result() {
  return {
    raceId: RACE_ID,
    durationSeconds: 30,
    startedAt: STARTED_AT,
    finishedAt: "2026-11-22T12:00:04.250Z",
    expiresAt: "2026-11-22T12:00:30.000Z",
    elapsedMs: 4250,
    correctCharacters: 0,
    typedCharacters: 0,
    wpm: 0,
    accuracy: 0,
    inputMethod: "keyboard",
    ranked: false,
  };
}

function response(status, body) {
  return { status, async json() { return body; } };
}

function stubWorker(onPost) {
  const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  const workers = [];
  class WorkerStub {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.listeners = new Map();
      this.terminated = false;
      workers.push(this);
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    postMessage(message) {
      this.message = message;
      queueMicrotask(() => onPost(this));
    }
    emit(type, data) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ data, preventDefault() {} });
      }
    }
    terminate() {
      this.terminated = true;
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: WorkerStub,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    writable: true,
    value: new URL("https://fastasl.test/race.html"),
  });
  return {
    workers,
    restore() {
      if (workerDescriptor) {
        Object.defineProperty(globalThis, "Worker", workerDescriptor);
      } else {
        delete globalThis.Worker;
      }
      if (locationDescriptor) {
        Object.defineProperty(globalThis, "location", locationDescriptor);
      } else {
        delete globalThis.location;
      }
    },
  };
}

for (const durationSeconds of [30, 60]) {
  test(`createRace sends only the ${durationSeconds}-second request and strictly returns its DTO`, async () => {
    const calls = [];
    const signal = new AbortController().signal;
    const api = createApi({
      fetchImpl: async (...args) => {
        calls.push(args);
        return response(201, { race: race(durationSeconds) });
      },
    });

    const created = await api.createRace(durationSeconds, { signal });
    assert.deepEqual(created, race(durationSeconds));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "/api/races");
    assert.deepEqual(calls[0][1], {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationSeconds }),
      signal,
    });
  });
}

test("completeRace sends only typed text and returns exact authoritative Unicode/empty scores", async () => {
  const calls = [];
  const api = createApi({
    fetchImpl: async (...args) => {
      calls.push(args);
      return response(200, { result: result() });
    },
  });
  const completed = await api.completeRace(RACE_ID, "");
  assert.deepEqual(completed, result());
  assert.equal(calls[0][0], `/api/races/${RACE_ID}/complete`);
  assert.deepEqual(JSON.parse(calls[0][1].body), { typedText: "" });
  assert.equal(calls[0][1].credentials, "same-origin");
});

test("default browser transport uses a same-origin module worker and returns exact DTOs", async () => {
  const stub = stubWorker((worker) => {
    worker.emit("message", {
      status: 201,
      text: JSON.stringify({ race: race(30) }),
    });
  });
  try {
    const api = createApi();
    const created = await api.createRace(30);
    assert.deepEqual(created, race(30));
    assert.equal(stub.workers.length, 1);
    const [worker] = stub.workers;
    assert.ok(worker.url.pathname.endsWith("/public/assets/js/api.js"));
    assert.deepEqual(worker.options, { type: "module" });
    assert.equal(worker.message.url, "https://fastasl.test/api/races");
    assert.deepEqual(worker.message.options, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationSeconds: 30 }),
    });
    assert.equal(worker.terminated, true);
  } finally {
    stub.restore();
  }
});

test("worker HTTP and network failures remain safe ApiErrors", async () => {
  const outcomes = [
    { status: 410, text: JSON.stringify({ error: "SENSITIVE SERVER DETAIL" }) },
    { failed: true },
  ];
  const stub = stubWorker((worker) => {
    worker.emit("message", outcomes.shift());
  });
  try {
    const api = createApi();
    await assert.rejects(api.createRace(30), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 410);
      assert.equal(error.message, "Request failed");
      return true;
    });
    await assert.rejects(api.createRace(30), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      assert.equal(error.message, "Network request failed");
      return true;
    });
    assert.equal(stub.workers.length, 2);
    assert.ok(stub.workers.every((worker) => worker.terminated));
  } finally {
    stub.restore();
  }
});

test("aborting a worker request terminates it without sending the signal", async () => {
  const stub = stubWorker(() => {});
  try {
    const api = createApi();
    const abortController = new AbortController();
    const pending = api.createRace(30, { signal: abortController.signal });
    await Promise.resolve();
    const [worker] = stub.workers;
    assert.equal("signal" in worker.message.options, false);
    abortController.abort();
    await assert.rejects(pending, (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, "Network request failed");
      return true;
    });
    assert.equal(worker.terminated, true);
  } finally {
    stub.restore();
  }
});

test("creation rejects malformed success DTOs, unknown fields, and client/server duration mismatch", async () => {
  const invalidRaces = [
    null,
    [],
    { ...race(), extra: true },
    { ...race(), id: "not-a-uuid" },
    { ...race(), prompt: "" },
    { ...race(), durationSeconds: 60 },
    { ...race(), startedAt: "not-a-date" },
    { ...race(), serverNow: "2026-11-22T12:00:00.001Z" },
    { ...race(), expiresAt: "2026-11-22T12:00:29.999Z" },
    { ...race(), inputMethod: "camera" },
    { ...race(), ranked: true },
  ];
  for (const invalid of invalidRaces) {
    const api = createApi({ fetchImpl: async () => response(201, { race: invalid }) });
    await assert.rejects(api.createRace(30), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, "Invalid server response");
      assert.equal(error.message.includes("not-a-uuid"), false);
      return true;
    });
  }
  const extraTopLevel = createApi({
    fetchImpl: async () => response(201, { race: race(), result: result() }),
  });
  await assert.rejects(extraTopLevel.createRace(30), /Invalid server response/);
});

test("creation rejects impossible calendar timestamps with safe ApiErrors", async () => {
  for (const field of ["startedAt", "expiresAt", "serverNow"]) {
    for (const timestamp of IMPOSSIBLE_TIMESTAMPS) {
      const api = createApi({
        fetchImpl: async () => response(201, {
          race: { ...race(), [field]: timestamp },
        }),
      });
      await assert.rejects(api.createRace(30), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.message, "Invalid server response");
        assert.equal(error.status, 0);
        assert.equal(error.message.includes(timestamp), false);
        return true;
      });
    }
  }
});

test("completion rejects impossible calendar timestamps with safe ApiErrors", async () => {
  for (const field of ["startedAt", "finishedAt", "expiresAt"]) {
    for (const timestamp of IMPOSSIBLE_TIMESTAMPS) {
      const api = createApi({
        fetchImpl: async () => response(200, {
          result: { ...result(), [field]: timestamp },
        }),
      });
      await assert.rejects(api.completeRace(RACE_ID, "abc"), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.message, "Invalid server response");
        assert.equal(error.status, 0);
        assert.equal(error.message.includes(timestamp), false);
        return true;
      });
    }
  }
});

test("completion rejects nonfinite, out-of-range, mismatched, and malformed result DTOs", async () => {
  const invalidResults = [
    null,
    { ...result(), extra: "forged" },
    { ...result(), raceId: "123e4567-e89b-42d3-a456-426614174099" },
    { ...result(), durationSeconds: 45 },
    { ...result(), wpm: Number.POSITIVE_INFINITY },
    { ...result(), elapsedMs: -1 },
    { ...result(), accuracy: 100.01 },
    { ...result(), inputMethod: "camera" },
    { ...result(), ranked: true },
  ];
  for (const invalid of invalidResults) {
    const api = createApi({ fetchImpl: async () => response(200, { result: invalid }) });
    await assert.rejects(api.completeRace(RACE_ID, "abc"), /Invalid server response/);
  }
});

test("HTTP errors preserve only safe statuses and never expose response bodies", async () => {
  for (const status of [400, 404, 409, 410, 500, 503]) {
    const api = createApi({
      fetchImpl: async () => response(status, { error: "SENSITIVE SERVER DETAIL" }),
    });
    await assert.rejects(api.createRace(30), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.message, "Request failed");
      assert.equal(error.message.includes("SENSITIVE"), false);
      return true;
    });
  }
});

test("network and malformed JSON failures become safe ApiErrors", async () => {
  const network = createApi({
    fetchImpl: async () => { throw new TypeError("private socket detail"); },
  });
  await assert.rejects(network.createRace(30), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.message, "Network request failed");
    return true;
  });

  const malformed = createApi({
    fetchImpl: async () => ({
      status: 201,
      async json() { throw new SyntaxError("private JSON detail"); },
    }),
  });
  await assert.rejects(malformed.createRace(30), /Invalid server response/);
});

test("invalid client arguments do not call fetch", async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async () => { calls += 1; } });
  for (const duration of [0, 15, "30", null]) {
    await assert.rejects(api.createRace(duration), /Invalid race duration/);
  }
  await assert.rejects(api.completeRace("bad", "abc"), /Invalid completion request/);
  await assert.rejects(api.completeRace(RACE_ID, "x".repeat(1001)), /Invalid completion request/);
  assert.equal(calls, 0);
});
