# ASL Revive — Human + AI Remediation and Learning Plan

**Companion files:**
- `ASL_Revive_Project_Audit.md`
- `ASL_Revive_Remediation_Guide.md`

**Goal:** Fix the project without turning the entire codebase over to an LLM, while using the difficult parts as a structured backend and deployment learning project.

> The AI may write code, tests, documentation, and configuration. You remain responsible for understanding and approving security, authentication, database, scoring, model-serving, and deployment decisions.

---

# 1. How to divide the work

Use three ownership levels:

## AI-owned

The AI can implement these changes with normal review because they are mostly repetitive, localized, or easily verified by tests.

## Human-owned

You should design and understand these changes yourself. The AI can explain concepts, generate a first draft, or review your code, but it should not independently decide the behavior.

## Shared

The AI writes much of the implementation, but you approve the design, inspect the diff, run the application, and verify the result manually.

A finding is not finished merely because the AI says it is fixed. It is finished only when:

1. The old defect has a regression test or reproducible manual check.
2. The fix passes that check.
3. Existing features still work.
4. You can explain at a basic level what changed and why.
5. The change has its own commit or a clearly scoped group commit.

---

# 2. Recommended ownership for all 45 findings

## Mostly delegate to the AI

| Finding | Work | Why it is suitable for AI | Your verification |
|---|---|---|---|
| H-03 | Repair frontend paths and remove duplicate frontend structure | Mechanical file/path work | Open every page and check the browser console |
| H-13 | Correct file and directory permissions | Configuration cleanup | Inspect permissions in Git/deployment |
| M-05 | Invalidate leaderboard cache after score updates | Localized cache behavior | Update a score and confirm immediate leaderboard refresh |
| M-07 | Safer browser state parsing and rendering | Standard defensive frontend coding | Try corrupted storage and malicious-looking usernames |
| M-09 | Normalize routing and rewrite behavior | Mostly routing/config cleanup | Test valid and invalid routes |
| M-10 | Synchronize README, OpenAPI, and runtime docs | Documentation-heavy | Compare docs to actual requests |
| M-12 | Add `no-store` and correct cache/Vary headers | Standard HTTP hardening | Inspect response headers |
| M-13 | Add log rotation/retention and redact identifiers | Repetitive logging work | Review sample logs and retention settings |
| M-15 | Add dependency manifests, test setup, and CI | Tooling/scaffolding | Run CI locally or in GitHub Actions |
| M-17 | Accessibility and responsive-layout fixes | Iterative frontend work | Keyboard test and mobile viewport test |
| L-02 | Deterministic leaderboard tie sorting | Small database/query fix | Add tied scores and confirm stable order |
| L-03 | Align cache comments/APIs with implementation | Small cleanup | Confirm tests and documentation agree |
| L-04 | Fix small frontend defects and leaked globals | Mechanical cleanup | Browser console must remain clean |
| L-05 | Correct method behavior and outdated headers | Standard API cleanup | Test unsupported methods and headers |
| L-06 | Remove unnecessary version disclosure | Simple hardening | Inspect server and health responses |
| L-07 | Remove stale comments and replace placeholder license | Documentation cleanup | Read final files |

### Instructions for the AI on these findings

For each finding:

1. Confirm the finding in the current code.
2. Add or update a test when practical.
3. Make the smallest reasonable change.
4. Do not redesign unrelated modules.
5. Run syntax checks, relevant tests, and the full suite.
6. Update `docs/AUDIT_REMEDIATION_TRACKER.md`.
7. Commit the change with the finding ID in the commit message.

---

## Shared: let the AI implement, but you control the design and acceptance

| Finding | Work | What the AI may do | What you must decide or verify |
|---|---|---|---|
| C-01 | Public document root and secret exposure | Move files, add server config, add exposure tests | Decide final deployment layout; verify no internal file is downloadable |
| C-02 | Replace mock login with real backend login | Build API client, forms, guards, error UI | Verify credentials are actually checked and session behavior is correct |
| H-02 | Secret validation and truthful health checks | Add validators and health endpoints | Decide which dependencies make the service ready/unready |
| H-05 | Strict request validation | Add schemas/validators and tests | Approve accepted types and error responses |
| H-06 | Centralized safe error handling | Build exception mapping and safe responses | Verify internal database details never reach clients |
| H-08 | Enforce body-size limits | Add proxy/app limits and tests | Verify behavior in the real hosting stack |
| H-11 | Bound leaderboard queries | Add maximum page sizes and indexes | Decide acceptable limits and user experience |
| H-12 | Security headers and CSP | Draft separate frontend/API policies | Test that camera, MediaPipe, model assets, and API calls still work |
| H-14 | Repair migration scripts | Make migrations idempotent and testable | Test against a backup/copy of the database before production |
| H-15 | Process-environment configuration | Refactor config loader and `.env.example` | Set real Render/environment values yourself |
| M-04 | Strict score input and truthful responses | Add validation and correct response payloads | Define valid ranges and score update semantics |
| M-06 | Leaderboard scope consistency | Update schema/API/frontend together | Decide whether rankings are global, per mode, per lesson, or per model version |
| M-08 | Accuracy, duration, and timer correctness | Implement validated calculations and tests | Define exactly when a race begins/ends and what counts as correct |
| M-14 | Database TLS, UTC, and cleanup assumptions | Add config and scheduled cleanup mechanism | Configure actual provider connection requirements |
| M-18 | Validate all configuration ranges | Add startup schema validation | Decide safe min/max values |
| L-01 | Reject invalid input instead of mutating it | Replace cleaners with validators | Decide normalization rules for names, email, and other fields |

### Rule for shared findings

The AI may open a pull request or produce a commit, but you should not accept it until you can answer:

- What input is trusted here?
- What happens when the dependency fails?
- What response does the client receive?
- Is the behavior tested negatively as well as positively?
- Does this work on the actual deployment platform, not only the local server?

---

## Human-led learning work

These are the highest-value areas for you to learn. Let the AI act as a tutor and reviewer, not the decision-maker.

| Finding | Topic you should learn | Why it matters |
|---|---|---|
| C-03 | Session logout and refresh-token revocation | Defines whether stolen sessions remain usable |
| C-04 | Refresh-token reuse detection | Incorrect ordering can silently defeat theft detection |
| H-01 | Server-authoritative score design | Prevents users from submitting arbitrary leaderboard scores |
| H-04 | Real ASL inference integration | This is the central product feature and connects ML to the web app |
| H-07 | Atomic rate limiting | Requires understanding concurrency and shared state |
| H-09 | Atomic refresh-token rotation | Two simultaneous refreshes must not both succeed |
| H-10 | Safe account lockout | Bad concurrency logic can weaken security or lock out real users |
| H-16 | Security verification and release claims | Teaches you not to treat a checklist as proof |
| M-01 | Complete JWT claim validation | Issuer, audience, type, expiry, and algorithm must be deliberate |
| M-02 | Key separation and token lifetimes | Access and refresh tokens serve different security purposes |
| M-03 | Connecting tokens to current account state | Deleted, disabled, or password-reset accounts must lose access |
| M-11 | Proxy-aware, distributed rate limiting | Local IP/file assumptions break after deployment |
| M-16 | Dependency injection and backend architecture | Reduces hidden load-order and global-state bugs |

The AI can generate examples and tests for these items, but you should write or substantially edit the final implementation.

---

# 3. Your recommended learning order

Do not learn everything at once. Work through these modules in order.

## Module A — HTTP and validation

Learn:

- JSON request parsing
- Content types
- Status codes
- Centralized error handling
- Request-body limits
- Validation versus normalization

Work on:

- H-05, H-06, H-08, M-04, M-18, L-01, L-05

Completion project:

Create one reusable request-validation layer and prove it handles strings, arrays, nulls, malformed JSON, oversized bodies, and unknown fields without returning an accidental 500.

## Module B — Authentication sessions

Learn:

- Short-lived access tokens
- Long-lived refresh tokens
- Hashing stored refresh tokens
- Token families
- Rotation
- Revocation
- Reuse detection
- JWT issuer, audience, subject, and token type

Work on:

- C-03, C-04, H-09, M-01, M-02, M-03, M-12

Completion project:

Draw the complete session state machine before coding:

```text
login
  -> access token + refresh token
refresh
  -> old refresh token consumed atomically
  -> new access token + new refresh token
logout
  -> entire session/token family revoked
reuse of consumed token
  -> entire family revoked and event logged
password reset/account disable
  -> all active sessions rejected
```

Required concurrency test:

Send two refresh requests with the same refresh token at nearly the same time. Exactly one may succeed.

## Module C — Concurrency and rate limits

Learn:

- Race conditions
- Transactions
- Row locks
- Atomic Redis operations
- Trusted reverse proxies
- Why files are unsuitable as shared production counters

Work on:

- H-07, H-10, M-11

Completion project:

Use Redis atomic commands or a transactional database design. Run parallel login attempts and prove no attempts disappear.

## Module D — Server-authoritative races and scores

Learn:

- Trust boundaries
- Server-created race sessions
- Nonces/session IDs
- Server timestamps
- Recomputing values instead of accepting derived client values
- Replay prevention

Work on:

- H-01, M-04, M-06, M-08

A safer design:

1. Client requests a race.
2. Server creates a race session containing the prompt/challenge ID, start time, mode, model version, and expiration.
3. Client performs recognition and submits event/result evidence tied to that session.
4. Server validates the race session, timing bounds, sequence, completion, and allowed model version.
5. Server calculates WPM, accuracy, and final score.
6. Server marks the race session consumed so it cannot be replayed.

Do not accept a final WPM number as authoritative merely because the user is authenticated.

## Module E — Deployment and operations

Learn:

- Public document roots
- Environment variables
- Health/readiness endpoints
- Database TLS
- CORS and same-origin deployment
- Logging and secret handling
- Docker basics

Work on:

- C-01, H-02, H-12, H-13, H-14, H-15, M-09, M-13, M-14

Completion project:

Deploy a staging environment from a clean clone using only documented commands and environment variables. Then run the exposure tests and API smoke tests against the public URL.

## Module F — Backend architecture

Learn:

- Front controller
- Controllers versus services versus repositories
- Dependency injection
- Configuration objects
- Test doubles
- Avoiding static global state

Work on:

- M-16 and related cleanup

Do this after the security behavior is covered by tests. Architecture refactoring before tests can create new defects.

---

# 4. Hosting your trained ASL model

Your trained model changes H-04 from “build a model” into “serve and integrate an existing model.” First determine the model format:

- TensorFlow/Keras: `.keras`, `.h5`, SavedModel, or TFLite
- PyTorch: `.pt` or `.pth`
- scikit-learn: `.joblib` or `.pkl`
- ONNX: `.onnx`
- TensorFlow.js: `model.json` plus weight files

## Choose between browser inference and server inference

### Browser inference

Best when the model is small enough to load in the browser and can run with TensorFlow.js, ONNX Runtime Web, MediaPipe Tasks, or another browser runtime.

Advantages:

- Camera frames remain on the user's device.
- Lower server cost.
- Lower network latency after model loading.
- Easier scaling because each client performs inference.

Disadvantages:

- Model conversion may be required.
- Performance varies by device.
- Model files become downloadable.
- Browser compatibility must be tested.

### Server inference

Best when the model requires Python libraries, is too large for the browser, or needs controlled hardware/runtime behavior.

Advantages:

- Reuse the original Python model with fewer conversion steps.
- Centralized model version and preprocessing.
- Easier to update the model without refreshing browser assets.

Disadvantages:

- Uploading video frames creates latency, bandwidth, privacy, and cost problems.
- A free CPU service might not provide smooth real-time inference.
- The service must handle concurrency, timeouts, and model memory.

### Recommended ASL architecture

Do **not** stream full camera video to the server unless necessary.

A better hybrid architecture is:

1. MediaPipe runs in the browser.
2. The browser extracts normalized hand landmarks.
3. The browser sends a small landmark vector or short sequence to the inference API.
4. The Python API applies the exact preprocessing used during training.
5. The API returns the predicted class, confidence, model version, and inference time.
6. The frontend applies smoothing/debouncing before accepting a letter.

This preserves your Python model while sending far less data than images or video.

## Render deployment plan

Render supports Python web services and documents both FastAPI and Flask deployment. A web service can build from a linked Git repository or Docker image, receives a public Render URL, and can use an HTTP health-check endpoint. Render's free services are intended for testing/hobby use rather than production. For model artifacts, prefer packaging an immutable model with the deployment or downloading it during the build; persistent disks preserve only files written under their configured mount path and are a paid-service feature. See the official Render documentation linked in the Sources section.

### Suggested model-service repository

```text
asl-model-service/
├── app/
│   ├── main.py
│   ├── inference.py
│   ├── schemas.py
│   └── preprocessing.py
├── model/
│   └── model-file
├── tests/
│   ├── test_health.py
│   ├── test_predict.py
│   └── fixtures/
├── requirements.txt
├── Dockerfile                 # recommended if native dependencies are tricky
├── render.yaml                # optional
└── README.md
```

### Minimum API contract

```http
GET /health
```

Response:

```json
{
  "status": "ok",
  "model_loaded": true,
  "model_version": "2026-07-01"
}
```

```http
POST /v1/predict
Content-Type: application/json
```

Example landmark request:

```json
{
  "landmarks": [[0.42, 0.31, -0.02]],
  "handedness": "Right",
  "sequence_id": "client-generated-id"
}
```

Example response:

```json
{
  "label": "A",
  "confidence": 0.94,
  "model_version": "2026-07-01",
  "inference_ms": 8.7
}
```

The actual landmark shape must match the training input exactly. Do not make up the number or order of features.

### Implementation checklist

1. Extract the preprocessing code used during training into a reusable module.
2. Load the model once at application startup, not once per request.
3. Validate input dimensions and numeric ranges.
4. Reject NaN, infinity, missing features, and excessive sequence lengths.
5. Add a warm-up prediction during startup when the framework requires it.
6. Expose `/health` and make it fail readiness when the model cannot load.
7. Return stable error JSON without Python stack traces.
8. Add CORS only for the exact frontend origin if the service is cross-origin.
9. Add request limits, timeouts, and rate limits.
10. Pin Python and package versions.
11. Test predictions against saved examples from your training/evaluation set.
12. Record model version with race results when scores depend on recognition behavior.
13. Never deserialize an untrusted `.pkl` or `.joblib` file.

### Render configuration outline

For FastAPI, a typical production start command is conceptually:

```bash
uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
```

For Flask, use a production WSGI server such as Gunicorn rather than Flask's development server.

Set these through Render rather than committing secrets:

```text
MODEL_PATH
MODEL_VERSION
ALLOWED_ORIGIN
LOG_LEVEL
```

Add `/health` as the Render health-check path. Keep model loading deterministic so a failed model load prevents a bad deployment from being marked ready.

## Model-hosting tasks you should personally do

- Identify the exact saved-model format.
- Reproduce one local prediction from a saved real input.
- Document the preprocessing and class-label map.
- Measure model load time, memory use, and inference time locally.
- Decide whether landmarks, images, or temporal sequences are required.
- Deploy the first staging service.
- Inspect logs and test cold starts.
- Connect the frontend to staging.
- Decide whether Render performance is adequate for real-time use.

## Tasks the AI can do for model hosting

- Generate the FastAPI/Flask project scaffold.
- Convert your existing prediction function into an endpoint after you provide it.
- Write Pydantic/input schemas.
- Write Dockerfile, `requirements.txt`, and `render.yaml` drafts.
- Add unit tests and health checks.
- Add frontend API client code.
- Add retry, timeout, and user-facing error handling.
- Write deployment documentation.

Do not let the AI guess preprocessing. A model can load successfully and still return useless predictions when feature order, normalization, handedness, image orientation, or label encoding differs from training.

---

# 5. Phased execution plan

## Phase 0 — Establish a safe baseline

**AI does:**

- Add Composer/npm lockfiles.
- Add PHPUnit and browser-test scaffolding.
- Add CI.
- Create remediation tracker.
- Run syntax/static checks and record current failures.

**You do:**

- Run the project locally.
- Record a short screen capture of current behavior.
- Back up the database.
- Make a Git branch/tag for the original snapshot.

**Exit criteria:** A clean clone can install dependencies and run a documented test command.

## Phase 1 — Stop obvious exposure and breakage

**AI does:** C-01 draft, H-03, H-13, H-15 draft, L-06.

**You do:** Approve document-root layout, configure local environment variables, and manually request every forbidden file.

**Exit criteria:** Secrets and internal code are not web-accessible; all pages load without missing scripts.

## Phase 2 — Make the API predictable

**AI does:** H-05, H-06, H-08, M-09, M-12, M-18, L-01, L-05.

**You do:** Review request/response contracts and run malformed-request tests.

**Exit criteria:** Invalid input consistently produces 4xx JSON responses, never empty/raw 500 responses.

## Phase 3 — Learn and repair authentication

**You lead:** C-03, C-04, H-09, M-01, M-02, M-03.

**AI supports:** Draw schema/state flow, generate migrations/tests, review transaction boundaries, and explain each line.

**Exit criteria:** Logout revokes sessions, refresh rotation is atomic, reuse revokes the family, and disabled accounts cannot use old access tokens.

## Phase 4 — Rate limiting and lockout

**You lead:** H-07, H-10, M-11.

**AI supports:** Generate parallel test harness and Redis/database implementation options.

**Exit criteria:** Concurrent attempts are counted exactly, successful logins do not consume failure limits unless intentionally designed, and proxy IP handling is explicit.

## Phase 5 — Connect the real frontend

**AI does:** C-02, M-07, L-04.

**You do:** Verify login, refresh, logout, expiry, network failure, and unauthorized navigation manually.

**Exit criteria:** No mock token or client-only authentication path remains.

## Phase 6 — Deploy the model service

**You lead:** Model format, preprocessing, local prediction, Render service, performance testing.

**AI supports:** API scaffold, Docker/config, tests, client integration.

**Exit criteria:** Staging `/health` reports the loaded model and known test inputs produce expected predictions.

## Phase 7 — Secure races and scores

**You lead:** H-01, M-04, M-06, M-08.

**AI supports:** Database schema, endpoint implementation, tests, and UI integration.

**Exit criteria:** Changing a submitted WPM value cannot alter the stored score; replayed/expired sessions are rejected.

## Phase 8 — Resource, browser, and quality work

**AI does most:** H-11, H-12, M-05, M-13, M-17, L-02, L-03, L-07.

**You do:** Load tests, CSP/camera testing, accessibility pass, and final manual regression.

## Phase 9 — Architecture cleanup and release review

**Shared:** H-16, M-10, M-14, M-16.

**Exit criteria:** Documentation matches reality, deployment is reproducible, security claims are backed by tests, and global/load-order coupling has been reduced without changing behavior.

---

# 6. Copyable prompt for the coding LLM

Use this prompt one phase at a time:

```text
You are working on the ASL Revive repository.

Read these files first:
1. ASL_Revive_Project_Audit.md
2. ASL_Revive_Remediation_Guide.md
3. ASL_Revive_Human_AI_Fix_Plan.md

Work only on Phase [NUMBER] from ASL_Revive_Human_AI_Fix_Plan.md.
Do not begin later phases.

Before editing:
- inspect the current code and confirm the assigned findings;
- summarize the existing behavior;
- identify any assumption that needs product-owner approval;
- add failing regression tests when practical.

While editing:
- make small, scoped changes;
- do not replace production behavior with mocks;
- do not weaken security to make tests pass;
- do not invent model preprocessing, score rules, authentication policy, or deployment secrets;
- preserve unrelated behavior;
- keep secrets out of source control.

For human-led findings, do not silently choose the design. Present the decision, recommended option, alternatives, and tradeoffs. Then implement only the approved design.

For each completed finding, report:
- finding ID;
- files changed;
- exact behavior before and after;
- tests added;
- commands run and their results;
- manual verification steps;
- remaining risks;
- commit hash.

Update docs/AUDIT_REMEDIATION_TRACKER.md.
Stop after Phase [NUMBER] and provide a review checklist.
```

---

# 7. Prompt for a tutoring-style LLM session

Use this for one of the human-led issues:

```text
Teach me how to fix finding [ID] in my ASL Revive project.

Do not directly rewrite the whole project. First:
1. Explain the defect using the current code path.
2. Explain the underlying backend/security concept.
3. Draw the desired request, state, and database flow.
4. Show me the smallest first change I should make.
5. Give me a test that proves the old behavior is wrong.
6. Let me implement it, then review my diff.

Use ASL_Revive_Project_Audit.md and ASL_Revive_Remediation_Guide.md as requirements. Do not accept a fix unless the regression test passes.
```

---

# 8. Practical time estimate with this split

This plan should reduce repetitive work while preserving the learning value.

| Work | Your estimated hands-on time |
|---|---:|
| Project setup and reviewing AI changes | 8–15 hours |
| HTTP validation and backend fundamentals | 10–18 hours |
| Authentication/session learning and implementation | 18–35 hours |
| Concurrency/rate limiting | 8–18 hours |
| Model-serving setup and Render deployment | 10–30 hours |
| Race/score integrity | 10–24 hours |
| Deployment, testing, and final review | 10–20 hours |
| **Likely total** | **74–160 hours** |

The model-serving range depends heavily on its framework, size, native dependencies, and whether it consumes single landmarks, landmark sequences, or images. A model that already runs from a clean local Python script is much easier to deploy than one whose inference code exists only inside a training notebook.

---

# 9. What to do next

1. Put all three Markdown files in the repository root or `docs/`.
2. Commit the untouched current project as a baseline.
3. Start Phase 0 with the coding LLM.
4. Separately create a clean local inference script for your trained model.
5. Do not integrate the model into the main application until the inference script can reliably reproduce known predictions.
6. Keep all work on branches and merge only after tests and manual review.

---

# Sources for Render deployment

- [Render Web Services](https://render.com/docs/web-services)
- [Deploy a FastAPI App on Render](https://render.com/docs/deploy-fastapi)
- [Deploy a Flask App on Render](https://render.com/docs/deploy-flask)
- [Render Health Checks](https://render.com/docs/health-checks)
- [Docker on Render](https://render.com/docs/docker)
- [Render Free Services](https://render.com/docs/free)
- [Render Persistent Disks](https://render.com/docs/disks)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
