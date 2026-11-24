# FastASL — Node Phase 2 Keyboard Practice

FastASL is being rebuilt on Node.js 24 and Express 5. Phase 2 adds a real,
server-authoritative, unranked keyboard practice loop to the secure Phase 1
foundation. It does **not** provide accounts, authentication, a database, ASL
recognition, camera/model integration, durable race history, or a leaderboard;
those require later reviewed phases and contracts.

The project owner reassigned the five former HUMAN-1/2/3 Phase 1 implementation
scaffolds to AI on 2026-11-21. Architecture decisions and phase/PR gates remain
human-reviewed; see `docs/CODE_OWNERSHIP.json` and `docs/HUMAN_AI_WORKLOG.md`.

## Requirements and setup

- [Node.js 24 LTS](https://nodejs.org/download/release/latest-v24.x/)
- npm (included with Node.js)

```bash
npm ci
cp .env.example .env   # optional; the documented defaults work without it
npm start
```

The default server address is `http://127.0.0.1:3000`. Use `npm run dev` for
Node watch mode during development. Both commands use Node's built-in
`--env-file-if-exists=.env`; no custom dotenv loader is involved.

## Environment contract

`src/config/env.js` is the only application module that reads `process.env`.
Every supplied value is validated before the server listens. Invalid values
throw a startup-safe error naming each failing field; they are never silently
replaced by defaults.

| Variable | Default | Accepted values |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `HOST` | `127.0.0.1` | 1–255 non-whitespace characters |
| `PORT` | `3000` | Canonical decimal integer `1`–`65535`; normalized to a number |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent` |
| `REQUEST_BODY_LIMIT` | `100kb` | Integer lowercase-`kb` value from `1kb` through `100kb` |

## Current behavior

### Health

```bash
curl --fail http://127.0.0.1:3000/api/health
```

`GET /api/health` returns HTTP 200, a JSON content type, and exactly:

```json
{ "status": "ok" }
```

It deliberately exposes no runtime version, environment, database, Git, or
secret information. Unknown routes and unsupported health methods return HTTP
404 with exactly `{ "error": "Not found" }`.

### Pages and honest capability limits

- `/login.html` — accounts and sign-in are unavailable.
- `/dashboard.html` — 30/60-second keyboard practice is available; the community
  leaderboard remains unavailable.
- `/race.html` — keyboard development/practice input produces unranked,
  server-calculated results. ASL recognition and camera/classifier input remain
  unavailable. Results are not verified, cheat-proof, or leaderboard eligible.

### Practice API and timing authority

`POST /api/races` accepts only `{ "durationSeconds": 30 | 60 }` and returns 201.
The server selects the prompt and owns the ID, start time, deadline, and server
clock. `POST /api/races/:id/complete` accepts only `{ "typedText": "..." }` and
returns 200 with the server-calculated result. The browser cannot supply a
prompt, timestamp, elapsed time, WPM, accuracy, input method, or ranking value.

The countdown uses the creation-time server clock offset. The server remains
the expiry authority; the browser never calculates a local score. Completion
network failure shows no guessed result. Before expiry, a person may explicitly
retry the identical submitted text without editing it. HTTP 404 (unavailable),
409 (already completed), and 410 (expired) are distinct terminal states that
require a new race rather than automatic retry loops.

Phase 2 storage is a bounded **single-process, in-memory** repository: at most
100 total race records, with completed/expired records retained for 300,000 ms
before opportunistic cleanup. A server restart loses races and can make an old
race ID unavailable. There is no durable history, account association, database,
or cross-process sharing.

The browser stores only the active race DTO, typed practice text, schema version,
and clock offset in `sessionStorage` under `fastasl.practice.v1`. Reloading a
valid active snapshot resumes without creating another race. Invalid or already
expired snapshots are cleared; completed results and rankings are never stored
or restored. If browser storage is denied or full, practice still works and a
notice explains that text will not survive reload. Use invented practice text,
not personal or sensitive information.

### Security and request failures

Helmet supplies baseline security headers, `x-powered-by` is disabled, and JSON
parsing is bounded by `REQUEST_BODY_LIMIT`. Pino HTTP retains only reviewed
non-sensitive request headers, omitting credential headers, `Referer`, and URL
query strings from request logs. Request failures log only safe status/type
metadata; unexpected error messages and stacks are never serialized, so request
bodies, parser details, credentials, and filesystem paths stay out of these logs.

Malformed JSON returns HTTP 400 and oversized JSON returns HTTP 413, both with
exactly `{ "error": "Request failed" }`. Other safe client errors retain their
4xx status and that payload. Unexpected failures return HTTP 500 with exactly
`{ "error": "Internal server error" }`. Responses do not include stack traces,
parser details, request bodies, or filesystem paths.

`public/` is the only static document root. The middleware checks lexical and
resolved paths plus file identity before and after opening, then streams the
response from that same file handle rather than resolving the path again. It
serves regular files only, disables directory indexes and redirects, denies
dotfiles, and rejects symlinks whose targets escape `public/`. Repository files,
environment files, backend/PHP paths, SQL, internal docs, traversal, and
encoded-separator attempts therefore fall through to safe 404s.

The integration suite includes outside-secret link and deterministic
after-open path-swap canaries. The outside-secret canary uses a file symlink on
POSIX hosts and a directory junction on Windows, requesting the secret through
either link without a conditional skip. The path-swap regression uses a
directory rename and runs without symlink privileges.

## Verification

```bash
node --test tests/unit/browser-race-store.test.js tests/unit/browser-race-controller.test.js tests/unit/browser-race-state.test.js tests/unit/browser-api.test.js tests/unit/browser-timer-display.test.js
npm ci
npm run check
git diff --check
```

`npm run check` runs ESLint and the complete Node test suite. Unit and
integration tests do not prove real-browser layout, accessibility, storage, or
network behavior. Before the Phase 2 gate, independent browser UAT must cover
resume, corrupt/denied storage, restart and stale responses, duplicate submission,
actual 30-second expiry, offline creation/completion, unknown races after server
restart, keyboard-only navigation, 320-pixel/mobile layout, reduced motion, and
console errors. These checks remain required; no browser UAT result is implied
by the unit suite. Server lifecycle tests use injected listeners/fakes, so
importing `src/server.js` never opens a port.

The ownership checker remains available for a recorded human checkpoint:

```bash
npm run check:ownership -- <checkpoint-commit>
```

## Roadmap and ownership

- **Phase 1:** Node/Express foundation, validation, safe static serving, health,
  bounded errors, and graceful shutdown.
- **Phase 2:** honest unranked keyboard practice, server-authoritative races,
  bounded in-memory storage, and active-snapshot browser resume; independent
  browser UAT remains the phase-gate evidence.
- **Phase 3 (not implemented):** accounts, opaque sessions, persistence, and
  abuse controls.
- **Phase 4 (not implemented):** a real classifier contract, leaderboard, and
  release hardening.

See `FASTASL_NODE_REBOOT_4_PHASE_PLAN.md`, `docs/REBOOT_DECISIONS.md`, and
`docs/LEGACY_SNAPSHOT.md` for the plan, locked decisions, and legacy archive.
