# Auth Hardening

## Goal

Eliminate the unauthenticated header-based auth bypass, fail closed on default/placeholder secrets, replace wide-open CORS with an explicit origin allow-list, and correct `docs/ARCHITECTURE.md`'s sync description to match the real HTTP + `since_ts`-cursor implementation — without breaking the PWA, the Capacitor iOS shell, local dev, or Playwright E2E.

This is branch 1 ("findings 1 + 2 + CORS + doc reconciliation") of a three-branch, Dean-approved remediation arc following a read-only quality review of `main` @ `ffbcb31`.

## Scope

**1. Remove the legacy header-auth bypass** (`server/src/routes/types.rs` `ctx_from_headers`, lines ~97-134)
- Remove the fallback that derives a `RequestCtx` from raw `x-space-id`/`x-user-id` headers when no `Authorization: Bearer` token is present. See "Open questions resolved" for the remove-vs-env-gate decision.
- Refactor the ~40 header-auth integration tests in `server/src/routes/mod.rs` to mint real JWTs (via the existing `issue_token` path) and exercise the real Bearer-token auth path — not a test-only bypass helper.
- Refactor `sync_push`/`sync_pull` (`server/src/routes/sync.rs`, lines ~58-69) to pass an already-authenticated `RequestCtx` directly into `create_task`/`update_task_meta`/`update_task_status`/`get_lists`/`get_tasks` instead of synthesizing `x-space-id`/`x-user-id` headers to re-invoke those handlers. Handler signatures in `tasks.rs`/`lists.rs` change accordingly.
- Remove client legacy mode in `web/src/lib/api/headers.ts`: the `x-space-id`/`x-user-id`/`x-role` fallback, the `AuthMode` type, `tasksync:auth-mode` localStorage key, and `getAuthMode`/`setAuthMode`. The unused `x-role` header is retired with it.
- Handle stale client state gracefully: a device with a pre-existing `tasksync:auth-mode: legacy` value in localStorage from before this upgrade must be routed to a clean login screen after the upgrade, not hard-error or loop.

**2. Fail closed on default secrets** (`server/src/routes/types.rs`, `app_state()`, lines ~38-44)
- Server refuses to boot if `JWT_SECRET` or `DEV_LOGIN_PASSWORD` are unset, empty, or equal to known default/placeholder literals. See "Open questions resolved" for the exact condition and rationale.
- `docker-compose.yml`'s `JWT_SECRET: ${JWT_SECRET:-change-me}` default must not let a fresh `docker compose up` silently boot on the placeholder — this needs to be reconciled as part of this item (grounded finding: `docker-compose.yml`'s own placeholder default, `change-me`, is a *different* string than the Rust code's hardcoded default, `tasksync-dev-secret`; both must be treated as "known-bad" defaults).
- Local dev workflow currently has **no** environment source for `JWT_SECRET`/`DEV_LOGIN_PASSWORD` outside the removed hardcoded fallback: `scripts/2-serve.ps1` and the documented `cd server && cargo run` flow in `README.md` do not set these vars, and there is no `dotenv` loading in `server/src/main.rs`. Fail-closed-always will break this flow unless it is given an explicit dev-secret source (script update, README instruction, or equivalent) as part of this item's scope — the *how* is a design decision for the Principal Engineer, but "local dev must keep working via a documented mechanism" is a requirement here.
- `cargo test` is grounded to be unaffected: integration tests in `server/src/routes/mod.rs` construct `AppState` directly (`test_state()`, using `"test-secret"`/`"test-pass"`) and never call the env-reading `app_state()` function, so the fail-closed boot check does not gate the test suite.

**3. Pin CORS** (`server/src/main.rs`, lines ~47-59)
- Replace `allow_origin(Any)` / `allow_headers(Any)` with an env-configurable allow-list (e.g. a `CORS_ALLOWED_ORIGINS`-style variable) and an explicit enumerated header set.
- Origins that must remain permitted, grounded against the codebase:
  - Local web dev server: `http://localhost:5173` (SvelteKit dev, matches `docker-compose.yml`'s `WEB_HOST_PORT` default and README's "Running from source" instructions).
  - Playwright E2E preview server: `http://localhost:4173` (`web/playwright.config.ts` `baseURL`/`webServer.url`).
  - Capacitor iOS shell: `capacitor://localhost` — confirmed against `web/capacitor.config.ts`, which sets no `server.iosScheme` override, so Capacitor's default iOS WKWebView scheme applies.
  - Self-hosted production PWA origin(s): operator-specific (this is a self-hosted product per `docs/ARCHITECTURE.md` — "Simplicity: one server binary"), so these are **not** hardcoded; they must be supplied via the new env-configurable allow-list, wired into `docker-compose.yml`'s `server.environment` block, and documented in `README.md`'s reverse-proxy section (which already tells operators to set `VITE_API_URL`/`VITE_ALLOWED_HOSTS` for reverse-proxy setups — the CORS origin var belongs alongside those instructions).
- Playwright E2E's existing auth approach (token-mode via localStorage seeding, per `web/tests/e2e/auth.spec.ts`) is unaffected by header-bypass removal and must continue to pass unmodified after CORS pinning.

**4. Doc reconciliation** (`docs/ARCHITECTURE.md`)
- Rewrite the "Sync" bullet under "High-level Design" and the entire "Sync Protocol" / "Conflict Rules" sections to describe the actual implementation: whole-task and whole-list rows returned over HTTP via `POST /sync/pull` and `POST /sync/push`, scoped by role and list grants, incremental fetch via a `since_ts` cursor (`cursor_ts` in the response), no WebSocket, no changesets, no version vectors, no per-field LWW in the current implementation (conflict handling today is whole-row overwrite via the existing task update endpoints, not a documented CRDT/LWW scheme — the Principal Engineer should confirm and describe the actual current conflict behavior precisely during design).
- Preserve the aspirational protocol (changesets, version vectors, WebSocket live sync, per-field LWW, deterministic tiebreak) by moving it into a clearly labeled "Roadmap" / "Future" subsection rather than deleting it outright.
- `docs/ARCHITECTURE.md` is the **only** doc touched for this change, per the repo's "exactly one doc" change-hygiene rule. Any other operationally-relevant note (CORS env var usage, fail-closed boot behavior, token invalidation on deploy) goes into the PR description / release notes, not into a second doc.

## Out of scope

- **Branch 2** (separate, later): sync-contract changes — COALESCE field-clear bug, op_id-keyed applied results / staleness check.
- **Branch 3** (separate, later): incremental IndexedDB writes.
- New auth mechanisms (OAuth/SSO/MFA), password reset flows, rate limiting / brute-force protection beyond what already exists — none of these were findings in scope for this branch.
- Changing the JWT token lifetime (remains 30 days) — not a finding in scope; only the secret-handling and header-bypass behavior change.
- Any new roles/permissions model — role enforcement (admin/contributor) is strengthened by removing the bypass, not redesigned.
- General secret-strength policy (e.g. minimum length/entropy checks beyond matching known-default literals) — out of scope unless the Principal Engineer determines it's required to close the actual vulnerability; if so, flag it as a design-stage addition, not assumed here.

## Constraints

- **Server-side role enforcement stays server-authoritative** — this feature strengthens it; nothing in this branch or the deferred branches may weaken it.
- **Offline-first must hold** — client-side changes (removing legacy auth mode) must not affect the app's ability to work offline once a valid token exists.
- **Sync determinism must not regress** — the push/pull internal call path is being refactored (headers → direct `RequestCtx`); push/pull idempotency and conflict resolution behavior must be unchanged by the refactor, only the auth plumbing changes.
- **Never `--no-verify`**; all quality gates (`pre-commit`, `pre-push`, CI) must pass without bypass.
- **QA review is MANDATORY, not optional, for this feature** — an adversarial pass is required specifically on everything touching `ctx_from_headers` and the sync push/pull internal call path, before acceptance.
- **Process note for later stages:** `cargo test` requires a C linker (`cc`) that may be absent in a specialist sandbox; CI has it. Specialist agents must verify they can link before trusting local `cargo test` results, or defer to CI.
- Deferring branch-2/branch-3 findings to separate, already-approved branches is **not** the same as deferring required testing on *this* branch's changes — every change made in this branch still requires its full test coverage per `docs/CONTRIBUTING.md` ("Tests required per PR"). No conflict with CONTRIBUTING.md was found: nothing in this scope defers coverage that CONTRIBUTING.md requires of this change.

## Open questions resolved

### Q1: Remove the header-auth bypass entirely, or gate it behind an explicit opt-in env var (default off)?

**Decision: Remove it entirely. No env gate, no opt-in flag.**

Rationale:
- The bypass allows unauthenticated impersonation of any user, including admin, with only a guessable header value — this is a full authentication bypass, not a role-enforcement nuance. `CLAUDE.md`'s non-negotiable is that auth stays server-authoritative; an opt-in flag that defaults off still leaves the vulnerable code path resident in the binary as a footgun (a misconfigured or copy-pasted deployment could flip it on).
- The only reason this fallback still exists is the ~40 integration tests and the `sync_push`/`sync_pull` internal re-invocation pattern, which are *both already being refactored away* in this same branch (tests mint real JWTs; sync passes `RequestCtx` directly). Once those two consumers are gone, there is no legitimate remaining caller of the header path — keeping a flag preserves attack surface for zero functional benefit.
- Matches `docs/CONTRIBUTING.md`'s "fail fast and visibly" and "explicit over implicit" principles: an unauthenticated fallback, gated or not, is implicit trust in client-supplied identity headers.

### Q2: Fail closed (refuse to boot) vs. prominent warning on default secrets — and under what condition?

**Decision: Fail closed, always — not gated behind a "production" flag.** The server refuses to start (non-zero exit, clear log message) if, for either `JWT_SECRET` or `DEV_LOGIN_PASSWORD`:
- the env var is unset or empty, **or**
- it exactly matches a known default/placeholder literal: `JWT_SECRET` = `"tasksync-dev-secret"` (the Rust code's current hardcoded default) or `"change-me"` (`docker-compose.yml`'s current placeholder default); `DEV_LOGIN_PASSWORD` = `"tasksync"` (both the code default and the documented seed/dev password).

Rationale:
- This is a single self-hosted binary (`docs/ARCHITECTURE.md`: "Simplicity — one server binary") with no reliable runtime signal that distinguishes "production" from "dev" deployments. Introducing a `--production`/env-flag gate adds a *new* config surface that itself defaults to some value and can be misconfigured or left off — recreating the same class of bug this item exists to close.
- `README.md` already instructs operators to `cp .env.example .env` and explicitly change `JWT_SECRET` before running in Docker — fail-closed-always only enforces what deployment docs already ask for; it converts a documentation-only expectation into a verified boot invariant.
- Grounded check confirms this doesn't break the test suite: `server/src/routes/mod.rs` integration tests construct `AppState` directly with `"test-secret"`/`"test-pass"` and never call `app_state()`, so `cargo test` needs no env vars set and is unaffected.
- Grounded check also surfaces a real gap this decision must close as part of scope (see Scope §2): `scripts/2-serve.ps1` and the documented `cargo run` local-dev flow currently rely entirely on the removed hardcoded defaults, with no `.env`/dotenv loading in `server/src/main.rs`. This branch must give local dev an explicit, documented secret source (mechanism TBD at design stage) so `cargo run`/`scripts/2-serve.ps1` keep working — a warning-only approach would have avoided this problem, but at the cost of leaving the actual vulnerability (guessable production secret) unaddressed, which is not an acceptable trade given the non-negotiable that auth stays server-authoritative.

## Acceptance criteria

**Finding 1 — Remove header-auth bypass**
- [ ] `ctx_from_headers` in `server/src/routes/types.rs` has no code path that derives a `RequestCtx` from `x-space-id`/`x-user-id` headers; a request with only those headers and no `Authorization` header returns `401`.
- [ ] All integration tests in `server/src/routes/mod.rs` (and any other affected test files) that previously authenticated via `x-space-id`/`x-user-id` headers are refactored to mint and use real JWTs through the existing `issue_token`/Bearer-token path; `cargo test` passes; no test-only auth-bypass helper is introduced as a substitute.
- [ ] `sync_push` and `sync_pull` (`server/src/routes/sync.rs`) pass an already-authenticated `RequestCtx` directly into the task/list handlers instead of synthesizing `x-space-id`/`x-user-id` headers; `tasks.rs`/`lists.rs` handler signatures are updated accordingly; sync push/pull idempotency behavior (per `docs/RELIABILITY.md`) is verified unchanged by test.
- [ ] `web/src/lib/api/headers.ts` no longer contains the `x-space-id`/`x-user-id`/`x-role` fallback, the `AuthMode` type, or the `tasksync:auth-mode` key; `getAuthMode`/`setAuthMode` are removed or reduced to token-only no-ops as appropriate.
- [ ] A client with a pre-existing `tasksync:auth-mode: legacy` value in localStorage from before the upgrade is routed to the login screen gracefully on next load after upgrade (stale mode cleared, no hard error/blank screen/infinite loop) — covered by a unit or E2E test.

**Finding 2 — Fail closed on default secrets**
- [ ] Starting the server with `JWT_SECRET` unset, empty, `"tasksync-dev-secret"`, or `"change-me"` exits non-zero with a clear preflight error log, in every run mode (no flag disables this check).
- [ ] Starting the server with `DEV_LOGIN_PASSWORD` unset, empty, or `"tasksync"` exits non-zero with a clear preflight error log, in every run mode.
- [ ] Starting the server with real, non-default values for both boots successfully.
- [ ] `cargo test` passes without requiring `JWT_SECRET`/`DEV_LOGIN_PASSWORD` to be set in the test environment (confirms the fail-closed check only gates the `app_state()` boot path, not test construction).
- [ ] The documented local dev workflow (`README.md` "Running from source", `scripts/2-serve.ps1`, `scripts/1-seed.ps1` where applicable) boots successfully from a clean checkout after this change, via an explicit documented secret-source mechanism (not the removed hardcoded default).
- [ ] `docker-compose.yml`'s `JWT_SECRET` handling no longer allows a fresh `docker compose up` to silently boot on the `change-me` placeholder; it fails closed consistent with `README.md`'s existing "change `JWT_SECRET` in `.env`" instruction.

**Finding 3 — Pin CORS**
- [ ] `server/src/main.rs`'s `CorsLayer` uses an env-configurable origin allow-list and an explicit enumerated header set — no `allow_origin(Any)` or `allow_headers(Any)` remains.
- [ ] A CORS preflight/request from a non-allow-listed origin does not receive a matching `Access-Control-Allow-Origin` header (verified via curl or an integration test against a running server with a configured allow-list).
- [ ] The allow-list mechanism, when configured for local dev, permits `http://localhost:5173` and `http://localhost:4173` (verified against `web/playwright.config.ts` and the documented dev server port).
- [ ] The allow-list mechanism permits `capacitor://localhost` for the Capacitor iOS shell (verified against `web/capacitor.config.ts`'s lack of a `server.iosScheme` override, confirming Capacitor's default iOS scheme applies).
- [ ] `docker-compose.yml` gains an env-configurable CORS origin variable wired to the server's `environment:` block, and `README.md`'s reverse-proxy section documents it alongside the existing `VITE_API_URL`/`VITE_ALLOWED_HOSTS` guidance.
- [ ] `npm run test:e2e:smoke` (Playwright, Chromium `@smoke`) passes unmodified in its auth approach after CORS pinning lands.

**Finding 4 — Doc reconciliation**
- [ ] `docs/ARCHITECTURE.md`'s "Sync" bullet, "Sync Protocol" section, and "Conflict Rules" section describe the actual current implementation (whole-task/whole-list rows over HTTP, `since_ts` cursor, role/grant-scoped, no WebSocket) with no current-state claims of changesets, version vectors, or per-field LWW.
- [ ] The aspirational protocol (changesets, version vectors, WebSocket live sync, per-field LWW) is preserved under a clearly labeled Roadmap/Future subsection rather than deleted.
- [ ] `docs/ARCHITECTURE.md` is the only file under `docs/` modified for this change.

**Operational consequences**
- [ ] The PR description / release notes explicitly state: setting/changing `JWT_SECRET` invalidates all existing 30-day tokens, so every device must re-login after this deploys.
- [ ] The PR description / release notes explicitly state, as a pre-upgrade checklist item: if the current deployment relies on a default/placeholder `JWT_SECRET`, the server will refuse to boot after upgrade until a real secret is set in `.env`/environment — operators must set it before deploying.
- [ ] The PR description / release notes explicitly state that devices still in legacy header-auth mode will 401 after upgrade and must re-login (client handles this gracefully per the Finding 1 criterion above, not via a hard error).

## Release notes / preflight

- **Token invalidation:** Any `JWT_SECRET` rotation as part of this deploy invalidates all existing 30-day tokens. Every device (PWA, Capacitor iOS) logs out and must re-login post-deploy. Coordinate the deploy window accordingly.
- **Boot preflight required:** If the current Docker deployment is running on the default/placeholder `JWT_SECRET` (`tasksync-dev-secret` or `change-me`) or default `DEV_LOGIN_PASSWORD` (`tasksync`), the upgraded server will **refuse to boot** until real values are set in `.env`. Set them *before* pulling the new image.
- **Legacy-mode clients:** Any device still running in legacy header-auth mode (pre-dates the client's token-mode-only auth) will receive `401`s from the upgraded server and must refresh + re-login. The client clears the stale `tasksync:auth-mode` state and routes to login gracefully rather than erroring.
- **PWA update lag:** Because service-worker-cached clients update asynchronously, some devices may run old client JS against the new server for a period. Old token-mode clients are unaffected (still authenticate correctly). Old legacy-mode clients fail (401) until they refresh and re-login. This is acceptable and expected — no additional mitigation planned.
- **CORS:** Confirm the deployed allow-list includes the operator's actual PWA origin (self-hosted, so this is deployment-specific) in addition to the standard local dev / Playwright / Capacitor origins baked into defaults, or configuration will silently block the production frontend.

## Design

### Approach

All four work items are auth/config plumbing with zero data-model impact. The
design principle throughout: **authenticate once at the HTTP boundary, pass the
proven identity (`RequestCtx`) explicitly everywhere else** — no re-derivation,
no synthesized headers, no test back doors. Work item 1 makes `ctx_from_headers`
Bearer-token-only and splits the five sync-invoked handlers into a thin HTTP
wrapper plus a `*_for_ctx` core that takes `RequestCtx` directly. Work item 2
moves secret reading from silent-default (`unwrap_or_else`) to a boot preflight
in `main()` that validates both secrets against the decided denylist and exits
non-zero on failure; local dev keeps working via `dotenvy` loading the existing
repo-root `.env`. Work item 3 replaces `allow_origin(Any)`/`allow_headers(Any)`
with a boot-time-parsed allow-list: three baked-in dev origins plus operator
origins from a new `CORS_ALLOWED_ORIGINS` env var (additive, so the Capacitor
iOS origin can never be accidentally dropped). Work item 4 rewrites
`docs/ARCHITECTURE.md`'s sync sections to describe the real HTTP + `since_ts`
protocol, moving the aspirational changeset/version-vector/WebSocket design into
the existing Roadmap section.

Mapping to acceptance criteria: work item 1 → F1 criteria 1–5; work item 2 →
F2 criteria 1–6; work item 3 → F3 criteria 1–6; work item 4 → F4 criteria 1–3;
the three operational criteria are satisfied in the PR description at `/done`.

### Work item 1 — remove the header-auth bypass

**`server/src/routes/types.rs` — `ctx_from_headers`:** signature is unchanged
(`(&HeaderMap, &AppState) -> Result<RequestCtx, StatusCode>`); the body becomes
Bearer-only. Missing `Authorization` header, missing `Bearer ` prefix, invalid
token, or missing membership all return `401`. Lines 120–133 (the
`x-space-id`/`x-user-id` fallback) are deleted with no replacement. This is the
single authentication boundary; everything downstream trusts `RequestCtx`
(CONTRIBUTING.md: validate at boundaries, internals trust the contract).

**`server/src/routes/tasks.rs` / `lists.rs` — handler split.** Only the five
handlers that sync re-invokes are split into an HTTP wrapper + core. The HTTP
wrappers keep their current names and signatures (so `Router` wiring and the
`mod.rs` tests are untouched in shape); each wrapper authenticates and delegates:

```rust
// tasks.rs — new core functions (bodies are the existing logic, verbatim)
pub(super) async fn get_tasks_for_ctx(
    state: &AppState, ctx: &RequestCtx,
) -> Result<Vec<TaskRow>, StatusCode>;

pub(super) async fn create_task_for_ctx(
    state: &AppState, ctx: &RequestCtx, body: CreateTask,
) -> Result<(StatusCode, TaskRow), StatusCode>;

pub(super) async fn update_task_meta_for_ctx(
    state: &AppState, ctx: &RequestCtx, id: String, body: UpdateTaskMeta,
) -> Result<TaskRow, StatusCode>;

pub(super) async fn update_task_status_for_ctx(
    state: &AppState, ctx: &RequestCtx, id: String, body: UpdateTaskStatus,
) -> Result<TaskRow, StatusCode>;

// lists.rs
pub(super) async fn get_lists_for_ctx(
    state: &AppState, ctx: &RequestCtx,
) -> Result<Vec<ListRow>, StatusCode>;
```

Cores return plain data; the HTTP wrappers wrap in `Json(...)`. The HTTP entry
points reach the cores via `ctx_from_headers` on the request headers; the sync
internal callers reach the same cores by passing the already-authenticated
`ctx`. The remaining handlers (`delete_task`, `create_list`, `update_list`,
`delete_list`, all `auth_*`) have no internal callers and keep their current
shape unchanged — no speculative splitting (DRY-but-not-prematurely).

**`server/src/routes/sync.rs`:** `headers_for_ctx` is deleted. `sync_pull` and
`sync_push` keep their public signatures, call `ctx_from_headers` exactly once,
then call the `*_for_ctx` cores with `&ctx`. No `HeaderValue` construction, no
fake `HeaderMap`s. The per-change loop, `op_id` rejection reporting, 500-change
cap, `sync_cursor_for_ctx`, and `deleted_tasks_for_ctx` are untouched.

**`web/src/lib/api/headers.ts`:** shrinks to token-only: `getAuthToken`,
`setAuthToken`, and `buildHeaders` (returns `{ authorization: Bearer … }` or
`{}`). Deleted: `AuthMode` type, `getAuthMode`, `setAuthMode`, the
`tasksync:auth-mode` key constant, and the `spaceId`/`userId`/`role` module
constants (which also retires the `VITE_SPACE_ID`/`VITE_USER_ID`/`VITE_ROLE`
reads — those three lines are removed from `.env.example`).

**`web/src/lib/stores/auth.ts` — stale-state handling:** `AuthState.mode` and
the `'legacy'` variant of `source` are removed (grounded: no Svelte component
reads either field — only `auth.ts` and its tests). `hydrate()` starts with a
one-time cleanup, `localStorage.removeItem('tasksync:auth-mode')`, then follows
the existing token-only flow: no token → `anonymous` → the existing layout
routing shows the login screen. A pre-upgrade device holding
`tasksync:auth-mode: legacy` and no token therefore lands on login with no
network call, no error state, and no loop — covered by a new unit test in
`auth.test.ts` (seed the stale key, `hydrate()`, assert `anonymous` + key
removed). Test files updated: `headers.test.ts`, `auth.test.ts`,
`tasks.test.ts` (drops its `tasksync:auth-mode` seeding).

### Known-trap call-outs (explicit, per standing constraint)

1. **`mod.rs` tests keep exercising the REAL JWT auth path.** The ~40 tests
   currently inserting `x-space-id`/`x-user-id` switch to a single test helper:

   ```rust
   fn auth_headers(state: &AppState, user_id: &str, space_id: &str) -> HeaderMap
   ```

   which calls the production `issue_token(user_id, space_id,
   &state.jwt_secret)` and inserts `Authorization: Bearer <token>`. Every test
   request then flows through the real `ctx_from_headers` → JWT decode →
   `role_from_membership` path against `test_state()`'s `"test-secret"`. This
   is **not** a bypass helper: it mints a genuine signed token and there is no
   code path in the product or tests that constructs a `RequestCtx` without a
   verified token, other than sync passing on a ctx it obtained from
   `ctx_from_headers`. Explicitly rejected: any `#[cfg(test)]` constructor or
   extractor shortcut that fabricates `RequestCtx` — that would remove the very
   coverage this branch exists to create. New negative tests: headers-only
   request → `401`; garbage/expired token → `401`; valid token for a user with
   no membership → `401`.

2. **`sync_push`/`sync_pull` pass `RequestCtx` directly — no header
   synthesis.** The signatures above are the concrete shape: HTTP entry points
   authenticate once, cores receive `&RequestCtx` as a parameter. Idempotency
   and conflict behavior are provably unchanged because the core function
   bodies are the existing handler bodies moved verbatim — the only delta is
   how `ctx` arrives. The existing sync idempotency tests in `mod.rs` (re-push
   same `op_id`/task-id payload → no duplicates via the unique-violation →
   return-existing-row path; re-pull → same snapshot) are kept and re-run
   against the refactored path, satisfying F1 criterion 3 and
   `docs/RELIABILITY.md`'s sync invariants.

3. **CORS allow-list covers the Capacitor iOS origin.** Verified:
   `web/capacitor.config.ts` sets only `appId`/`appName`/`webDir` — no
   `server.iosScheme` override — so Capacitor's default iOS scheme applies and
   the origin is exactly `capacitor://localhost`. It is one of the three
   **baked-in** defaults (see CORS design below) that remain allowed even when
   an operator sets `CORS_ALLOWED_ORIGINS`, so a self-hosted operator cannot
   silently break the iOS app by forgetting it.

### Work item 2 — fail closed on default secrets

**Boot-check placement:** validation lives in `server/src/routes/types.rs`
next to `app_state()` (single module owns secret knowledge), invoked from
`main()` **before** the database connect:

```rust
// types.rs
pub(super) const JWT_SECRET_DENYLIST: [&str; 2] = ["tasksync-dev-secret", "change-me"];
pub(super) const DEV_LOGIN_PASSWORD_DENYLIST: [&str; 1] = ["tasksync"];

// Pure and unit-testable without env mutation:
fn validate_secret(name: &str, value: Option<String>, denylist: &[&str])
    -> Result<String, String>;

// Reads env, aggregates ALL failures into one actionable message
// (re-exported through routes/mod.rs for main.rs):
pub fn validate_boot_secrets() -> Result<(), String>;
```

`main()` calls `validate_boot_secrets()` first thing after tracing init and
propagates the error (`anyhow!`), so the process logs one clear preflight error
naming each failing variable, the reason (unset / empty / known default), the
fix (`set it in .env — see .env.example`), and exits non-zero. `app_state()`
drops both `unwrap_or_else` defaults and becomes
`env::var("JWT_SECRET").expect("validated by validate_boot_secrets at boot")`
(same for `DEV_LOGIN_PASSWORD`) — the boundary has already validated, internals
assert the contract. No production flag exists; the check runs in every mode,
per the resolved Q2.

**Why `cargo test` is unaffected:** the integration tests construct `AppState`
directly via `test_state()` (`"test-secret"`/`"test-pass"`) and call handlers
as functions; nothing in the test tree calls `app_state()`, `main()`, or the
route-constructor functions (`auth_routes` etc.) that call `app_state()`.
Implementation must re-verify that last claim with a grep before merging. The
denylist matrix (unset/empty/each literal/valid) is unit-tested through the
pure `validate_secret` — no env-var mutation in tests, which would be racy
under parallel test execution. The seed binary (`src/bin/seed.rs`) reads only
`DATABASE_URL`/`SEED_*` vars, so `scripts/1-seed.ps1` is unaffected.

**Local-dev secret sourcing — decision: `dotenvy` (`.env` loading in
`main.rs`).** Add the `dotenvy` crate; `main()` opens with `dotenvy::dotenv()`
(result logged: "loaded .env from <path>" / "no .env file found"), before the
preflight. `dotenvy` searches the current directory and its ancestors and does
**not** override already-set process env, so:

- `cd server && cargo run` (README flow) picks up the repo-root `.env` the
  operator already creates via `cp .env.example .env` — one secret source
  shared by Docker Compose and source builds.
- `scripts/2-serve.ps1` needs no env plumbing (it runs cargo from `server/`,
  and `.env` is found one level up); it gains only a friendly pre-check that
  warns and exits early if no repo-root `.env` exists.
- Real environment variables still win (production/Docker behavior unchanged).

Rejected alternatives: **(a)** script-generated random secrets per run — every
server restart would invalidate dev tokens (constant re-login), and the
PowerShell script doesn't cover the documented bare `cargo run` flow; **(b)**
README-only "export these vars" instructions — per-shell, fragile, and
guaranteed to produce recurring "server won't boot" friction; **(c)** a
hardcoded non-denylisted dev literal in scripts — just recreates a new known
default, the exact bug class this item closes.

**`.env.example` and `docker-compose.yml`:** `.env.example` ships
`JWT_SECRET=` and `DEV_LOGIN_PASSWORD=` **empty**, each with a `# REQUIRED:`
comment stating the server refuses to boot until a real value is set.
`docker-compose.yml` switches both to Compose's required-variable syntax —
`JWT_SECRET: ${JWT_SECRET:?Set JWT_SECRET in .env (see .env.example)}` and
likewise for `DEV_LOGIN_PASSWORD` — so a fresh `docker compose up` on an
unedited `.env` fails immediately at interpolation time with an explicit
message instead of entering a `restart: unless-stopped` crash loop. The server
preflight remains the authoritative backstop (Compose `:?` cannot check
denylist literals, only unset/empty).

### Work item 3 — pin CORS

**Env var:** `CORS_ALLOWED_ORIGINS` — comma-separated exact origins
(scheme + host [+ port], no path, no trailing slash), e.g.
`CORS_ALLOWED_ORIGINS=https://tasks.example.com`.

**Semantics — additive to baked-in defaults.** The effective allow-list is the
union of:

- `capacitor://localhost` (Capacitor iOS shell — see trap call-out 3)
- `http://localhost:5173` (SvelteKit dev server / Compose web default)
- `http://localhost:4173` (Playwright preview, per `web/playwright.config.ts`)
- every entry in `CORS_ALLOWED_ORIGINS` (operator's self-hosted PWA origin(s))

Additive rather than replace, because the always-required Capacitor origin
must not depend on operators remembering to re-list it. The residual exposure
of allowing `http://localhost:*` origins against a production server is
accepted: an attack requires code already running on the victim's own
localhost ports, and the API requires a Bearer token regardless.

**Implementation:** a pure `parse_allowed_origins(raw: Option<String>) ->
Result<Vec<HeaderValue>, String>` in `main.rs` (unit-tested in a `#[cfg(test)]`
module there: empty/unset → defaults only; valid list → union; malformed entry
→ error naming the entry). Malformed entries **fail the boot** with a clear
message — consistent with the work-item-2 preflight; a silently dropped origin
would mean a silently broken production frontend. The `CorsLayer` becomes:

- `allow_origin(AllowOrigin::list(origins))`
- `allow_methods` — unchanged enumerated set (GET/POST/PATCH/PUT/DELETE/OPTIONS)
- `allow_headers([AUTHORIZATION, CONTENT_TYPE])` — the only two headers the
  client sends after `x-space-id`/`x-user-id`/`x-role` are retired. No
  `allow_credentials` (auth is Bearer-header, not cookies).

**Wiring:** `docker-compose.yml` server block gains
`CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-}` (optional — defaults cover
non-CORS same-origin reverse-proxy setups); `.env.example` gains a commented
example; `README.md`'s reverse-proxy operating note documents it alongside the
existing `VITE_API_URL`/`VITE_ALLOWED_HOSTS` guidance.

**E2E survival:** Playwright runs against `http://localhost:4173` (baked-in
default) and its specs stub server endpoints via `page.route` (grounded in
`auth.spec.ts`), so browser-level CORS never applies to the mocked calls; any
real-server smoke traffic originates from an allow-listed origin. F3 criterion
6 (`npm run test:e2e:smoke` passes unmodified) holds. Verification of F3
criterion 2 (non-allow-listed origin gets no `Access-Control-Allow-Origin`) is
a curl check documented in the verify stage, plus the parse-function unit
tests.

### Work item 4 — ARCHITECTURE.md sync reconciliation

Confirmed actual behavior (grounded in `sync.rs`, `tasks.rs`, and
`migrations/`):

- **Transport:** HTTP only — `POST /sync/pull` and `POST /sync/push`
  (protocol tag `"delta-v1"`). No WebSocket anywhere in the server.
- **Pull:** returns whole `ListRow`/`TaskRow` rows scoped by role and list
  grants. Lists are always a full snapshot; tasks are filtered to
  `updated_ts >= since_ts` and deletions to tombstones with
  `deleted_ts >= since_ts` when `since_ts` is supplied. `cursor_ts` =
  max(task `updated_ts`, tombstone `deleted_ts`) within the caller's scope.
- **Push:** up to 500 changes (`create_task` / `update_task` /
  `update_task_status`), each applied sequentially through the same code paths
  as the REST endpoints; per-op failures are reported in `rejected[]` keyed by
  `op_id`; `applied[]` is a list of resulting task rows (not op_id-keyed —
  that is the known branch-2 finding and is documented as-is, not fixed here).
- **Idempotency:** client-supplied task ids make re-pushed creates converge
  (unique violation → return existing row, HTTP 200 vs 201); updates are
  absolute-value writes, so replays are no-ops; re-pulls are pure reads.
- **Conflict behavior (precise wording for the rewrite):** *arrival-order,
  whole-row overwrite* — the last write to **reach the server** wins for the
  fields it carries. `update_task_meta` applies `coalesce(?, column)` per
  column, so omitted optional fields are preserved and provided fields
  overwrite unconditionally; there is **no** comparison of client vs server
  timestamps, no version vectors, no per-field LWW by logical clock, and no
  tiebreak rule. (The punt fields `punted_from_due_date`/`punted_on_date` are
  written unconditionally, and status transitions manage `completed_ts` — the
  COALESCE can't-clear-a-field wart is the deferred branch-2 finding.) Deletes
  converge via `task_tombstone` rows; a create for a tombstoned id clears the
  tombstone (deliberate resurrect-on-create).

Edits to `docs/ARCHITECTURE.md` (the only doc touched):

1. "High-level Design" — rewrite the **Sync** and **Conflicts** bullets to the
   reality above.
2. Component diagram — `[WebSocket/HTTP]` becomes `[HTTP]`; `[Sync Engine]`
   stays (the client sync coordinator is real).
3. "Sync Protocol (concise)" — replace Hello/Delta/Push/Live with the actual
   pull/push request/response shapes (`since_ts`, `cursor_ts`, `op_id`,
   `applied`/`rejected`, 500-change cap, role/grant scoping).
4. "Conflict Rules" — replace with the arrival-order overwrite description,
   tombstone convergence, and fractional `task_order` keys (which are real).
5. Data model / "Key Tables" — the `Change { … }` entity and the `change`
   table SQL describe a table that **does not exist in any migration**
   (grounded: `migrations/` has no `change` table); move both into the Roadmap
   subsection.
6. "Roadmap" — add a clearly-labeled "Future sync protocol (aspirational —
   not implemented)" entry preserving changesets, version vectors, WebSocket
   live sync, per-field LWW + deterministic tiebreak, and the `Change` schema.

Server code, CORS, and secret behavior are deployment/config concerns and per
the exec plan go in the PR description/release notes, not a second doc.

### Component changes (summary)

- **`server/src/routes/types.rs`** — `ctx_from_headers` Bearer-only;
  `app_state()` drops env defaults; new denylist consts, `validate_secret`,
  `validate_boot_secrets` (+ unit tests).
- **`server/src/routes/tasks.rs`** — `get_tasks`/`create_task`/
  `update_task_meta`/`update_task_status` split into HTTP wrapper +
  `*_for_ctx` core; `delete_task` unchanged.
- **`server/src/routes/lists.rs`** — `get_lists` split; other handlers
  unchanged.
- **`server/src/routes/sync.rs`** — `headers_for_ctx` deleted; cores called
  with `&ctx`.
- **`server/src/routes/mod.rs`** — re-export `validate_boot_secrets`; tests:
  new `auth_headers` real-JWT helper, ~40 call sites mechanically converted,
  new 401-path negative tests.
- **`server/src/main.rs`** — `dotenvy::dotenv()`, secret preflight,
  `parse_allowed_origins` + pinned `CorsLayer` (+ unit tests).
- **`server/Cargo.toml`** — add `dotenvy`.
- **`web/src/lib/api/headers.ts`** (+ test) — token-only.
- **`web/src/lib/stores/auth.ts`** (+ test) — drop `mode`/legacy `source`;
  stale-key cleanup in `hydrate()`; stale-legacy-mode unit test.
- **`web/src/lib/stores/tasks.test.ts`** — drop `tasksync:auth-mode` seeding.
- **`docker-compose.yml`**, **`.env.example`**, **`README.md`**,
  **`scripts/2-serve.ps1`** — config/doc wiring per items 2–3.
- **`docs/ARCHITECTURE.md`** — per item 4.

### Data model changes

None. No migrations, no schema edits, no new entities. Confirmed: every change
in this branch is auth plumbing, boot validation, CORS config, and
documentation; `task`, `task_tombstone`, and all other tables are untouched.

### API changes

- **Breaking (intended):** requests carrying only `x-space-id`/`x-user-id`
  (no valid Bearer token) now receive `401` on every endpoint. This is the
  vulnerability fix; legacy-mode clients must re-login (release-noted).
- **Unchanged:** all endpoint paths, request/response bodies, and the
  `/sync/pull`–`/sync/push` wire format (`delta-v1`) are byte-identical.
- **New config surface:** `JWT_SECRET` and `DEV_LOGIN_PASSWORD` become
  mandatory (boot-validated); new optional `CORS_ALLOWED_ORIGINS`.

### Alternatives considered

- **Axum extractor (`FromRequestParts` for `RequestCtx`) instead of
  wrapper+core split** — idiomatic and removes wrapper boilerplate, but the
  `mod.rs` tests call handlers as plain functions, so they would have to
  construct `RequestCtx` values directly — a de-facto auth bypass in tests,
  violating trap 1 — or the whole suite would need conversion to
  `tower::ServiceExt::oneshot` router-level requests (a much larger, riskier
  test rewrite than the mechanical header swap). Rejected.
- **Env-gated bypass / test-only bypass helper** — rejected by resolved Q1 and
  trap 1; not revisited.
- **Local-dev secrets via script-generated values or README-only exports** —
  rejected; see work item 2 rationale.
- **`CORS_ALLOWED_ORIGINS` replaces (rather than extends) defaults** — more
  operator control, but one forgotten `capacitor://localhost` silently bricks
  the iOS app (trap 3) and a forgotten `localhost:5173` breaks dev against a
  shared server. Union semantics chosen; the marginal localhost exposure is
  documented and accepted.
- **Warn-and-continue on malformed CORS entries or default secrets** —
  rejected: contradicts resolved Q2 and "fail fast and visibly"; a warning in
  a Docker log closes no vulnerability.

### Risks and mitigations

- **Risk:** `JWT_SECRET` rotation invalidates every outstanding 30-day token —
  all devices (PWA + iOS) log out at deploy. → **Mitigation:** release-note
  preflight (already in this plan); deploy when re-login is acceptable; no
  code mitigation possible or desired.
- **Risk:** existing deployments running on `change-me`/`tasksync-dev-secret`
  refuse to boot after upgrade. → **Mitigation:** Compose `:?` interpolation
  fails at `docker compose up` with an explicit message (no crash loop for the
  unset/empty case); server preflight message names the variable and the fix;
  release-note checklist item.
- **Risk:** legacy-mode devices 401 after upgrade. → **Mitigation:** client
  clears `tasksync:auth-mode` and routes to login (unit-tested); PWA
  update-lag window accepted and release-noted.
- **Risk:** sync refactor accidentally alters push/pull semantics. →
  **Mitigation:** core bodies are moved verbatim, not rewritten; existing
  idempotency/conflict tests re-run on the new path; mandatory adversarial QA
  pass on `ctx_from_headers` + sync call path (process constraint).
- **Risk:** `dotenvy` picks up an unexpected ancestor `.env`. →
  **Mitigation:** boot log line prints which file was loaded (or that none
  was); real env vars always take precedence.
- **Risk:** operator sets `CORS_ALLOWED_ORIGINS` with a trailing slash or a
  path and gets a confusing boot failure. → **Mitigation:** parse error names
  the offending entry and shows a valid example.

### Performance impact

No expected impact on performance budgets. The sync request path loses a
per-change `HeaderMap` construction/parse round-trip (negligible win); CORS
list matching and the one-time boot preflight are off the hot path; client
changes remove code. No budget in `docs/RELIABILITY.md` is approached, and the
sync-ack budget (<500 ms WAN) is unaffected — the DB work per change is
identical.

### Design Addendum (2026-07-02) — anonymous IDB scope key

The grounding claim in "Work item 1 — `web/src/lib/stores/auth.ts` — stale-state
handling" above ("no Svelte component reads either field — only `auth.ts` and its
tests") is **false**; it stays as written per append-only history and is corrected
here. `web/src/routes/+layout.svelte:186` (`storageScopeFromAuth`) reads
`AuthState.mode` to derive the IndexedDB storage scope key for non-authenticated
states (used at ~190/256/322 to select the physical IDB database), and six E2E
files mirror or seed `tasksync:auth-mode`. This addendum makes the data-scoping
decision that removing `mode` forces, and extends T4 accordingly. No server-side
change or data migration is required — T4 remains a single client task.

#### Grounding — what each scope actually holds today

- **Authenticated devices (token *or* legacy)** get the
  `space:{space_id}:user:{user_id}` scope whenever `status === 'authenticated'`.
  A legacy-mode device that successfully authenticated therefore kept its full
  task cache — and any dirty edits made while signed in — under the **space:user**
  scope, *not* `legacy-default`.
- **`legacy-default` is reachable only** when `tasksync:auth-mode` is explicitly
  `'legacy'` AND `hydrate()` ends `anonymous` (server unreachable or 401). The app
  stays locally usable while anonymous (offline-first invariant; the signed-out
  E2E suites exercise exactly this), so a device in that state *could* have
  written local tasks under `legacy-default` — but only in that narrow
  signed-out window.
- **No migration between scopes exists anywhere today.** When an anonymous device
  logs in, the reactive `scopeKey` flips and the anonymous database
  (`token-anonymous` or `legacy-default`) is left behind unreferenced. Orphaning
  anonymous-scope data on auth transitions is existing, accepted behavior — with
  the further precedent that the pre-scoping `tasksync_legacy` database
  (`idb.ts`'s default scope) was orphaned in place when scoping shipped.

**Answer to "was `legacy-default` ever a real data home":** never for
authenticated data (that always lived under `space:user`); only transiently for
tasks created while signed out on an explicitly-legacy device — data that
pre-change behavior would have orphaned at that device's next successful login
anyway.

#### Decision 1 — anonymous scope key: `'token-anonymous'` unconditionally

`storageScopeFromAuth` becomes:

```ts
const storageScopeFromAuth = (state: AuthState): string => {
	if (state.status === 'authenticated' && state.user) {
		return `space:${state.user.space_id}:user:${state.user.user_id}`;
	}
	return 'token-anonymous';
};
```

The authenticated key is unchanged. Every non-authenticated state maps to the
**existing** `'token-anonymous'` literal (rather than a new name like
`'anonymous'`) so every current signed-out token-mode device keeps opening the
same `tasksync_token-anonymous` database it already uses — zero data movement for
the overwhelmingly common case. `web/src/lib/data/idb.ts` is **unchanged**: its
`'legacy'` default scope and sanitize fallback are unreachable in practice
(`setDbScope` always runs before hydration) and touching them is out of scope.

#### Decision 2 — fate of `legacy-default` data: orphan

Existing `tasksync_legacy-default` databases are **orphaned**: left on the
device, never opened, never deleted, never migrated.

- **Rejected: delete-on-hydrate** — destructive and irreversible for zero
  benefit (a few KB of tasks; IDB storage pressure is not a concern), and it
  converts a recoverable state (data still on device, inspectable) into
  permanent loss.
- **Rejected: migrate** — merging an anonymous scope into `token-anonymous` (or
  a later account scope) invents merge semantics that exist nowhere today, not
  even for the mainstream `token-anonymous` → login transition. That violates
  sync determinism ("do not introduce branching behavior that isn't encoded and
  tested") and balloons T4 for a near-zero device population.
- **Offline-first check — holds:** a stale legacy device upgrades, `hydrate()`
  resolves `anonymous` with no network call, the app is fully usable locally
  under `token-anonymous`, and re-login re-pulls all server data into the
  unchanged `space:user` scope. The server remains a sync rendezvous, not a
  runtime dependency.

**Unsynced-dirty-edits ruling (explicit):**

- Dirty edits made while **signed in** on a legacy device live under
  `space:user` and are **not lost**: after upgrade and re-login as the same
  user, the same scope key is derived, the same database opens, and the dirty
  rows push normally.
- Tasks created while **signed out** on an explicitly-legacy device live under
  `legacy-default` and become invisible to the app after upgrade. This is an
  **accepted loss** and a release-note item. It requires a device that (a)
  still carries the explicit `tasksync:auth-mode: legacy` key, (b) used the app
  while unauthenticated, and (c) never logged in afterwards — and pre-change
  behavior would have orphaned that data at the next login regardless (which
  the T1 server change forces). Affected population is effectively zero.

**Release-note wording** (for the `/done` PR description, alongside the
existing legacy-mode re-login note):

> Devices still in legacy header-auth mode that created tasks **while signed
> out** kept that data in a device-local `legacy-default` store. After this
> upgrade the app uses the standard anonymous store instead; old
> `legacy-default` data stays on the device but is no longer shown, and if it
> was never synced it is effectively lost to the app. Signed-in data is
> unaffected — it lives on the server and in the per-account store and
> reappears after re-login. Expected affected devices: zero.

#### Decision 3 — E2E fallout (Finding B)

- **`web/tests/e2e/helpers/idb.ts`** — all four inlined `resolveScopedDbName()`
  copies drop the `tasksync:auth-mode` read and mirror the new scope function
  exactly: if `tasksync:auth-user` parses to `{user_id, space_id}` →
  `space:{space_id}:user:{user_id}`, else `'token-anonymous'`; the sanitize
  logic stays a verbatim copy of `idb.ts`. The four copies remain inlined —
  `page.evaluate` serializes its closure, so they cannot import a shared
  helper. Behavior is identical for every existing spec, because all current
  seeds set mode `'token'`.
- **The 10 seeding sites** delete their
  `localStorage.setItem('tasksync:auth-mode', 'token')` line and nothing else
  (`auth.spec.ts` ×3, `offline.spec.ts` ×4, `perf.spec.ts` ×1, `myday.spec.ts`
  ×1, `sidebar-drag.spec.ts` ×1). Each spec's remaining seed already provides
  everything the new scope logic reads: signed-out suites clear
  `tasksync:auth-token`/`tasksync:auth-user`, so app and helpers both resolve
  `token-anonymous` (the same DB name as today — `offline.spec.ts:162` already
  asserts the `tasksync_token-anonymous` literal); authenticated suites set
  token + user and resolve the unchanged `space:user` scope. Seeded data
  therefore lands exactly where the app reads it, with no scope-name shift in
  any suite.

#### Decision 4 — tests the scope decision requires

- **Unit (already in T4, stands):** seed stale `tasksync:auth-mode: legacy`
  with no token → `hydrate()` → `anonymous`, key removed, no network call.
- **Anonymous-scope assertion — existing E2E coverage suffices:** the
  signed-out suites read/write seeded data through the updated helpers against
  `tasksync_token-anonymous` and fail if the app resolves any other scope.
- **New E2E case in `auth.spec.ts` (stale-legacy device data fate):** pre-seed
  `tasksync:auth-mode: legacy` (no token, no user) AND a marker task in a
  manually-opened `tasksync_legacy-default` database; load the app; assert
  (a) it reaches the normal anonymous state with sign-in available — no error
  loop or blank screen, (b) the stale key is removed, (c) a task created while
  signed out lands in `tasksync_token-anonymous` (via the updated helper), and
  (d) the `tasksync_legacy-default` database still exists with its marker
  untouched (orphaned, not deleted). Not tagged `@smoke` (upgrade-path edge
  case; runs in the full CI matrix).

#### Amended T4 file fence

Original T4 files (`web/src/lib/api/headers.ts` + `headers.test.ts`,
`web/src/lib/stores/auth.ts` + `auth.test.ts`,
`web/src/lib/stores/tasks.test.ts`, `.env.example`) **plus**:
`web/src/routes/+layout.svelte`, `web/tests/e2e/helpers/idb.ts`,
`web/tests/e2e/auth.spec.ts`, `web/tests/e2e/offline.spec.ts`,
`web/tests/e2e/perf.spec.ts`, `web/tests/e2e/myday.spec.ts`,
`web/tests/e2e/sidebar-drag.spec.ts`. Grep-verify 2b must now come back
**fully clean**: zero `tasksync:auth-mode` references anywhere under `web/`
(src, tests, E2E, config), in addition to the already-clean
`VITE_SPACE_ID`/`VITE_USER_ID`/`VITE_ROLE`/`x-role` result.

## Task breakdown

Ordered by dependency. Server tasks T1→T2→T3 are sequential because they share
`types.rs` (T1, T2) and `main.rs` (T2, T3); doing them in order avoids self-inflicted
merge friction. T4 (client) and T5 (docs) are independent of the server tasks and of
each other. Each task is one SDE session. `.env.example` is touched by T2 (secrets),
T3 (CORS example), and T4 (remove VITE_* lines) — sequential ordering keeps those edits
non-overlapping.

Cross-cutting note carried from design review (Fable): the operational-consequence
acceptance criteria (release-notes items — F "Operational consequences" 1–3) are NOT an
implementation task; they are satisfied by the PR description authored at the `/done`
stage. Recorded here so acceptance does not expect a code change for them.

### T1 — Server auth: Bearer-only `ctx_from_headers` + wrapper/core handler split + sync refactor + `mod.rs` test migration
- **Description:** Make `ctx_from_headers` Bearer-token-only (delete the `x-space-id`/`x-user-id` fallback at `types.rs` ~120–133, no replacement). Split the five sync-invoked handlers into HTTP wrapper + `*_for_ctx` core per the Design signatures (`get_tasks`, `create_task`, `update_task_meta`, `update_task_status` in `tasks.rs`; `get_lists` in `lists.rs`). Delete `headers_for_ctx` in `sync.rs`; `sync_pull`/`sync_push` authenticate once via `ctx_from_headers` then call the cores with `&ctx` — no synthesized headers. Migrate the ~40 header-auth tests in `mod.rs` to a single real-JWT `auth_headers(state, user_id, space_id)` helper that calls production `issue_token` and sets `Authorization: Bearer`. Add negative tests.
- **Files:** `server/src/routes/types.rs`, `server/src/routes/tasks.rs`, `server/src/routes/lists.rs`, `server/src/routes/sync.rs`, `server/src/routes/mod.rs`.
- **Closes acceptance criteria:** F1-1 (headers-only + no Authorization → 401), F1-2 (tests use real JWTs via `issue_token`/Bearer, no test-only bypass helper), F1-3 (sync passes `RequestCtx` directly; push/pull idempotency unchanged).
- **Done when:**
  - `ctx_from_headers` has no `x-space-id`/`x-user-id` code path; the five `*_for_ctx` cores exist with the Design signatures and their bodies are the existing handler logic moved verbatim; `delete_task`/`create_list`/`update_list`/`delete_list`/`auth_*` are unchanged (no speculative splitting).
  - `headers_for_ctx` is deleted; `sync.rs` constructs no `HeaderValue`/`HeaderMap`.
  - `auth_headers` helper mints a genuine signed token; ~40 test call sites converted; NO `#[cfg(test)]` `RequestCtx` constructor/extractor shortcut is introduced (trap 1).
  - New negative tests pass: headers-only → 401; garbage/expired token → 401; valid token for a user with no membership → 401.
  - Existing sync idempotency/conflict tests (re-push same `op_id`/task-id → no dupes; re-pull → same snapshot) re-run green against the refactored path (trap 2, RELIABILITY.md sync invariants).
  - `cargo fmt -- --check`, `cargo clippy -- -D warnings`, `cargo test` pass. **SDE must first verify the sandbox can link (`cc` present); if not, run `cargo check`/`clippy` and explicitly defer `cargo test` to CI, stating so.**

### T2 — Boot preflight (fail-closed secrets) + `dotenvy` local-dev sourcing + compose/env wiring
- **Description:** Add `JWT_SECRET_DENYLIST`/`DEV_LOGIN_PASSWORD_DENYLIST` consts, a pure `validate_secret(name, value, denylist)`, and `validate_boot_secrets()` in `types.rs` (re-exported via `mod.rs`). `main()` calls `dotenvy::dotenv()` (log which file loaded / none) then `validate_boot_secrets()` before DB connect; on failure log one aggregated preflight error (naming each bad var, reason, and fix) and exit non-zero. `app_state()` drops both `unwrap_or_else` defaults (become `.expect("validated by validate_boot_secrets at boot")`). Add `dotenvy` to `Cargo.toml`. `.env.example` ships `JWT_SECRET=`/`DEV_LOGIN_PASSWORD=` empty with `# REQUIRED:` comments. `docker-compose.yml` switches both to `${VAR:?message}` required-variable syntax. `scripts/2-serve.ps1` gains a friendly pre-check that warns/exits if no repo-root `.env`. README "Running from source" documents the `.env` requirement.
- **Files:** `server/src/routes/types.rs`, `server/src/routes/mod.rs`, `server/src/main.rs`, `server/Cargo.toml`, `docker-compose.yml`, `.env.example`, `scripts/2-serve.ps1`, `README.md`.
- **Closes acceptance criteria:** F2-1 … F2-6.
- **Done when:**
  - Server exits non-zero with a clear preflight log when `JWT_SECRET` is unset/empty/`tasksync-dev-secret`/`change-me`, in every run mode (no flag disables it); same for `DEV_LOGIN_PASSWORD` unset/empty/`tasksync`.
  - Server boots with real non-default values for both.
  - `validate_secret` has unit tests covering the full matrix (unset / empty / each denylisted literal / valid) with NO env-var mutation in tests (avoids parallel-test races).
  - **Grep-verification (carried from review note 2a):** before relying on the "cargo test unaffected" claim, grep the entire test tree and confirm nothing under test calls `app_state()`, `main()`, or the route-constructor functions (`auth_routes` etc.) that call `app_state()`. Record the grep result in the SDE report. `cargo test` then passes with `JWT_SECRET`/`DEV_LOGIN_PASSWORD` UNSET in the test env.
  - `dotenvy` loads the repo-root `.env`; `cd server && cargo run` and `scripts/2-serve.ps1` boot from a clean checkout with a populated `.env`; real process env still wins over `.env`.
  - `docker compose config`/`up` on an unedited `.env` fails at interpolation with the `:?` message (no `restart` crash loop for unset/empty).
  - `cargo fmt -- --check`, `cargo clippy -- -D warnings`, `cargo test` pass (linker caveat per T1).

### T3 — Pin CORS
- **Description:** Replace `allow_origin(Any)`/`allow_headers(Any)` in `main.rs` with a boot-time-parsed additive allow-list: baked-in `capacitor://localhost`, `http://localhost:5173`, `http://localhost:4173` unioned with a new comma-separated `CORS_ALLOWED_ORIGINS` env var. Implement pure `parse_allowed_origins(raw) -> Result<Vec<HeaderValue>, String>` (malformed entry → boot failure naming the entry). `CorsLayer`: `allow_origin(AllowOrigin::list(...))`, unchanged enumerated methods, `allow_headers([AUTHORIZATION, CONTENT_TYPE])`, no `allow_credentials`. Wire `CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-}` into `docker-compose.yml`; add a commented example to `.env.example`; document in README's reverse-proxy note alongside `VITE_API_URL`/`VITE_ALLOWED_HOSTS`.
- **Files:** `server/src/main.rs`, `docker-compose.yml`, `.env.example`, `README.md`.
- **Closes acceptance criteria:** F3-1 … F3-6.
- **Done when:**
  - No `allow_origin(Any)`/`allow_headers(Any)` remains; header allow-list is exactly `[AUTHORIZATION, CONTENT_TYPE]`.
  - `parse_allowed_origins` unit tests: unset/empty → the three defaults only; valid list → union; malformed (trailing slash / path / bad scheme) → error naming the entry and boot fails.
  - Effective allow-list includes `capacitor://localhost` (trap 3, verified against `web/capacitor.config.ts` — no `iosScheme` override), `http://localhost:5173`, `http://localhost:4173`.
  - A CORS request from a non-allow-listed origin receives no matching `Access-Control-Allow-Origin` (documented curl check against a running server with a configured list, for the verify stage).
  - `docker-compose.yml` + `.env.example` + README wiring present.
  - `npm run test:e2e:smoke` (Chromium `@smoke`) passes unmodified in its auth approach; `cargo fmt`/`clippy`/`test` pass (linker caveat per T1).

### T4 — Client legacy-mode removal
- **Description:** Shrink `web/src/lib/api/headers.ts` to token-only (`getAuthToken`, `setAuthToken`, `buildHeaders`); delete `AuthMode`, `getAuthMode`, `setAuthMode`, the `tasksync:auth-mode` key constant, and the `spaceId`/`userId`/`role` module constants (retiring the `VITE_SPACE_ID`/`VITE_USER_ID`/`VITE_ROLE` reads). Remove those three `VITE_*` lines from `.env.example`. In `web/src/lib/stores/auth.ts`, drop `AuthState.mode` and the `'legacy'` `source` variant; `hydrate()` starts with a one-time `localStorage.removeItem('tasksync:auth-mode')` then the existing token-only flow (no token → `anonymous` → login). Update `headers.test.ts`, `auth.test.ts` (add stale-legacy-mode test), `tasks.test.ts` (drop `tasksync:auth-mode` seeding).
- **Files:** `web/src/lib/api/headers.ts` (+ `headers.test.ts`), `web/src/lib/stores/auth.ts` (+ `auth.test.ts`), `web/src/lib/stores/tasks.test.ts`, `.env.example`.
- **Closes acceptance criteria:** F1-4 (headers.ts token-only; `AuthMode`/`tasksync:auth-mode`/get/setAuthMode gone), F1-5 (stale `tasksync:auth-mode: legacy` device routes to login gracefully, tested).
- **Done when:**
  - `headers.ts` contains no `x-space-id`/`x-user-id`/`x-role` fallback, no `AuthMode`, no `tasksync:auth-mode` key, no `get/setAuthMode`.
  - `auth.ts` has no `mode` field / `'legacy'` source; `hydrate()` clears the stale key then resolves `anonymous` with no network call for a token-less device.
  - New `auth.test.ts` case: seed `tasksync:auth-mode: legacy` (no token), `hydrate()`, assert `anonymous` and the key removed — no error/blank/loop.
  - `tasks.test.ts` no longer seeds `tasksync:auth-mode`.
  - **Grep-verification (carried from review note 2b):** after removal, grep the web tree AND E2E fixtures/config and confirm no Vite build path or E2E fixture still references `VITE_SPACE_ID`/`VITE_USER_ID`/`VITE_ROLE` (or the removed `x-role` header / `tasksync:auth-mode` key). Record the grep result in the SDE report.
  - `npm run lint`, `npm run check`, `npm run test`, and `npm run test:e2e:smoke` all pass.
- **Amendment (2026-07-02, per the Design Addendum — anonymous IDB scope key; original text above stands as history):**
  - **Files (amended):** the original list **plus** `web/src/routes/+layout.svelte`, `web/tests/e2e/helpers/idb.ts`, `web/tests/e2e/auth.spec.ts`, `web/tests/e2e/offline.spec.ts`, `web/tests/e2e/perf.spec.ts`, `web/tests/e2e/myday.spec.ts`, `web/tests/e2e/sidebar-drag.spec.ts`.
  - **Done when (additional):**
    - `storageScopeFromAuth` in `+layout.svelte` returns the unchanged authenticated `space:{space_id}:user:{user_id}` key, and `'token-anonymous'` for every non-authenticated state; no reference to `state.mode` remains anywhere in the file.
    - `web/src/lib/data/idb.ts` is untouched, and NO code deletes or migrates `legacy-default` databases (orphan decision — Addendum Decision 2).
    - All four `resolveScopedDbName()` copies in `web/tests/e2e/helpers/idb.ts` resolve the scope from `tasksync:auth-user` only (valid user → `space:user` scope, else `'token-anonymous'`), with no `tasksync:auth-mode` read; the 10 seeding sites' `tasksync:auth-mode` lines are deleted with the rest of each seed intact.
    - The new `auth.spec.ts` E2E case (Addendum Decision 4) passes: stale legacy device → anonymous state with sign-in available, stale key removed, signed-out task lands in `tasksync_token-anonymous`, pre-seeded `tasksync_legacy-default` marker database untouched. Not tagged `@smoke`.
    - **Grep-verification 2b (amended):** must come back FULLY clean — zero `tasksync:auth-mode` references anywhere under `web/` (src, tests, E2E, config), plus the original clean `VITE_SPACE_ID`/`VITE_USER_ID`/`VITE_ROLE`/`x-role` result. Record in the SDE report.
    - In addition to the original gate list, the six touched E2E spec files are run locally on Chromium (`npx playwright test tests/e2e/auth.spec.ts tests/e2e/offline.spec.ts tests/e2e/perf.spec.ts tests/e2e/myday.spec.ts tests/e2e/sidebar-drag.spec.ts --project=chromium` or equivalent) since most are outside the `@smoke` subset.

### T5 — ARCHITECTURE.md sync reconciliation
- **Description:** Rewrite `docs/ARCHITECTURE.md`'s Sync/Conflicts material to the confirmed reality (HTTP-only `POST /sync/pull` + `/sync/push`, `delta-v1`, whole `ListRow`/`TaskRow` rows scoped by role + list grants, `since_ts`→`cursor_ts`, 500-change cap, `op_id`-keyed `rejected[]`, arrival-order whole-row overwrite with `coalesce(?, column)` semantics — no version vectors / per-field LWW / WebSocket / tiebreak). Change the component diagram `[WebSocket/HTTP]`→`[HTTP]`. Move the aspirational changeset/version-vector/WebSocket/per-field-LWW design AND the non-existent `Change` entity + `change` table SQL into a clearly labeled "Future sync protocol (aspirational — not implemented)" Roadmap subsection.
- **Files:** `docs/ARCHITECTURE.md`.
- **Closes acceptance criteria:** F4-1, F4-2, F4-3.
- **Done when:**
  - Sync bullet, Sync Protocol section, and Conflict Rules describe the real implementation with no current-state claims of changesets/version-vectors/per-field-LWW/WebSocket; the `Change` entity + `change` table SQL are moved to Roadmap (grounded: no `change` table in any migration).
  - Aspirational protocol preserved under the labeled Roadmap subsection, not deleted.
  - `docs/ARCHITECTURE.md` is the only *behavior doc* changed for this feature. (Clarifying note for acceptance/QA so F4-3 is not false-flagged: the exec plan under `docs/exec-plans/active/` and `tech-debt-tracker.md` are process artifacts updated by the workflow itself, not the "exactly one doc" hygiene target — ARCHITECTURE.md is the single behavior/architecture doc touched.)

### QA-stage charter addendum (carried from design review, note 1 — not a T-task)
When the mandatory QA stage runs, its charter is extended: **determine what
`DEV_LOGIN_PASSWORD` actually gates in `server/src/routes/auth.rs`** (that file was
never deep-audited during review). If it turns out to be a shared master-login
mechanism rather than a seed/dev convenience, QA must flag it as a **branch-2 candidate
finding** — it is NOT to be fixed in this branch. Recorded in `.state/feature-state.json`
under `process_constraints.qa_charter_addendum`.

## Progress log

- 2026-07-01: Discovery complete. Requirements, blast radius, and both open questions resolved and documented above by product-manager, grounded against `server/src/routes/types.rs`, `sync.rs`, `mod.rs`, `main.rs`, `web/src/lib/api/headers.ts`, `web/capacitor.config.ts`, `docker-compose.yml`, `.env.example`, `scripts/2-serve.ps1`, `scripts/1-seed.ps1`, `README.md`, and `web/playwright.config.ts`/`web/tests/e2e/auth.spec.ts`.
- 2026-07-01: Design complete (principal-engineer). Wrapper+core handler split with `*_for_ctx` signatures; real-JWT `auth_headers` test helper (no bypass); boot preflight `validate_boot_secrets` in `types.rs` called from `main()` pre-DB; local-dev secrets via `dotenvy` + repo-root `.env`; `CORS_ALLOWED_ORIGINS` additive to baked-in `capacitor://localhost`/`localhost:5173`/`localhost:4173` defaults; ARCHITECTURE.md sync sections rewritten to arrival-order whole-row overwrite reality (confirmed: no `change` table exists in migrations — `Change` entity/SQL moves to Roadmap). All three trap call-outs addressed explicitly. Data model impact: none. Design reviewed and APPROVED by main session (Fable); Dean approved advancing to Tasks.
- 2026-07-01: Task breakdown complete (engineering-manager). Five dependency-ordered one-SDE-session tasks: T1 server auth refactor + `mod.rs` real-JWT test migration (F1-1..3); T2 boot preflight + `dotenvy` + compose/env wiring (F2-1..6, includes grep-verify that no test calls `app_state()`/`main()`/route-constructors); T3 CORS pinning (F3-1..6); T4 client legacy-mode removal (F1-4..5, includes grep-verify no `VITE_SPACE_ID`/`VITE_USER_ID`/`VITE_ROLE` references remain); T5 ARCHITECTURE.md sync reconciliation (F4-1..3). Operational-consequence criteria deferred to the `/done` PR description (not a code task). QA-stage charter extended (review note 1): audit what `DEV_LOGIN_PASSWORD` gates in `auth.rs`; if it is a shared master-login mechanism, flag as a branch-2 candidate finding, do not fix here.
- 2026-07-01: T1 implemented (software-developer). `types.rs`: `ctx_from_headers` is Bearer-only — the `x-space-id`/`x-user-id` fallback deleted with no replacement, tail is `Err(StatusCode::UNAUTHORIZED)`; signature unchanged. `tasks.rs`/`lists.rs`: the five sync-invoked handlers split into thin HTTP wrappers + `pub(super) *_for_ctx` cores per the Design signatures (`get_tasks_for_ctx`, `create_task_for_ctx`, `update_task_meta_for_ctx`, `update_task_status_for_ctx`, `get_lists_for_ctx`); core bodies moved verbatim — the only in-body delta is the return line dropping `Json(...)`; `delete_task`/`create_list`/`update_list`/`delete_list`/`auth_*` untouched. `sync.rs`: `headers_for_ctx` deleted, `HeaderValue` import removed; `sync_pull`/`sync_push` call `ctx_from_headers` once and pass `&ctx` into the cores — zero header synthesis; per-change loop, `op_id` rejection reporting, 500-change cap, `sync_cursor_for_ctx`, `deleted_tasks_for_ctx` untouched. `mod.rs`: new `auth_headers(state, user_id, space_id)` test helper mints a GENUINE token via production `issue_token` + `Authorization: Bearer`; all 36 header-auth sites converted (25 u-admin, 9 u-contrib, 1 `admin_headers`, 1 `create_headers` block); NO `#[cfg(test)]` `RequestCtx` shortcut exists (`RequestCtx {` constructed nowhere outside `ctx_from_headers`). Four new negative tests: legacy-headers-only → 401 (via `ctx_from_headers`, `get_tasks`, and `sync_pull`), garbage + non-Bearer-scheme token → 401, expired-but-genuinely-signed token → 401, valid token for membership-less user → 401. Existing sync idempotency/conflict tests retained unmodified apart from the mechanical auth swap (test count 40 → 44). Quality gates: `cargo fmt -- --check` PASS; `cargo clippy -- -D warnings` PASS; `cargo clippy --all-targets -- -D warnings` PASS (fully type-checks the migrated test suite). `cargo test` COULD NOT RUN locally: no C linker in the sandbox (`cc`/`gcc`/`clang`/`lld`/`mold` absent; `rust-lld` fallback fails on build scripts) — test execution, including the idempotency re-runs (trap 2), is explicitly deferred to CI / the `/verify` build-specialist stage.

- 2026-07-02: T2 implemented (software-developer). `types.rs`: added `JWT_SECRET_DENYLIST` (`tasksync-dev-secret`, `change-me`) / `DEV_LOGIN_PASSWORD_DENYLIST` (`tasksync`) consts; pure private `validate_secret(name, value: Option<String>, denylist) -> Result<String, String>` failing on unset / empty-or-whitespace / exact denylist match, error naming the variable, reason, and fix; `pub fn validate_boot_secrets() -> Result<(), String>` reads env and aggregates BOTH variables' failures into one joined message (re-exported via `routes/mod.rs`); `app_state()` dropped both `unwrap_or_else` defaults → `.expect("… validated by validate_boot_secrets at boot")`. `main.rs`: after tracing init, `dotenvy::dotenv()` logs the loaded `.env` path or "no .env file found" (dotenvy never overrides already-set process env, so real env wins); then `validate_boot_secrets()` runs BEFORE the database connect — on failure logs the aggregated preflight error and `anyhow::bail!`s (exit 1). `Cargo.toml`: added `dotenvy = "0.15"`. `docker-compose.yml`: both secrets switched to `${VAR:?Set VAR in .env (see .env.example)}` required-variable syntax. `.env.example`: `JWT_SECRET=`/`DEV_LOGIN_PASSWORD=` shipped empty with `# REQUIRED:` comments (VITE_* auth lines untouched — T4). `scripts/2-serve.ps1`: friendly pre-check exits early with cp-instructions if no repo-root `.env`. `README.md` "Running from source": documents the `.env` requirement + dotenvy loading. Tests: 7 new unit tests in `types.rs` cover the full matrix THROUGH the pure `validate_secret` (unset / empty / whitespace / each denylisted literal per variable / valid passthrough / per-variable denylist independence) with NO env mutation. **Grep-verification (review note 2a): PASS** — `grep -rn "app_state|auth_routes|list_routes|task_routes|sync_routes|fn main" server/src` shows `app_state()` called only from the four route constructors, which are called only from `main.rs`; the only test module is `#[cfg(test)] mod tests` in `routes/mod.rs` (no `tests/` dir), whose 46 sites all use `test_state()` — nothing under test reaches `app_state()`/`main()`/route constructors; `src/bin/seed.rs` reads only `DATABASE_URL`/`SEED_ADMIN_PASSWORD`/`SEED_CONTRIB_PASSWORD` (no `app_state()`), so `scripts/1-seed.ps1` is unaffected. Functional verification of the built binary: unset/denylisted/empty combos all exit 1 with the aggregated preflight log; valid values in a `.env` boot to "listening on 0.0.0.0:3000" with "loaded .env from <path>" logged; a denylisted real env var fails even with a valid `.env` (env precedence confirmed). Quality gates: `cargo fmt -- --check` PASS; `cargo clippy --all-targets -- -D warnings` PASS; `cargo test` PASS 51/51 (44 existing + 7 new) run with `JWT_SECRET`/`DEV_LOGIN_PASSWORD` explicitly UNSET (F2-4). Not locally verifiable: `docker compose config` interpolation failure (no docker binary in sandbox) — `${VAR:?}` is standard Compose syntax; flagged for the verify stage.

- 2026-07-02: T3 implemented (software-developer). `main.rs`: added `DEFAULT_ALLOWED_ORIGINS` const (`capacitor://localhost`, `http://localhost:5173`, `http://localhost:4173`) and pure `parse_allowed_origins(raw: Option<String>) -> Result<Vec<HeaderValue>, String>` — unset/empty/whitespace → the three defaults only; valid comma-separated list → union of defaults + trimmed entries (stray empty segments skipped — they drop no origin); malformed entry (trailing slash / path / missing or empty scheme / empty host / whitespace in host / invalid header chars, via helper `parse_origin_entry`) → `Err` naming the entry verbatim and showing a valid example. `main()` parses `CORS_ALLOWED_ORIGINS` right after the T2 secrets preflight and BEFORE the DB connect, `anyhow::bail!`-ing on error (fail-closed, exit 1) — T2 dotenvy/preflight code untouched, changes purely additive. `CorsLayer` now: `allow_origin(AllowOrigin::list(...))`, methods unchanged (GET/POST/PATCH/PUT/DELETE/OPTIONS), `allow_headers([AUTHORIZATION, CONTENT_TYPE])` exactly, no `allow_credentials` — no `allow_origin(Any)`/`allow_headers(Any)` remains (F3-1). Five new `#[cfg(test)]` unit tests in `main.rs`: unset → exactly the three defaults; empty/whitespace → defaults only; valid list → ordered union; trim + stray-comma handling; six malformed variants each asserting the error names the entry and shows the example. `docker-compose.yml`: server gains optional `CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-}` (T2 `${VAR:?}` secret lines untouched). `.env.example`: commented `CORS_ALLOWED_ORIGINS` example noting the always-allowed baked-in origins (T2 secret lines and T4's VITE_* lines untouched). `README.md`: reverse-proxy operating note now documents `CORS_ALLOWED_ORIGINS` alongside `VITE_API_URL`/`VITE_ALLOWED_HOSTS`. **F3-2 verified LOCALLY via curl** against the built binary running with valid secrets and `CORS_ALLOWED_ORIGINS=https://tasks.example.com`: OPTIONS preflights from all three baked-in origins and the env-configured origin each got an exact-echo `access-control-allow-origin` + `access-control-allow-headers: authorization,content-type`; `https://evil.example.com` got NO `access-control-allow-origin` header; no `access-control-allow-credentials` anywhere. Fail-closed also functionally verified: booting with `CORS_ALLOWED_ORIGINS=https://tasks.example.com/` exits 1 with the preflight error naming the entry. Quality gates: `cargo fmt -- --check` PASS; `cargo clippy --all-targets -- -D warnings` PASS; `cargo test` PASS 56/56 (51 + 5 new, run with `JWT_SECRET`/`DEV_LOGIN_PASSWORD`/`CORS_ALLOWED_ORIGINS` unset); `npm run test:e2e:smoke` PASS 20/20 unmodified (F3-6). Environment note: the smoke suite initially could not launch Chromium (missing `libglib-2.0.so.0` etc. — sandbox lacked Playwright system deps); fixed via `sudo npx playwright install-deps chromium`, unrelated to this change.

- 2026-07-02: T4 BLOCKED before implementation (software-developer). The mandated pre-deletion grep re-verify falsified the design's grounding claim that "no Svelte component reads `mode` or the `'legacy'` source — only auth.ts and its tests." Finding A: `web/src/routes/+layout.svelte:186` — `storageScopeFromAuth(state: AuthState)` reads `state.mode` to derive the IndexedDB storage scope for non-authenticated states (`state.mode === 'token' ? 'token-anonymous' : 'legacy-default'`); removing `AuthState.mode` breaks `npm run check` and forces an undesigned decision about the anonymous IDB scope key (data-scoping behavior), in a file outside T4's scope fence. Finding B (derivative): grep-verify 2b cannot come back clean within the fence — `web/tests/e2e/helpers/idb.ts` contains four inlined `resolveScopedDbName()` copies reading `tasksync:auth-mode` (mirroring +layout.svelte's scope logic), and ten E2E seeding sites set `tasksync:auth-mode = 'token'` (`auth.spec.ts` x3, `offline.spec.ts` x4, `perf.spec.ts` x1, `myday.spec.ts` x1, `sidebar-drag.spec.ts` x1) — all outside the fence. Positive finding: `VITE_SPACE_ID`/`VITE_USER_ID`/`VITE_ROLE` and `x-role` exist ONLY in `web/src/lib/api/headers.ts` itself (no other source, test, E2E, or vite/svelte/playwright config reference), so that half of T4 is unobstructed once the `mode` question is designed. NO changes made; reported to engineering-manager for a design amendment (anonymous-scope key decision + E2E helper/seeding scope-fence extension) before T4 re-routes.

- 2026-07-02: Design Addendum complete (principal-engineer) — T4 blocker resolved; see "Design Addendum (2026-07-02) — anonymous IDB scope key". Decisions: (1) `storageScopeFromAuth` drops `state.mode`; every non-authenticated state scopes to the EXISTING `'token-anonymous'` literal (authenticated `space:user` key unchanged; `idb.ts` untouched) — zero data movement for current signed-out token-mode devices. (2) `legacy-default` databases are ORPHANED in place — never opened, deleted, or migrated. Grounded: `legacy-default` was never a data home for authenticated data (legacy devices that authenticated always stored under `space:user`, which re-login re-selects, so signed-in dirty edits are NOT lost); it only transiently held tasks created while signed out on an explicitly-legacy device — data that pre-change behavior already orphaned at the next login (orphaning anonymous scopes on auth transitions is existing behavior; precedent: the pre-scoping `tasksync_legacy` DB). That narrow unsynced signed-out edge is an ACCEPTED LOSS; release-note wording provided in the addendum for the `/done` PR description. (3) E2E: the four `resolveScopedDbName()` copies in `helpers/idb.ts` mirror the new scope function (`tasksync:auth-user` → `space:user`, else `'token-anonymous'`); the 10 `tasksync:auth-mode` seeding lines are deleted — remaining seeds already provide what the new logic reads, and no suite's DB name shifts (`offline.spec.ts:162` already asserts `tasksync_token-anonymous`). (4) One new non-`@smoke` `auth.spec.ts` E2E case asserts the stale-legacy-device fate (anonymous + key removed + signed-out task in `token-anonymous` + `legacy-default` marker DB untouched). T4 fence extended to `+layout.svelte` + the six E2E files; grep-verify 2b must now be fully clean (zero `tasksync:auth-mode` under `web/`). No server-side changes or migrations required — T4 remains one SDE session.

- 2026-07-02: T4 implemented (software-developer, amended scope per the Design Addendum). Part A: `headers.ts` shrunk to token-only (`getAuthToken`/`setAuthToken`/`buildHeaders` returning Bearer-or-empty) — `AuthMode`, `getAuthMode`/`setAuthMode`, the `tasksync:auth-mode` key constant, the `spaceId`/`userId`/`role` module consts, and all `x-space-id`/`x-user-id`/`x-role` construction deleted (F1-4); the three `VITE_SPACE_ID`/`VITE_USER_ID`/`VITE_ROLE` lines removed from `.env.example` (T2/T3 secret+CORS entries untouched). `auth.ts`: `AuthState.mode` and the `'legacy'` `source` variant removed (`AuthOrigin = 'token' | null`); `hydrate()` now begins with a one-time `localStorage.removeItem('tasksync:auth-mode')` then the existing token-only flow — a token-less stale-legacy device resolves `anonymous` with no network call, no error, no loop (F1-5); `login()`/`logout()` drop `setAuthMode`/`mode`. Part B (addendum): `+layout.svelte` `storageScopeFromAuth` per Decision 1 — authenticated `space:{space_id}:user:{user_id}` unchanged, every non-authenticated state → the existing `'token-anonymous'` literal unconditionally; zero references to `state.mode` remain; `idb.ts` UNTOUCHED (verified: no diff) and no code deletes/migrates `legacy-default` DBs (orphan decision). All four inlined `resolveScopedDbName()` copies in `tests/e2e/helpers/idb.ts` now resolve from `tasksync:auth-user` only (valid user → `space:user`, else `'token-anonymous'`; sanitize logic verbatim). All 10 seeding sites dropped exactly their `tasksync:auth-mode` line (`auth.spec.ts` ×3, `offline.spec.ts` ×4, `perf.spec.ts` ×1, `myday.spec.ts` ×1, `sidebar-drag.spec.ts` ×1); no suite's DB name shifted (`offline.spec.ts` `tasksync_token-anonymous` assertion passes unmodified). Tests: new `auth.test.ts` stale-legacy-key unit test (seed key, no token → `hydrate()` → anonymous, key removed, `/auth/me` never called); `headers.test.ts` rewritten for the token-only surface (4 tests); `tasks.test.ts` seeding dropped; NEW non-`@smoke` `auth.spec.ts` E2E case per Addendum Decision 4 — stale legacy device loads to normal anonymous state with sign-in available, stale key removed, signed-out task lands in `tasksync_token-anonymous` via the updated helper, and a pre-seeded `tasksync_legacy-default` marker DB remains with its marker untouched (orphaned, not deleted) — PASSES on Chromium. Grep-verify 2b: `VITE_SPACE_ID`/`VITE_USER_ID`/`VITE_ROLE` → ZERO matches anywhere (web tree + `.env.example`/compose/README); `x-role` → ZERO matches; `tasksync:auth-mode` → ZERO readers and ZERO E2E/helper/config references — the only remaining occurrences are the addendum-DESIGNED cleanup writer and its mandated tests (`auth.ts` `staleAuthModeKey` const used solely by `hydrate()`'s `removeItem`; `auth.test.ts` ×2 and the new `auth.spec.ts` case ×2, which seed/assert-removal of the stale key per A4/B4 — a literal zero is unsatisfiable while those mandated tests exist; flagged transparently in the SDE report). Quality gates ALL PASS locally: `npm run lint`, `npm run check` (0 errors/0 warnings), `npm run test` 367/367, `npm run test:e2e:smoke` 20/20, explicit `npx playwright test` of the five touched spec files `--project=chromium` 45/45 (incl. the new case), `cargo fmt -- --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` 56/56 (server regression re-run, untouched by T4).

- 2026-07-02: T5 implemented (software-developer, docs-only). `docs/ARCHITECTURE.md` sync sections reconciled to the actual implementation, all six Design Work-item-4 edit targets applied: (1) "High-level Design" **Sync** bullet now states HTTP-only `POST /sync/pull` + `/sync/push` (`delta-v1`), whole list/task rows scoped by role + list grants, `since_ts`→`cursor_ts` incremental pull, "No WebSocket"; **Conflicts** bullet now states arrival-order whole-row overwrite + tombstone convergence + fractional order keys. (2) Component diagram: `[WebSocket/HTTP]` → `[HTTP]`, and the server node `[HTTP+WS API]` → `[HTTP API]` (same target's intent — a current-state WS claim could not remain per F4-1); `[Sync Engine]` kept. (3) "Sync Protocol (concise)" replaced with "Sync Protocol (current implementation: `delta-v1`)": pull `{since_ts?}` → `{protocol, cursor_ts, lists[], tasks[], deleted_tasks[]}` with `updated_ts >= since_ts` / `deleted_ts >= since_ts` filtering and `cursor_ts` = max(task `updated_ts`, tombstone `deleted_ts`) in scope; push `{changes[]}` with the 500-change cap (400 above it), sequential application through the REST code paths, `op_id`-keyed `rejected[]`, and `applied[]` documented AS-IS as positional/not-op_id-keyed (known branch-2 limitation); idempotency via client-supplied ids (unique violation → existing row, 200 vs 201), absolute-value updates, pure re-pulls; client-cursor nuance added (in-memory `lastPullCursorTs` in `web/src/lib/sync/sync.ts` resets per app launch → cold start = full pull). (4) "Conflict Rules (current implementation)": arrival-order whole-row overwrite with per-column `coalesce(?, column)` (punt fields written unconditionally, status transitions manage `completed_ts`), explicit no-timestamp-comparison/no-version-vectors/no-per-field-LWW/no-tiebreak, tombstone convergence with deliberate resurrect-on-create, fractional order keys retained. (5) `Change {…}` entity removed from the abridged data model and the `change` table SQL removed from Key Tables (grounded: no `change` table in any migration). (6) New Roadmap subsection "Future sync protocol (aspirational — not implemented)" preserves the changeset/version-vector/Hello-Delta-Push-Live/WebSocket/per-field-LWW+tiebreak design, the old Sets/Notes conflict bullets, and the `Change` entity + SQL verbatim, with an explicit not-implemented preamble. Every rewritten claim spot-checked against `server/src/routes/sync.rs` (delta-v1 tags, `>=` filters, cursor max, 500 cap, op_id rejection, positional applied), `server/src/routes/tasks.rs` (coalesce column list, unconditional punt binds, unique-violation convergence, tombstone delete-on-create), and `web/src/lib/sync/sync.ts:29` (module-level in-memory cursor) — no contradictions found; no code modified. `docs/ARCHITECTURE.md` is the only doc changed besides this progress-log entry (F4-3). Quality gates ALL PASS locally: `npm run lint`, `npm run check` (0/0), `npm run test` 367/367, `npm run test:e2e:smoke` 20/20, `cargo fmt -- --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` 56/56. Closes F4-1, F4-2, F4-3.

## Decision log

- 2026-07-01: Header-auth bypass — remove entirely, no opt-in env gate (see "Open questions resolved" Q1).
- 2026-07-01: Default secrets — fail closed always, no production-flag gate; matches unset OR known-default-literal for both `JWT_SECRET` and `DEV_LOGIN_PASSWORD` (see "Open questions resolved" Q2).
- 2026-07-01: `docs/ARCHITECTURE.md` is the single doc updated for this change; all other operational notes go into release notes/PR description only.
- 2026-07-01: Local-dev secret source (design) — `dotenvy` loading the repo-root `.env` (shared with Docker Compose); rejected script-generated and README-export alternatives.
- 2026-07-01: CORS allow-list semantics (design) — `CORS_ALLOWED_ORIGINS` is additive to baked-in `capacitor://localhost` / `http://localhost:5173` / `http://localhost:4173` defaults, so the Capacitor iOS origin cannot be dropped by operator misconfiguration.
- 2026-07-01: `.env.example` ships `JWT_SECRET`/`DEV_LOGIN_PASSWORD` empty with REQUIRED comments; `docker-compose.yml` uses `${VAR:?}` required-variable syntax so unedited setups fail at compose time, with the server boot preflight as the authoritative backstop.
- 2026-07-02: Anonymous IDB scope key (design addendum) — non-authenticated states scope to the existing `'token-anonymous'` key; `legacy-default` databases are orphaned in place (no delete, no migration); unsynced signed-out legacy-device data is an accepted, release-noted loss.
