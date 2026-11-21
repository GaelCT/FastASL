# Automatic loop: `/issue-to-pr`

`/issue-to-pr <issue>` takes one `Agent task` issue through build, review, testing and a pull request, then stops for a person. A Node.js script sets the order, not a model. It runs through Kimi Code, and nothing changes for anyone who does not run it.

| Step | Who | What happens |
|---|---|---|
| Spec | Person | Writes the `Agent task` issue. Starting the run approves the ordinary task, not sensitive areas. |
| Guard | One small agent of each type | Proves each agent type is guarded before work starts. |
| Intake | `loop-reviewer` | Checks the worktree and issue. A missing field stops the run. |
| Plan review | Person | Required only for sensitive tasks. |
| Build | `loop-builder` | Follows the agent-task skill on `agent/issue-<N>` and keeps `artifacts/issue-to-pr/issue-<N>/STATUS.md`. |
| Review | Four `loop-reviewer` agents | Check acceptance criteria, architecture, security and data, and trust boundaries. Findings return to the builder. |
| Verify | `loop-verifier` | Reruns the full check and the issue's exact commands, then tries the app when a change affects users. |
| Handoff | `loop-builder` | Pushes only the agent branch and opens or updates the pull request. |
| Approve and merge | Person | The loop never approves, merges or deploys. |

A run gets at most 3 rounds. A clean run uses 11 agents, and the worst case uses 23. Each stage is a separate non-interactive Kimi Code session.

## Before the first run

- Use a current Kimi Code CLI with `--agent-file` and `stream-json`, with `kimi` and `gh` signed in. Install `node` and `python3`.
- Make sure the loop's files are on the base branch. A run builds from there and needs its agents and guard.
- Run `install.sh` once per machine to register the user-level hook, restart Kimi Code, then check `/hooks` and run `kimi doctor`.
- Make sure the full check leaves no untracked files, because a run needs a clean tree before and after verification.
- Create the approval labels once. If the sensitive areas changed, use those names:

  ```bash
  for area in authorization infrastructure user-data external-writes shared-contracts agent-gates; do gh label create "plan-approved:$area"; done
  ```

- For user-facing changes, install the Playwright CLI and Chromium on each machine:

  ```bash
  npm install -g @playwright/cli@0.1.23
  playwright-cli install-browser chromium --only-shell
  ```

  On Linux, add `--with-deps` to the second command. Fill in `.agents/skills/verify/FEATURE_MAP.md` and list app addresses in `.playwright/cli.config.json`.

## Write the issue

Use the `Agent task` issue form. The issue body is the only spec; edit the body if the spec changes and do not rely on comments. It needs an objective, at least one in-scope repository path, acceptance criteria and verification commands. A sensitive path, objective or criterion stops the run for plan review before anything is built.

## Run it

Create a separate worktree from the current base branch. For issue 42 and the default `main` branch:

```bash
git fetch origin main
git worktree add ../repo-issue-42 -b issue-42-work origin/main
cd ../repo-issue-42
kimi
```

Then run:

```text
/issue-to-pr 42
```

`/skill:issue-to-pr 42` is equivalent. The launcher starts `.kimi-code/workflows/run-issue-to-pr.mjs`, which prints the final JSON result. Agents work in that worktree, so a run refuses the main checkout.

For a rerun after a blocked result, return to the same worktree and run the same command. The branch and status file let the builder resume, while reviews and the full check run again.

| Result | What it means | What to do |
|---|---|---|
| `ready_for_human_review` | The pull request is open and everything the loop could check passed. | Review it, then merge it if it is right. |
| `needs_plan_review` | The task touches a sensitive area. Nothing was built unless a build reached that area unexpectedly. | Read the reasons or plan. Edit the issue if needed. To proceed, add the listed labels yourself and rerun. Each label approves one area only. |
| `blocked` | The run stopped with a reason and next step. After 3 rounds it lists every round's findings. | Fix the cause and rerun in the same worktree. |
| `run_already_active` | The active-run file already exists. | If no runner is alive, remove `artifacts/issue-to-pr/active.json`; otherwise wait. |

## Browser verification

User-facing verification requires the Playwright CLI. If it or Chromium is unavailable, the run ends as `blocked` with an environment problem; the verifier installs nothing and does not substitute the desktop browser.

The CLI runs from the repository root and reads `.playwright/cli.config.json`. The latest check for each issue keeps screenshots in `artifacts/issue-to-pr/issue-<N>/screenshots/`. The verifier must open each screenshot with `ReadMediaFile` before describing it, and the pull request lists the paths. Screenshots are gitignored and stay on that machine. Only one run should do browser testing at a time.

## What the guard does and doesn't do

The installer registers `.kimi-code/hooks/loop_guard.py` as a user-level Kimi `PreToolUse` hook for Bash. It is inert unless the current worktree contains `artifacts/issue-to-pr/active.json`. The runner creates that file before guard probes and removes it in normal cleanup. While active, the guard blocks merging, reviewing and deploying, and blocks every push except the exact `git push -u origin agent/issue-<N>` command. It enables that push only during Handoff. Every run proves the guard fires for all three agent types before work starts.

During an active run, the hook also guards unrelated Kimi sessions in the same worktree. Keep the worktree dedicated to the run. If the runner is interrupted, it tries to remove the active file; after an ungraceful kill, check that no runner is alive before removing stale state.

The guard is not a security boundary. It reads command text, so another spelling can get past it, and it knows only the deploy commands listed at the top of the file. Kimi hooks fail open on hook errors. Branch protection on GitHub is the real control.

## Settings

Settings are at the top of `.kimi-code/workflows/issue-to-pr.mjs` and `.kimi-code/hooks/loop_guard.py`; browser limits are in `.playwright/cli.config.json`. Treat changes to them like changes to any other gate. If a new sensitive area is added, create its `plan-approved:<area>` label too.
