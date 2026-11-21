# Escape Hatch Contract

Pause-and-ask schema. Use it when the next action needs a human decision the
workflow cannot safely choose, and never for recoverable failures.

```text
escape_hatch:
  decision_type: scope | shared-contract | dependency | auth | cost | destructive | ambiguity | blocker
  question: <one precise question>
  recommended_option: <safe recommended choice>
  options:
    - <option + consequence>   # at most 3 alternatives
  safe_default: <what happens after approval, or none>
  state_snapshot:
    phase: <phase>
    files_changed: [<paths>]
    last_command: <command or not_run>
    evidence: <short error text, log path, or blocker id>
```

When a `STATUS.md` exists for the task, record the escape hatch as an `E###`
row there, with status `waiting`, and fill in its resolution when answered.

Ask only for product or PR scope changes, shared-contract edits, dependency or
pin changes, auth or sandbox setup (variable names only, never token values),
paid cloud resources, destructive file, git or infrastructure operations,
contradictory sources, or accepting a blocker or loosening a gate.

Do not ask for failing tests, lint errors, missing local paths, mock setup, or
bugs the workflow covers. After two identical failures in a row, stop retrying,
preserve the output, and change strategy.
