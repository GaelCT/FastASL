# Feature Map

How to reach each user-facing feature, so an agent can check a change in the
running app. Update it in the same PR that adds, moves or removes a route,
navigation item or label listed here. Anything unverified is `TBD`.

## How to start the app

Use Node.js 24. No account or sign-in exists in Phase 1.

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

Phase 1 has no accounts, user data, scores, tokens, or classifier input. Use no
real credentials or personal data in evidence. Screenshots may contain only the
truthful placeholder pages and test responses. Never capture `.env` contents,
secrets, cookies, authorization headers, or real camera frames.

## Features

| Feature | Route | How to reach it | What to check |
|---|---|---|---|
| Health | `/api/health` | Start the app and request the URL | HTTP 200, exact JSON body, Helmet headers, no version disclosure |
| Login placeholder | `/login.html` | Open directly or follow LOGIN PAGE from the dashboard | Truthful unavailable-account message; no mock login or token |
| Dashboard placeholder | `/dashboard.html` | Open directly | Both future durations and leaderboard are labeled unavailable |
| Practice placeholder | `/race.html` | Open directly or follow a dashboard duration | No recognition, scoring, or result submission claim |
| Static exposure boundary | `/.env`, `/package.json`, `/docs/REBOOT_DECISIONS.md`, `/index.php` | Request each URL directly | Safe 404 and no repository/internal content |
| Practice race | `/race.html` | Phase 2; not implemented | Do not simulate or claim this flow exists |
| Accounts | `/login.html` | Phase 3; not implemented | Do not create test accounts or claim authentication exists |
| Community leaderboard | `/dashboard.html` | Phase 4; not implemented | Must remain unavailable until the real classifier gate passes |
