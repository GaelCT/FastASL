import { test } from "node:test";
import assert from "node:assert/strict";
import { createRaceRenderer, renderPrompt, renderStatus } from "../../public/assets/js/render.js";
import { initialRaceState } from "../../public/assets/js/race-state.js";

function element(value = "") {
  return {
    textContent: "",
    value,
    dataset: {},
    hidden: false,
    disabled: false,
    focusCount: 0,
    attributes: {},
    setAttribute(name, attributeValue) { this.attributes[name] = attributeValue; },
    focus() { this.focusCount += 1; },
  };
}

function elements() {
  return {
    prompt: element(),
    input: element(),
    timer: element(),
    status: element(),
    practicePanel: element(),
    results: element(),
    resultWpm: element(),
    resultAccuracy: element(),
    resultCorrect: element(),
    resultTyped: element(),
    resultElapsed: element(),
    startButton: element(),
    finishButton: element(),
    restartButton: element(),
    duration: element(),
  };
}

const race = {
  prompt: "<img src=x onerror=alert(1)> a😀",
  durationSeconds: 30,
};
const result = {
  wpm: 12.34,
  accuracy: 56.78,
  correctCharacters: 4,
  typedCharacters: 7,
  elapsedMs: 4250,
};

test("HTML-like and Unicode prompts are literal text, never elements or markup", () => {
  const prompt = element();
  renderPrompt(prompt, race.prompt);
  assert.equal(prompt.textContent, race.prompt);
  assert.equal(prompt.children, undefined);
  assert.equal(prompt.innerHTML, undefined);
});

test("active rendering shows exact prompt, enables labeled input, and moves focus once", () => {
  const ui = elements();
  const renderer = createRaceRenderer(ui);
  const state = {
    ...initialRaceState(30),
    status: "active",
    operationId: 1,
    race,
    remainingMs: 29_750,
    typedText: "<b>typed 😀</b>",
  };
  renderer.render(state);
  renderer.render(state);
  assert.equal(ui.prompt.textContent, race.prompt);
  assert.equal(ui.input.value, "<b>typed 😀</b>");
  assert.equal(ui.input.disabled, false);
  assert.equal(ui.input.focusCount, 1);
  assert.equal(ui.practicePanel.hidden, false);
  assert.equal(ui.finishButton.disabled, false);
  assert.equal(ui.timer.textContent, "0:30");
  assert.equal(ui.timer.attributes["aria-label"], "30 seconds remaining");
  assert.equal(ui.results.hidden, true);
});

test("results use exact server WPM/accuracy and move focus to the polite result region", () => {
  const ui = elements();
  const renderer = createRaceRenderer(ui);
  const state = {
    ...initialRaceState(30),
    status: "results",
    race,
    result,
  };
  renderer.render(state);
  assert.equal(ui.resultWpm.textContent, "12.34");
  assert.equal(ui.resultAccuracy.textContent, "56.78%");
  assert.equal(ui.resultCorrect.textContent, "4");
  assert.equal(ui.resultTyped.textContent, "7");
  assert.equal(ui.resultElapsed.textContent, "4.25 seconds");
  assert.equal(ui.results.hidden, false);
  assert.equal(ui.results.focusCount, 1);
  assert.equal(ui.startButton.hidden, true);
  assert.equal(ui.restartButton.hidden, false);
  assert.match(ui.status.textContent, /unranked/i);
});

test("starting/completing disable conflicting controls and errors offer deliberate recovery", () => {
  const ui = elements();
  const status = element();
  renderStatus(status, { status: "idle" });
  assert.match(status.textContent, /start/i);

  const renderer = createRaceRenderer(ui);
  renderer.render({ ...initialRaceState(30), status: "starting", durationSeconds: 30 });
  assert.equal(ui.startButton.disabled, true);
  assert.equal(ui.input.disabled, true);
  assert.equal(ui.duration.disabled, true);

  renderer.render({
    ...initialRaceState(30),
    status: "error",
    race,
    error: { message: "Race expired", expired: true },
  });
  assert.equal(ui.status.textContent, "Race expired");
  assert.equal(ui.status.dataset.state, "error");
  assert.equal(ui.restartButton.focusCount, 1);
  assert.equal(ui.restartButton.hidden, false);
  assert.equal(ui.startButton.hidden, true);
  assert.equal(ui.finishButton.hidden, true);
});
