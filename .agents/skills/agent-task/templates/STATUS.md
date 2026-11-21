# Status: <task name> (<issue #>)

Durable state for an `Agent task` that spans sessions or subagents. The
transcript is not the record; this file is. Keep resolved rows with their
resolution — never delete a row. IDs are stable: number each type from 001
and never reuse an ID.

## Current phase

<Phase 0–4> — <one line on where things stand and what happens next>

## Log

| ID | Type | Summary | Status | Resolution / evidence |
|---|---|---|---|---|
| Q001 | question | <open question> | open | |
| I001 | issue | <problem found> | resolved | <commit, command output, or log path> |
| E001 | escape hatch | <decision asked of a human; see contracts/escape_hatch.md> | waiting | |
| D001 | decision | <reversible assumption or choice made, and why> | done | <where recorded> |

Types: `Q###` question · `I###` issue · `E###` escape hatch · `D###` decision.
Statuses: `open` · `waiting` · `resolved` · `done` · `blocked`.

## Commands run

| Command | Result | When |
|---|---|---|
| <exact command> | <pass / fail + short excerpt or log path> | <ISO date/time> |
