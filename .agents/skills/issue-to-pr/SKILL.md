---
name: issue-to-pr
description: Run the deterministic GitHub issue-to-pull-request loop. Use only when a person invokes /issue-to-pr or /skill:issue-to-pr with one issue number.
---

Run exactly this command from the repository root, passing the invocation arguments unchanged:

```bash
node .kimi-code/workflows/run-issue-to-pr.mjs $ARGUMENTS
```

Do not implement, review, verify, push, or open a pull request yourself. The runner owns those stages. Return its JSON result unchanged. If the command cannot start, report the actual error; do not simulate a run.
