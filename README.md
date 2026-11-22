# FastASL — Node Phase 1 Foundation

FastASL is being rebuilt on Node.js 24 and Express 5. Phase 1 provides a small,
secure server foundation and three truthful placeholder pages. It does **not**
provide accounts, authentication, a database, ASL recognition, scoring, races,
or a leaderboard; those belong to later reviewed phases.

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

## Phase 1 behavior

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

### Truthful pages

- `/login.html` — accounts and sign-in are unavailable.
- `/dashboard.html` — future race durations and leaderboard remain unavailable.
- `/race.html` — recognition, scoring, and submission are not implemented.

### Security and request failures

Helmet supplies baseline security headers, `x-powered-by` is disabled, and JSON
parsing is bounded by `REQUEST_BODY_LIMIT`. Pino HTTP uses the shared
credential/header redaction policy, omits URL query strings from request logs,
and logs only safe status/type metadata for expected client errors so malformed
request bodies and parser details are not serialized.

Malformed JSON returns HTTP 400 and oversized JSON returns HTTP 413, both with
exactly `{ "error": "Request failed" }`. Other safe client errors retain their
4xx status and that payload. Unexpected failures return HTTP 500 with exactly
`{ "error": "Internal server error" }`. Responses do not include stack traces,
parser details, request bodies, or filesystem paths.

`public/` is the only static document root. The middleware checks both lexical
and real paths, serves regular files only, disables directory indexes and
redirects, denies dotfiles, and rejects symlinks whose targets escape `public/`.
Repository files, environment files, backend/PHP paths, SQL, internal docs,
traversal, and encoded-separator attempts therefore fall through to safe 404s.

The integration suite includes an outside-secret symlink canary. On this
Windows development host, symlink creation was denied with `EPERM`; only that
canary was explicitly skipped with its OS diagnostic and remains unverified on
this host. Other static-boundary tests ran normally.

## Verification

```bash
npm run test:unit
npm run test:integration
npm run check
git diff --check
```

`npm run check` runs ESLint and the complete Node test suite. Server lifecycle
unit tests use injected listeners/fakes, so importing `src/server.js` never
opens a port. Real browser and signal smoke verification is performed against
the running app independently before the Phase 1 gate.

The ownership checker remains available for a recorded human checkpoint:

```bash
npm run check:ownership -- <checkpoint-commit>
```

## Roadmap and ownership

- **Phase 1:** Node/Express foundation, validation, safe static serving, health,
  bounded errors, and graceful shutdown.
- **Phase 2 (not implemented):** honest practice and server-authoritative races.
- **Phase 3 (not implemented):** accounts, opaque sessions, persistence, and
  abuse controls.
- **Phase 4 (not implemented):** a real classifier contract, leaderboard, and
  release hardening.

See `FASTASL_NODE_REBOOT_4_PHASE_PLAN.md`, `docs/REBOOT_DECISIONS.md`, and
`docs/LEGACY_SNAPSHOT.md` for the plan, locked decisions, and legacy archive.
