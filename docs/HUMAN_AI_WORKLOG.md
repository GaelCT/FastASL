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

### HUMAN-1 — Express application composition (`src/app.js`)

Checklist for the human (one small behavior at a time):

- [ ] Create the Express application without calling `listen()`.
- [ ] Disable `x-powered-by`.
- [ ] Add bounded JSON body parsing.
- [ ] Mount Helmet (security middleware placement).
- [ ] Mount request logging (pino-http via the shared logger config).
- [ ] Serve static files from exactly `public/` (never the repo root).
- [ ] Mount `/api` routes.
- [ ] Mount 404 middleware, then error middleware last.
- [ ] Run lint + narrow tests; explain middleware order in your own words.

| Owner | Card | Task | Started | Finished | Actual time | Commit | Notes |
|-------|------|------|---------|----------|-------------|--------|-------|
| HUMAN | HUMAN-1 | Implement `src/app.js` | | | | | |

### HUMAN-2 — Server lifecycle and health route (`src/server.js`, `src/routes/health.js`)

Checklist for the human:

- [ ] Health route first: create router, add `GET /health` (mounted under `/api`), return minimal reviewed JSON.
- [ ] Mount the health router through the human app composition.
- [ ] Import validated env configuration in `src/server.js`.
- [ ] Start listener on configured host/port; handle startup failure.
- [ ] Implement graceful shutdown helper; connect `SIGINT` and `SIGTERM`; prevent duplicate shutdown handling.
- [ ] Test manual startup/shutdown.

| Owner | Card | Task | Started | Finished | Actual time | Commit | Notes |
|-------|------|------|---------|----------|-------------|--------|-------|
| HUMAN | HUMAN-2 | Implement health route | | | | | |
| HUMAN | HUMAN-2 | Implement server lifecycle | | | | | |

### HUMAN-3 — Environment contract and acceptance cases (`src/config/env.js`, `tests/integration/health.test.js`)

Checklist for the human:

- [ ] Define Zod schema for `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, `REQUEST_BODY_LIMIT` (this is the only module allowed to read `process.env`).
- [ ] Test valid values; then malformed values (`PORT=abc`, `PORT=-1`, `PORT=70000`, `NODE_ENV=banana`, `LOG_LEVEL=madeup`, invalid body limit).
- [ ] Export normalized validated configuration; decide failure behavior for invalid values.
- [ ] Write exact `/api/health` status/body/content-type assertions.
- [ ] Assert `/login.html`, `/dashboard.html`, `/race.html` load.
- [ ] Assert `/.env`, `/composer.json`, `/package.json`, `/backend/…`, `/index.php`, `/router.php`, SQL paths, and internal docs are NOT served (404).
- [ ] Build the symlink-escape canary fixture (link inside `public/` → secret outside) and assert it is not served; report platform constraints explicitly if symlink creation is impossible.
- [ ] Assert representative Helmet headers on HTML and API responses; assert `x-powered-by` absent.
- [ ] Run the integration suite.

| Owner | Card | Task | Started | Finished | Actual time | Commit | Notes |
|-------|------|------|---------|----------|-------------|--------|-------|
| HUMAN | HUMAN-3 | Environment contract (`src/config/env.js`) | | | | | |
| HUMAN | HUMAN-3 | Acceptance/exposure assertions (`tests/integration/health.test.js`) | | | | | |

---

## Time-rebalancing rule

If any human card takes substantially longer than its planned checklist
estimate, stop before starting the next phase and record the overage here so
the next phase's cards can be rebalanced while preserving the 50/50 ownership
split.
