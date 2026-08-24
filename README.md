# FastASL — Phase 1 (Clean Reboot and Node Foundation)

FastASL is being rebuilt as one understandable Node.js application. This
repository is currently at the **Phase 1** milestone: the legacy PHP/JWT/Apache
implementation has been removed and replaced with a small Node.js/Express
foundation.

## What exists right now

- A Node.js 24 / Express 5 server (plain JavaScript, ES modules).
- Three static page shells preserved from the original design:
  `/login.html`, `/dashboard.html`, `/race.html`.
- `GET /api/health` for process liveness.
- Static files served from exactly `public/` — nothing else in the repository
  is web-accessible.
- Zod-based environment validation (`src/config/env.js`).
- Structured logging via Pino/Pino HTTP with credential redaction.
- Helmet security headers.
- Node-only lint and tests (`node --test` + supertest).

## What does NOT exist yet (by design)

These arrive in later phases; nothing here pretends otherwise:

- Real login, registration, bcrypt, or server-side sessions
- MySQL persistence
- Any leaderboard (the pages show honest "not available yet" states)
- The real race engine (practice mode is being rebuilt in Phase 2)
- ASL classification of any kind

The login, dashboard, and race pages are intentionally truthful placeholders.

## Requirements

- [Node.js 24 LTS](https://nodejs.org/download/release/latest-v24.x/)

## Setup

```bash
npm ci                 # install exact dependency versions
cp .env.example .env   # optional locally; fill in values you understand
```

Environment variables are loaded by Node itself via
`--env-file-if-exists=.env`; there is no dotenv package. Validation rules live
in `src/config/env.js`.

## Running

```bash
npm run dev    # watch mode
npm start      # normal start
```

## Verification

```bash
npm run lint               # ESLint
npm test                   # unit + integration tests (Node test runner)
npm run test:integration   # integration tests only
npm run check              # lint + tests
```

Ownership protection (see `docs/CODE_OWNERSHIP.json`):

```bash
npm run check:ownership -- <human-checkpoint-commit>
```

## Documentation

- `docs/REBOOT_DECISIONS.md` — locked architecture decisions.
- `docs/LEGACY_SNAPSHOT.md` — what was deleted and where it lives in history.
- `docs/HUMAN_AI_WORKLOG.md` — human/AI card tracking.
