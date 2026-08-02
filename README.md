# ASL Racer

[![CI](https://github.com/GaelCT/FastASL/actions/workflows/ci.yml/badge.svg)](https://github.com/GaelCT/FastASL/actions/workflows/ci.yml)

A typing race game with American Sign Language (ASL) integration.

## Project Structure

```
ASL-Revive/
├── public/               # ONLY web-accessible directory
│   ├── index.php         # API front controller (routes /api/*)
│   ├── router.php        # Development server router
│   ├── login.html        # Frontend pages
│   ├── dashboard.html
│   ├── race.html
│   └── assets/           # Frontend assets
│       ├── js/
│       └── css/
├── backend/              # PHP API implementation (NOT web-accessible)
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── services/
│   └── utils/
├── database/             # SQL schema
├── docs/                 # Internal documentation
├── tests/                # PHPUnit tests
├── var/                  # Runtime logs and cache (created at deployment)
│   ├── log/
│   └── cache/
├── .env                  # Environment configuration (outside public/)
├── composer.json
└── package.json
```

> **Security note:** Only `public/` is served by the web server. `.env`, `backend/`, `database/`, `docs/`, and `var/` must never be inside the document root.

## Backend Setup

### Prerequisites

- PHP 8.0 or higher
- MySQL 5.7 or higher
- Web server (Apache/Nginx) or PHP built-in server

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ASL-Revive
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your database credentials and settings:
   ```env
   DB_HOST=localhost
   DB_NAME=asl_racer
   DB_USER=your_db_user
   DB_PASS=your_secure_password
   CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
   JWT_SECRET=your-access-secret-min-32-chars
   JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars
   JWT_EXPIRY_HOURS=1
   JWT_REFRESH_EXPIRY_HOURS=168
   ```

3. **Database setup**
   ```bash
   mysql -u root -p
   source database/db.sql;
   ```
   For existing installations, see the migration files in `database/`.

4. **Run the application**
   ```bash
   php -S 127.0.0.1:8000 -t public public/router.php
   ```

5. **Access the application**
   - Frontend: http://localhost:8000/login.html
   - API: http://localhost:8000/api/

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register` | Register a new user |
| POST | `/api/login` | Authenticate and receive tokens |
| POST | `/api/refresh` | Refresh access token |
| POST | `/api/logout` | Invalidate current session |
| POST | `/api/validate` | Check username availability |
| GET | `/api/check` | Check username availability (query) |
| GET | `/api/leaderboard` | Retrieve leaderboard |
| POST | `/api/score` | Submit race score |
| GET | `/api/` | Health check |

### Authentication

All protected endpoints require an `Authorization: Bearer <token>` header. Tokens are obtained via `/api/login`.

### Testing

```bash
composer install     # install PHP dependencies
vendor/bin/phpunit   # run PHP tests
npm install          # install frontend tooling
npm run lint         # lint JavaScript
```

## Project Audit

Three companion documents provide a detailed security and quality review:

- **`ASL_Revive_Project_Audit.md`** — Full security audit with 45 findings (4 critical, 16 high, 18 medium, 7 low)
- **`ASL_Revive_Human_AI_Fix_Plan.md`** — Learning-oriented remediation plan dividing work between human and AI
- **`ASL_Revive_Remediation_Guide.md`** — Detailed implementation steps for coding LLMs

## License

This project is licensed under the MIT License.
