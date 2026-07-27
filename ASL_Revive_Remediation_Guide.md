# ASL Revive Remediation Implementation Guide

**Companion to:** `ASL_Revive_Project_Audit.md`  
**Project snapshot:** `ASL-Revive-zip.zip`  
**Snapshot SHA-256:** `bafe91a8e90acaeffe195db27e83660de775ef21f48a8d7d0d264a4f2455e8ff`  
**Purpose:** Give a coding LLM enough implementation detail, sequencing, tests, and acceptance criteria to remediate the audit without guessing.

> This is an implementation plan, not proof that the findings are fixed. A finding is complete only after the code change is reviewed and its required tests pass.

## Working assumptions

Unless the project owner specifies otherwise, use these targets:

- PHP 8.2 or newer.
- MySQL 8.0 or newer.
- A same-origin browser frontend and `/api/...` backend.
- HTTPS in staging and production.
- Composer for PHP autoloading and dependencies.
- npm with a lockfile for browser dependencies and test tooling.
- Redis for production rate limiting and cache. A transactionally locked database fallback is acceptable for local development.
- UTC for PHP, MySQL sessions, JWT timestamps, and stored timestamps.

Do not silently preserve compatibility with PHP 8.0 or MySQL 5.7 unless that is an explicit project requirement. Supporting older versions would require separate implementation decisions and tests.

---

# Instructions for the Coding LLM

## Non-negotiable behavior

1. Read the audit and this remediation guide completely before editing.
2. Inspect the current implementation and confirm every referenced finding.
3. Work in the batch order below. Do not perform all 45 fixes in one unreviewable change.
4. Keep a tracker at `docs/AUDIT_REMEDIATION_TRACKER.md` with one row per finding.
5. For every finding, record:
   - status: `open`, `in_progress`, `fixed`, `blocked`, `accepted_risk`, or `not_reproducible`;
   - files changed;
   - migration/configuration impact;
   - tests added;
   - exact commands run and results;
   - commit hash;
   - residual risk.
6. Never mark a finding fixed merely because code was edited.
7. Do not weaken validation, authorization, CSP, TLS, token expiry, or tests to make a failure disappear.
8. Do not add hard-coded production secrets or commit a populated `.env`.
9. Preserve one coherent frontend architecture. Delete obsolete duplicate code after the chosen path is working.
10. When a requirement is product-specific—especially ASL recognition, leaderboard scope, score anti-cheat, or account lockout—document the assumption in the tracker rather than inventing silent behavior.
11. Use separate commits for separate logical changes.
12. Stop and report a blocker when a required external asset is missing, such as an ASL classifier model or representative validation data.

## Required first deliverables

Before fixing production code, add:

- `composer.json` and `composer.lock`;
- PHPUnit configuration and a minimal test bootstrap;
- an API test harness capable of making requests to the front controller;
- a MySQL test service or container;
- a Redis test service if Redis is selected;
- npm package and lock files;
- a browser test runner such as Playwright;
- CI that runs PHP syntax checks, static analysis, unit tests, integration tests, JavaScript linting/tests, browser tests, migration tests, and OpenAPI validation.

Add failing regression tests for confirmed defects before implementing each fix whenever practical.

## Definition of done for every finding

A finding is `fixed` only when all applicable conditions are true:

- The vulnerable or defective path is changed.
- A regression test fails on the old behavior and passes on the new behavior.
- Neighboring functionality still passes.
- Documentation and OpenAPI are updated when the public contract changed.
- New configuration has startup validation and an example value.
- Database changes have an idempotent migration and rollback/recovery notes.
- Security-sensitive changes have negative tests, not just happy-path tests.
- The tracker contains evidence.

---

# Target Project Layout

Use a layout similar to this. The exact names may vary, but the security boundaries must not.

```text
ASL-Revive/
├── public/
│   ├── index.php                 # only PHP front controller exposed publicly
│   ├── login.html
│   ├── dashboard.html
│   ├── race.html
│   └── assets/
│       ├── css/
│       ├── js/
│       ├── models/
│       └── vendor/
├── src/
│   ├── Config/
│   ├── Controller/
│   ├── Domain/
│   ├── Http/
│   ├── Middleware/
│   ├── Repository/
│   └── Service/
├── config/
├── database/
│   └── migrations/
├── tests/
│   ├── Unit/
│   ├── Integration/
│   ├── Concurrency/
│   └── Browser/
├── var/
│   ├── cache/
│   └── log/
├── docs/
├── composer.json
├── package.json
└── .env.example                 # contains placeholders only
```

Production secrets must come from process environment or a secret manager. `var/`, `database/`, `src/`, `docs/`, and configuration files must never be under the web document root.

---

# Recommended Commit / Batch Order

| Batch | Scope | Findings |
|---|---|---|
| 0 | Test harness, CI, dependency locks | M-15, foundation for all |
| 1 | Public document root, config startup, permissions | C-01, H-02, H-13, H-15, M-18, L-06 |
| 2 | Strict HTTP parsing and centralized errors | H-05, H-06, H-08, M-09, L-05 |
| 3 | JWT and session lifecycle | C-03, C-04, H-09, M-01, M-02, M-03, M-12 |
| 4 | Login concurrency and rate limiting | H-07, H-10, M-11 |
| 5 | Database migration and operations | H-14, M-14 |
| 6 | Frontend architecture and real authentication | C-02, H-03, M-07, L-04 |
| 7 | Race integrity and ASL recognition | H-01, H-04, M-04, M-08 |
| 8 | Leaderboard correctness and resource controls | H-11, M-05, M-06, L-02, L-03 |
| 9 | Browser security policy and frontend quality | H-12, M-17 |
| 10 | Logging, documentation, architecture cleanup | H-16, M-10, M-13, M-16, L-01, L-07 |

Run the full test suite after each batch, not only at the end.

---

# Critical Findings

## C-01 — Prevent public access to secrets, source, SQL, logs, and internal documents

### Goal

Only intended public HTML, static assets, and the API front controller can be fetched over HTTP.

### Implementation steps

1. Create `public/` and move the browser-facing HTML/CSS/JavaScript into it.
2. Place the API front controller at `public/api/index.php` or route `/api/*` to `public/index.php`.
3. Move PHP implementation code to `src/` or keep `backend/` outside `public/`.
4. Keep `.env`, `database/`, `docs/`, `tests/`, `var/log`, `var/cache`, Composer files, and source outside `public/`.
5. Change local startup documentation from:

   ```bash
   php -S localhost:8000 -t .
   ```

   to a safe document root, for example:

   ```bash
   php -S 127.0.0.1:8000 -t public public/router.php
   ```

6. Add a development router only when required. It must serve existing public files and send API routes to the front controller. It must not expose files outside `public/`.
7. Configure Apache/Nginx with `public/` as the root. Add defense-in-depth denial for dotfiles, backup files, SQL, logs, Markdown internals, and configuration artifacts.
8. Move runtime logs/cache to `var/` and create them at deployment time with controlled ownership.
9. Remove the populated `.env` from source history and the distributed archive. Retain only `.env.example` with placeholders.
10. Rotate database and JWT secrets if the project was ever run from the repository root or shared with real values.
11. Add a deployment assertion that the resolved document root ends in `/public` and refuses startup in production otherwise.

### Required tests

Create an HTTP exposure test that requests at least:

```text
/.env
/.git/config
/composer.json
/database/db.sql
/database/migrate_v3_to_v31.sql
/docs/AUDIT_REMEDIATION_TRACKER.md
/var/log/app.log
/src/Service/AuthService.php
/backend/openapi.yaml
```

Each must return 403 or 404 and must not contain file contents. Public pages, assets, and documented API endpoints must still work.

### Acceptance criteria

- `curl` cannot retrieve any non-public artifact.
- Static pages and APIs work through the same documented deployment layout.
- No production secret file exists inside the repository or public tree.

### Do not

- Do not rely only on `.htaccess`.
- Do not place a deny rule around an otherwise public repository root and call the architecture fixed.

---

## C-02 — Replace mock browser authentication with the backend API

### Goal

A browser session exists only after the backend validates credentials. Client-side route guards remain UX only.

### Implementation steps

1. Choose the multi-page frontend unless there is a documented reason to build an SPA. Remove the duplicate all-in-one script from `pages/login.html` after equivalent functionality exists in modules.
2. Build an API client module, for example `public/assets/js/api.js`, that:
   - sends JSON with `Content-Type: application/json`;
   - handles non-2xx responses consistently;
   - includes credentials for a refresh cookie if cookies are used;
   - performs one controlled refresh attempt after a 401;
   - never logs tokens.
3. On login, read and validate both username and password. Call `POST /api/login`.
4. Prefer this token storage design:
   - short-lived access token kept only in JavaScript memory;
   - rotating refresh token returned as `Secure; HttpOnly; SameSite=Lax` or `Strict` cookie;
   - CSRF protection for cookie-authenticated state-changing refresh/logout routes if SameSite is not sufficient for the chosen cross-site architecture.
5. If the current API must temporarily return a refresh token in JSON, document that as transitional and never persist it in localStorage. Move to an HttpOnly cookie before production.
6. Replace `jwt_frontend_mock_token_sequence` and any localStorage “authenticated” boolean with actual session state.
7. On page initialization, call a lightweight authenticated endpoint or perform refresh to establish session state. Redirect only after the server rejects the session.
8. Implement logout by calling the backend, clearing in-memory access state, and expiring the refresh cookie.
9. Handle token expiration, network failure, disabled accounts, and revoked sessions with explicit user messages.
10. Do not trust a local username or score as identity. Render current-user data returned by the API.

### Required tests

- Wrong password cannot enter the dashboard.
- Manually adding the previous localStorage object does not authenticate the user.
- A valid login reaches the dashboard.
- Refresh restores a session after an access token expires.
- Logout prevents subsequent refresh.
- A revoked or disabled account is redirected to login.
- No refresh token appears in localStorage, sessionStorage, console output, or page source.

### Acceptance criteria

- Browser authentication can be proven from network calls and server state.
- Mock token code and duplicate login implementations are removed.

---

## C-03 — Make logout revoke the refresh-token family

### Goal

After logout, neither the current access token nor any refresh token from the same session can create a new session.

### Preferred design

Use an HttpOnly refresh-token cookie and make `POST /api/logout` receive both the access-token identity and the refresh token. Decode the refresh token, verify that `sub` matches the access token, and delete/revoke its family transactionally. This avoids depending solely on a `family` claim in the access token.

If the API keeps header-based refresh tokens, include the family ID in every access token generated from that family.

### Implementation steps

1. Generate `familyId` before generating the initial access token.
2. Add `family` and a token/session version to the access-token claims.
3. On refresh, generate the new access token with the same family.
4. Change logout to accept validated claims that include:
   - user ID;
   - access JTI;
   - access expiration;
   - family ID or validated refresh token.
5. In one transaction:
   - insert the access JTI into the revocation store with its exact `exp`;
   - mark the refresh family revoked or delete it;
   - optionally revoke all family refresh JTIs if explicit token history is stored.
6. Make logout idempotent. Repeating logout should return success without restoring or exposing state.
7. Expire the refresh cookie even when the backend session is already gone.
8. Add a distinct “logout all sessions” operation that increments `users.token_version` or revokes all families for the user.

### Required tests

1. Login and retain access/refresh tokens.
2. Logout.
3. Access with old access token fails.
4. Refresh with old refresh token fails.
5. Repeating logout is safe.
6. Logging out one family does not revoke another family unless “logout all” was requested.

### Acceptance criteria

No refresh token belonging to the logged-out session works after the transaction commits.

---

## C-04 — Implement one authoritative refresh-token replay state machine

### Goal

A used, replaced, expired, or revoked refresh token is handled consistently. Reuse of a rotated token revokes the active family according to the documented policy.

### Recommended data model

Replace the generic-only blacklist approach for refresh tokens with explicit session state. At minimum, keep:

```text
refresh_token_families
- family_id
- user_id
- current_jti_hash
- previous_jti_hash nullable
- status: active | revoked
- token_version
- expires_at
- rotated_at
- revoked_at nullable
- created_at
```

Store a keyed hash of refresh JTIs rather than raw bearer credentials. A separate token table with one row per rotation is even easier to audit.

### Implementation steps

1. Middleware should only verify cryptography and required claims. It must not return early merely because a refresh JTI appears in a generic blacklist.
2. Pass validated refresh claims to one refresh service method.
3. Start a database transaction and lock the family row with `SELECT ... FOR UPDATE`.
4. Reject if the family is missing, expired, revoked, belongs to another user, or has a token-version mismatch.
5. Compare the presented JTI hash with the current JTI hash using `hash_equals`.
6. If it matches current:
   - generate the replacement JTI and tokens;
   - atomically store the new current JTI and the old current JTI as previous/used;
   - commit;
   - return the replacement pair.
7. If it matches a known previous/used JTI:
   - mark the family revoked;
   - optionally increment the account token version if the policy is “revoke all sessions”;
   - commit;
   - return a generic 401 requiring login;
   - emit a security event without logging raw JTIs.
8. If it matches neither, treat it as invalid/tampered and reject. Do not reveal which comparison failed.
9. Ensure failures after transaction start roll back in `catch (Throwable)` or `finally`.
10. Document whether replay revokes one family or every family. Implement exactly that policy.

### Required tests

- Normal refresh succeeds and old token becomes unusable.
- Reusing the old token revokes the replacement family.
- After replay detection, the replacement token also fails.
- Two simultaneous refreshes permit exactly one rotation.
- Missing family, wrong user, expired family, and revoked family fail.
- The API never reveals expected/current JTI values.

### Acceptance criteria

Refresh lifecycle decisions occur in one locked transaction, not partly in middleware and partly in the service.

---

# High Findings

## H-01 — Stop trusting a client-provided WPM score

### Goal

The backend stores immutable race evidence and derives leaderboard scores from server-approved sessions rather than accepting arbitrary `wpm`.

### Database changes

Add tables similar to:

```text
race_sessions
- id UUID/binary UUID
- user_id
- challenge_seed or challenge_id
- mode
- duration_seconds
- starts_at
- expires_at
- status: issued | started | submitted | expired | invalid
- submission_nonce_hash
- created_at

race_results
- id
- race_session_id unique
- user_id
- correct_events
- total_events
- elapsed_ms
- calculated_wpm
- accuracy
- telemetry_digest nullable
- review_status
- created_at
```

Keep a derived best score or calculate it from valid results. Never let the client directly update `users.best_wpm`.

### Implementation steps

1. Add `POST /api/races` to issue a short-lived server race session.
2. Server selects duration/mode/challenge seed and returns a random session ID and one-time nonce.
3. Client starts only an issued session. Store server timestamps and a bounded client start signal.
4. Add `POST /api/races/{id}/submit` with raw counts and elapsed time, not an authoritative WPM.
5. Lock the race session and require:
   - authenticated user owns it;
   - state is eligible for submission;
   - nonce is correct;
   - deadline has not been exceeded beyond a small allowance;
   - result has not already been submitted;
   - counts and elapsed time are internally consistent.
6. Calculate WPM server-side using one documented formula.
7. Make submission idempotent with a unique session/result constraint.
8. Add plausible upper bounds and mark suspicious results for review rather than pretending client telemetry is cryptographic proof.
9. Exclude keyboard/development mode from competitive boards.
10. Update the leaderboard only from accepted race results.

### Required tests

- Submitting `wpm: 1000` directly is rejected.
- A session cannot be submitted by another user.
- Duplicate submission returns the original result or a conflict without double counting.
- Expired, nonexistent, or modified sessions fail.
- Server-calculated WPM matches test vectors.
- Impossible event counts or elapsed times are rejected/flagged.

### Acceptance criteria

There is no public code path that directly assigns a client-provided best WPM.

---

## H-02 — Fail startup/readiness when required configuration or infrastructure is unavailable

### Goal

An instance never reports ready when it cannot access its database or issue/validate tokens.

### Implementation steps

1. Add a typed `Configuration` object built once at bootstrap.
2. Require database host/name/user/credentials, access signing key, refresh signing key, issuer, audience, allowed origins, and runtime environment.
3. Validate secret entropy/length, inequality, and known placeholders.
4. Validate that `pdo_mysql` is installed.
5. Establish a database connection and run `SELECT 1` during readiness, not necessarily liveness.
6. Check the schema migration version.
7. Check required writable runtime directories or external Redis connectivity.
8. Expose:
   - `/health/live`: process is running; minimal static body;
   - `/health/ready`: dependencies/configuration are usable; generic 200 or 503 body.
9. Log detailed readiness failures internally with a request/instance ID, not secrets.
10. Refuse to serve normal traffic when configuration bootstrap fails.

### Required tests

Readiness must be 503 for empty/equal/weak JWT keys, missing PDO driver, database failure, schema behind expected version, and unwritable required path. Liveness may remain 200 when only a dependency is down.

---

## H-03 — Repair frontend assets and remove the duplicate architecture

### Goal

Each page loads one existing module from a predictable public assets path, with no duplicate inline application after `</html>`.

### Implementation steps

1. Rename `JS/race..js` to `race.js`.
2. Move scripts to `public/assets/js/`.
3. Use module references such as:

   ```html
   <script type="module" src="/assets/js/login.js"></script>
   ```

4. Update every page to absolute root-relative paths or a build-generated manifest.
5. Delete the nonexistent `script.js` reference.
6. Remove scripts placed after the closing HTML tag.
7. Extract shared API/session/storage code into modules.
8. Delete obsolete standalone or inline implementations only after equivalent tests pass.
9. Add a link checker and a browser console-error test to CI.

### Required tests

Every local `src`, `href`, model, font, and image resolves. Browser tests fail on console errors, uncaught exceptions, and 404 resource requests.

---

## H-04 — Implement actual ASL classification, not only hand tracking

### Goal

Camera landmarks are converted into a tested ASL letter prediction with confidence and temporal stability. Keyboard mode is explicitly noncompetitive.

### Required product decision

Before coding, identify the classifier source:

- an existing model file and its license;
- a training dataset and training pipeline;
- supported alphabet subset, especially dynamic letters such as J and Z;
- one-hand/two-hand expectations;
- target devices and acceptable latency/accuracy.

If these assets do not exist, mark H-04 `blocked` and create a separate ML implementation plan. Do not fabricate a classifier with hard-coded landmark guesses and claim the finding fixed.

### Implementation steps after a model is selected

1. Separate modules:
   - camera acquisition;
   - MediaPipe hand detection;
   - landmark normalization/feature extraction;
   - classifier inference;
   - confidence calibration;
   - temporal smoothing/debouncing;
   - game-state acceptance.
2. Normalize for translation, scale, handedness, and orientation using the same preprocessing as training.
3. Require minimum confidence over multiple consecutive frames before accepting a letter.
4. Add cooldown/debounce so one held sign is not repeatedly accepted.
5. Treat “no hand,” low confidence, and unknown class separately.
6. Handle J/Z temporal motion with a sequence model or explicitly exclude them from the first supported mode.
7. Provide calibration, lighting/distance guidance, camera permission errors, and mirrored display without corrupting model handedness.
8. Offer a clearly labeled accessible/non-camera practice mode.
9. Do not submit keyboard-mode scores to production leaderboards.
10. Add telemetry only with privacy review; do not upload camera frames by default.

### Required evaluation

Use a held-out representative dataset. Report per-letter precision, recall, confusion matrix, false acceptance rate, latency, and device/browser coverage. Add deterministic inference tests against fixed landmark samples.

### Acceptance criteria

Progress can be driven by model predictions, and the UI does not call landmark visualization “recognition” unless classification is active.

---

## H-05 — Add strict request schemas before typed service calls

### Goal

Malformed JSON, arrays where strings are expected, unknown fields, and invalid query shapes produce controlled 400 responses, never uncaught `TypeError` 500 responses.

### Implementation steps

1. Add a `Request`/`JsonBody` abstraction used by every controller.
2. Read a bounded body once.
3. Decode using `json_decode($body, true, flags: JSON_THROW_ON_ERROR)`.
4. Require the decoded value to be an associative object, not a scalar or list.
5. Define route-specific schemas with required fields, exact types, ranges, and allowed unknown fields.
6. Never cast first. For example, require `is_int($data['wpm'])` before range checking.
7. Reject query parameters that are arrays: `is_string($_GET['scope'] ?? null)`.
8. Return a stable error shape containing a generic code and field errors, without stack details.
9. Add a top-level `catch (Throwable $e)` around dispatch. Log an opaque request ID and return generic 500.
10. Keep domain validation in services, but controllers must guarantee primitive types before invoking typed methods.

### Suggested error shape

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The request body is invalid.",
    "fields": {"username": "Must be a string."},
    "request_id": "..."
  }
}
```

### Required tests

For every endpoint, test empty body, malformed JSON, JSON list, JSON scalar, array-valued fields, object-valued fields, booleans, floats, unknown fields, duplicate/ambiguous query values, and oversized values.

---

## H-06 — Map infrastructure failures safely and roll back all failed transactions

### Goal

Database/configuration failures return 500/503 without raw internals, and no failed request leaves an open transaction.

### Implementation steps

1. Refactor `Database` so `inTransaction()` never creates a new connection.
2. In each transactional service, hold a local nullable PDO reference.
3. Use this control flow:

   ```php
   $db = null;
   try {
       $db = $database->connection();
       $db->beginTransaction();
       // work
       $db->commit();
   } catch (DomainException $e) {
       if ($db?->inTransaction()) $db->rollBack();
       throw $e;
   } catch (Throwable $e) {
       if ($db?->inTransaction()) $db->rollBack();
       throw new InfrastructureException('Operation unavailable.', previous: $e);
   }
   ```

4. Create typed domain exceptions for invalid credentials, duplicate username, locked account, validation errors, and replay.
5. Map domain exceptions to explicit 4xx codes in one exception handler.
6. Map infrastructure exceptions to 503 when retry may help, otherwise generic 500.
7. Log the original exception internally with redaction and a request ID.
8. Never return PDO messages, SQL, paths, hostnames, or stack traces to clients.

### Required tests

Inject connection failure, query failure, commit failure, missing JWT configuration after transaction start, duplicate username, and invalid credentials. Verify HTTP status, generic body, internal logging, and no open transaction.

---

## H-07 — Replace the non-atomic file rate limiter

### Preferred production solution: Redis

Use a Redis Lua script or a well-tested limiter implementing a token bucket, sliding window, or fixed window atomically. Key by normalized route/action plus a hashed identifier. Set TTL atomically with increment/update.

### Implementation steps

1. Define a `RateLimiter` interface and inject it into middleware/controllers.
2. Implement Redis-backed production limiter.
3. Define a deliberate failure policy per route:
   - authentication and refresh: fail closed or use a constrained emergency fallback;
   - public low-risk reads: potentially fail open with alerting, if documented.
4. Return `429`, `Retry-After` in seconds, and standard rate-limit metadata if desired.
5. Never include raw username/email/IP in Redis keys; use an HMAC with a server-side key.
6. Add metrics for allowed, blocked, backend failures, and key cardinality.
7. For a temporary file fallback, lock one stable `.lock` file for the entire read-filter-check-append-write operation. Treat write failure according to the documented policy. This is not suitable for multiple instances.

### Required tests

- 80 or more concurrent attempts persist/count exactly.
- Limit is consistent across two application instances using the same Redis.
- TTL and retry value are correct.
- Storage failure follows the configured fail policy and emits an alert.

---

## H-08 — Enforce request-body limits independent of `Content-Length`

### Goal

Fixed-length, chunked, malformed, and compressed oversized requests are rejected before full JSON parsing.

### Implementation steps

1. Enforce a body limit at the reverse proxy or gateway.
2. Set PHP/web-server request limits consistently.
3. In the application, open `php://input` and read in chunks up to `max + 1` bytes.
4. If more than `max` bytes are observed, stop reading and return 413.
5. Treat a declared `Content-Length` over the maximum as an immediate 413, but do not rely on it as the sole enforcement.
6. Decide whether compressed request bodies are unsupported. Reject unsupported `Content-Encoding`; otherwise cap decompressed size as well.
7. Reuse the bounded body from the strict request parser so endpoints do not reread the stream.
8. Use smaller route-specific limits when practical.

### Required tests

Test below/at/above limit with `Content-Length`, chunked transfer, no length, malformed chunks through the real proxy, and compressed bodies. Confirm the application does not allocate the entire oversized payload.

---

## H-09 — Make refresh rotation single-use under concurrency

### Goal

For one current refresh token, exactly one concurrent request can rotate it.

### Implementation steps

1. Combine this change with C-04.
2. Lock the family row with `SELECT ... FOR UPDATE`, or use compare-and-swap:

   ```sql
   UPDATE refresh_token_families
   SET current_jti_hash = :new, previous_jti_hash = :old, rotated_at = UTC_TIMESTAMP()
   WHERE family_id = :family
     AND user_id = :user
     AND status = 'active'
     AND current_jti_hash = :old;
   ```

3. Require exactly one affected row. Zero rows means another request rotated/revoked it or the token is invalid.
4. Do not return new tokens until the state transition is guaranteed to commit.
5. Define what the losing concurrent request does. Usually it receives a generic 401; only confirmed replay of a used token should invoke the chosen family-revocation policy.
6. Consider a very small idempotency/grace design only if mobile retry behavior requires it; document the security tradeoff.

### Required tests

Use real concurrent database transactions. Submit the same refresh token simultaneously 20+ times. Exactly one result succeeds; database state and returned tokens remain consistent.

---

## H-10 — Make failed-login accounting atomic and separate failures from general request throttling

### Goal

Parallel failures cannot lose increments, and successful logins do not consume the strict failure quota.

### Implementation steps

1. Keep a broad per-IP login request limiter to absorb traffic.
2. Add a separate failed-auth limiter keyed by HMAC(username) and optionally IP/account pair.
3. Record into the failed-auth limiter only after credential failure.
4. On successful authentication, reset the account failure counter and optionally clear the account-specific limiter.
5. Update database counters atomically. Options:
   - lock the user row `FOR UPDATE` before verifying/updating; or
   - use one SQL `UPDATE failed_logins = failed_logins + 1, locked_until = CASE ...` and read back state.
6. Avoid a policy that lets an attacker indefinitely lock a known account. Prefer progressive delays, risk-based challenges, and alerting over permanent/simple lockouts.
7. Do not reveal whether an account exists.
8. Make time calculations in UTC and use an injected clock for tests.

### Required tests

Parallel incorrect passwords produce the exact expected counter. Successful logins do not trigger the failure limit. Multiple users behind one IP can log in within reasonable limits. Lockout expiry and reset are deterministic.

---

## H-11 — Bound leaderboard resource use

### Goal

Unauthenticated requests cannot force huge offsets, unbounded cache files, or unlimited expensive queries.

### Implementation steps

1. Prefer cursor pagination based on deterministic ordering, for example `(best_wpm, achieved_at, user_id)`.
2. If page pagination remains temporarily:
   - require integer `page` and `limit`;
   - cap `limit`, page, and calculated offset;
   - reject overflow and pages beyond a documented maximum;
   - avoid caching nonsensical/empty high pages.
3. Apply a route-specific public rate limit.
4. Move cache to Redis or a bounded managed cache.
5. Add TTL, maximum key count/memory policy, and versioned invalidation.
6. Do not run `COUNT(*)` for every request if not required; use cached counts or a next-cursor response.
7. Add database indexes matching the final filter and order.
8. Return a stable 400/416-style response for invalid cursors/pages.

### Required tests

Extreme integers, overflow values, array query parameters, random cursors, repeated high pages, and concurrent requests cannot create unbounded files or slow queries. Query plans use the intended index.

---

## H-12 — Apply compatible browser security headers to static and API responses

### Goal

All responses receive appropriate headers, while camera, model loading, fonts, and scripts still work under a deliberate policy.

### Implementation steps

1. Serve headers at the reverse proxy/web-server layer so static files receive them.
2. Self-host and pin frontend dependencies where possible. This permits a tighter CSP.
3. Remove inline event handlers and inline scripts. Use modules and `addEventListener`.
4. Start with a report-only CSP in staging, collect violations, then enforce.
5. Use route-aware policy only where necessary. Example concepts:
   - default deny;
   - scripts/styles/fonts from self;
   - connections/workers/model resources only from explicitly required locations;
   - `frame-ancestors 'none'` unless embedding is required;
   - `base-uri 'none'` or `'self'`;
   - `object-src 'none'`.
6. Set `Permissions-Policy` so camera is allowed only for self and only where required by the application design. Remember that this header is origin/response policy, not a replacement for browser permission prompts.
7. Add `Referrer-Policy`, `X-Content-Type-Options: nosniff`, and a suitable cross-origin isolation policy only after compatibility testing.
8. Redirect HTTP to HTTPS. Enable HSTS only after HTTPS works across the intended domain/subdomains.
9. Keep API token responses `no-store` as described in M-12.

### Required tests

Automated header assertions for HTML, JS, CSS, API success/error, and 404 responses. Playwright must verify camera setup/model loading and that the console has no CSP violations in enforcement mode.

---

## H-13 — Correct ownership and permissions

### Goal

Source and secrets are not writable by unrelated users/processes; only operational directories are writable by the application account.

### Implementation steps

1. Set source files to `0644` or stricter and directories to `0755`.
2. Set secrets to `0600` or `0640` with a controlled group.
3. Set runtime directories to `0750` or `0770`, owned by the application service account/group.
4. Make deployed source read-only for the runtime user.
5. Do not run the application as root.
6. Configure deployment tools/containers to set permissions explicitly rather than inheriting ZIP metadata.
7. Add CI/release validation that rejects group/world-writable code and secret files.
8. Prefer immutable container images and mounted writable volumes for `var/`.

### Required tests

A release script should fail if any code/configuration file is group/world-writable, if `.env` is world-readable, or if the runtime account can modify source files.

---

## H-14 — Replace the fragile migration with a versioned migration system

### Goal

Fresh installs and upgrades are deterministic, least-privilege, repeatable, and verifiable.

### Implementation steps

1. Adopt a migration tool or implement a small migration runner with a `schema_migrations` table.
2. Split schema changes into numbered migrations.
3. Remove `SET GLOBAL event_scheduler = ON` from migrations.
4. Prefer an application/cron cleanup command over MySQL events. If events are retained, put them in a separately documented optional operations migration with correct delimiter handling.
5. Detect legacy columns/indexes through `information_schema` or migration version rather than referencing them unconditionally.
6. Pin supported MySQL version and write SQL valid for it.
7. Add preflight checks, backup instructions, post-migration verification queries, and recovery instructions.
8. Since MySQL DDL may auto-commit, do not promise transactional rollback where it is not available.
9. Run migrations with a dedicated deployment principal, not the runtime application account.

### Required tests

CI must test fresh schema creation, upgrade from the exact legacy snapshot, rerun/idempotency behavior, partially applied detection, and application startup against the migrated schema.

---

## H-15 — Load production configuration from process environment

### Goal

The application does not require a repository-root `.env`, and configuration parsing is standard and testable.

### Implementation steps

1. Read `getenv()`/`$_ENV` first.
2. For local development only, optionally load an explicitly supplied file outside `public/` using a maintained library such as `vlucas/phpdotenv`.
3. Never hard-code the `.env` path relative to source.
4. Build one immutable typed configuration object during bootstrap.
5. Distinguish required values, optional values, defaults allowed only in development, and secret values.
6. Never include secret values in exception messages or logs.
7. Keep `.env.example` as placeholders and descriptions only.
8. Add container/platform examples using injected environment or secret mounts.
9. Combine with M-18 startup validation.

### Required tests

Process environment overrides local files; production starts without an env file; missing required values fail startup; malformed values fail with key names but no values.

---

## H-16 — Replace the misleading security audit process

### Goal

Security status is tied to reproducible evidence and a specific commit/artifact.

### Implementation steps

1. Archive the old report as historical and clearly label it superseded, or remove it from release documentation.
2. Keep the current audit and remediation tracker under `docs/security/`.
3. Tie every report to commit hash, artifact hash, date, test environment, and known limitations.
4. Use statuses `open`, `fixed`, `accepted`, `not_reproducible`, and `unverified`.
5. Link every fixed claim to regression tests and commit hashes.
6. Add a CI release gate that fails while critical/high findings are open unless an explicit, approved risk record exists.
7. Re-run security regression tests after auth, routing, proxy, migration, and deployment changes.
8. Do not claim “fully hardened,” “all files secure,” or “no supply-chain risk” without bounded evidence.

### Required tests/evidence

The tracker must accurately reflect automated test results and no longer list a finding fixed when its regression test fails.


---

# Medium Findings

## M-01 — Enforce a strict JWT claim contract

### Implementation steps

1. Replace the custom JWT implementation with a maintained library unless there is a documented reason not to.
2. On encode, always set and type:
   - `iss` exact configured issuer;
   - `aud` exact configured audience;
   - `sub` non-empty integer/string user ID;
   - `jti` cryptographically random identifier;
   - `iat`, `nbf`, and `exp` integers;
   - `type` exactly `access` or `refresh`;
   - `family` for session-bound tokens;
   - `ver`/token version if M-03 is implemented.
3. On decode, require every applicable claim rather than validating it only when present.
4. Reject wrong types, wrong issuer/audience, empty JTI, unsupported algorithms, excessive lifetime, and tokens issued too far in the future.
5. Configure a small clock-skew allowance such as 30–60 seconds.
6. Use separate validation profiles for access and refresh tokens.

### Tests

Missing/empty/wrongly typed claims, wrong issuer/audience/type, missing expiration/JTI, future issue time, excessive lifetime, wrong key, and wrong algorithm all fail.

---

## M-02 — Use independent signing keys and exact revocation expiry

### Implementation steps

1. Require independently generated access and refresh keys. Do not derive one from the other.
2. Reject startup when keys are equal, too short, placeholder values, or absent.
3. Prefer managed asymmetric keys when operationally justified, but do not add complexity without key-rotation procedures.
4. When revoking a token, store the validated token's exact `exp` as the row expiry.
5. Purge revocation records only after that timestamp.
6. Ensure all expiry conversions use UTC.
7. Add key identifiers and a documented rotation strategy if multiple active keys are needed.

### Tests

A revoked token remains rejected until its signature expiry, regardless of configured default lifetime. Equal/derived keys prevent startup.

---

## M-03 — Tie protected requests to current account state

### Database changes

Add at least:

```text
users.status: active | disabled | deleted_pending
users.token_version integer not null default 1
```

### Implementation steps

1. Include `token_version` in access and refresh tokens.
2. On protected requests, load a minimal current-user session record or use a short-lived cached session record.
3. Reject missing users, disabled users, and version mismatch.
4. Increment `token_version` for password reset, forced logout-all, suspected compromise, and security-sensitive account changes.
5. Do not trust username/name claims as current profile data; use the user ID as identity and load mutable fields when needed.
6. Check update row counts and return not-found/revoked errors accurately.

### Tests

Disable/delete a user and verify existing access/refresh tokens fail. Increment token version and verify all prior sessions fail.

---

## M-04 — Require exact score types and return truthful results

### Implementation steps

1. Remove `(int)` coercion from request handling.
2. Require a JSON integer and validate the range before domain code.
3. After H-01, remove the direct score endpoint or make it a race-session submission endpoint.
4. Until then, use an atomic best-score update and determine whether an improvement occurred.
5. Return fields such as `improved`, `previous_best`, `best_wpm`, and the accepted result ID.
6. Return 404/401 when the subject no longer maps to an active user.
7. Log only when a real state change occurred.

### Tests

Strings, floats, booleans, arrays, null, and out-of-range integers fail. Lower/equal scores return `improved: false`; a higher valid result returns accurate previous/current values.

---

## M-05 — Invalidate leaderboard cache after accepted results

### Implementation steps

1. Call invalidation only after a race result commits successfully.
2. Use a per-board cache generation/version key rather than deleting every possible page.
3. Include the generation in cache keys.
4. Invalidate only boards affected by the user's accepted result, such as global and verified region/friends boards.
5. Make result commit and invalidation reliable. If strict atomicity across DB/Redis is unavailable, use an outbox/event processed idempotently.
6. Remove or correctly implement the unused scope parameter.

### Tests

Warm the cache, submit an improved result, and immediately retrieve a board containing the new score. Unaffected board caches remain valid.

---

## M-06 — Define real leaderboard scopes

### Implementation steps

1. Decide and document supported boards. Suggested first release: global only.
2. Remove `local`, `regional`, and `friends` until their domain data exists.
3. For regional boards, derive region from a verified/profile field with privacy controls; do not accept it per score request.
4. For friends, add relationship tables, accepted states, and visibility/access rules.
5. Remove user-selected `scope` from registration unless it has a clearly different non-security meaning.
6. Align schema constraints, API enum, UI controls, and documentation.
7. Add authorization and privacy tests for non-global boards.

### Tests

Unsupported scope values fail consistently. A user cannot place themselves in an arbitrary private/regional board merely by submitting a string.

---

## M-07 — Treat browser storage and rendered records as untrusted

### Implementation steps

1. Create a storage wrapper with versioned schemas and safe defaults.
2. Wrap parse operations in `try/catch`; remove/reset malformed values.
3. Validate every field and reject unexpected object shapes.
4. Stop using localStorage for authentication and competitive scores.
5. Construct leaderboard rows with `document.createElement` and assign user-controlled text through `textContent`.
6. Never insert server/local values with `innerHTML`.
7. Add CSP and DOM-XSS linting/test cases.

### Tests

Malformed JSON does not crash the page. Values containing `<img onerror=...>` render as text and do not execute.

---

## M-08 — Correct race timing, accuracy, and initialization

### Implementation steps

1. Count only actual user/classifier attempts in both numerator and denominator.
2. Define how skipped spaces/punctuation affect WPM and accuracy; apply consistently.
3. Validate race duration against a server-approved enum.
4. Use `performance.now()` and an absolute deadline instead of decrementing a counter.
5. Derive remaining time from `deadline - performance.now()` on every animation/timer update.
6. Initialize timer, score, accuracy, and prompt before starting.
7. Clamp display values only after fixing the underlying counts; do not use clamping to hide invalid formulas.
8. Pause/cancel cleanly on visibility changes according to an explicit policy.
9. Server calculation from H-01 remains authoritative.

### Tests

30/60-second modes initialize correctly; throttled timers still calculate elapsed time; accuracy never exceeds 100%; invalid stored duration cannot start a competitive race.

---

## M-09 — Publish one canonical route layout

### Implementation steps

1. Use one front controller under `public/`.
2. Pick canonical endpoints, preferably `/api/...`.
3. Configure the server to pass the original path explicitly to the router.
4. Remove exactly one known base prefix using anchored matching; never unrestricted `str_replace`.
5. Reject repeated prefixes and path confusion forms.
6. Remove `backend/validation.php` after its behavior is represented by the canonical route.
7. Centralize a route table with allowed methods.
8. Redirect old routes only if backward compatibility is required; otherwise return 404.

### Tests

Canonical paths work. Repeated `/backend/backend`, encoded slashes, dot segments, duplicate slashes, trailing slash variants, and wrong methods produce the intended response and cannot alias another endpoint.

---

## M-10 — Make OpenAPI, README, and runtime one contract

### Implementation steps

1. Set and test one supported PHP/MySQL version range.
2. Update OpenAPI to actual route prefixes, request schemas, status codes, token/cookie behavior, and response shapes.
3. Ensure password examples satisfy the actual policy.
4. Use one configuration key name, such as `JWT_ACCESS_TTL_SECONDS`, across code and docs.
5. Remove obsolete schema fields from README.
6. Set one application/API version source at build time.
7. Validate OpenAPI in CI and run contract tests against the application.
8. Generate or verify README examples from tested fixtures where possible.

### Tests

Every documented example succeeds against a clean test deployment. OpenAPI-generated requests match runtime responses.

---

## M-11 — Extend rate limiting and correctly handle proxy chains

### Implementation steps

1. Apply distinct policies to login request, login failure, registration, username check, refresh, race creation/submission, leaderboard, and validation endpoints.
2. Add per-account/user/token limits where identity is available, not only IP limits.
3. Use shared storage across instances.
4. Trust forwarding headers only when `REMOTE_ADDR` is in the configured trusted proxy list.
5. Parse the chain from the immediate peer backward, removing trusted proxies until the first untrusted address is found.
6. Support IPv4 and IPv6 CIDRs with a maintained IP library.
7. Prefer standardized `Forwarded` handling when the deployment proxy supports it, while preventing conflicting header ambiguity.
8. Document exact proxy topology and test it.

### Tests

Spoofed forwarding headers from an untrusted peer are ignored. Multi-hop trusted chains select the correct client for IPv4 and IPv6. Limits apply across replicas.

---

## M-12 — Prevent caching of authentication data and make CORS cache-safe

### Implementation steps

1. Add `Cache-Control: no-store, private` to responses that contain or alter authentication/session state.
2. Add `Pragma: no-cache` for legacy compatibility when desired.
3. Add `Vary: Origin` whenever CORS behavior changes by origin.
4. Return 403 for disallowed origins/preflight requests rather than a misleading 204.
5. Allow only configured origins, methods, and headers.
6. Do not use wildcard origin with credentials.
7. If using refresh cookies, configure `Access-Control-Allow-Credentials` only when cross-origin architecture truly requires it.
8. Verify the reverse proxy/CDN does not cache auth responses.

### Tests

Headers exist on login, refresh, logout, and all auth errors. Allowed/disallowed origins and preflights behave explicitly; cache tests cannot reuse one origin's response for another.

---

## M-13 — Use bounded, structured, redacted logging

### Implementation steps

1. Emit structured JSON logs to stderr or a managed collector outside the public root.
2. Include timestamp, severity, event code, request ID, route, and safe subject identifier.
3. HMAC or truncate identifiers when correlation is needed. Never log bearer tokens, raw refresh JTIs, passwords, full secrets, or full request bodies.
4. Log exception class and controlled diagnostic context; restrict raw messages to secured internal logs.
5. Define retention, maximum disk use, rotation/compression, and deletion in the deployment platform.
6. Add monitoring for logging failures, disk pressure, repeated auth failures, refresh replay, and readiness failures.
7. Use a request ID returned in error responses for support correlation.

### Tests

Security test scans logs after auth/error cases and finds no token/password/secret. Retention and log-backend failure behavior are exercised.

---

## M-14 — Require database TLS, UTC, and reliable cleanup

### Implementation steps

1. Add PDO TLS configuration for non-local environments, including CA verification.
2. Refuse production database connections that do not meet the configured TLS policy.
3. Set PHP timezone to UTC.
4. Execute `SET time_zone = '+00:00'` for each MySQL session and store UTC timestamps.
5. Convert JWT `exp` with UTC-safe functions rather than local `date()` assumptions.
6. Replace reliance on MySQL event scheduler with a least-privilege scheduled application command.
7. Monitor blacklist/family/cache table sizes and cleanup job success.
8. Index expiry columns used by cleanup.

### Tests

Different host timezones produce identical stored expiry behavior. Cleanup is idempotent and removes only expired rows. Production-mode connection policy rejects unverified transport.

---

## M-15 — Add tests, CI, and reproducible dependencies

### Implementation steps

1. Add Composer with autoloading and locked versions.
2. Add PHPUnit, static analysis (PHPStan/Psalm), coding standard, and security/dependency audit.
3. Add npm lockfile, ESLint, browser/unit tests, and a bundling/self-hosting strategy for frontend libraries.
4. Add MySQL and Redis services in CI.
5. Create test layers:
   - unit tests for validator/JWT/config/math;
   - API integration tests;
   - database migration tests;
   - concurrency tests for refresh/rate/login;
   - browser tests for auth, CSP, resources, race UX;
   - deployment exposure/header tests.
6. Validate OpenAPI and compare contract behavior.
7. Run dependency vulnerability checks without treating them as a replacement for code testing.
8. Fail releases on test failure or open critical/high findings.

### Minimum regression suite

Include every reproduction listed in the original audit: public sensitive files, malformed array inputs, chunked oversize body, rate-limit concurrency, wrong JWT issuer/missing claims, logout refresh, replay revocation, concurrent refresh, and broken assets.

---

## M-16 — Remove hidden include order and static global coupling

### Implementation steps

1. Add Composer PSR-4 autoloading and namespaces.
2. Define interfaces for database connection, clock, logger, token service, rate limiter, and cache.
3. Constructor-inject dependencies into services/controllers.
4. Replace the global `require_auth()` helper with explicit middleware composition.
5. Make controllers return response objects/data rather than calling an exit-style static response utility.
6. Build a small application/container bootstrap that wires production dependencies.
7. Provide test doubles without global static reset hacks.
8. Refactor incrementally after security behavior is covered by tests; do not combine a complete architecture rewrite with untested auth logic.

### Tests

Controllers can be instantiated and tested independently. Changing include order cannot change behavior. Test state does not leak across cases.

---

## M-17 — Meet accessibility and mobile requirements

### Implementation steps

1. Add persistent `<label for>` elements and helpful descriptions/errors connected with `aria-describedby`.
2. Use semantic buttons/forms/headings and visible keyboard focus.
3. Add `aria-live` regions for tracking state, timer warnings, errors, and results without excessive announcements.
4. Move focus appropriately after login errors, modal/result display, and page transitions.
5. Correct text contrast to WCAG 2.2 AA.
6. Add `@media (prefers-reduced-motion: reduce)` to disable nonessential flashing, shaking, blinking, and particles.
7. Replace fixed `100vh`/hidden overflow with `min-height: 100dvh` and allow scrolling.
8. Test responsive layouts, zoom, screen readers, keyboard-only operation, and mobile camera permissions.
9. Provide a non-camera practice mode and explain competitive restrictions.
10. Avoid rapid flashing that could create seizure risk.

### Tests

Automated axe checks plus manual keyboard, screen-reader, 200%/400% zoom, reduced-motion, mobile viewport, and camera-denied tests.

---

## M-18 — Validate every configuration value at startup

### Implementation steps

1. Define a schema for every setting with type, required status, allowed environments, default, minimum/maximum, and secret flag.
2. Parse integers with `filter_var` or explicit numeric validation; never `(int)` arbitrary text.
3. Validate TTLs, limits, bcrypt cost, cache sizes, body sizes, and lockout windows against safe ranges.
4. Validate origins as origins, URLs as URLs, and CIDRs with IPv4/IPv6 support.
5. Add cross-field checks: refresh TTL > access TTL, keys differ, production HTTPS origin, nonzero limits, and compatible cookie/CORS settings.
6. Fail startup once with a concise list of invalid key names, never values.
7. Unit-test the complete configuration matrix.

---

# Low Findings

## L-01 — Reject invalid input instead of silently rewriting it

1. Define canonical normalization explicitly, such as trimming allowed outer whitespace and Unicode normalization.
2. Validate the normalized value and reject forbidden characters.
3. Do not strip tags/null bytes to turn invalid input into another valid username.
4. Store and compare one documented canonical username form.
5. Add collision tests for values that previously cleaned to the same result.

---

## L-02 — Make tie ordering deterministic

1. Define the tie rule, for example earliest achievement first, then user ID.
2. Store `best_wpm_achieved_at` or derive rank from immutable race results.
3. Add all tie keys to SQL `ORDER BY` and cursor pagination.
4. Use the same order in client previews.
5. Add pagination tests with many equal scores.

---

## L-03 — Align cache comments, API, and behavior

1. Correct file-extension/storage comments or remove obsolete file cache after Redis migration.
2. Implement truly scoped invalidation or remove the scope argument.
3. Document key format, TTL, versioning, and eviction.
4. Keep all cache storage outside the document root.
5. Add unit tests for invalidation scope.

---

## L-04 — Remove implicit globals and render initial state correctly

1. Use ES modules, which are strict by default.
2. Change `zIndex = '1000'` to `element.style.zIndex = '1000'`.
3. Enable ESLint rules for undefined variables and implicit globals.
4. Render initial timer/state from the selected configuration before starting.
5. Add a browser test for 30-second initialization and particle creation.

---

## L-05 — Return correct method semantics and remove obsolete headers

1. Define allowed methods per route.
2. For a known path with the wrong method, return 405 and `Allow`.
3. Remove unused DELETE from CORS/method lists.
4. Handle OPTIONS consistently through the route/CORS layer.
5. Remove `X-XSS-Protection`; rely on output safety, CSP, and modern headers.
6. Add method-matrix tests.

---

## L-06 — Minimize public version disclosure

1. Return a minimal liveness body such as `{"status":"ok"}`.
2. Put build/version metadata on an internal/authenticated diagnostics endpoint or in deployment metadata.
3. Disable `expose_php` in the actual PHP runtime.
4. Remove or overwrite unnecessary server banners at the reverse proxy.
5. Verify success and error headers in deployment tests.

---

## L-07 — Correct stale comments and select a real license

1. Update README claims after fixes are proven.
2. Remove claims that `.env` is not distributed until it is actually absent from history/artifacts.
3. Correct explanations about JSON escaping, rate-limit atomicity, and proxy selection.
4. Select and add a real license approved by the project owner.
5. Add a documentation review item to release checklists.
6. Treat security comments as assertions that must match tests.

---

# Suggested Database Migration Sequence

Use separate numbered migrations. Example:

```text
001_baseline_schema.sql
002_add_user_status_and_token_version.sql
003_replace_refresh_family_state.sql
004_add_race_sessions_and_results.sql
005_add_best_score_timestamp_and_indexes.sql
006_add_schema_operational_indexes.sql
```

Important constraints/indexes:

- unique active result per race session;
- unique refresh family ID;
- indexes on user ID, expiry, status, and leaderboard order;
- foreign keys with deliberate deletion behavior;
- UTC timestamps;
- a `schema_migrations` table.

Do not put global database-server configuration changes in application migrations.

---

# Suggested API Shape After Remediation

This is a recommended coherent target, not a requirement to preserve every current route.

```text
GET  /health/live
GET  /health/ready
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
POST /api/auth/logout-all
GET  /api/me
POST /api/races
POST /api/races/{raceId}/submit
GET  /api/leaderboards/global?cursor=...&limit=...
```

Use exact request schemas, standard error objects, explicit 405 handling, and no-store headers on session routes.

---

# Required End-to-End Security Regression Scenarios

The coding LLM should add or preserve automated tests for all of these:

1. Sensitive paths are not retrievable over HTTP.
2. A fake localStorage token does not authenticate the browser.
3. Wrong password fails; correct password succeeds.
4. Logout blocks both access and refresh tokens.
5. A rotated refresh token cannot be reused.
6. Replay revokes the intended active family/session scope.
7. Concurrent refresh allows exactly one success.
8. Wrong JWT issuer/audience or missing required claims fails.
9. Disabled/deleted/version-invalid users cannot use existing tokens.
10. Array/object/scalar malformed fields return 400, not 500.
11. Infrastructure failure returns generic 500/503 and rolls back.
12. Fixed-length and chunked oversized bodies return 413.
13. Concurrent rate-limit attempts are counted exactly.
14. Concurrent failed logins are counted exactly.
15. Successful logins do not consume the strict failure quota.
16. Arbitrary WPM cannot be submitted directly.
17. Race sessions are owner-bound, single-use, time-bounded, and server-scored.
18. Leaderboard extreme pages/cursors cannot create unbounded cache/database work.
19. Score improvement invalidates affected leaderboard cache.
20. Static and API responses have compatible security headers.
21. Browser assets have no 404s or console exceptions.
22. User-controlled leaderboard text cannot execute HTML/script.
23. Migrations pass fresh install and legacy upgrade tests.
24. Logs do not contain secrets, passwords, or bearer tokens.
25. Accessibility smoke tests pass and reduced motion is respected.

---

# Copyable Prompt for the Coding LLM

Use this prompt together with both Markdown files and the repository:

```text
You are remediating the ASL Revive repository.

Read these files first:
1. ASL_Revive_Project_Audit.md
2. ASL_Revive_Remediation_Guide.md

Do not begin by changing all findings. Inspect the repository, confirm the snapshot, and create docs/AUDIT_REMEDIATION_TRACKER.md containing every finding ID C-01 through L-07.

Follow the batch order in the remediation guide. Start with Batch 0 and Batch 1 only. Add regression tests before or alongside each fix. Do not mark a finding fixed without test evidence.

Rules:
- Never hard-code or print real secrets.
- Never use localStorage authentication as a security boundary.
- Never weaken security checks to make tests pass.
- Never accept a client-provided WPM as authoritative.
- Do not claim ASL recognition is implemented unless an actual licensed model, matching preprocessing, and evaluation data exist.
- Use small commits grouped by logical remediation.
- Keep public files under a dedicated public/ document root.
- Use process environment for production configuration.
- Use strict request schemas and one top-level exception handler.
- Use a locked transactional refresh-token state machine.
- Use a shared atomic production rate limiter.
- Update OpenAPI and README whenever the public behavior changes.

For each completed finding, update the tracker with:
- status;
- files changed;
- tests added;
- commands and results;
- commit hash;
- residual risk.

At the end of the batch, stop and report:
1. findings completed;
2. files and migrations changed;
3. tests run and exact results;
4. unresolved blockers/assumptions;
5. commit hashes;
6. instructions for manual verification.

Do not start the next batch until the current batch passes the full test suite.
```

---

# Review Guidance for the Project Owner

Do not approve a batch solely from the model's summary. Review:

- the actual diff;
- newly added tests;
- whether the tests reproduce the old defect;
- migration safety;
- token and cookie handling in browser developer tools;
- deployment document-root configuration;
- logs for leaked values;
- the remediation tracker and commit history.

The ASL classifier and anti-cheat design require product/ML decisions that a coding LLM should not silently invent. Those areas can be implemented by an LLM after the model assets, supported alphabet, scoring rules, and validation dataset are explicitly selected.
