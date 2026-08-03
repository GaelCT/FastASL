# ASL Revive — Audit Remediation Tracker

**Audit date:** July 21, 2026  
**Tracker created:** July 26, 2026  
**Snapshot SHA-256:** `bafe91a8e90acaeffe195db27e83660de775ef21f48a8d7d0d264a4f2455e8ff`  

**Status legend:** `open` | `in_progress` | `fixed` | `blocked` | `accepted_risk` | `not_reproducible`

---

## Critical

| ID | Title | Status | Files Changed | Tests | Commit | Residual Risk |
|---|---|---|---|---|---|---|
| C-01 | Public document root exposes secrets, SQL, logs, internal files | open | | | | |
| C-02 | Frontend authentication is fake, ignores password | open | | | | |
| C-03 | Logout does not revoke the refresh token | open | | | | |
| C-04 | Refresh-token reuse detection bypassed by blacklist pre-check | open | | | | |

## High

| ID | Title | Status | Files Changed | Tests | Commit | Residual Risk |
|---|---|---|---|---|---|---|
| H-01 | Server accepts arbitrary client-provided WPM as authoritative score | open | | | | |
| H-02 | Required secrets are empty, health endpoint reports false healthy | open | | | | |
| H-03 | Frontend script paths broken, two conflicting architectures | in_progress | public HTML/JS, static security headers, CI tests | SRI, header, and browser regressions | Pending PR #6 follow-up | Nginx must mirror static-page headers at deployment |
| H-04 | Core ASL recognition feature not implemented | open | | | | |
| H-05 | Array inputs cause uncaught TypeErrors and HTTP 500 | open | | | | |
| H-06 | Auth DB failures leak internals, return wrong HTTP statuses | open | | | | |
| H-07 | File rate limiter not atomic, loses concurrent attempts | open | | | | |
| H-08 | Request-size limit bypassable with chunked bodies | open | | | | |
| H-09 | Refresh-token rotation vulnerable to concurrent use | open | | | | |
| H-10 | Account lockout concurrency-unsafe, IP limiter counts successes | open | | | | |
| H-11 | Unbounded leaderboard pages exhaust DB/disk resources | open | | | | |
| H-12 | Static pages lack security headers, API policy breaks frontend | open | | | | |
| H-13 | Archive marks project code and directories as world-writable | in_progress | Shared policy, POSIX/Windows validators, release ZIP checks | Linux-only POSIX fixtures + Windows ACL fixtures + ZIP metadata/extraction | Pending PR #7 follow-up | POSIX validator intentionally exits nonzero on macOS; deployment owner/group must apply documented runtime modes |
| H-14 | v3-to-v3.1 migration not reliably executable | open | | | | |
| H-15 | Config requires `.env` in web root, ignores process environment | open | | | | |
| H-16 | Pre-existing security audit provides false release assurance | open | | | | |

## Medium

| ID | Title | Status | Files Changed | Tests | Commit | Residual Risk |
|---|---|---|---|---|---|---|
| M-01 | JWT claim validation is incomplete | open | | | | |
| M-02 | Refresh-key separation and blacklist lifetimes inconsistent | open | | | | |
| M-03 | Protected requests not tied to current account state | open | | | | |
| M-04 | Score input coercive, update responses misleading | open | | | | |
| M-05 | Leaderboard cache not invalidated after score changes | open | | | | |
| M-06 | Leaderboard scope semantics conflict across layers | open | | | | |
| M-07 | Browser state parsing and leaderboard rendering unsafe/fragile | open | | | | |
| M-08 | Race accuracy, duration, timer logic produce invalid results | open | | | | |
| M-09 | Routing/rewrite behavior ambiguous, creates unintended aliases | open | | | | |
| M-10 | README, OpenAPI, runtime describe different systems | open | | | | |
| M-11 | Rate-limit coverage, proxy handling, deployment weak | open | | | | |
| M-12 | Auth responses lack no-store, CORS not cache-safe | open | | | | |
| M-13 | Logging has unbounded retention, records sensitive identifiers | open | | | | |
| M-14 | DB transport, time handling, cleanup depend on unstated assumptions | open | | | | |
| M-15 | Missing dependency manifests, test setup, and CI | open | | | | |
| M-16 | Dependency injection and backend architecture coupling | open | | | | |
| M-17 | Accessibility and responsive-layout issues | open | | | | |
| M-18 | Configuration ranges not validated at startup | open | | | | |

## Low

| ID | Title | Status | Files Changed | Tests | Commit | Residual Risk |
|---|---|---|---|---|---|---|
| L-01 | Invalid input mutated instead of rejected | open | | | | |
| L-02 | Leaderboard tie sorting non-deterministic | open | | | | |
| L-03 | Cache comments/APIs misaligned with implementation | open | | | | |
| L-04 | Small frontend defects and leaked globals | open | | | | |
| L-05 | Method behavior and outdated headers | open | | | | |
| L-06 | Unnecessary version disclosure | open | | | | |
| L-07 | Stale comments, placeholder license | open | | | | |

---

## Baseline — Phase 0 (July 26, 2026)

### PHP syntax check
```text
php -l backend/*.php backend/**/*.php
```
Result: Pending (PHP not available in authoring environment). Audit confirms all backend files pass syntax check.

### ESLint baseline
```
C:\Users\gaelc\Downloads\ASL\JS\dashboard.js
  21:10  warning  'selectRaceConfiguration' is defined but never used  no-unused-vars
  26:10  warning  'switchLeaderboardScope' is defined but never used   no-unused-vars

C:\Users\gaelc\Downloads\ASL\JS\login.js
  1:10  warning  'handleCredentialsLogin' is defined but never used  no-unused-vars

C:\Users\gaelc\Downloads\ASL\JS\race..js
  223:60  warning  'e' is defined but never used                       no-unused-vars
  223:62  error    Empty block statement                               no-empty
  234:10  warning  'saveAndShowLeaderboard' is defined but never used  no-unused-vars
  249:10  warning  'restartGame' is defined but never used             no-unused-vars
  254:60  warning  'e' is defined but never used                       no-unused-vars
  254:62  error    Empty block statement                               no-empty
  272:45  error    'zIndex' is not defined                             no-undef
```

### PHPStan baseline
Pending — requires `composer install` on a system with PHP available.
