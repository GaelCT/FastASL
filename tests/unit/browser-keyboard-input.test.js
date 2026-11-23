import { test } from "node:test";
import assert from "node:assert/strict";
import { attachKeyboardInput } from "../../public/assets/js/keyboard-input.js";

function fakeInput() {
  const listeners = new Map();
  return {
    value: "",
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, properties = {}) {
      const event = {
        key: undefined,
        isComposing: false,
        keyCode: 0,
        prevented: false,
        preventDefault() { this.prevented = true; },
        ...properties,
      };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
    listenerCount() {
      return [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
    },
  };
}

test("input and explicit Enter submit the current editable text", () => {
  const input = fakeInput();
  const inputs = [];
  const submits = [];
  const cleanup = attachKeyboardInput(input, {
    onInput: (value) => inputs.push(value),
    onSubmit: (value) => submits.push(value),
  });
  input.value = "a😀";
  input.dispatch("input");
  input.value = "edited";
  input.dispatch("input");
  const enter = input.dispatch("keydown", { key: "Enter" });
  assert.deepEqual(inputs, ["a😀", "edited"]);
  assert.deepEqual(submits, ["edited"]);
  assert.equal(enter.prevented, true);
  cleanup();
});

test("IME composition Enter and other keys never submit", () => {
  const input = fakeInput();
  let submits = 0;
  const cleanup = attachKeyboardInput(input, {
    onInput() {},
    onSubmit: () => { submits += 1; },
  });
  input.dispatch("compositionstart");
  input.dispatch("keydown", { key: "Enter" });
  input.dispatch("compositionend");
  input.dispatch("keydown", { key: "Enter", isComposing: true });
  input.dispatch("keydown", { key: "Enter", keyCode: 229 });
  input.dispatch("keydown", { key: "a" });
  assert.equal(submits, 0);
  input.dispatch("keydown", { key: "Enter" });
  assert.equal(submits, 1);
  cleanup();
});

test("cleanup removes every control-local listener", () => {
  const input = fakeInput();
  let calls = 0;
  const cleanup = attachKeyboardInput(input, {
    onInput: () => { calls += 1; },
    onSubmit: () => { calls += 1; },
  });
  assert.equal(input.listenerCount(), 4);
  cleanup();
  assert.equal(input.listenerCount(), 0);
  input.dispatch("input");
  input.dispatch("keydown", { key: "Enter" });
  assert.equal(calls, 0);
});
