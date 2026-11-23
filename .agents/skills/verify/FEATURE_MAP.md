# Feature Map

How to reach each user-facing feature, so an agent can check a change in the
running app. Update it in the same PR that adds, moves or removes a route,
navigation item or label listed here. Anything unverified is `TBD`.

## How to start the app

Use Node.js 24. No account or sign-in exists in Phase 2.

```bash
npm ci
npm start
```

Health check:

```bash
curl --fail http://127.0.0.1:3000/api/health
```

The exact response is `{ "status": "ok" }`.

## Data safety

Phase 2 has no accounts, persistent user data, tokens, or classifier input.
Keyboard practice races and unranked results live only in server/browser memory.
Use invented keyboard text only; no real credentials, personal data, or camera
frames in evidence. Never capture `.env` contents, secrets, cookies, or
authorization headers.

## Features

| Feature | Route | How to reach it | What to check |
|---|---|---|---|
| Health | `/api/health` | Start the app and request the URL | HTTP 200, exact JSON body, Helmet headers, no version disclosure |
| Login placeholder | `/login.html` | Open directly or follow LOGIN PAGE from the dashboard | Truthful unavailable-account message; no mock login or token |
| Dashboard practice navigation | `/dashboard.html` | Open directly | 30/60-second links preselect a real practice mode; leaderboard remains unavailable |
| Keyboard practice | `/race.html?duration=30` or `/race.html?duration=60` | Follow a dashboard duration or open directly; duration is preselected, then choose START PRACTICE | Server prompt/deadline, keyboard editing, early finish, one expiry submission, exact unranked WPM/accuracy, safe errors, accessible focus, responsive layout |
| Static exposure boundary | `/.env`, `/package.json`, `/docs/REBOOT_DECISIONS.md`, `/index.php` | Request each URL directly | Safe 404 and no repository/internal content |
| Accounts | `/login.html` | Phase 3; not implemented | Do not create test accounts or claim authentication exists |
| Community leaderboard | `/dashboard.html` | Phase 4; not implemented | Must remain unavailable until the real classifier gate passes |
