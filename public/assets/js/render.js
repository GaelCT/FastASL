import { formatRemaining } from "./timer-display.js";

function setText(element, value) {
  element.textContent = String(value);
}

export function renderPrompt(element, prompt) {
  // textContent is intentional: prompts and test doubles may contain HTML-like text.
  setText(element, prompt);
}

export function renderStatus(element, state) {
  let message = "Choose a duration, then start when you are ready.";
  if (state.status === "starting") {
    message = "Starting your practice race…";
  } else if (state.status === "active") {
    message = "Race active. Type the prompt, then finish or wait for the timer.";
  } else if (state.status === "completing") {
    message = "Submitting your practice text…";
  } else if (state.status === "results") {
    message = "Practice complete. These results are unranked.";
  } else if (state.status === "error" && state.error) {
    message = state.error.message;
  }
  setText(element, message);
  element.dataset.state = state.status;
}

export function renderResults(elements, result) {
  if (!result) {
    setText(elements.resultWpm, "—");
    setText(elements.resultAccuracy, "—");
    setText(elements.resultCorrect, "—");
    setText(elements.resultTyped, "—");
    setText(elements.resultElapsed, "—");
    return;
  }
  setText(elements.resultWpm, result.wpm);
  setText(elements.resultAccuracy, `${result.accuracy}%`);
  setText(elements.resultCorrect, result.correctCharacters);
  setText(elements.resultTyped, result.typedCharacters);
  setText(elements.resultElapsed, `${(result.elapsedMs / 1000).toFixed(2)} seconds`);
}

/** Render the complete state without injecting HTML or trapping keyboard focus. */
export function createRaceRenderer(elements) {
  let previousStatus;

  function render(state) {
    const active = state.status === "active";
    const completing = state.status === "completing";
    const results = state.status === "results";
    const error = state.status === "error";

    renderStatus(elements.status, state);
    renderPrompt(
      elements.prompt,
      state.race?.prompt ?? "Your server-selected prompt will appear here.",
    );
    setText(elements.timer, formatRemaining(state.remainingMs));
    elements.timer.setAttribute(
      "aria-label",
      `${Math.ceil(state.remainingMs / 1000)} seconds remaining`,
    );

    if (elements.input.value !== state.typedText) {
      elements.input.value = state.typedText;
    }
    elements.input.disabled = !active;
    elements.practicePanel.hidden = !(active || completing);
    elements.results.hidden = !results;
    renderResults(elements, state.result);

    elements.startButton.disabled = state.status === "starting";
    elements.startButton.hidden = !(state.status === "idle" || state.status === "starting");
    elements.finishButton.hidden = !(active || completing);
    elements.finishButton.disabled = !active;
    elements.restartButton.hidden = !(active || completing || results || error);
    elements.restartButton.disabled = completing;
    elements.duration.disabled = state.status !== "idle";

    if (previousStatus !== state.status) {
      if (active) {
        elements.input.focus();
      } else if (results) {
        elements.results.focus();
      } else if (error) {
        elements.restartButton.focus();
      } else if (state.status === "idle" && previousStatus !== undefined) {
        elements.startButton.focus();
      }
      previousStatus = state.status;
    }
  }

  return { render };
}
