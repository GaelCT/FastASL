# Legacy Snapshot (pre-reboot)

This document records the state of the FastASL repository immediately before the
Phase 1 "clean reboot and Node foundation" work began. Git history is the legacy
archive; no legacy source code is copied into the new tree.

## Identifiers

```text
Legacy source commit: a69bdf6ec5930950e134aace415dc98f930ede8a (short: a69bdf6)
Legacy tag: legacy-php-v3.1-a69bdf6
Phase branch: reboot/p1-node-baseline
```

## What the reboot intentionally removes

The previous implementation was a PHP/Apache application with a handwritten JWT
implementation and browser-side fake authentication. The reboot removes:

- The PHP backend (`backend/`), including the custom `JWT.php` implementation.
- Apache routing configuration (`.htaccess`, `public/.htaccess`,
  `.github/apache-test/`).
- The Composer/PHPUnit PHP toolchain (`composer.json`, `phpunit.xml.dist`,
  `tests/bootstrap.php`, `tests/Unit/`, `tests/Integration/`, `tests/Browser/`).
- Legacy SQL bootstrap files (`database/db.sql`,
  `database/migrate_v3_to_v31.sql`).
- Legacy permission/security shell scripts under `scripts/`.
- The three old browser scripts (`public/assets/js/login.js`,
  `public/assets/js/dashboard.js`, `public/assets/js/race.js`) because they
  contained fake authentication, browser-stored leaderboard persistence, and
  mixed race/camera behavior.
- Superseded audit/remediation documents at the repository root and in `docs/`
  (`SECURITY_AUDIT.md`, `ASL_Revive_Project_Audit.md`,
  `ASL_Revive_Human_AI_Fix_Plan.md`, `ASL_Revive_Remediation_Guide.md`,
  `docs/AUDIT_REMEDIATION_TRACKER.md`).

Normal deletion keeps all of this recoverable from Git history via the legacy
tag above. No history rewrite is performed as part of Phase 1.

## Preserved as refactor targets

- `public/login.html`
- `public/dashboard.html`
- `public/race.html`
- `public/assets/css/main.css`

The three old browser scripts are intentionally **not** preserved. Phase 1
replaces them only with truthful, minimal page behavior; Phase 2 builds the real
practice modules.

## Pre-cleanup repository tree

Recorded with `git ls-tree -r --name-only HEAD` at the legacy commit:

```text
.env.example
.github/apache-test/headers.load
.github/apache-test/htaccess.conf
.github/apache-test/php.ini
.github/workflows/ci.yml
.gitignore
.htaccess
ASL_Revive_Human_AI_Fix_Plan.md
ASL_Revive_Project_Audit.md
ASL_Revive_Remediation_Guide.md
README.md
SECURITY_AUDIT.md
backend/.htaccess
backend/config/Config.php
backend/controllers/AuthController.php
backend/controllers/LeaderboardController.php
backend/controllers/UserController.php
backend/middleware/AuthMiddleware.php
backend/middleware/CorsMiddleware.php
backend/middleware/RateLimitMiddleware.php
backend/middleware/SecurityMiddleware.php
backend/openapi.yaml
backend/services/AuthService.php
backend/services/LeaderboardService.php
backend/services/UserService.php
backend/utils/Database.php
backend/utils/JWT.php
backend/utils/Logger.php
backend/utils/Response.php
backend/utils/Validator.php
composer.json
database/db.sql
database/migrate_v3_to_v31.sql
docs/AUDIT_REMEDIATION_TRACKER.md
eslint.config.js
package-lock.json
package.json
phpunit.xml.dist
public/.htaccess
public/assets/css/main.css
public/assets/js/dashboard.js
public/assets/js/login.js
public/assets/js/race.js
public/dashboard.html
public/index.php
public/login.html
public/race.html
public/router.php
scripts/check-permissions.ps1
scripts/check-permissions.sh
scripts/permission-policy.json
scripts/permission-policy.py
scripts/test-static-security-headers.sh
scripts/verify-mediapipe-sri.mjs
tests/Browser/race-security.mjs
tests/Integration/ApiTestCase.php
tests/Integration/ExposureTest.php
tests/Unit/ExampleTest.php
tests/bootstrap.php
```

## Note on history contents

Git history also contains `Syllabus for CMPS 3600 Operating Systems - Summer
2026.pdf`. If that document should never have been public, its removal requires
a separate, explicitly approved history-rewrite operation; it is deliberately
out of scope for the Phase 1 cleanup.
