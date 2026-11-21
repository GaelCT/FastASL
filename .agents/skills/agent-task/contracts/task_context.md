# Task Context Contract

The packet an agent receives before Phase 0. The source of truth is the GitHub
`Agent task` issue, and this schema mirrors it.

```text
task_context:
  issue: <#NNN or planned>
  objective: <one observable user outcome>
  requirement_links:
    - <requirement or design document, or none>
  in_scope_paths:
    - <paths this task may edit>
  out_of_scope_paths:
    - <paths this task must not touch>
  prohibited_actions:
    - <for example external writes or dependency changes>
  contracts_and_invariants:
    - <schemas and trust boundaries that must hold>
  data_classification: <sensitive | test-data | none>
  acceptance_criteria:
    - <behavior-level, independently verifiable>
  verification_commands:
    - <exact commands>
  known_assumptions_open_questions:
    - <or none>
  prior_failed_approaches:
    - <or none>
  handoff_owner: <the person responsible for merging>
  status_file: <path to STATUS.md from templates/STATUS.md, or none>
```

If a field is unknown, write `unknown` plus what was already checked. A task
missing its objective, boundaries, acceptance criteria or verification commands
stays in planning.
