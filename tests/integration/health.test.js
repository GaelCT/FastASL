/**
 * HUMAN-3 — Integration acceptance and exposure assertions.
 *
 * The human owns the important expected cases in this file. AI must not
 * weaken, replace, or pre-decide the final security expectations here.
 * AI may add repetitive scaffolding around the human-authored cases
 * later, only after the human checkpoint is recorded.
 *
 * Run with: npm run test:integration
 *
 * Required human-written assertions (one small test at a time):
 *
 *  1. GET /api/health returns the exact reviewed status, body, and
 *     content type (contract defined by HUMAN-2).
 *  2. /login.html, /dashboard.html, /race.html load successfully.
 *  3. /.env is NOT served (404).
 *  4. /composer.json is NOT served (404) — deletion is not a boundary;
 *     the static root must make repo files unreachable even if one
 *     reappears outside public/.
 *  5. Representative PHP/backend paths are NOT served (404):
 *     /backend/, /backend/JWT.php, /index.php, /router.php.
 *  6. Representative SQL paths are NOT served (404).
 *  7. Internal repository docs are NOT served (404), e.g. /docs/... —
 *     proves express.static() was not pointed at the repository root.
 *  8. Arbitrary repository files outside public/ are NOT served (404),
 *     e.g. /package.json.
 *  9. Symlink-escape canary: create a secret file OUTSIDE public/, a
 *     symlink INSIDE public/ pointing at it, request the public URL,
 *     and assert the outside file's content is NOT returned. Clean up
 *     the fixture afterwards. If the platform cannot create symlinks,
 *     report that constraint explicitly instead of silently passing.
 *     https://nodejs.org/api/fs.html#fsfspromisesymlinktarget-path-type
 * 10. A normal HTML page response carries representative Helmet security
 *     headers. Inspect the installed Helmet version's actual defaults:
 *     https://github.com/helmetjs/helmet#how-it-works
 * 11. The /api/health response carries representative reviewed Helmet
 *     headers.
 * 12. `x-powered-by` is absent from responses.
 */

import { test } from "node:test";

// TODO(HUMAN): import createApp from src/app.js and supertest, then write
// the twelve assertion groups above as individual tests.

test("health endpoint contract", () => {
  test.todo("HUMAN-3: assert status/body/content-type of GET /api/health");
});

test("public pages load", () => {
  test.todo("HUMAN-3: /login.html, /dashboard.html, /race.html return success");
});

test("environment files are not exposed", () => {
  test.todo("HUMAN-3: /.env returns 404");
});

test("composer manifest is not exposed", () => {
  test.todo("HUMAN-3: /composer.json returns 404");
});

test("php and backend paths are not exposed", () => {
  test.todo(
    "HUMAN-3: /backend/, /backend/JWT.php, /index.php, /router.php return 404",
  );
});

test("sql files are not exposed", () => {
  test.todo("HUMAN-3: representative SQL paths return 404");
});

test("internal docs are not exposed", () => {
  test.todo("HUMAN-3: internal docs paths return 404");
});

test("arbitrary repository files are not exposed", () => {
  test.todo("HUMAN-3: /package.json returns 404");
});

test("symlink escape canary", () => {
  test.todo(
    "HUMAN-3: symlink inside public/ cannot expose its outside target; report platform limits explicitly",
  );
});

test("security headers on html", () => {
  test.todo("HUMAN-3: representative Helmet headers present on an HTML page");
});

test("security headers on api", () => {
  test.todo("HUMAN-3: representative Helmet headers present on /api/health");
});

test("x-powered-by is disabled", () => {
  test.todo("HUMAN-3: x-powered-by header is absent");
});
