import { createApi } from "./api.js";
import { attachKeyboardInput } from "./keyboard-input.js";
import { createRaceController } from "./race-controller.js";
import { createRaceStore } from "./race-store.js";
import { createRaceRenderer } from "./render.js";

function element(id) {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Required race element is missing: ${id}`);
  }
  return found;
}

const requestedDuration = new URLSearchParams(window.location.search).get("duration");
const durationSeconds = requestedDuration === "30" ? 30 : 60;
const duration = element("duration");
duration.value = String(durationSeconds);

const elements = {
  duration,
  prompt: element("prompt"),
  input: element("typed-text"),
  timer: element("timer"),
  status: element("race-status"),
  practicePanel: element("practice-panel"),
  results: element("results"),
  resultWpm: element("result-wpm"),
  resultAccuracy: element("result-accuracy"),
  resultCorrect: element("result-correct"),
  resultTyped: element("result-typed"),
  resultElapsed: element("result-elapsed"),
  startButton: element("start-race"),
  finishButton: element("finish-race"),
  restartButton: element("restart-race"),
  storageNotice: element("storage-notice"),
};
const renderer = createRaceRenderer(elements);
const controller = createRaceController({
  api: createApi(),
  store: createRaceStore(),
  durationSeconds,
  onChange: renderer.render,
});
const cleanupKeyboard = attachKeyboardInput(elements.input, {
  onInput: controller.setTypedText,
  onSubmit: () => void controller.finish(),
});

function start() {
  void controller.start(Number(duration.value));
}
function finish() {
  void controller.finish();
}
function restart() {
  controller.restart();
}
function dispose() {
  cleanupKeyboard();
  controller.dispose();
  elements.startButton.removeEventListener("click", start);
  elements.finishButton.removeEventListener("click", finish);
  elements.restartButton.removeEventListener("click", restart);
  window.removeEventListener("pagehide", dispose);
}

elements.startButton.addEventListener("click", start);
elements.finishButton.addEventListener("click", finish);
elements.restartButton.addEventListener("click", restart);
window.addEventListener("pagehide", dispose);
controller.resume();
