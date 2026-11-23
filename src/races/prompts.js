import { randomInt } from "node:crypto";

export const PRACTICE_PROMPTS = Object.freeze([
  "practice makes progress",
  "steady hands build skill",
  "focus on each letter",
  "keep a calm rhythm",
]);

export function choosePrompt(prompts = PRACTICE_PROMPTS, selectIndex = randomInt) {
  return prompts[selectIndex(prompts.length)];
}
