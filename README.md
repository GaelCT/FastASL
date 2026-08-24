# FastASL — Phase 1: AI-Side Checkpoint (Node Foundation Scaffold)

This branch (`reboot/p1-node-baseline`) is the **AI-side Phase 1 checkpoint**
of the FastASL reboot. The legacy PHP/JWT/Apache implementation has been
removed and the Node.js/Express tooling scaffold is in place — but the core
application logic is deliberately **not implemented yet**. It is reserved for
the human-owned cards (HUMAN-1/2/3) per `docs/CODE_OWNERSHIP.json`.

## What exists right now

- Node.js 24 / Express 5 project setup (plain JavaScript, ES modules).
- Dependency lockfile (`npm ci` reproducible) with runtime deps:
  `express`, `helmet`, `pino`, `pino-http`, `zod`; dev deps:
  `@eslint/js`, `eslint`, `globals`, `supertest`.
- ESLint (flat config), Node-only CI workflow.
- Pino logger with credential/header redaction, plus tests proving redaction
  against serialized output.
- Safe 404 middleware and final error middleware (implemented, AI-owned).
- Ownership guard: `docs/CODE_OWNERSHIP.json` +
  `scripts/check-human-ownership.mjs`, with automated tests for the guard
  itself.
- Three preserved page shells rendered as honest placeholders
  (`/login.html`, `/dashboard.html`, `/race.html`) and the original stylesheet.

## What is still a TODO (human-owned; intentionally non-functional)

The following files contain scaffolding/JSDoc/TODO markers only and throw
until the human implements them:

- **App composition** — `src/app.js` (`createApp()`): Express app, Helmet,
  request logging, body limits, static `public/` boundary, `/api` mounting.
- **Environment validation** — `src/config/env.js` (`loadEnv()`): Zod schema
  for `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, `REQUEST_BODY_LIMIT`.
- **Health routing** — `src/routes/health.js`: the `/api/health` contract.
- **Server startup** — `src/server.js` (`main()`): listener lifecycle,
  SIGINT/SIGTERM shutdown.
- **Integration assertions** — `tests/integration/health.test.js`: all twelve
  acceptance/exposure assertion groups are `test.todo` placeholders.

Because of this:

- `npm run dev` / `npm start` do **not** work yet (the server entry point
  throws a TODO error by design).
- `GET /api/health` does **not** exist yet.
- The integration suite currently reports its assertions as pending TODOs;
  only the AI-owned unit tests pass today.

## Requirements

- [Node.js 24 LTS](https://nodejs.org/download/release/latest-v24.x/)

## Setup

```bash
npm ci                 # install exact dependency versions
cp .env.example .env   # optional locally; validation arrives with HUMAN-3
```

Environment variables will be loaded by Node itself via
`--env-file-if-exists=.env`; there is no dotenv package.

## Verification (current state)

```bash
npm run lint               # passes
npm test                   # AI-owned unit tests pass; HUMAN-3 todos listed
npm run test:integration   # lists the pending human-owned assertion groups
npm run check              # lint + tests

npm run check:ownership -- <checkpoint-commit>   # ownership guard
```

## Documentation

- `docs/CODE_OWNERSHIP.json` — which paths are human-owned vs AI-owned.
- `docs/REBOOT_DECISIONS.md` — locked architecture decisions.
- `docs/LEGACY_SNAPSHOT.md` — what was deleted and where it lives in history.
- `docs/HUMAN_AI_WORKLOG.md` — human/AI card tracking with commit IDs.
