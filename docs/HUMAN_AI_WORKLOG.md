# Human/AI Worklog — FastASL Reboot

Ownership is measured by **meaningful implementation ownership**, never by line
count. Each card below is broken into checklist steps of roughly 20–60 minutes.
Record actual time so an unexpectedly large card can be rebalanced before the
next phase.

Fields per item:

```text
Owner | Card | Task | Started | Finished | Actual time | Commit | Notes
```

---

## Phase 1 — Clean Reboot and Node Foundation

Branch: `reboot/p1-node-baseline`

### AI-1 — Git hygiene and deletion-only cleanup

- [x] Verify repository state and expected legacy commit `a69bdf6`.
- [x] Tag legacy commit as `legacy-php-v3.1-a69bdf6`.
- [x] Create `reboot/p1-node-baseline`.
- [x] Add `.gitattributes` with deliberate LF policy; confirm no CRLF-only churn.
- [x] Record pre-cleanup tree in `docs/LEGACY_SNAPSHOT.md`.
- [x] Delete the approved legacy paths (PHP backend, Apache routing, Composer/PHPUnit, legacy SQL, permission scripts, fake-auth browser scripts, superseded audit docs).
- [x] Preserve `public/login.html`, `public/dashboard.html`, `public/race.html`, `public/assets/css/main.css`.

| Owner | Card | Task | Started | Finished | Actual time | Commit | Notes |
|-------|------|------|---------|----------|-------------|--------|-------|
| AI | AI-1 | Deletion-only cleanup + snapshot + line-ending policy | 2026-08-23 | 2026-08-23 | n/a (AI) | 1c022c3 | Legacy recoverable at tag `legacy-php-v3.1-a69bdf6`; no history rewrite |

### AI-2 — Node/tooling boilerplate

- [x] Create `package.json` (`"type": "module"`, Node 24 engine constraint, required scripts).
- [x] Generate `package-lock.json` via `npm install` (never hand-written).
- [x] Install runtime deps: `express`, `helmet`, `pino`, `pino-http`, `zod`.
- [x] Install dev deps: `@eslint/js`, `eslint`, `globals`, `supertest`.
- [x] Rewrite `eslint.config.js` for ES modules + Node/browser globals.
- [x] Create `.env.example` documenting Phase 1 variable names only (contract belongs to HUMAN-3).
- [x] Update `.gitignore` (env files except example, node_modules, coverage, logs, OS/editor junk).
- [x] Implement `src/lib/logger.js` (Pino with header + sensitive-field redaction).
- [x] Add `tests/unit/logger-redaction.test.js` proving sentinels are absent from serialized output.
- [x] Implement `src/middleware/not-found.js`.
- [x] Implement `src/middleware/error-handler.js`.
- [x] Create `docs/CODE_OWNERSHIP.json`.
- [x] Create `scripts/check-human-ownership.mjs` (checkpoint argument required; fails on human-owned changes after checkpoint).
- [x] Create TODO-only scaffolds for the five human-owned files.

| Owner | Card | Task | Started | Finished | Actual time | Commit | Notes |
|-------|------|------|---------|----------|-------------|--------|-------|
| AI | AI-2 | Node/tooling scaffold + AI-owned infra | 2026-08-23 | 2026-08-23 | n/a (AI) | 26866502a2de67ea17a0d713337751befaffabf9 | Five human-owned files contain TODO scaffolds only |

### AI-3 — Documentation, CI, and temporary page truthfulness

- [x] Rewrite `README.md` describing only existing Phase 1 behavior.
- [x] Create `docs/REBOOT_DECISIONS.md` with locked decisions.
- [x] Replace legacy PHP CI with Node-only `.github/workflows/ci.yml` (Node 24: npm ci, lint, test, check).
- [x] Remove broken script imports from the three preserved HTML pages.
- [x] Make login page truthful (no fake authentication).
- [x] Make dashboard page truthful (no fake leaderboard data, no regional tab simulation).
- [x] Make race page truthful (no ASL recognition claims, no score submission).

| Owner | Card | Task | Started | Finished | Actual time | Commit | Notes |
|-------|------|------|---------|----------|-------------|--------|-------|
| AI | AI-3 | Docs, CI, truthful temporary UI | 2026-08-23 | 2026-08-23 | n/a (AI) | d0ab7c92c22c4f0593f9baae7a040f783cd72fd2 | No fake users/sessions/tokens/leaderboard created |

### Owner-approved reassignment — 2026-11-21

The project owner explicitly requested AI continuation of the five former
HUMAN-1/2/3 Phase 1 TODO scaffolds in issue #11. AI-4/5/6 below supersede the
old human implementation assignments. Human ownership is retained for
`docs/REBOOT_DECISIONS.md`, architecture-decision review, PR review, and the
phase gate. This reassignment does not authorize Phase 2–4 behavior.

### AI-4 — Express application composition (`src/app.js`; formerly HUMAN-1)

- [x] Create the Express application without calling `listen()`.
- [x] Disable `x-powered-by`.
- [x] Add bounded JSON body parsing.
- [x] Mount Helmet and redacting pino-http request logging.
- [x] Serve static regular files from exactly `public/`, with lexical, resolved-path, and pre/post-open identity checks; stream from the validated file handle to prevent symlink-swap escapes.
- [x] Mount `/api` routes, then 404 and final error middleware in order.
- [x] Add health, page, header, exposure, traversal, and request-error integration tests.

| Owner | Card | Task | Started | Finished | Actual time | Commit | Notes |
|-------|------|------|---------|----------|-------------|--------|-------|
| AI | AI-4 | Secure app/static composition and integration cases | 2026-11-21 | 2026-11-21 | n/a (AI) | agent/issue-11 change | Focused integration tests pass; the outside-secret canary uses a Windows directory junction or POSIX file symlink with no conditional skip |

### AI-5 — Server lifecycle and health route (`src/server.js`, `src/routes/health.js`; formerly HUMAN-2)

- [x] Add `GET /health` under `/api`, returning exactly `{ "status": "ok" }`.
- [x] Validate configuration and compose the app before listening.
- [x] Propagate listener startup errors and make direct-entry startup failures nonzero.
- [x] Implement idempotent graceful `SIGINT`/`SIGTERM` shutdown, close-idle support, and listener cleanup.
- [x] Prove imports open no listener and test startup/shutdown with injected real/fake servers.

| Owner | Card | Task | Started | Finished | Actual time | Commit | Notes |
|-------|------|------|---------|----------|-------------|--------|-------|
| AI | AI-5 | Health route and server lifecycle | 2026-11-21 | 2026-11-21 | n/a (AI) | agent/issue-11 change | Lifecycle unit tests pass; independent real-server/browser signal smoke test remains a verification-gate activity |

### AI-6 — Environment contract and acceptance cases (`src/config/env.js`, integration tests; formerly HUMAN-3)

- [x] Define Zod validation and defaults for all five Phase 1 variables in the only module that reads `process.env`.
- [x] Test every valid class and malformed/empty/boundary values; assert safe field-naming errors and no source mutation.
- [x] Write exact health, page, 404, Helmet, parser-error, and repository-exposure assertions.
- [x] Add outside-secret link and deterministic after-open swap canaries; use a Windows directory junction or POSIX file symlink so no canary is conditionally skipped.
- [x] Document setup, environment, commands, response contracts, static boundary, and later-phase limitations in README.

| Owner | Card | Task | Started | Finished | Actual time | Commit | Notes |
|-------|------|------|---------|----------|-------------|--------|-------|
| AI | AI-6 | Environment validation, acceptance coverage, and documentation | 2026-11-21 | 2026-11-21 | n/a (AI) | agent/issue-11 change | Focused unit/integration tests pass; final npm run check and git diff --check evidence recorded at handoff |

---

## Time-rebalancing rule

If any human card takes substantially longer than its planned checklist
estimate, stop before starting the next phase and record the overage here so
the next phase's cards can be rebalanced while preserving the 50/50 ownership
split.
