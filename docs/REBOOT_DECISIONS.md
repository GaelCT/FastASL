# Reboot Decisions (Locked)

These decisions are locked for the FastASL Node.js reboot. Source:
`FASTASL_NODE_REBOOT_4_PHASE_PLAN.md` (section 2). Do not relitigate them
without an explicit, reviewed decision change.

| Area | Decision |
|---|---|
| Runtime | Node.js 24 LTS |
| Server | Express 5 |
| Language | Plain JavaScript with ES modules; no TypeScript in the reboot |
| Frontend | Existing static HTML/CSS refactored into small browser ES modules; no React requirement |
| Database | MySQL via `mysql2/promise` (later phases; none in Phase 1) |
| Validation | Zod at environment, body, query, and important response boundaries |
| Authentication | bcrypt password hashes plus server-side sessions (later phases; none in Phase 1) |
| Browser credential | Opaque session cookie: `HttpOnly`, production `Secure`, deliberate `SameSite` |
| JWT | Not used. Reconsider only if a separate mobile/third-party client later requires bearer tokens |
| Production session storage | `express-mysql-session` with reviewed pinned version and application-owned schema; never `MemoryStore` |
| Logging | Pino / Pino HTTP with password, cookie, authorization, token, and secret redaction |
| Environment loading | Node 24 built-in `--env-file-if-exists=.env`, then Zod validation; no handwritten dotenv parser |
| Abuse limits | `rate-limiter-flexible` with its MySQL store (release); failed-login limits keyed by network identity AND canonical username |
| Frontend/backend origin | Same origin in production; no production CORS without a real need |
| Leaderboard | Global only; separate 30s/60s results; disabled until a real classifier exists; labeled "server-calculated, client-attested" — not cheat-proof |
| Keyboard input | Development/practice only; never community-leaderboard eligible |
| Score authority | Server chooses prompt/duration, records start/finish timestamps, calculates WPM/accuracy |
| Client trust limit | Browser inference and input-method claims can be forged; results are "client-attested," never "verified" |
| Vision privacy | Camera frames stay in the browser unless a separate reviewed design changes this |
| ASL scope | Only the alphabet subset the actual model contract supports; J/Z and two-hand signs are not invented |

## Phase ordering

Authentication and database work begin in **Phase 3**; the race engine and
honest practice mode arrive in **Phase 2**. Phase 1 deliberately ships none of
these: its goal is a small, testable Node foundation with no fake auth, no fake
leaderboard, and no PHP remnants.

## Static boundary

`public/` is the ONLY static document root. The repository root must never be
passed to `express.static()`.
