/** Attach practice-input events only to the supplied control, never globally. */
export function attachKeyboardInput(input, { onInput, onSubmit }) {
  let composing = false;

  function handleInput() {
    onInput(input.value);
  }

  function handleCompositionStart() {
    composing = true;
  }

  function handleCompositionEnd() {
    composing = false;
  }

  function handleKeydown(event) {
    if (event.key !== "Enter" || event.isComposing || composing ||
        event.keyCode === 229) {
      return;
    }
    event.preventDefault();
    onSubmit(input.value);
  }

  input.addEventListener("input", handleInput);
  input.addEventListener("keydown", handleKeydown);
  input.addEventListener("compositionstart", handleCompositionStart);
  input.addEventListener("compositionend", handleCompositionEnd);

  return function cleanup() {
    input.removeEventListener("input", handleInput);
    input.removeEventListener("keydown", handleKeydown);
    input.removeEventListener("compositionstart", handleCompositionStart);
    input.removeEventListener("compositionend", handleCompositionEnd);
  };
}
