# Handoff Contract

Returned at Phase 4, and pasted into the PR's "Agent handoff" section.

```text
handoff:
  issue: <#NNN>
  changed_paths:
    - <path>: <behavior change>
  assumptions_made:
    - <reversible assumptions, and where they are recorded>
  deferred_work:
    - <or none>
  tests:
    - <test path>: <added|updated>, <command>: <result>
  full_check: pass | fail (never "skipped")
  security_data_impact: <review of secrets, personal data and generated files>
  migration_cost_rollback: <or none>
  evidence:
    - <command output, sanitized screenshot or log path>
  verifier: <who independently reran the commands, never the author>
  status_file: <path, or none. Every Q/I/E row is resolved or listed here as a blocker>
  next_step: merge_review | ask_user | blocked
  escape_hatch: <required block when next_step=ask_user>
```
