# ASL Revive Project Code Audit

**Project snapshot:** `ASL-Revive-zip.zip`  
**Snapshot SHA-256:** `bafe91a8e90acaeffe195db27e83660de775ef21f48a8d7d0d264a4f2455e8ff`  
**Audit date:** July 21, 2026 (America/Los_Angeles)  
**Overall assessment:** **Not ready for production or public beta**  
**Scope:** 50 supplied files covering PHP API code, SQL schema/migration, static HTML/CSS/JavaScript, Apache configuration, environment configuration, API documentation, and the pre-existing `SECURITY_AUDIT.md`.

> Secret values are intentionally not reproduced in this report. The supplied `.env` was inspected only for presence, emptiness, and configuration safety.

## Executive Summary

The backend contains several good building blocks—prepared PDO statements, bcrypt password hashing, signed JWTs, a token blacklist, input allowlists, and API security headers—but the project is not operating as one integrated application. The browser frontend uses mock authentication and local-only leaderboards, several pages reference JavaScript files that do not exist at those paths, and the core ASL recognition feature is not implemented.

The most serious backend problems are session-revocation defects. Access tokens do not contain their refresh-token family, so logging out never invalidates the refresh token. Separately, refresh-token reuse detection is short-circuited by the blacklist check and therefore does not revoke the active family in the normal reuse case.

The documented development command serves the entire repository as the web root. Because PHP’s built-in server ignores `.htaccess`, it exposes `.env`, SQL files, logs, documentation, and cache data. This was reproduced directly. The supplied ZIP also records every regular project file as world-writable and almost every directory as world-writable.

### Finding Count

| Severity | Count | Meaning |
|---|---:|---|
| Critical | 4 | Release-blocking security or authentication failure |
| High | 16 | Serious security, integrity, availability, or core-function failure |
| Medium | 18 | Important correctness, hardening, maintainability, or product defect |
| Low | 7 | Lower-risk defects and cleanup work |
| **Total** | **45** | Best-effort exhaustive review of the supplied snapshot |

### Immediate Release Blockers

1. Move `.env`, logs, cache, SQL, source code, and audits outside the public web root.
2. Replace the fake browser login with real backend authentication.
3. Correct logout and refresh-token reuse handling.
4. Stop accepting a raw client-provided WPM value as an authoritative score.
5. Repair frontend asset paths and choose one coherent frontend architecture.
6. Replace the non-atomic rate limiter and add strict request-schema validation.
7. Fix file permissions and the database migration before deployment.

## Verification Performed

| Check | Result |
|---|---|
| PHP syntax check across all backend PHP files | Passed |
| Node syntax check across all standalone JavaScript files | Passed |
| Inline JavaScript syntax from `pages/login.html` | Passed |
| OpenAPI YAML parse | Passed |
| Local asset reference resolution | Three missing script targets confirmed |
| HTTP smoke test with the documented `php -S ... -t .` layout | Performed |
| Sensitive-file exposure test | `.env`, SQL, audit, OpenAPI, and generated log returned HTTP 200 |
| Invalid structured-input test | Array-shaped inputs caused uncaught 500 responses |
| Request-size test | 1,200,015-byte chunked JSON request bypassed the 1 MB application limit |
| Rate-limit concurrency test | 80 simultaneous attempts persisted as only 63 attempts |
| JWT claim test | A correctly signed access token with the wrong issuer and no expiration or JTI was accepted |
| Database integration test | Not completed: the audit environment did not include a MySQL server or the PDO MySQL driver |
| Browser/camera end-to-end test | Not completed: no interactive browser/camera was available in the audit environment |

## Severity Legend

- **Critical:** Directly exposes secrets, defeats authentication/session security, or makes a claimed security boundary ineffective.
- **High:** Serious security, integrity, availability, deployment, or core-product failure.
- **Medium:** Material defect that should be resolved before a reliable production release.
- **Low:** Best-practice, consistency, or limited-impact defect.

---

# Critical Issues

## C-01 — The documented server configuration publicly exposes secrets, logs, SQL, and internal files

- **Severity:** Critical
- **Status:** Confirmed by HTTP testing
- **Files:** `README.md:58-70`, `.env`, `.htaccess:6-15`, `logs/`, `cache/`, `database/`, `SECURITY_AUDIT.md`

### Problem

The README instructs operators to run:

```bash
php -S localhost:8000 -t .
```

That makes the repository root the document root. PHP’s built-in server does not process Apache `.htaccess` rules. The same structural problem applies to Nginx unless explicit deny rules are provided.

The audit reproduced all of the following as public HTTP 200 responses:

- `/.env` — 2,231 bytes
- `/database/db.sql` — 3,578 bytes
- `/database/migrate_v3_to_v31.sql` — 3,282 bytes
- `/SECURITY_AUDIT.md` — 27,196 bytes
- `/backend/openapi.yaml` — 8,271 bytes
- `/logs/error.log` — generated during testing and publicly downloadable

### Why It Matters

A production `.env` would contain database credentials and JWT signing secrets. Downloading it would permit database access and token forgery. Downloadable logs can reveal usernames, token identifiers, database errors, paths, and operational details. Relying on `.htaccess` also fails on Nginx, PHP’s built-in server, and Apache installations where overrides or compatibility modules are disabled.

### Recommended Fix

- Introduce a dedicated `public/` document root containing only static assets and a single API entry point.
- Move `.env`, PHP source, SQL, logs, cache, migrations, and internal documentation above/outside `public/`.
- Read secrets from process environment or a secret manager; do not require a web-root `.env`.
- Configure the web server to deny dotfiles and non-public extensions as defense in depth.
- Do not document `php -S -t .` as a safe server command. Supply a router script or point `-t` at `public/`.
- Rotate database and JWT secrets immediately if a populated archive has ever been shared or hosted this way.

### Verification After Fix

Every path listed above should return 404 or 403, while public HTML/assets and API routes continue to work.

---

## C-02 — Frontend authentication is fake and ignores the password

- **Severity:** Critical
- **Status:** Confirmed by code inspection
- **Files:** `pages/login.html:192-219`, `JS/login.js:1-28`, `JS/dashboard.js:11-18`, `JS/race..js:43-50`

### Problem

The login flow reads only the username, never reads or validates the password field, never calls `/login`, and creates a hard-coded mock token:

```javascript
{
  username,
  token: "jwt_frontend_mock_token_sequence"
}
```

The standalone dashboard and race guards only check whether a localStorage item exists. Any user can create that item and be treated as authenticated by the frontend.

### Why It Matters

The UI presents an “authentication gateway” and “protected connection” but performs no authentication. This is a complete bypass of the user-facing access gate and creates a dangerous false impression that the secure backend is in use.

### Recommended Fix

- Submit both username and password to the real backend `/login` endpoint.
- Treat HTTP status and the backend response as authoritative.
- Keep the access token in memory where practical; keep a refresh token in a `Secure`, `HttpOnly`, appropriately `SameSite` cookie.
- Implement logout, token refresh, registration, and session-expiry behavior against the API.
- Treat client-side route guards only as navigation/UX controls, never as a security boundary.
- Remove the mock token and all code paths that establish a session without a backend response.

---

## C-03 — Logout does not revoke the refresh token

- **Severity:** Critical
- **Status:** Confirmed by control-flow analysis
- **Files:** `backend/services/AuthService.php:213-226`, `backend/services/AuthService.php:389-399`, `backend/middleware/AuthMiddleware.php:65-70`, `backend/controllers/AuthController.php:76-81`, `backend/services/AuthService.php:292-298`

### Problem

The logout service can delete a refresh-token family only when it receives a family ID. However, access tokens are generated without a `family` claim during both login and refresh. `AuthMiddleware` therefore returns `family => null`, and `AuthController::logout()` passes `null` to the logout service. The family-deletion branch never runs.

Logout only blacklists the current access-token JTI. The refresh token remains usable until it expires and can immediately mint a new access token after “logout.”

### Why It Matters

A stolen refresh token survives user logout. Even the legitimate user can call logout and then continue the session through the refresh token. This defeats the stated session invalidation guarantee.

### Recommended Fix

Generate the family ID before the access token and include it in the access token:

```php
$familyId = bin2hex(random_bytes(16));
$accessToken = JWT::encode([
    'sub' => $userId,
    'username' => $usernameUpper,
    'type' => 'access',
    'family' => $familyId,
]);
```

Do the same when rotating tokens. Alternatively, require the refresh token at logout and revoke it explicitly. Add a separate “logout all sessions” operation that removes all families for the user.

### Required Test

1. Login and retain both tokens.
2. Logout with the access token.
3. Attempt refresh with the retained refresh token.
4. The refresh must fail and the family row must no longer exist.

---

## C-04 — Refresh-token reuse detection is bypassed by the blacklist pre-check

- **Severity:** Critical
- **Status:** Confirmed by control-flow analysis
- **Files:** `backend/middleware/AuthMiddleware.php:98-113`, `backend/services/AuthService.php:352-378`

### Problem

A used refresh token is inserted into `token_blacklist` during rotation. On reuse, `AuthMiddleware::authenticateRefresh()` sees the blacklisted JTI and exits immediately with 401. The request never reaches `AuthService::refreshToken()`, where the code that deletes all token families on JTI mismatch is located.

The advertised theft-detection behavior therefore does not run in the normal reuse scenario. The attacker’s reused token is rejected, but the legitimate current refresh token remains active.

### Why It Matters

The project claims that refresh-token reuse destroys the full token family. It currently does not. A detected replay is not escalated into session revocation, so the security response is materially weaker than documented.

### Recommended Fix

Use a single authoritative refresh-token state machine inside one database transaction. Options include:

- Do not short-circuit rotated refresh tokens in middleware. Pass verified claims to the service and let the service determine whether the JTI is current, rotated, expired, or revoked.
- Or, when middleware detects a blacklisted refresh JTI, use its verified `sub` and `family` claims to revoke the family before responding.
- Store explicit refresh-token status/replacement information rather than relying on a generic blacklist alone.
- Add replay tests proving that reuse revokes the active replacement token.

---

# High-Priority Issues

## H-01 — The server accepts an arbitrary client-provided WPM as an authoritative score

- **Severity:** High
- **Status:** Confirmed
- **Files:** `backend/controllers/UserController.php:44-53`, `backend/services/UserService.php:45-60`, `JS/race..js:212-245`, `pages/login.html:417-475`

### Problem

An authenticated client can submit any integer from 1 through 1000. The backend has no race session, start time, duration, event count, challenge ID, nonce, proof, or plausibility check beyond the numeric maximum. The current frontend does not call the endpoint at all; it writes a mutable score directly to localStorage.

### Why It Matters

Any authenticated user can submit `1000` WPM without playing and permanently place that value on the leaderboard. Authentication establishes identity, not score validity.

### Recommended Fix

- Create a server-issued race session with a random ID, allowed duration, start/deadline, and challenge content or seed.
- Submit race telemetry/results against that session and validate elapsed time and event totals.
- Store immutable race records and derive each user’s best score server-side.
- Rate-limit and make score submission idempotent.
- Apply anomaly detection and moderation for impossible or suspicious scores.
- Do not claim strong anti-cheat from client-only code; a determined user controls the browser.

---

## H-02 — Required secrets are empty and the health endpoint reports a false healthy state

- **Severity:** High
- **Status:** Confirmed
- **Files:** `.env:10,17-18`, `backend/utils/JWT.php:187-213`, `backend/index.php:36-43`, `backend/utils/Database.php:13-30`

### Problem

The supplied configuration has an empty database password, empty `JWT_SECRET`, and empty `JWT_REFRESH_SECRET`. `JWT::getSecret()` throws at request time, so successful authentication cannot issue tokens. The health endpoint checks neither critical configuration nor database connectivity and returned HTTP 200 during the audit even though JWT secrets were empty and no PDO MySQL driver/database was available.

### Why It Matters

Monitoring and load balancers can route traffic to an instance that cannot authenticate users or access the database. An empty database password is unsafe outside a tightly isolated local environment.

### Recommended Fix

- Validate all required configuration at process startup and fail fast.
- Require two different, high-entropy JWT secrets; do not permit an implicit fallback in production.
- Use a dedicated least-privilege database account with a strong secret.
- Split health into liveness and readiness. Readiness should verify required config, the PDO MySQL driver, a database query, writable operational directories, and migration/schema version.
- Return only a generic unhealthy response publicly; log diagnostic detail internally.

---

## H-03 — Frontend script paths are broken and the project contains two conflicting frontend architectures

- **Severity:** High
- **Status:** Confirmed by file resolution and HTTP 404 tests
- **Files:** `pages/dashboard.html:38`, `pages/race.html:81`, `pages/login.html:127-131`, `JS/dashboard.js`, `JS/race..js`, `JS/login.js`

### Problem

The pages request scripts that do not exist at their resolved paths:

| Page reference | Resolved target | Actual file | Result |
|---|---|---|---|
| `dashboard.js` | `pages/dashboard.js` | `JS/dashboard.js` | 404 |
| `race.js` | `pages/race.js` | `JS/race..js` | 404 |
| `script.js` | `pages/script.js` | No such file | 404 |

`pages/login.html` also contains a second, all-in-one application script after the closing `</html>` tag, while the standalone `JS/login.js`, `JS/dashboard.js`, and `JS/race..js` implement a different multi-page flow.

### Why It Matters

The dashboard and race pages do not load their application logic. The duplicate architectures drift independently and make it unclear which code is authoritative.

### Recommended Fix

Choose one architecture:

- **Multi-page:** rename `race..js` to `race.js`, reference scripts as `../JS/login.js`, `../JS/dashboard.js`, and `../JS/race.js`, and remove the duplicate inline application.
- **Single-page:** move the inline script into a versioned module, remove unused pages/scripts, and use a router/state model.

Keep all scripts inside valid HTML structure, enable automated broken-reference checks, and return a clean console with no 404s.

---

## H-04 — The core ASL recognition feature is not implemented

- **Severity:** High
- **Status:** Confirmed
- **Files:** `JS/race..js:59-99`, `JS/race..js:176-210`, `JS/race..js:258-261`, `pages/login.html:238-292`, `pages/login.html:377-415`, `pages/login.html:497-506`

### Problem

MediaPipe detects and draws hand landmarks, but no classifier maps landmarks to an ASL letter. Progress is triggered only by keyboard events that call `checkSign(event.key)`.

### Why It Matters

The product is described as an ASL/fingerspelling racer, but the camera currently supplies visualization only. “TRACKING ACTIVE” can be mistaken for successful recognition even though no sign classification occurs.

### Recommended Fix

- Implement or integrate a tested fingerspelling classifier.
- Separate hand detection, feature extraction, classification, confidence smoothing, and game-state transitions.
- Require confidence and temporal stability thresholds before accepting a letter.
- Add a calibration flow, left/right-hand handling, lighting guidance, and an accessible non-camera mode.
- Label keyboard input explicitly as a development/testing mode and prevent its scores from entering production leaderboards.
- Build a representative accuracy test set and report per-letter confusion/false-positive rates.

---

## H-05 — User-controlled array inputs cause uncaught TypeErrors and HTTP 500 responses

- **Severity:** High
- **Status:** Confirmed by HTTP testing
- **Files:** `backend/index.php:46-50`, `backend/controllers/AuthController.php:27-39`, `backend/controllers/UserController.php:20-33`, `backend/controllers/LeaderboardController.php:17-26`, typed service signatures throughout

### Problem

The controllers pull values directly from decoded JSON or query parameters and pass them into methods typed as `string`. JSON objects such as `{"username":["abc"]}` and query strings such as `?username[]=abc` produce an array, causing an uncaught `TypeError`.

The audit reproduced HTTP 500 for:

- `POST /validate` with an array username
- `POST /register` with an array username
- `GET /check?username[]=abc`
- `GET /leaderboard?scope[]=global`

### Why It Matters

Any unauthenticated client can trigger internal errors. Without a production-safe global handler, deployments may leak stack traces and filesystem paths. Repeated errors also create log and availability pressure.

### Recommended Fix

Create one strict request parser that:

- Uses `JSON_THROW_ON_ERROR`.
- Requires a JSON object, not a scalar or list.
- Validates each field’s exact type before calling domain code.
- Rejects unknown fields where appropriate.
- Validates query parameters as scalar strings before casting.

Add a top-level `catch (Throwable $e)` that logs a request ID and returns a generic JSON 500 without internal details.

---

## H-06 — Authentication database failures leak raw internals and return incorrect HTTP statuses

- **Severity:** High
- **Status:** Confirmed by HTTP testing
- **Files:** `backend/utils/Database.php:47-49`, `backend/services/AuthService.php:91-96`, `backend/services/AuthService.php:268-273`, `backend/services/AuthService.php:306-311`, `backend/services/AuthService.php:430-435`, `backend/controllers/AuthController.php:41-45`, `backend/controllers/AuthController.php:63-69`

### Problem

In a `PDOException` handler, the service calls `Database::inTransaction()`. That method calls `getConnection()` and can throw a second connection exception. The replacement exception escapes before the generic logging/message code runs.

The audit reproduced raw `could not find driver` messages in JSON. Login returned that infrastructure failure as 401 Unauthorized; registration returned it as 409 Conflict.

Non-PDO failures after a transaction starts—such as missing JWT configuration—are also not guaranteed to roll back.

### Why It Matters

Internal database messages can reveal driver, host, authentication, or schema details. Incorrect status codes hide outages from monitoring and clients. Open transactions can hold locks until request teardown.

### Recommended Fix

- Keep the local PDO variable nullable and only call `$db->inTransaction()` when a connection was actually created.
- Make `Database::inTransaction()` inspect an existing connection without creating one.
- Roll back in a broad `catch (Throwable $e)` or `finally` block when appropriate.
- Translate only known domain exceptions into 400/401/409 responses.
- Return a generic 500/503 for infrastructure failures and log the original exception internally.

---

## H-07 — The file rate limiter is not atomic and loses concurrent attempts

- **Severity:** High
- **Status:** Confirmed by concurrency testing
- **Files:** `backend/middleware/RateLimitMiddleware.php:48-69`, `backend/middleware/RateLimitMiddleware.php:128-164`

### Problem

The limiter performs read, filter, append, and write as separate operations. `LOCK_EX` is applied only to a randomly named temporary file. It does not lock the canonical counter during the read-modify-write sequence.

In an audit harness, 80 concurrent calls for the same identifier/action completed successfully, but the persisted rate file contained only 63 attempts. Seventeen attempts were lost.

The write path also silently returns on failure, which is a fail-open behavior despite comments claiming fail-closed behavior.

### Why It Matters

Parallel brute-force or abusive traffic can exceed configured limits. The weakness is most relevant exactly when the limiter is under concurrency pressure.

### Recommended Fix

Use an atomic shared store such as Redis (`INCR`/expiry or a Lua script), a database counter with transactional locking, or a managed gateway limiter. If file storage is retained temporarily, hold `flock()` on one stable lock file for the full read-check-update-write operation. Define and monitor a deliberate failure policy rather than silently allowing traffic.

---

## H-08 — The application request-size limit is bypassable with chunked bodies

- **Severity:** High
- **Status:** Confirmed by HTTP testing
- **Files:** `backend/middleware/SecurityMiddleware.php:58-64`, `backend/index.php:48`, `backend/controllers/AuthController.php:29,53`, `backend/controllers/UserController.php:48`

### Problem

The middleware checks only `$_SERVER['CONTENT_LENGTH']`. A chunked request can omit that value. The endpoint then reads the complete unbounded `php://input` body.

The audit sent a 1,200,015-byte chunked JSON request while `MAX_REQUEST_SIZE` was 1,048,576 bytes. The server processed it and returned a normal validation error instead of 413.

### Why It Matters

Attackers can consume worker memory, CPU, bandwidth, JSON parsing time, and logs with oversized requests despite the advertised limit.

### Recommended Fix

- Enforce limits at the reverse proxy/web server (`client_max_body_size`, Apache request limits, gateway limits).
- Configure appropriate PHP limits.
- Read the body through a bounded stream and stop once the maximum plus one byte is reached.
- Reject missing/invalid length metadata where the server cannot guarantee a transport-level cap.
- Add tests for fixed-length, chunked, compressed, and malformed bodies.

---

## H-09 — Refresh-token rotation is vulnerable to concurrent use

- **Severity:** High
- **Status:** Confirmed by static transaction analysis
- **Files:** `backend/services/AuthService.php:323-415`

### Problem

The refresh service selects the current family JTI without `FOR UPDATE` and later updates the row. Two simultaneous requests using the same refresh token can both read the same current JTI, both pass validation, and both issue replacement tokens. The last update wins, making the other response’s refresh token immediately invalid. Its later use can trigger mass session invalidation.

### Why It Matters

Normal client retries, mobile network duplication, or deliberate parallel requests can create false theft alerts, invalidate legitimate sessions, or produce inconsistent token pairs.

### Recommended Fix

- Lock the family row using `SELECT ... FOR UPDATE` inside the transaction.
- Or perform a compare-and-swap update such as `UPDATE ... SET jti=:new WHERE ... AND jti=:old`, then require exactly one affected row.
- Issue/return tokens only after the state transition is known to have succeeded.
- Add a concurrency test proving only one refresh succeeds and the other follows the intended replay policy.

---

## H-10 — Account lockout updates are concurrency-unsafe, while the IP limiter counts successful attempts

- **Severity:** High
- **Status:** Confirmed by static analysis
- **Files:** `backend/services/AuthService.php:133-184`, `backend/controllers/AuthController.php:57-61`, `backend/middleware/RateLimitMiddleware.php:52-69`

### Problem

Failed-login state is read and then written without locking the user row. Concurrent failures can read the same `failed_logins` value and overwrite one another, delaying or bypassing the threshold.

Separately, the IP rate limiter records an attempt before authentication and never removes it on success. Five total login requests—including valid logins—can block an IP for the configured window. Shared offices, schools, homes, and carrier NAT users can affect one another.

### Why It Matters

The account lockout is weaker under parallel attack, while legitimate users can be denied service by normal successful use or traffic from another user sharing an address.

### Recommended Fix

- Use a row lock or one atomic SQL update for failed-login counters.
- Track failures rather than all requests for the strict login-failure bucket, while retaining a separate broad request-rate bucket.
- Reset or expire counters deliberately after success.
- Combine IP, account, and device/risk signals; avoid a simple lockout that lets attackers repeatedly deny service to known users.
- Add concurrency and shared-NAT tests.

---

## H-11 — Unbounded leaderboard pages can exhaust database and disk resources

- **Severity:** High
- **Status:** Confirmed by static analysis
- **Files:** `backend/controllers/LeaderboardController.php:18-26`, `backend/utils/Validator.php:182-186`, `backend/services/LeaderboardService.php:27-40`, `backend/services/LeaderboardService.php:92-164`

### Problem

`page` has no upper bound. Every unique `(scope, page, limit)` can trigger a `COUNT(*)`, a large `OFFSET` query, and a new persistent cache file. Expired or one-off cache files are not globally purged. The public endpoint has no rate limit.

An attacker can request millions of distinct high page numbers, generating expensive offset scans and an unbounded number of cache files—even when every result page is empty. Extremely large page arithmetic can also overflow or produce invalid offsets.

### Why It Matters

This creates both database-amplification and disk-exhaustion paths through an unauthenticated endpoint.

### Recommended Fix

- Cap page and offset based on a safe maximum and the actual result count.
- Prefer cursor/keyset pagination over large offsets.
- Do not cache invalid, out-of-range, or empty high pages.
- Add endpoint rate limits and cache quotas/eviction.
- Put cache outside the web root and use a managed cache where possible.
- Invalidate or version cache entries after score changes.

---

## H-12 — Static pages lack security headers, and the API policy would break the frontend if applied globally

- **Severity:** High
- **Status:** Confirmed by HTTP testing and policy comparison
- **Files:** `backend/middleware/SecurityMiddleware.php:19-54`, `.htaccess:18-34`, `pages/login.html:7,21,123-131`, `pages/dashboard.html:7,19-26,38`, `pages/race.html:7,67-81`

### Problem

Security headers are emitted only by the PHP API middleware. Static HTML responses from the documented server contained none of the CSP, frame, referrer, permissions, or HSTS headers.

The current API policy is also incompatible with the frontend:

- `script-src 'self'` blocks the jsDelivr MediaPipe scripts.
- Inline `onclick` handlers and the inline login script are blocked without nonces/hashes.
- Google Fonts is not permitted by the current source directives.
- `Permissions-Policy: camera=()` would disable the core camera feature if applied to the race page.
- `connect-src 'self'` can block MediaPipe model/WASM fetches from the CDN.

### Why It Matters

The browser-facing attack surface is not protected, while copying the existing API header policy to HTML would make the application fail.

### Recommended Fix

- Set browser security headers at the web-server layer for static and dynamic responses.
- Build a route-specific CSP based on local, pinned assets.
- Remove inline handlers/scripts or use nonces/hashes.
- Use a deliberate camera policy such as `camera=(self)` only on pages that require it.
- Enable HTTPS redirects and HSTS for the entire origin after HTTPS is verified.
- Test headers and functionality in an actual browser as part of CI.

---

## H-13 — The supplied archive marks project code and directories as world-writable

- **Severity:** High
- **Status:** Confirmed from ZIP metadata
- **Files:** Entire archive, including `.env`, PHP source, JavaScript, SQL, logs, and cache

### Problem

The ZIP records regular files as mode `0666` and directories as `0777` in almost every case. The extracted `.env` was world-readable and world-writable. The code files were also world-writable.

### Why It Matters

On a multi-user host or after compromise of any local service account, another process can alter PHP/JavaScript, replace configuration, poison logs/cache, or introduce server-side code execution. Writable source also makes integrity monitoring unreliable.

### Recommended Fix

- Package source files as `0644` or more restrictive and directories as `0755`.
- Set `.env` to `0600` or `0640` with a dedicated group.
- Make only operational directories writable by the application user, preferably `0750`/`0770` with controlled ownership.
- Keep application source read-only at runtime.
- Add deployment checks that fail when code or secret files are group/world-writable.

---

## H-14 — The v3-to-v3.1 migration is not reliably executable

- **Severity:** High
- **Status:** Confirmed in the supplied SQL; some compatibility impact depends on the target MySQL build
- **Files:** `database/migrate_v3_to_v31.sql:10-27`, `database/migrate_v3_to_v31.sql:63-74`, `README.md:28-30,53-56`

### Problem

The migration defines a multi-statement event body with `BEGIN ... END` but does not change the client delimiter. The fresh schema correctly uses `DELIMITER //`; the migration does not. When run through the documented MySQL CLI workflow, the inner semicolons can terminate the statement early.

It also:

- Executes `SET GLOBAL event_scheduler = ON`, requiring elevated server privileges and conflicting with least-privilege deployment.
- Requires event-creation privileges often unavailable on managed/shared databases.
- Unconditionally updates legacy `token` and `token_expires` columns.
- Uses `ADD COLUMN IF NOT EXISTS` and `ADD INDEX IF NOT EXISTS` while documentation broadly promises MySQL 5.7; exact compatibility is not checked or enforced.
- Has no schema-version table, preflight checks, rollback plan, or verification query.

### Why It Matters

A production upgrade can fail partway through after DDL has auto-committed, leaving an unclear partial state. Operators may need dangerous global privileges just to run the application migration.

### Recommended Fix

- Add correct delimiter handling or avoid a compound event body.
- Remove `SET GLOBAL` from application migrations; document scheduler configuration separately.
- Provide a cleanup command/cron path that does not require events.
- Detect legacy columns before referencing them.
- Pin and test against explicit database versions in CI.
- Add a migration history table, idempotency checks, post-migration verification, backup instructions, and a recovery plan.

---

## H-15 — Configuration handling requires a `.env` file in the repository web root and ignores process environment

- **Severity:** High
- **Status:** Confirmed
- **Files:** `backend/config/Config.php:12-37`, `backend/utils/Database.php:15-23`, `backend/utils/JWT.php:187-213`

### Problem

`Config::load()` always reads one fixed `.env` path and throws if the file is absent. It does not prefer `getenv()`, `$_ENV`, injected secrets, or a path outside the repository. The parser is also a minimal custom parser that trims values and lacks standard quoting/escaping behavior.

### Why It Matters

The design pushes secrets into the same deployable tree that is being served publicly. It prevents normal container, platform, and secret-manager practices and increases the chance of accidentally packaging or publishing credentials.

### Recommended Fix

- Prefer process environment/injected secrets.
- Allow an explicitly configured environment-file path outside the document root for local development only.
- Use a maintained configuration library or a small well-tested parser.
- Validate types, ranges, required keys, secret difference/entropy, URLs, origins, and CIDR values at startup.
- Never place production secret files inside the public/repository tree.

---

## H-16 — The pre-existing security audit provides false release assurance

- **Severity:** High
- **Status:** Confirmed by comparison with current code and tests
- **Files:** `SECURITY_AUDIT.md:9-11`, `SECURITY_AUDIT.md:430`, `SECURITY_AUDIT.md:434-523`, `SECURITY_AUDIT.md:560-604`

### Problem

The existing report says every backend file was reviewed/hardened and lists several issues as fixed, but the current snapshot still contains material defects:

- The file rate-limit race is marked fixed, yet concurrency testing lost 17 of 80 attempts.
- Empty database credentials are marked fixed, while `DB_PASS` remains empty.
- File protection is marked fixed, while the documented server exposes `.env`, SQL, and logs.
- The report claims no third-party dependencies/supply-chain risk, while the frontend loads Google Fonts and multiple unpinned MediaPipe scripts from CDNs.
- It acknowledges that the frontend does not use the backend, which contradicts an overall “hardened application” conclusion.
- It does not identify the logout family bug, refresh replay short-circuit, malformed-input 500s, request-size bypass, or cache DoS.

### Why It Matters

Release decisions based on this document can approve a system whose key security guarantees are not true. Security documentation that overstates coverage is itself an operational risk.

### Recommended Fix

Replace it with a versioned, evidence-based report tied to a commit or artifact hash. Separate fixed, open, accepted, and unverified findings. Require regression tests for every claimed fix and prevent release when critical/high findings remain open.

---
# Medium-Priority Issues

## M-01 - JWT claim validation is incomplete

- **Severity:** Medium
- **Status:** Confirmed by code inspection and a signed-token test
- **Files:** `backend/utils/JWT.php:39-54,71-86,96-142`, `backend/middleware/AuthMiddleware.php:43-70`

### Problem

The decoder validates the HMAC signature, algorithm, and any `exp` or `nbf` values that happen to be present. It does not require `exp`, `iat`, `nbf`, or `jti`; it does not validate the configured issuer; and it has no audience check. The access-token middleware only requires `type=access` and a non-empty `sub`. An empty JTI skips the blacklist check.

A correctly signed token with a different issuer and no expiration or JTI was accepted during testing.

### Why It Matters

A token signed with the same key for another environment or service can be accepted here, and a signed token without an expiration can remain usable indefinitely. Missing JTI values also bypass logout revocation.

### Recommended Fix

Use a maintained JWT library and enforce a strict claim contract: expected algorithm, exact issuer, expected audience, non-empty subject, non-empty JTI, token type, issued-at, not-before, and expiration. Apply a small explicit clock-skew allowance and reject missing or wrongly typed claims.

---

## M-02 - Refresh-key separation and blacklist lifetimes are inconsistent with configuration

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/utils/JWT.php:187-213`, `backend/services/AuthService.php:285-290,373-378`

### Problem

When `JWT_REFRESH_SECRET` is absent, the refresh key is deterministically derived from the access-token secret. This is not independent key separation. Logout then blacklists access JTIs for a hard-coded 24 hours, and refresh rotation blacklists refresh JTIs for a hard-coded seven days, regardless of the configured token expiration or the actual token `exp` claim.

### Why It Matters

Compromise of the access secret also reveals the refresh secret derivation. If configured token lifetimes exceed the hard-coded blacklist periods, a revoked token can become acceptable again before its signature expires. Shorter configured lifetimes leave unnecessary blacklist rows.

### Recommended Fix

Require two independently generated secrets or asymmetric keys. Store each revoked token's exact expiration from its validated payload, and purge the row only after that time. Reject startup when the keys are absent, equal, weak, or known placeholder values.

---

## M-03 - Protected requests are not tied to current account state

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/middleware/AuthMiddleware.php:43-70`, `backend/services/UserService.php:53-65`, `database/db.sql:12-28`

### Problem

Authentication trusts identity claims from a valid token and does not load the current user record. There is no active/disabled status or token-version field. A user deleted, suspended, renamed, or forced through a credential reset would continue to be represented by an access token until it expires unless every JTI is separately known and blacklisted.

The score update also reports success even when the token subject no longer maps to a user because the update row count is not checked.

### Why It Matters

Administrative account changes and security responses do not take effect promptly. Stale identity data can also be used throughout the token lifetime.

### Recommended Fix

Add an account status and a monotonically increasing session/token version. Include the version in tokens and compare it with the current user record on protected requests, or use a server-side session store. Reject missing, deleted, disabled, or version-mismatched accounts.

---

## M-04 - Score input is coercive and score-update responses are misleading

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/controllers/UserController.php:44-58`, `backend/services/UserService.php:45-69`

### Problem

The controller casts `wpm` with `(int)` instead of requiring a JSON integer. Strings, booleans, and floating-point values can be silently converted or truncated. The service does not check whether the user exists, whether any row changed, or whether the submitted score actually exceeded the previous best. It always logs "Score updated" and returns success.

### Why It Matters

Clients cannot distinguish a valid improvement from a no-op or a missing account. Coercion also makes the API contract unpredictable and can turn malformed payloads into accepted values.

### Recommended Fix

Validate the decoded body against an explicit schema and require `wpm` to be an integer in range. Use an update that returns or separately reads the prior/current score, check `rowCount()` or user existence, and return an accurate result such as `improved`, `previous_best`, and `best_wpm`.

---

## M-05 - Leaderboard cache is not invalidated after score changes

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/services/UserService.php:45-69`, `backend/services/LeaderboardService.php:36-42,77-80,166-183`

### Problem

`LeaderboardService::invalidateCache()` exists but is never called from score updates. Cached pages therefore remain stale for the full TTL after a new best score. The method's optional `$scope` parameter is also ignored and clears every scope.

### Why It Matters

Users can submit a score successfully and still see an old ranking. Increasing the cache TTL for performance directly increases visible inconsistency.

### Recommended Fix

After a confirmed score improvement, invalidate only the affected scope or use a cache-version key per scope. Add an integration test that submits an improvement and immediately observes it in the leaderboard.

---

## M-06 - Leaderboard scope semantics conflict across the database, API, and frontend

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/utils/Validator.php:139-147`, `backend/controllers/AuthController.php:27-40`, `database/db.sql:17,26`, `JS/dashboard.js:1-3,26-55`, `pages/dashboard.html:23-28`

### Problem

The backend accepts `global`, `local`, and `friends`. The frontend exposes `global` and `regional`. Registration lets a client select a scope, and the public leaderboard simply filters on that user-controlled category. There is no friend relationship, geographic region, membership rule, or authorization check behind the labels.

### Why It Matters

The same product term has different meanings depending on the layer. A supposed friends or regional leaderboard is not a trusted social or geographic view; it is just a public bucket chosen by the user.

### Recommended Fix

Define one domain model. For example, make the global board universal, derive regional membership from a verified profile attribute, and implement friends through relationship tables and access checks. Remove client-controlled scope assignment unless it is intentionally only a cosmetic category.

---

## M-07 - Browser state parsing and leaderboard rendering are unsafe and fragile

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `JS/dashboard.js:11-18,35-55`, `JS/race..js:43-53,234-246`

### Problem

Multiple `JSON.parse(localStorage...)` calls have no error handling or shape validation. A malformed value crashes page initialization. Dashboard records are interpolated into `innerHTML`, including `record.name` and `record.score`. Those records are currently local, but any script running in the origin can write them, and a future backend integration could turn this into stored DOM XSS if server data is passed through unchanged.

### Why It Matters

Local state corruption can make the application unusable. The rendering pattern creates an avoidable injection sink and encourages unsafe handling when the leaderboard becomes server-backed.

### Recommended Fix

Wrap storage reads in a versioned parser with schema validation and safe reset behavior. Build leaderboard rows with DOM nodes and `textContent`; do not concatenate record fields into HTML. Treat localStorage as untrusted input.

---

## M-08 - Race accuracy, duration, and timer logic can produce invalid results

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `JS/race..js:43-53,101-130,176-225`, `pages/race.html:12-24`, `pages/dashboard.html:18-21`

### Problem

Automatically skipped spaces increment `correctAttempts` without incrementing `totalAttempts`. Accuracy can therefore exceed 100 percent. Race duration is loaded from localStorage with `parseInt()` and no finite/range validation, allowing negative, zero, `NaN`, or extremely large values. Timing is based on decrementing a counter with `setInterval`, so background-tab throttling and event-loop delays change the effective race duration.

For a 30-second race, the HTML initially displays 60 and is not corrected until the first timer tick, at which point it displays 29.

### Why It Matters

Displayed WPM and accuracy are not reliable measurements and can be manipulated through local state. The results should not be sent to a competitive leaderboard as authoritative data.

### Recommended Fix

Count only user attempts in both numerator and denominator, clamp displayed accuracy to a logically valid range, validate duration against a server-approved enum, and compute remaining time from a monotonic start/deadline rather than interval count. Initialize every displayed value before starting the timer.

---

## M-09 - Routing and rewrite behavior is ambiguous and creates unintended aliases

- **Severity:** Medium
- **Status:** Confirmed by HTTP testing and code inspection
- **Files:** `backend/index.php:24-32,34-101`, `.htaccess:18-20`, `backend/validation.php:1-8`

### Problem

Path normalization uses unrestricted `str_replace('/backend', '', $path)`, removing every occurrence rather than one leading base prefix. Requests such as `/backend/backend/validate` and deeper repetitions reached the same endpoint during testing.

The root rewrite maps `/api/(.*)` to `/backend/index.php` but discards the captured route, while the PHP router does not strip an `/api` prefix. Behavior therefore differs among direct PHP serving, Apache rewriting, and other web servers. The legacy `validation.php` entry point adds another route form.

### Why It Matters

Security controls, logs, caches, monitoring, and client documentation can disagree on the canonical route. Unexpected aliases complicate access-control rules and incident analysis.

### Recommended Fix

Use one front controller under a dedicated public document root. Remove exactly one configured base path, reject malformed or repeated prefixes, preserve the rewritten path explicitly, and publish one canonical URL form. Add route tests for every supported server configuration.

---
## M-10 - README, OpenAPI, and runtime behavior describe different systems

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `README.md:28-30,72-104,129-160`, `backend/openapi.yaml:1-10,66-175`, `backend/utils/Validator.php:91-124`, `backend/index.php:3-5`, `backend/services/AuthService.php:259-267`

### Problem

Material contract differences include:

- The README permits PHP 8.0, while the code uses `never` return types and string-key array unpacking, which require PHP 8.1 or newer.
- Password examples use `secure123`, which fails the backend's uppercase requirement.
- The configuration table documents `TOKEN_EXPIRY_HOURS`, while the code reads `JWT_EXPIRY_HOURS`.
- The README still lists legacy `token` and `token_expires` user columns.
- OpenAPI identifies version 3.0.0 while the runtime identifies 3.1.0.
- OpenAPI's password constraints and token response shapes do not match implementation. The implementation returns `access_token` and `refresh_token`, not one generic token.
- The documented server URL and route forms do not match every supported serving mode.

### Why It Matters

Clients generated from the specification can fail at runtime, operators can deploy an unsupported PHP version, and copied setup examples fail validation.

### Recommended Fix

Make the OpenAPI document the tested API contract. Generate examples from integration tests, validate it in CI, and update the README from the same source. Pin exact supported PHP and MySQL versions and test them in a build matrix.

---

## M-11 - Rate-limit coverage, proxy handling, and deployment model remain weak

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/controllers/AuthController.php:35-36,57-58`, `backend/controllers/UserController.php:20-27,44-58`, `backend/index.php:45-97`, `backend/middleware/RateLimitMiddleware.php:72-126,166-191`

### Problem

Only registration, login, and username availability have explicit limits. Refresh, score submission, leaderboard queries, and format validation are unlimited. File-based state is local to one application instance and cannot enforce a global limit across multiple servers or ephemeral containers.

The proxy comment says it selects the rightmost non-trusted address, but the code takes the leftmost `X-Forwarded-For` value. It supports only IPv4 CIDR math and does not walk or remove a trusted proxy chain.

### Why It Matters

Attackers can shift traffic to unprotected expensive endpoints, bypass limits across replicas, or exploit a misconfigured proxy chain to select identifiers. IPv6 clients and proxies are not handled consistently.

### Recommended Fix

Use a shared atomic store such as Redis with a documented algorithm and limits per IP, account, route, and token. Rate-limit refresh and score operations, cap leaderboard traffic, and parse standardized proxy headers only when the immediate peer is trusted. Add IPv4/IPv6 proxy-chain tests.

---

## M-12 - Authentication responses lack no-store controls and CORS responses are not cache-safe

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/utils/Response.php:25-43`, `backend/middleware/CorsMiddleware.php:15-64`, `backend/controllers/AuthController.php:51-108`

### Problem

Responses containing access and refresh tokens do not set `Cache-Control: no-store` or related protections. CORS reflects an allowed origin but does not send `Vary: Origin`, so a shared cache can reuse a response across origins. Disallowed preflight requests still receive 204 rather than an explicit rejection; only the absence of allow headers causes browser enforcement.

### Why It Matters

Tokens can be retained by browser or intermediary caches, and origin-varying responses can be cached incorrectly. Ambiguous preflight behavior also makes server-side monitoring less clear.

### Recommended Fix

Add `Cache-Control: no-store, private` and `Pragma: no-cache` to login, register where applicable, refresh, and logout responses. Add `Vary: Origin` whenever CORS depends on the request origin. Return a clear 403 for disallowed origins and preflights, and test through the actual reverse proxy/CDN configuration.

---

## M-13 - Logging has unbounded total retention and records sensitive operational identifiers

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/utils/Logger.php:11-64`, `backend/services/AuthService.php:254-257,302-305,344-366,419-422,448-450`

### Problem

The logger rotates a file after 10 MB but never limits the number or age of `.old` files, compresses them, or removes them. Total disk usage is therefore unbounded. It logs database exception text and authentication identifiers such as usernames, JTIs, and refresh-family IDs. Logging failures are generally silent.

### Why It Matters

An attacker who can trigger repeated errors can consume disk over time. The resulting files contain useful incident and authentication metadata and, in the current layout, can also be exposed by the web server.

### Recommended Fix

Send structured logs to stderr or a managed collector outside the document root. Define retention, rotation, deletion, access control, and redaction policies. Avoid logging full token identifiers unless required for an incident workflow, and alert when logging is unavailable.

---

## M-14 - Database transport, time handling, and cleanup depend on unstated infrastructure assumptions

- **Severity:** Medium
- **Status:** Confirmed by configuration/code inspection
- **Files:** `backend/utils/Database.php:13-30`, `backend/services/AuthService.php:233-250,401-415`, `database/db.sql:64-73`, `database/migrate_v3_to_v31.sql:63-74`

### Problem

The PDO connection has no TLS options and does not set a session timezone. PHP converts JWT timestamps with `date(...)`, while SQL comparisons and cleanup use MySQL `NOW()`. Different PHP and database timezone settings can shift stored expiration times. Expired rows depend largely on an event scheduler that may be disabled or unavailable.

### Why It Matters

Remote database credentials and data may be sent without verified transport security. Timezone drift can make token-family and blacklist retention differ from token claims, and disabled cleanup can grow tables indefinitely.

### Recommended Fix

Support and require verified database TLS outside local development. Standardize PHP, database, and stored timestamps on UTC and set the database session timezone explicitly. Use a least-privilege scheduled application job for cleanup and monitor its success and table growth.

---

## M-15 - There is no automated test, CI, or reproducible dependency system

- **Severity:** Medium
- **Status:** Confirmed from the supplied snapshot
- **Files:** Project-wide; `pages/login.html:123-126`, `pages/race.html:77-80`, `pages/dashboard.html:7`

### Problem

The snapshot contains no unit tests, API integration tests, browser tests, CI configuration, Composer manifest/lockfile, JavaScript package manifest/lockfile, or dependency update policy. Browser libraries and fonts are loaded from external CDNs without pinned package versions or Subresource Integrity metadata.

### Why It Matters

Regressions in authentication, migrations, routing, and concurrency are easy to reintroduce. A CDN update or compromise can alter code executed in every user's browser, and builds are not reproducible.

### Recommended Fix

Add PHPUnit or an equivalent PHP test stack, database integration tests, browser tests, and CI gates for syntax, static analysis, migrations, OpenAPI validation, and security regression cases. Vendor/bundle pinned frontend dependencies with lockfiles, or pin immutable CDN artifacts and use SRI plus a compatible CSP.

---

## M-16 - Hidden load-order coupling and static global design make the backend brittle

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/index.php:17-22`, `backend/controllers/AuthController.php:14-21`, `backend/controllers/UserController.php:44-53`, `backend/config/Config.php:8-47`, `backend/utils/Database.php:10-49`, `backend/utils/Response.php:25-50`

### Problem

`UserController` calls the global `require_auth()` function, but that function is declared in `AuthController.php`. It works only because `index.php` includes AuthController first. Direct controller tests or a different loader can fail with an undefined function. Configuration, database access, services, and response termination are static globals, making dependencies difficult to replace and state difficult to isolate between tests.

### Why It Matters

Small changes to include order can break protected endpoints. The architecture raises the cost of testing error paths, database failures, and concurrency behavior, which are exactly where many current defects occur.

### Recommended Fix

Use Composer autoloading, namespaces, explicit middleware composition, and constructor-injected interfaces for configuration, database access, clock, logging, token handling, and response generation. Remove global helper functions and make controllers return response objects rather than exiting directly.

---

## M-17 - Accessibility and mobile behavior need substantial work

- **Severity:** Medium
- **Status:** Confirmed by static inspection and contrast calculation
- **Files:** `pages/login.html:18-20`, `pages/race.html:15-41,52-67`, `style/main.css:9-30,293-314,345-395,514-535`

### Problem

Inputs rely on placeholders instead of associated labels. Dynamic timer, tracking, error, and result content is not exposed through appropriate live regions. Muted text contrast is about 3.02:1 on the main background and 2.64:1 on panels, below the usual 4.5:1 target for normal text. Flashing, blinking, shaking, and particle animations have no `prefers-reduced-motion` alternative. `overflow: hidden` and fixed `100vh` containers can clip content on small screens and mobile browser chrome.

### Why It Matters

Keyboard, screen-reader, low-vision, motion-sensitive, and mobile users may be unable to understand or operate the application reliably. Camera-dependent instructions also need a clearly supported accessible fallback.

### Recommended Fix

Add semantic labels, focus management, keyboard-visible controls, live regions, accessible error messages, and a documented non-camera input mode. Correct contrast, support reduced motion, use dynamic viewport units/min-height with scrolling, and test against WCAG 2.2 AA with automated and manual checks.

---

## M-18 - Configuration values are cast but not validated

- **Severity:** Medium
- **Status:** Confirmed
- **Files:** `backend/config/Config.php:35-47`, `.env.example:19-69`, `backend/utils/JWT.php:35-43,67-76`, `backend/middleware/RateLimitMiddleware.php:35-50`, `backend/middleware/SecurityMiddleware.php:49-64`

### Problem

`getInt()` silently casts arbitrary strings to integers, and startup does not validate ranges or relationships. Negative or zero token lifetimes, rate-limit windows, request limits, lockout values, cache TTLs, or bcrypt costs can disable controls, immediately expire tokens, generate runtime errors, or create nonsensical behavior. Origins, URLs, charsets, and trusted-proxy CIDRs are also accepted without a complete startup validation pass.

### Why It Matters

A simple deployment typo can weaken or break security controls while the application still appears to start. Failures then occur only on particular requests.

### Recommended Fix

Define a typed configuration schema with required keys, environment-specific defaults, minimum/maximum values, URL/origin/CIDR parsing, and cross-field checks. Validate once at startup and refuse to serve traffic with a concise non-secret error report.

---

# Low-Priority Issues

## L-01 - Input cleaning mutates values instead of rejecting invalid input

- **Severity:** Low
- **Status:** Confirmed
- **Files:** `backend/utils/Validator.php:31-50,149-177`, `backend/index.php:45-60`, `backend/services/UserService.php:20-25`

### Problem

`clean()` strips tags, null bytes, and surrounding whitespace before validation. Invalid input can therefore be transformed into a different valid identifier rather than rejected. The later dangerous-character check often cannot see content already removed by `clean()`.

### Why It Matters

Mutation creates surprising account names and possible collisions between what a user submitted and what the server stores or checks.

### Recommended Fix

Normalize only well-defined properties, such as Unicode form or intentionally allowed surrounding whitespace, and then validate the original logical value. Reject forbidden characters instead of silently deleting them.

---

## L-02 - Leaderboard tie ordering is nondeterministic

- **Severity:** Low
- **Status:** Confirmed
- **Files:** `backend/services/LeaderboardService.php:53-65`, `JS/dashboard.js:49-55`, `JS/race..js:241-243`

### Problem

The database orders only by `best_wpm DESC`; equal scores have no stable secondary order. The local board similarly sorts only by score. Entries can move between pages or change rank between requests when scores tie.

### Why It Matters

Users can see inconsistent ranks and duplicate or missing-looking entries while moving through paginated results.

### Recommended Fix

Define the product's tie rule and add deterministic secondary keys, such as achievement timestamp and user ID. Use the same rule in the API and any client-side preview.

---

## L-03 - Cache comments and APIs do not match implementation

- **Severity:** Low
- **Status:** Confirmed
- **Files:** `backend/services/LeaderboardService.php:8-12,157-183`

### Problem

Comments say cache files use a `.php` extension, but the implementation writes `.cache`. `invalidateCache(?string $scope)` accepts a scope but always clears all cache files. These mismatches make maintenance and security review harder.

### Why It Matters

Operators and future reviewers can make incorrect assumptions about exposure, cleanup, and the blast radius of invalidation.

### Recommended Fix

Correct the comments and either implement scoped invalidation or remove the unused parameter. Keep cache storage outside the public tree regardless of extension.

---

## L-04 - Small frontend defects reduce polish and can leak globals

- **Severity:** Low
- **Status:** Confirmed
- **Files:** `JS/race..js:101-130,263-277`, `pages/race.html:15-17`

### Problem

The particle code assigns `zIndex = '1000'` rather than `component.style.zIndex`, creating or modifying a global variable in non-strict mode. The timer starts from hard-coded HTML text rather than the selected duration, causing the 30-second display error noted above.

### Why It Matters

Implicit globals can collide with later code, and the incorrect initial timer makes the selected mode appear unreliable.

### Recommended Fix

Enable JavaScript strict mode or modules, use linting with no-implicit-globals, assign the element style correctly, and render all initial state from JavaScript before play starts.

---

## L-05 - HTTP method semantics and some headers are outdated or imprecise

- **Severity:** Low
- **Status:** Confirmed
- **Files:** `backend/middleware/SecurityMiddleware.php:27-34,67-74`, `backend/index.php:34-101`, `backend/middleware/CorsMiddleware.php:56-58`

### Problem

The global allowlist permits DELETE even though no DELETE route exists. A known path with the wrong method generally falls through to 404 instead of returning 405 with an `Allow` header. `X-XSS-Protection` is obsolete in modern browsers and is not a substitute for output safety and CSP.

### Why It Matters

Imprecise semantics complicate clients, monitoring, and security policy, while obsolete headers can create false confidence.

### Recommended Fix

Define methods per route, return standards-consistent 405 responses, remove unused methods from CORS, and remove the obsolete XSS-filter header after verifying the intended browser support policy.

---

## L-06 - Health and server responses expose unnecessary version details

- **Severity:** Low
- **Status:** Confirmed by HTTP testing
- **Files:** `backend/index.php:36-43`, `.htaccess:25-35`

### Problem

The public health response returns the exact application version and current timestamp. Under the documented PHP built-in server, responses also included `X-Powered-By` because the Apache-only `mod_php` directive does not apply.

### Why It Matters

The information modestly improves technology fingerprinting and reveals details that a public liveness endpoint does not need.

### Recommended Fix

Use a minimal liveness response for public checks, keep detailed build metadata on an authenticated/internal diagnostics endpoint, disable PHP version exposure in the actual runtime configuration, and verify headers at the reverse proxy boundary.

---

## L-07 - Stale comments and a placeholder license create avoidable ambiguity

- **Severity:** Low
- **Status:** Confirmed
- **Files:** `README.md:21,113-127,194-196`, `backend/utils/Response.php:3-14`, `backend/middleware/RateLimitMiddleware.php:8-13,84-91`

### Problem

The README says `.env` is not committed even though it is in the supplied archive, and it describes controls more strongly than the implementation supports. The response utility incorrectly implies that unescaped Unicode itself creates XSS risk. Rate-limit comments claim atomic race protection and rightmost proxy selection that the code does not perform. The project license remains `[Your License Here]`.

### Why It Matters

Misleading comments can survive code review and drive unsafe operational decisions. A missing license also leaves reuse and contribution rights unclear.

### Recommended Fix

Treat comments and documentation as testable assertions, remove inaccurate security explanations, and add an actual license before distribution or external contribution.

---
# What Is Working Well

The supplied code is not uniformly poor. Several choices provide a useful foundation once the release-blocking defects are corrected:

- Reviewed database query paths use PDO prepared statements and bound parameters; no obvious user-controlled SQL concatenation was found.
- Passwords are hashed with bcrypt and checked with `password_verify()`.
- JWT signatures use HMAC-SHA256, an algorithm allowlist, strict comparison, and `hash_equals()`.
- Username, display-name, password, scope, and WPM rules are centralized rather than duplicated across every service.
- The database schema uses foreign keys and unique indexes for token identifiers and refresh families.
- API responses are consistently JSON-encoded with HTML-sensitive characters escaped.
- JSON content type is required on the main body-bearing endpoints.
- The leaderboard cache writes a temporary file before rename, which reduces partial-file corruption for an individual cache entry.
- No use of `eval`, shell execution, unsafe deserialization, XML entity parsing, or file-upload handling was found in the supplied backend.
- All supplied PHP files passed syntax checking, all standalone JavaScript files passed Node syntax checking, the large inline script parsed, and the OpenAPI YAML document parsed successfully.

These strengths should be preserved while replacing the custom session, configuration, and file-based concurrency mechanisms.

---

# Recommended Fix Order

## Phase 0 - Contain exposure before any further deployment

1. Create a dedicated `public/` directory and make it the only document root.
2. Move PHP source, `.env`, SQL, migrations, logs, cache, OpenAPI, and audit files outside it.
3. Replace repository `.env` loading with injected secrets and rotate any credentials or signing keys that may have been exposed.
4. Repackage the project with regular files at `0640` or stricter, executable directories at `0750` or stricter, and no world-writable project content.
5. Remove the existing inaccurate security attestation from release materials or mark it superseded.

**Exit criteria:** Direct requests for every sensitive path return 403/404 in all supported server modes, the application starts without a web-root secret file, and a deployment permission check finds no group/world-writable source or secret files.

## Phase 1 - Rebuild authentication and session guarantees

1. Integrate the frontend with real registration/login/refresh/logout endpoints; delete mock-token code.
2. Adopt a maintained JWT or session library and enforce issuer, audience, expiration, issued-at, not-before, JTI, subject, and token-type claims.
3. Use independent keys and a safe key-rotation process.
4. Make refresh rotation atomic with row locking or a compare-and-swap update. Design replay detection so an old refresh token revokes the active family rather than being rejected before detection.
5. Ensure logout revokes the refresh family. A secure HttpOnly refresh cookie plus server-side family record is preferable to relying on a family claim in the access token.
6. Make account lockout updates atomic and do not count successful logins as failed-attempt traffic.
7. Tie tokens to current account status/session version and add no-store response headers.

**Exit criteria:** Passwords are actually verified; fabricated localStorage state grants no backend access; logout makes both access and refresh credentials unusable; one of two simultaneous refreshes succeeds and the replay response follows the documented family-revocation policy; wrong-issuer, missing-expiration, and missing-JTI tokens are rejected.

## Phase 2 - Establish trustworthy game and score behavior

1. Decide whether the product is a local practice game or a competitive service. Do not mix those trust models.
2. Implement actual ASL classification and validation, or clearly relabel the current feature as hand-landmark visualization with keyboard input.
3. Isolate developer keyboard override so it cannot submit ranked scores.
4. Introduce a server-issued race session/challenge, allowed duration, start/deadline, and one-time score submission. Validate event counts, duration, accuracy, and plausible WPM server-side. For high-integrity competition, browser-only telemetry is not sufficient by itself; define an explicit anti-cheat model.
5. Correct accuracy, timing, duration, and result calculations.
6. Connect score submission and leaderboard retrieval to the backend and use one scope model.

**Exit criteria:** Ranked scores cannot be created by posting an arbitrary WPM number, a client cannot choose an unsupported duration or submit twice, accuracy cannot exceed 100 percent, and keyboard testing cannot affect production rankings.

## Phase 3 - Make the API robust under malformed and concurrent traffic

1. Add typed request DTO/schema validation before controllers call services.
2. Add one global exception handler that maps validation, authentication, conflict, dependency, and internal failures to stable status codes without leaking dependency messages.
3. Enforce body size at the reverse proxy/web server and verify decoded-body size as a secondary control.
4. Replace file rate limiting with a shared atomic store and cover login, registration, refresh, validation, username checks, score, and leaderboard routes.
5. Set a maximum leaderboard page/offset, prefer cursor pagination, rate-limit it, and bound cache cardinality and disk usage.
6. Invalidate leaderboard cache after a real score improvement.
7. Canonicalize routing and return correct 405 responses for known paths.

**Exit criteria:** Array/object type confusion returns a structured 400 response; oversized fixed-length and chunked bodies return 413; concurrent rate-limit tests do not lose updates; arbitrary page values cannot create unbounded files or expensive offsets; dependency failures return non-secret 5xx responses.

## Phase 4 - Stabilize database and production operations

1. Replace the ad hoc migration with a versioned migration tool and test both fresh install and upgrade paths against every supported MySQL version.
2. Remove global server-setting changes from migrations and provide a least-privilege cleanup job.
3. Require database TLS outside local development and standardize all application/database timestamps on UTC.
4. Move logs and caches outside the document root, use bounded retention, and monitor cleanup failures and disk consumption.
5. Supply tested Apache/Nginx/PHP-FPM configurations and a safe local-development router.
6. Add startup health/readiness checks that verify required extensions, configuration, database connectivity, writable private directories, and migration level without exposing secret details publicly.

**Exit criteria:** Fresh and upgrade migrations pass in CI and staging, the production database user needs no global privileges, TLS/timezone checks pass, and cleanup/retention behavior is monitored.

## Phase 5 - Add quality controls and align the product surface

1. Add unit, database integration, HTTP, concurrency, and browser tests.
2. Add CI for PHP version compatibility, static analysis, linting, tests, migration checks, OpenAPI validation, secret scanning, and dependency review.
3. Pin dependencies and make builds reproducible.
4. Reconcile README, OpenAPI, examples, route paths, response schemas, supported versions, and security claims.
5. Resolve labels, contrast, live regions, focus behavior, reduced motion, responsive scrolling, and non-camera operation.
6. Add an actual project license.

**Exit criteria:** Documentation examples pass automatically, the OpenAPI contract matches observed responses, critical security regressions have tests, and accessibility testing meets the chosen release standard.

---

# Minimum Regression Test Set

| Area | Required regression case | Expected result |
|---|---|---|
| Public files | Request `.env`, SQL, logs, cache, source, OpenAPI, and audits | 403 or 404 in every supported server mode |
| Login | Correct username with wrong password | 401; no session created |
| Browser guard | Fabricated localStorage session | No authenticated API access |
| JWT claims | Wrong issuer, wrong audience, missing `exp`, missing `jti`, wrong type | 401 for every case |
| Logout | Use refresh token after logout | 401 and family remains revoked |
| Refresh replay | Reuse old refresh token after rotation | Active family revoked according to documented policy |
| Concurrent refresh | Send two refresh requests simultaneously | At most one rotation succeeds; state remains consistent |
| Lockout | Send concurrent failed logins | Counter and lock time are deterministic; no lost updates |
| JSON types | Send arrays/objects for string and numeric fields | Structured 400, never uncaught 500 |
| Body limit | Oversized request with Content-Length and chunked transfer | 413 before business logic |
| Rate limit | Parallel burst above the configured maximum | Exact atomic enforcement across instances |
| Score integrity | Post arbitrary WPM without a valid race | Rejected |
| Score update | Submit lower/equal/higher score | Accurate `improved` and best-score result |
| Leaderboard cache | Improve score then fetch ranking | New score visible according to explicit consistency policy |
| Pagination | Huge page, negative values, excessive limit | Bounded validation response; no unbounded cache growth |
| Migration | Fresh schema and upgrade from supported prior version | Complete, repeatable, verified result |
| Accessibility | Keyboard, screen reader, reduced motion, zoom, narrow viewport | Core flow remains understandable and operable |

---

# Production Readiness Gate

The project should not be labeled production-ready until every item below is satisfied:

- [ ] Only explicitly public assets and the front controller are web-accessible.
- [ ] No secrets, credentials, signing keys, logs, SQL, cache data, or internal reports are in the public tree or release archive.
- [ ] Production secrets are non-placeholder, independently generated, externally injected, and rotation-tested.
- [ ] The frontend uses the real backend for authentication, refresh, logout, score, and leaderboard operations.
- [ ] Logout revokes the refresh family, and refresh replay/concurrency tests pass.
- [ ] JWT/session validation requires all security claims and current account state.
- [ ] Score integrity has a documented threat model and raw client WPM is not authoritative.
- [ ] The core ASL feature performs real, validated classification or is accurately relabeled.
- [ ] Request schemas prevent type-confusion 500s and a global error handler prevents internal error leakage.
- [ ] Request-size, rate-limit, pagination, cache, and log controls remain effective under concurrency and across application replicas.
- [ ] Fresh-install and upgrade migrations pass against explicitly supported database versions with least privilege.
- [ ] Static pages receive a CSP and permissions policy that both protect the application and permit the intended camera/dependency behavior.
- [ ] File permissions, database TLS, UTC handling, logging, monitoring, backups, and cleanup are verified in staging.
- [ ] Automated tests and CI cover the critical/high findings in this report.
- [ ] README and OpenAPI examples match tested runtime behavior.
- [ ] Accessibility and responsive behavior meet the chosen release target.
- [ ] A new evidence-based security review is tied to the exact release commit/artifact.

---

# Audit Scope and Limitations

This was a best-effort review of the 50 files in the supplied ZIP. It included static inspection of PHP, JavaScript, HTML, CSS, SQL, Apache rules, configuration, documentation, and the previous audit; syntax/parsing checks; local HTTP smoke tests; malformed-input tests; a chunked-body test; a concurrent rate-limit harness; asset-path resolution; permission/archive inspection; and isolated JWT behavior tests.

The following could not be fully exercised in the audit environment:

- A MySQL server and the PDO MySQL driver were not available, so registration, login, refresh rotation, score persistence, database constraints, and migrations were not run end to end. Database findings are based on code and SQL inspection plus observed failure paths.
- No interactive browser or camera was available, so visual layout, MediaPipe behavior, permissions prompts, real-device performance, and full accessibility behavior were not executed.
- No production reverse proxy, hosting platform, secret manager, CI system, monitoring stack, or deployment manifests were supplied.
- No dependency manifests or lockfiles were present, so a complete dependency/CVE and license inventory was not possible. The externally loaded browser dependencies were reviewed at the integration level only.
- This report covers the supplied snapshot, not later commits, external services, database contents, or infrastructure not included in the archive.

A code audit cannot prove the absence of every defect. The findings marked confirmed were supported by direct code evidence or reproduction; infrastructure-dependent concerns are described with their assumptions. All critical and high findings should be treated as release blockers until fixed and regression-tested.

---

# Final Assessment

ASL Revive is currently a prototype composed of a partially hardened API and a separate browser demo, not one production-ready system. The strongest backend primitives are undermined by deployment exposure, broken refresh-session semantics, non-atomic security controls, permissive request handling, and lack of frontend integration. The product's defining feature - recognizing ASL signs - is not implemented in the supplied code, and the leaderboard cannot be trusted because the server accepts a client-declared score.

The safest path is to contain the public-file exposure first, rebuild authentication and refresh handling second, establish a real score/ASL trust model third, and only then harden operations and prepare a public release.
