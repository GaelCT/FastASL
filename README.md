# ASL Racer

[![CI](https://github.com/GaelCT/FastASL/actions/workflows/ci.yml/badge.svg)](https://github.com/GaelCT/FastASL/actions/workflows/ci.yml)

A typing race game with American Sign Language (ASL) integration.

## Project Structure

```
ASL-Revive/
├── backend/              # PHP API backend
│   ├── config/          # Configuration management
│   ├── controllers/     # HTTP request handlers
│   ├── middleware/      # Request middleware (CORS, Auth, Rate Limit)
│   ├── services/        # Business logic layer
│   ├── utils/           # Helper utilities
│   ├── index.php        # Main API entry point
│   └── validation.php   # Legacy endpoint (redirects to index.php)
├── database/            # SQL schema
├── JS/                  # Frontend JavaScript
├── pages/               # HTML pages
├── style/               # CSS styles
└── .env                 # Environment configuration (not in git)
```

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
   php -S localhost:8000 -t .
   ```

5. **Access the application**
   - Frontend: http://localhost:8000/pages/login.html
   - API: http://localhost:8000/backend/

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/backend/register` | Register a new user |
| POST | `/backend/login` | Authenticate and receive tokens |
| POST | `/backend/refresh` | Refresh access token |
| POST | `/backend/logout` | Invalidate current session |
| POST | `/backend/validate` | Check username availability |
| GET | `/backend/check` | Check username availability (query) |
| GET | `/backend/leaderboard` | Retrieve leaderboard |
| POST | `/backend/score` | Submit race score |
| GET | `/backend/health` | Health check |

### Authentication

All protected endpoints require an `Authorization: Bearer <token>` header. Tokens are obtained via `/backend/login`.

## Project Audit

Three companion documents provide a detailed security and quality review:

- **`ASL_Revive_Project_Audit.md`** — Full security audit with 45 findings (4 critical, 16 high, 18 medium, 7 low)
- **`ASL_Revive_Human_AI_Fix_Plan.md`** — Learning-oriented remediation plan dividing work between human and AI
- **`ASL_Revive_Remediation_Guide.md`** — Detailed implementation steps for coding LLMs

## License

This project is licensed under the MIT License.
