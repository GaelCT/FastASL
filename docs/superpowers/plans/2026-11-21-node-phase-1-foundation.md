# Node Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the minimal Node/Express Phase 1 server and install the issue-to-PR workflow so subsequent Node phase cards can be implemented and reviewed independently.

**Architecture:** `src/config/env.js` is the only environment reader and returns a validated configuration object. `src/app.js` composes Express without listening; a focused static middleware prevents files and symlink targets outside `public/` from being served. `src/server.js` owns listener startup and graceful shutdown. The deterministic issue-to-PR runner owns subsequent build/review/verify/PR stages.

**Tech Stack:** Node.js 24, Express 5, Zod 4, Helmet 8, Pino/Pino HTTP, Node test runner, Supertest, ESLint, Kimi issue-to-PR kit 0.3.

**Spec:** `FASTASL_NODE_REBOOT_4_PHASE_PLAN.md` and `docs/REBOOT_DECISIONS.md`

## Global Constraints

- Plain JavaScript ES modules on Node.js 24; no TypeScript, PHP, JWT, database, authentication, classifier, scores, or leaderboard in Phase 1.
- `public/` is the only static document root; neither the repository root nor a parent directory may be passed to `express.static()`.
- Health returns exactly `{ "status": "ok" }` and reveals no version or environment details.
- Preserve the existing failure contracts: 404 `{ "error": "Not found" }`, parser/client 4xx `{ "error": "Request failed" }`, and 500 `{ "error": "Internal server error" }`; malformed JSON is 400, oversized bodies are 413, and unsupported health methods are 404.
- No fake application behavior, hard-coded secrets, new production dependencies, approval, merge, or deployment.
- Only `src/config/env.js` reads `process.env` in application code. Tests and process-launch tooling may set it.
- All ordinary checks run through `npm run check`; workflow artifacts remain untracked.

## Review Focus

- A symlink inside `public/` points to a real outside file: the response must be 404, tested in the static exposure integration group.
- A supplied environment value is malformed rather than absent: startup must throw with the field name instead of using a default, tested for every configuration field.
- Malformed JSON and a body over 100kb must produce safe 4xx JSON rather than an empty response, HTML stack, or 500, tested in request-error integration tests.
- A duplicate SIGINT/SIGTERM must close the listener once and must not leave a second shutdown sequence running, tested with a fake server and signal emitter.
- A URL containing traversal or encoded separators must not escape `public/`, tested alongside direct repository-file exposure cases.

---

### Task 1: Install and configure the issue-to-PR workflow

**Files:**
- Create: `.kimi-code/`, `.agents/skills/`, `.playwright/cli.config.json`, `.github/ISSUE_TEMPLATE/agent-task.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/issue-to-pr.md` from the supplied kit template
- Modify: `.kimi-code/workflows/issue-to-pr.mjs`
- Modify: `.kimi-code/hooks/loop_guard.py`
- Modify: `.playwright/cli.config.json`
- Modify: `.agents/skills/verify/FEATURE_MAP.md`
- Modify: `.gitignore`
- Modify: `.github/workflows/ci.yml`
- Test: supplied kit `tests/` (not copied into the product repository)

**Interfaces:**
- Produces: `/issue-to-pr <issue>` running `node .kimi-code/workflows/run-issue-to-pr.mjs <issue>` against base branch `node` with `npm run check` as its full gate.

- [ ] **Step 1: Run the kit's tests before installation**

Run from the supplied kit: `python -m unittest discover -s tests`.
Expected: all kit tests pass without live model or GitHub calls. On Windows, use the available `python` executable; do not silently skip failures caused by the kit's Unix assumptions.

- [ ] **Step 2: Copy the template without overwriting application files**

Run the supplied `install.sh` against the repository. Confirm it adds `artifacts/issue-to-pr/` to `.gitignore` and registers the documented inert PreToolUse guard. Do not overwrite any existing file.

- [ ] **Step 3: Pin repository settings**

Set `VERIFY_COMMAND` to `npm run check`, `BASE_BRANCH` to `node`, `USER_FACING` to `/^public\//`, `BACKEND` to `/^src\//`, and `APP_PORTS` to `[3000]`. Add project rules forbidding PHP/JWT restoration, repository-root static serving, fake auth/classifier/scores, and production `MemoryStore`. Add deployment command spellings used by this repository to the guard only if such commands exist; otherwise leave the deploy list empty.

- [ ] **Step 4: Configure browser verification**

Allow only `http://127.0.0.1:3000` in `.playwright/cli.config.json`. Map health, all three static pages, static exposure, and the future practice flow in `FEATURE_MAP.md`; mark features not yet implemented as unavailable rather than inventing flows.

- [ ] **Step 5: Make CI include the local `node` branch**

Add `node` to the push branch list while retaining `main` and `reboot/**`.

- [ ] **Step 6: Verify installation**

Run `npm run check`, `git status --short`, and the kit tests. Expected: existing AI-owned tests pass, Phase 1 TODO tests remain explicitly pending until Task 2 onward, and workflow run artifacts are ignored.

- [ ] **Step 7: Commit**

```bash
git add .agents .github .kimi-code .playwright .gitignore docs/issue-to-pr.md FASTASL_NODE_REBOOT_4_PHASE_PLAN.md docs/superpowers/plans/2026-11-21-node-phase-1-foundation.md
git commit -m "chore: install issue-to-pr workflow and Node phase plan"
```

### Task 2: Validate configuration and reassign the Phase 1 scaffolds

**Files:**
- Modify: `src/config/env.js`
- Modify: `docs/CODE_OWNERSHIP.json`
- Modify: `docs/HUMAN_AI_WORKLOG.md`
- Modify: `.env.example`
- Create: `tests/unit/env.test.js`

**Interfaces:**
- Produces: `loadEnv(source = process.env)` returning `{ NODE_ENV, HOST, PORT, LOG_LEVEL, REQUEST_BODY_LIMIT }` where `PORT` is a number and all other values are strings.
- Produces: defaults `development`, `127.0.0.1`, `3000`, `info`, and `100kb` only for absent values.

- [ ] **Step 1: Write failing configuration tests**

Use table-driven Node tests for absent-value defaults and valid explicit values. Assert rejection of `PORT` values `abc`, `-1`, `0`, `70000`, `080`, `1.5`, and empty string; invalid `NODE_ENV` and `LOG_LEVEL`; blank/whitespace or overlong `HOST`; and missing, malformed, zero, negative, fractional, or over-100kb `REQUEST_BODY_LIMIT`. Assert thrown messages contain `Invalid environment configuration` and the failing field path. Assert the source object is not mutated.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/unit/env.test.js`.
Expected: FAIL because `loadEnv` is still a TODO.

- [ ] **Step 3: Implement the schema**

Use Zod enums for `NODE_ENV=development|test|production` and `LOG_LEVEL=fatal|error|warn|info|debug|trace|silent`. Require `HOST` to be 1–255 non-whitespace characters. Require canonical base-10 `PORT` text (`[1-9][0-9]*`), transform to a number, and restrict to 1–65535. Require `REQUEST_BODY_LIMIT` to be an integer 1–100 followed by lowercase `kb`, preserving its string form. Catch Zod failures and throw one startup-safe error listing issue paths and messages without dumping all environment values.

- [ ] **Step 4: Record the owner-approved reassignment**

Move the five former HUMAN-OWNED Phase 1 scaffold paths to AI-OWNED and move `docs/REBOOT_DECISIONS.md` to HUMAN-OWNED, preserving exactly one entry per tracked path and a nonempty human-owned set for the existing ownership checker. Update notes and worklog to say the project owner requested AI continuation on 2026-11-21 and retains architecture decisions and phase-gate review. Replace the variable-names-only `.env.example` warning with the actual defaults and accepted ranges; leave real `.env` files ignored.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/unit/env.test.js tests/unit/check-human-ownership.test.js`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.js tests/unit/env.test.js docs/CODE_OWNERSHIP.json docs/HUMAN_AI_WORKLOG.md .env.example
git commit -m "feat: validate Phase 1 environment configuration"
```

### Task 3: Compose the app and enforce the static boundary

**Files:**
- Modify: `src/app.js`
- Create: `src/middleware/public-static.js`
- Create: `tests/integration/static-exposure.test.js`
- Modify: `tests/integration/health.test.js`
- Modify: `src/routes/health.js`
- Modify: `docs/CODE_OWNERSHIP.json`

**Interfaces:**
- Consumes: `loadEnv(source = process.env)` from Task 2.
- Produces: `createApp(config = loadEnv())` returning an Express application with no listener.
- Produces: `createHealthRouter()` returning a router with `GET /health`.
- Produces: `createPublicStaticMiddleware(publicRoot)` serving GET/HEAD files only when both lexical and real paths stay inside `publicRoot`.

- [ ] **Step 1: Write failing health and exposure tests**

Assert exact health status 200, JSON content type, and body; successful loading of the three HTML pages; JSON 404 for unknown routes; 404 for `/.env`, `/package.json`, `/composer.json`, `/backend/JWT.php`, `/index.php`, `/router.php`, representative SQL and docs paths, traversal, and encoded-separator attempts. Create an outside temporary secret and an inside `public/` symlink, request its URL, assert 404 and absence of the sentinel, and always clean up. If Windows denies symlink creation, mark only that canary explicitly skipped with the OS error diagnostic; do not call it verified.

- [ ] **Step 2: Write failing application security tests**

Assert representative Helmet headers on HTML and health, absent `x-powered-by`, no static directory index or redirect, and request logging/redaction remains configured through the shared logger.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/integration/health.test.js tests/integration/static-exposure.test.js`.
Expected: FAIL because app and health composition are TODOs.

- [ ] **Step 4: Implement safe static serving**

Resolve and realpath the public root once. For GET/HEAD, decode and resolve the request path beneath that root, then realpath an existing candidate. Serve only if both candidate checks remain inside the root; missing files and escapes fall through to 404, malformed paths remain safe, and unexpected filesystem errors reach the final error handler. Configure Express static with dotfiles denied, directory indexes disabled, and redirects disabled.

- [ ] **Step 5: Implement app and health composition**

Disable `x-powered-by`; mount Helmet, Pino HTTP with `createLogger({ level: config.LOG_LEVEL })`, `express.json({ limit: config.REQUEST_BODY_LIMIT })`, the public static middleware, `/api` health routes, the existing 404 middleware, and the existing final error handler in that order. `createHealthRouter()` responds only with `{ status: "ok" }`. Register every new tracked file in the ownership manifest.

- [ ] **Step 6: Run integration tests to verify they pass**

Run: `npm run test:integration`.
Expected: PASS, except an explicitly diagnosed platform-limited symlink canary if applicable.

- [ ] **Step 7: Commit**

```bash
git add src/app.js src/routes/health.js src/middleware/public-static.js tests/integration docs/CODE_OWNERSHIP.json
git commit -m "feat: compose secure Express foundation"
```

### Task 4: Bound request errors predictably

**Files:**
- Create: `tests/integration/request-errors.test.js`
- Modify: `src/middleware/error-handler.js` only if the tests reveal unsafe Express parser error mapping
- Modify: `docs/CODE_OWNERSHIP.json`

**Interfaces:**
- Consumes: `createApp(config = loadEnv())` from Task 3.

- [ ] **Step 1: Write failing request-error tests**

Post malformed JSON, a JSON body larger than 100kb, a non-JSON content type, arrays/null/scalars where later routes would expect objects, and unsupported methods to `/api/health`. Assert safe 4xx JSON with no stack, filesystem path, request body, or internal detail; unsupported health methods use the existing JSON 404 contract in Phase 1.

- [ ] **Step 2: Run tests and inspect failures**

Run: `node --test tests/integration/request-errors.test.js`.
Expected: malformed and oversized parser failures expose the current mapping gap; no production code is changed before this result is recorded.

- [ ] **Step 3: Make the smallest error-mapping change**

Preserve the existing generic response contract. Use parser-supplied 4xx status and `type` only to select status; never return parser messages. Keep unexpected errors at generic 500 JSON.

- [ ] **Step 4: Run all integration tests**

Run: `npm run test:integration`.
Expected: PASS with no raw body-parser errors or stack disclosure. Register the new test in the ownership manifest.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/error-handler.js tests/integration/request-errors.test.js docs/CODE_OWNERSHIP.json
git commit -m "fix: return safe bounded request errors"
```

### Task 5: Start and stop the real server cleanly

**Files:**
- Modify: `src/server.js`
- Create: `tests/unit/server.test.js`
- Modify: `docs/CODE_OWNERSHIP.json`

**Interfaces:**
- Consumes: `loadEnv()` and `createApp(config)`.
- Produces: `startServer({ config = loadEnv(), app = createApp(config), logger = createLogger({ level: config.LOG_LEVEL }) } = {})` returning a Promise that resolves to the listening `node:http.Server` and rejects startup errors.
- Produces: `registerShutdown(server, { signals = process, logger = console } = {})` returning an idempotent shutdown function; `main()` starts the real listener only when `src/server.js` is the direct ES module entry point.

- [ ] **Step 1: Write failing lifecycle tests**

Use an injected app and port `0` (allowed only for an injected test configuration) to verify listening host/port and startup error propagation without a fixed-port collision. Use a fake server/emitter to prove SIGINT and SIGTERM each trigger graceful close, duplicate signals close once, close callbacks settle shutdown, and listener registration is cleaned up. Assert importing `src/server.js` opens no listener.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/unit/server.test.js`.
Expected: FAIL because lifecycle functions do not exist.

- [ ] **Step 3: Implement startup and idempotent shutdown**

Await the `listening` event and reject `error` before listening. After listening, log the bound address without environment values. On the first signal stop accepting connections, close idle connections where supported, await in-flight close, remove both signal listeners, and log failures. `main()` catches startup failure, logs a clear message, and sets a nonzero exit code. Use direct-entry detection so test imports never listen.

- [ ] **Step 4: Run lifecycle and full checks**

Run: `node --test tests/unit/server.test.js && npm run check`.
Expected: PASS with no TODO test remaining. Register the new test in the ownership manifest.

- [ ] **Step 5: Exercise the real server**

Run `npm start`, request `GET /api/health` and all three pages from `http://127.0.0.1:3000`, request `/.env` and `/package.json` for 404, then send SIGINT and separately SIGTERM. Expected: exact health JSON, truthful pages, safe 404s, and clean single shutdown for each signal.

- [ ] **Step 6: Commit**

```bash
git add src/server.js tests/unit/server.test.js docs/CODE_OWNERSHIP.json
git commit -m "feat: add Node server lifecycle"
```

### Task 6: Update Phase 1 evidence and run the workflow

**Files:**
- Modify: `README.md`
- Modify: `docs/HUMAN_AI_WORKLOG.md`
- Modify: `.github/workflows/ci.yml` only if its actual commands no longer match the repository
- Create through GitHub: one scoped Agent task issue for Phase 1 completion

**Interfaces:**
- Consumes: all behavior and checks from Tasks 1–5.
- Produces: a reviewed pull request targeting `node`; the runner stops before approval, merge, or deployment.

- [ ] **Step 1: Replace scaffold documentation with observed behavior**

Document setup, defaults/ranges, start/dev/check commands, exact health response, security boundary, test commands, known symlink-platform limitation if observed, and the four-phase roadmap. Mark Phase 1 checklist items complete only with commit/test evidence; do not claim Phases 2–4 are implemented.

- [ ] **Step 2: Run the full deliverable checks**

Run `npm ci && npm run check`, the real-server smoke test, `git diff --check`, and `git status --short`. Expected: all tests pass and only intended deliverable files are untracked/modified. Remove generated logs or test artifacts that are not part of the delivery.

- [ ] **Step 3: Commit and publish the `node` base required by the runner**

```bash
git add README.md docs/HUMAN_AI_WORKLOG.md
git commit -m "docs: record completed Node Phase 1 foundation"
git push -u origin node
```

- [ ] **Step 4: Run one real issue-to-PR card**

Create an Agent task issue limited to a small remaining Phase 1 correction found during review, or to the uncommitted Phase 1 foundation tasks if the workflow is installed before implementation. Include objective, exact scope, acceptance criteria, and `npm run check` plus real-server verification. Create the required `plan-approved:agent-gates` label only after human approval of workflow settings; then run `/issue-to-pr <issue>` from a dedicated worktree.

- [ ] **Step 5: Inspect the handoff**

Expected: `ready_for_human_review` with a PR targeting `node`, all workflow checks and browser evidence complete. If the result is `blocked`, `needs_plan_review`, or an environment limitation, report the exact result and retain evidence; never simulate success, bypass the guard, approve, merge, or deploy.

## Self-review notes

- Spec coverage: Tasks 2–5 complete every Phase 1 runtime deliverable; Task 1 installs the requested workflow; Task 6 records evidence and exercises the real handoff. Phases 2–4 are specified but intentionally not implemented in this plan.
- Type consistency: all tasks consume the same `loadEnv`, `createApp`, health router, static middleware, and lifecycle signatures declared in their Interfaces blocks.
- Review focus: every listed risk has a named test and a real-server or workflow-level verification step.
- Proportion: implementation bodies are left to the builder; the plan fixes only contracts, values, boundaries, tests, and commands.
