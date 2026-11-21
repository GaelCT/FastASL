# FastASL Node Reboot — Four-Phase Plan

## 1. Purpose

FastASL is being rebuilt as a Node.js application. The PHP, Apache, Composer,
JWT, legacy SQL, and fake browser-authentication implementation is removed and
must not be ported into the reboot. Git history and the
`legacy-php-v3.1-a69bdf6` tag are the legacy archive.

This plan carries forward the useful coverage of the old nine-phase PHP
remediation plan while following the locked decisions in
`docs/REBOOT_DECISIONS.md`. Each phase produces working, testable software and
stops for review before the next phase begins.

## 2. Global constraints

- Node.js 24 LTS, Express 5, plain JavaScript ES modules, and npm lockfiles.
- MySQL through `mysql2/promise` begins in Phase 3, not before.
- Zod validates environment, request, query, and important response boundaries.
- Authentication uses bcrypt password hashes and opaque server-side sessions;
  JWT is not used.
- Production sessions use `express-mysql-session`; `MemoryStore` is never a
  production session store.
- `public/` is the only static document root. The repository root is never
  passed to `express.static()`.
- Camera frames remain in the browser. No model preprocessing or supported
  alphabet is invented without the real model contract.
- Keyboard input is development/practice only and never leaderboard eligible.
- Rankings are global and separate for 30-second and 60-second races. They stay
  disabled until a real classifier exists and are labeled
  "server-calculated, client-attested," never cheat-proof.
- No fake users, sessions, tokens, classifier results, scores, or leaderboard.
- Every phase adds negative tests as well as happy-path tests and leaves
  `npm run check` passing.
- The project owner has asked the AI to continue the Node implementation. The
  Phase 1 TODO scaffolds formerly labeled HUMAN-1/2/3 are therefore reassigned
  to AI implementation with human review at the phase gate.

## 3. Phase 1 — Clean reboot and Node foundation

**Goal:** A clean clone starts a secure, minimal Node server with truthful
static placeholders and no application-domain pretense.

### Deliverables

- Delete all legacy PHP/Apache/JWT/Composer/PHPUnit/SQL implementation files.
- Establish Node 24, Express 5, ESLint, Node test runner, Supertest, Pino,
  Helmet, Zod, CI, and reproducible `npm ci` installation.
- Validate `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`, and `REQUEST_BODY_LIMIT`
  before listening. Invalid supplied values fail startup; they are never
  silently replaced by defaults.
- Compose the Express app without opening a listener. Disable `x-powered-by`,
  mount Helmet and redacting request logging, bound JSON parsing, serve only
  `public/`, mount `/api`, then use safe 404 and final error middleware.
- Return exactly `{ "status": "ok" }` from `GET /api/health`, without runtime,
  dependency, Git, database, secret, or version disclosure.
- Start and stop the listener cleanly on SIGINT and SIGTERM, with duplicate
  shutdown handling guarded.
- Prove repository files, environment files, internal docs, legacy paths, SQL,
  and symlink targets outside `public/` are not downloadable.
- Keep login, dashboard, and race pages honest about unavailable features.

### Verification

- Unit tests cover configuration defaults and every malformed configuration
  class, logger redaction, ownership tooling, and server lifecycle helpers.
- Integration tests cover the exact health contract, all three pages, JSON 404s,
  malformed/oversized JSON, Helmet headers, missing `x-powered-by`, repository
  exposure paths, and a symlink-escape canary.
- Manually start the server, request the health endpoint and pages, and send
  SIGINT/SIGTERM to confirm clean shutdown.
- Exit gate: `npm ci`, `npm run check`, and the manual smoke test pass; no PHP
  runtime files remain in the working tree.

## 4. Phase 2 — Honest practice and server-authoritative races

**Goal:** Replace the race placeholder with a real unranked practice loop and a
server-owned race lifecycle, without accounts, a database, or a classifier
claim.

### Deliverables

- Split browser code into small ES modules for API access, race state, timer
  display, keyboard practice input, and rendering. Browser state parsing and
  DOM rendering must tolerate corrupt storage and untrusted text safely.
- Add strict Zod contracts for race creation and completion. Reject unknown
  fields, wrong types, invalid durations, malformed IDs, replayed completions,
  expired races, and client-supplied authoritative scores.
- Create an application-owned race service with injectable clock and ID
  generation. The server chooses the prompt and 30s/60s duration, records start
  and finish timestamps, calculates WPM/accuracy, and consumes each race once.
- Keep Phase 2 race sessions in a bounded in-memory repository with explicit
  expiry and cleanup. This is a single-process practice/race engine, not a
  production account or leaderboard store; Phase 3 replaces persistence.
- Support keyboard input only as visibly labeled development/practice input.
  Practice results are unranked and are never represented as ASL inference.
- Add camera/model integration only behind a separate reviewed model-contract
  card. Until real model assets and preprocessing are supplied, the UI says
  recognition is unavailable and never generates classifier output.
- Apply accessible keyboard/focus behavior, responsive layouts, and safe error,
  timer, and network-failure states.

### Verification

- Unit tests use a fake clock and deterministic IDs to prove timing, scoring,
  expiration, cleanup, sequence validation, and exactly-once completion.
- Property/table tests cover empty input, Unicode, arrays/null/objects, NaN and
  infinity equivalents in JSON, extra fields, wrong durations, and replay.
- API integration tests prove a changed client WPM/accuracy value cannot alter
  the server-calculated result.
- Browser tests complete both durations with keyboard practice input, exercise
  restart/expiry/network failure, and check console errors and mobile layout.
- Exit gate: no score submission is called verified or cheat-proof; no ranked
  result or real ASL recognition is claimed without the model contract.

## 5. Phase 3 — Accounts, sessions, persistence, and abuse controls

**Goal:** Add real MySQL-backed accounts and races with secure opaque cookies,
atomic session behavior, and deliberate concurrency controls.

### Deliverables

- Add reviewed, pinned `mysql2`, `bcrypt`, `express-session`,
  `express-mysql-session`, and `rate-limiter-flexible` dependencies. Configuration
  is environment-driven, validated at startup, and documented without secrets.
- Write idempotent, transaction-aware migrations for users, session/token
  state, races, and results. Use UTC, appropriate unique constraints/foreign
  keys, bounded indexes, and documented backup/recovery steps.
- Separate controllers, services, repositories, and dependency composition.
  Avoid hidden globals and load-order coupling; inject database, clock, and
  rate-limit dependencies for tests.
- Validate usernames/email/passwords and all request bodies. Normalize only
  according to documented rules; reject invalid input rather than mutating it
  into a different valid value.
- Implement registration, login, current-account, logout, and session renewal
  with bcrypt and opaque `HttpOnly` cookies. Use production `Secure` cookies
  and a deliberate `SameSite` policy. Do not introduce JWT or browser token
  storage.
- Connect authentication to current account state. Deleted/disabled accounts
  and password resets invalidate existing sessions. Logout revokes the session
  server-side, not only in the browser.
- Make session renewal/rotation atomic under concurrent requests. Reuse or
  replay of consumed state must not create two valid successors.
- Implement atomic failed-login throttling and account lockout using
  `rate-limiter-flexible` with MySQL. Key failures by network identity AND
  canonical username; document trusted proxy behavior and lockout policy.
- Replace the Phase 2 race repository with transactional MySQL persistence while
  preserving server-side timing, scoring, expiration, and replay protection.
- Connect the real frontend login/logout/session flow, including expiry,
  unauthorized navigation, network failure, and safe rendering.

### Verification

- Run migration tests against a clean MySQL service and against an initialized
  schema; prove migrations are repeatable and rollback/recovery notes work.
- Test duplicate identities, disabled/deleted users, password reset, logout,
  cookie attributes, session fixation, renewal, replay, and concurrent renewal.
- Parallel login-attempt tests prove no failures disappear and successful login
  does not consume failure budget unless the reviewed policy explicitly says so.
- Integration tests use real MySQL transactions and atomic limiter storage;
  in-memory fakes alone cannot satisfy the concurrency exit gate.
- Browser tests cover register/login/logout/expiry and unauthorized navigation.
- Exit gate: no `MemoryStore` in production, no mock authentication path, no
  client-only authorization, and all concurrency tests pass repeatedly.

## 6. Phase 4 — Real classifier contract, leaderboard, and release hardening

**Goal:** Integrate only a verified ASL model contract, enable appropriately
qualified community results, and make deployment reproducible and observable.

### Deliverables

- Record the actual model format, landmark shape/order, normalization,
  handedness, image orientation, class-label map, model version, and known
  prediction fixtures before integration. Missing assets block classifier work.
- Prefer browser inference with MediaPipe and the reviewed runtime when the
  real model supports it. Camera frames stay on the device. If a separate
  inference service is necessary, send the smallest validated landmark payload,
  not full video, under a separately reviewed design.
- Load models once, validate input dimensions/ranges and output responses,
  apply bounded timeouts and request sizes, and surface honest unavailable and
  low-confidence states. Never invent J/Z, two-hand signs, or preprocessing.
- Gate community eligibility on real classifier input and the exact reviewed
  model version. Keyboard/practice results remain unranked. Store the input
  method and model version with each result.
- Enable global 30s/60s leaderboards only after the classifier gate. Bound page
  sizes, deterministically sort ties, use suitable indexes, and invalidate or
  update leaderboard caches immediately after accepted results.
- Label rankings "server-calculated, client-attested." Do not claim that browser
  inference, input-method attestations, or scores are cheat-proof.
- Finalize same-origin deployment, database TLS, environment validation,
  health/readiness behavior, security headers/CSP, cache controls, log
  redaction/rotation, graceful database shutdown, and dependency review.
- Update OpenAPI and user/developer documentation to match actual requests and
  responses. Document clean-clone setup, migrations, model assets, deployment,
  operations, limitations, and recovery.
- Complete accessibility, responsive, browser-console, load, and security
  regression passes. Remove stale comments and placeholder claims.

### Verification

- Reproduce known model predictions from saved real inputs and prove wrong
  feature order/shape, NaN/infinity, oversized sequences, missing assets, model
  load failure, and inference timeout fail safely.
- Test leaderboard eligibility, 30s/60s separation, deterministic ties, maximum
  pagination, cache refresh, model-version recording, and keyboard exclusion.
- Run exposure, malformed-request, authentication, authorization, race-replay,
  security-header, and browser regression suites against the release candidate.
- Deploy a staging instance from a clean clone using only documented commands
  and environment variables; verify real database TLS, health/readiness,
  shutdown, logs, camera/model behavior, and failure states there.
- Exit gate: documentation matches runtime behavior, all claims have evidence,
  no unresolved critical/high security defect remains, and a person approves
  the release. The workflow may open pull requests but never approve, merge,
  or deploy them.

## 7. Execution rule

Use one scoped GitHub issue per independently reviewable card. The issue must
name its objective, in-scope and out-of-scope paths, acceptance criteria, and
verification commands. Run `/issue-to-pr <issue>` from a dedicated worktree.
Do not combine all remaining phases into one issue or pull request. Sensitive
authentication, infrastructure, user-data, shared-contract, external-write, and
agent-gate changes require the workflow's explicit human plan approval.
