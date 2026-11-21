---
name: verify
description: Prove a user-facing change works in the running app. Start it locally, navigate with FEATURE_MAP.md, check the changed surface, and capture sanitized evidence for the handoff.
---

# Verify

## Invocation
Use after tests pass, for any change a user can see. It does not replace tests
or the repository's full check. It is not for infrastructure-only or docs-only
changes.

## Goal
Evidence that the changed surface behaves as the acceptance criteria say in the
running app, captured with test data only.

## Required input
- The task's acceptance criteria (`../agent-task/contracts/task_context.md`).
- The features touched, located in [`FEATURE_MAP.md`](FEATURE_MAP.md).

## Hard rules
- Use test data only. Follow "Data safety" in `FEATURE_MAP.md` before any
  screenshot.
- Never paste tokens, passwords or real contact details into evidence.
- A surface you could not reach or render is **not verified**. Say so in the
  handoff, and never describe expected behavior as observed behavior.
- If the change moves or renames a route, navigation item or label listed in
  `FEATURE_MAP.md`, update the map in the same PR.

## Phases

### Phase 1: Start the app
Run the commands in `FEATURE_MAP.md` under "How to start the app", then run its
health check before going further.

### Phase 2: Navigate
Reach each changed feature by the route and path in `FEATURE_MAP.md`. Locate
elements by ARIA role and accessible name where you can.

### Phase 3: Check the changed surface
- Exercise each acceptance criterion, and note observed against expected.
- Reach and operate new controls with Tab, Enter and Space, and confirm their
  labels are announced.
- Check light and dark themes if styling changed.

### Phase 4: Capture evidence
- Screenshot each changed surface with test data through the Playwright CLI.
  Open every saved image with `ReadMediaFile` before describing it. If the CLI
  is unavailable, report the surface as not verified; do not install anything.
- Record the start commands, URLs visited and observations in the handoff's
  `evidence` field, and in `STATUS.md` if one exists.
- Stop every server you started.

## Escape hatches
Use `../agent-task/contracts/escape_hatch.md` for needing production access,
needing real customer data to reproduce, or a change that requires a new
browser-automation dependency. A server that fails to start or a page that
errors is a recoverable failure, so diagnose it instead of asking.

## Verification
Done when every acceptance criterion touching the UI has an observed result
with sanitized evidence, unreached surfaces are listed as not verified, and
`FEATURE_MAP.md` matches the code.
