# Gated Login Wall + Programmatic Task-Creation API

## Goal

Force authentication before any app content, list, or API is reachable — replacing today's menu-first login (a form buried in the Sidebar account section) with a real login wall that includes first-run owner setup and server-checked session revocation — and add a minimal, server-authoritative programmatic API token that lets external callers create tasks without a full login. This feature also resolves tech-debt #047 by retiring the shared `DEV_LOGIN_PASSWORD` fallback login once a real owner account exists.

## Scope

### F-A — Gated login wall

- A session gate that covers **all** routes and **all** APIs by default. Only a minimal allowlist is reachable without an authenticated session: the login surface, the first-run owner-setup surface, and the existing unauthenticated `/health` endpoint. Every other route (client pages) and every other API endpoint (`/auth/*` except login/first-run, `/lists/*`, `/tasks/*`, `/sync/*`) requires a valid, non-revoked session.
- Client app shell renders nothing app-related (no tasks, no lists, no My Day, no Sidebar content) until the session gate resolves to authenticated. An unauthenticated visitor sees only the login (or first-run) screen — no flash of app content before redirect.
- First-run admin/owner setup flow: on a fresh deployment with no owner account yet, the app presents an owner-setup screen (not the login screen) so the operator can create the single owner/admin account. Once an owner account exists, first-run setup is no longer offered — a repeat visit (or any other visitor) is sent to the login screen instead.
- Replace the current menu-first login UX (the login form embedded in `Sidebar.svelte`'s account section, reachable only after opening the sidebar) with the wall described above. The Sidebar's account section may continue to show the authenticated user's identity/logout affordance, but it is no longer where unauthenticated users log in.
- Every issued session carries a `token_version`. The server re-checks the caller's `token_version` against the current server-side value on every sync/API call (not just at login). A session whose `token_version` no longer matches is rejected.
- The owner has a way to bump the server-side `token_version` to revoke all existing sessions (e.g. on password change or a deliberate "sign out everywhere" action) — mechanism is a design decision, but the *capability* is in scope.

### F-B — Programmatic task-creation API

- An optional static API token, configured by the operator, that an external/automated caller supplies via an HTTP header.
- A single endpoint — task creation — accepts this token as an alternative to a full login session.
- The token authenticates as the admin/owner identity for the purpose of attribution (created tasks are owned by/attributed to the owner's space), but is scoped server-side to **only** the create-task action. It grants no other endpoint and no admin-only capability.
- Missing or invalid token on the create-task endpoint is rejected. The same token presented to any other endpoint is rejected.

### #047 resolution

- Once a real owner account exists (i.e., first-run setup has been completed), the shared `DEV_LOGIN_PASSWORD` fallback in `password_matches_for_user` (`server/src/routes/auth.rs` ~262-281) no longer authenticates any hash-less account. This closes #047 as part of this feature, not a deferred branch, per user decision.
- The exec plan does not prescribe whether `DEV_LOGIN_PASSWORD` becomes fully optional/removed as an env var or is simply neutered post-owner-creation — that mechanism is a Principal Engineer design decision (see Open questions). What is in scope and fixed: after owner setup, no hash-less account (including one reintroduced via backup restore, per #047's grounded finding) can be logged into using the shared fallback value.
- First-run setup provisions the owner's real, hashed password directly (through the same hashing path already used elsewhere, e.g. `hash_password`) — it does not rely on the shared fallback as an intermediate step.

## Out of scope

- Multi-user onboarding, invites, or any onboarding flow beyond the single owner created at first-run. (Per decision 4 — single-owner self-hosted model.) The existing admin-invites-members flow (`auth_create_member`) is unaffected by this feature but is not being extended.
- OAuth/SSO/MFA.
- Password-reset email flows (no outbound email exists in this system).
- Any scope for the API token beyond create-task — it must not be usable for reads, updates, deletes, or any `/auth/*` admin action, now or as a "future extension" baked into this feature.
- Rate-limiting / brute-force hardening beyond what already exists. Noted as a possible follow-up given a public login wall increases exposed login-attempt surface, but not pulled into this feature's scope — flag as a candidate tech-debt item at `/done` if the Principal Engineer agrees it's warranted.
- Literal "instant" (offline-independent) revocation. Per decision 2, revocation is `token_version`-based and takes effect on next server contact; this is intentional, not a deferral.
- **Cross-check against CLAUDE.md non-negotiables:** none of the above conflicts with mandatory standards. Test coverage is not deferred by any of these exclusions — every in-scope change (gate, first-run flow, `token_version` check, API token path, #047 closure) still requires full test coverage per `docs/CONTRIBUTING.md`'s "Tests required per PR"; nothing here defers testing that CONTRIBUTING.md requires.

## Constraints

- **Offline-first.** A forced login wall must not break offline boot/use for an already-authenticated device. The gate evaluates against locally-persisted session state (not a live server round-trip) to decide whether to render the app shell. A cold reload while offline for an already-authenticated device must still render the cached shell and local tasks — it must not be blocked pending a network call to verify the session.
- **Server-authoritative roles and scope.** The login gate's true enforcement, the `token_version` check, and the API token's create-task-only scope are all enforced server-side. Client-side gating (redirecting to a login screen) is UX convenience only — the server independently rejects unauthenticated/revoked/out-of-scope requests regardless of what the client does. Neither a contributor session nor an API-token caller can gain admin-only abilities through either surface.
- **Sync determinism.** Tasks created via the F-B API endpoint flow through the same idempotent push/pull contract as tasks created through the normal UI/sync path — no new branching sync behavior, no changes to delete/tombstone or conflict-resolution rules (`docs/RELIABILITY.md`, `docs/ARCHITECTURE.md`).
- **Performance budgets.** The per-request `token_version` re-check must not regress sync/API latency or UI interaction budgets (primary UI actions <16ms per `docs/RELIABILITY.md`; existing sync latency envelopes). The added per-call lookup (however it's implemented) is a budget-sensitive item — the Principal Engineer must validate it against `docs/RELIABILITY.md` and flag any risk before implementation.
- **Builds on auth-hardening.** New auth surfaces respect the single-`RequestCtx`-constructor discipline established in the completed auth-hardening feature (`ctx_from_headers` remains the one authentication boundary that every request path funnels through), the fail-closed boot-secret preflight, and the additive `CORS_ALLOWED_ORIGINS` allow-list. Neither the login wall nor the API token path may reintroduce a header-trust bypass (e.g. trusting a client-supplied identity header without server-side verification).
- **Quality gates.** Never `--no-verify`. Standard test requirements per `docs/CONTRIBUTING.md` apply to every change in this feature, including the gate, first-run flow, `token_version` check, API token endpoint, and #047 closure.

## Acceptance criteria

### F-A — Gated login wall

- [x] An unauthenticated request to any protected client route (any page other than login/first-run) is redirected to the login (or first-run, if no owner exists) screen before any app content renders — verified by an E2E test asserting no task/list content is present pre-redirect.
- [x] An unauthenticated request to any protected server API (`/lists/*`, `/tasks/*`, `/sync/*`, and `/auth/*` endpoints other than login/first-run) returns `401` — verified by integration test per endpoint group.
- [x] The login surface, first-run surface, and `/health` remain reachable without authentication — verified by integration/E2E test.
- [x] On a fresh deployment with no owner account, loading the app presents the first-run owner-setup screen (not the login screen) — verified by E2E/integration test against an empty database.
- [x] After first-run setup creates an owner account, reloading the app (or visiting from another browser/device) presents the login screen, not first-run setup again — verified by integration test asserting a second first-run attempt is rejected/redirected once an owner exists.
- [x] The Sidebar no longer contains a reachable login form for unauthenticated users; login only occurs through the wall's login screen — verified by E2E test confirming an unauthenticated visitor cannot reach app content via the Sidebar.
- [x] A valid login issues a session that carries a `token_version` value matching the server's current value for that user.
- [x] Bumping the server-side `token_version` for a user causes the *next* sync/API call made with that user's previously-issued session to fail with `401`/an equivalent rejection, forcing re-login — verified by integration test: issue token, bump version, make a call, assert rejection.
- [x] An already-authenticated device that goes offline before a `token_version` bump continues to function locally (view/create/edit tasks against cached data) until its next server contact; only at that next server contact is the revoked session rejected — verified by test/documented behavior consistent with decision 2 (not literal instant offline revocation).
- [x] The owner has an accessible action (UI and/or API) to bump `token_version` and thereby revoke all previously-issued sessions for a user — verified by integration test exercising that action end-to-end (bump → old session rejected → new login succeeds).

### F-B — Programmatic task-creation API

- [x] A request to the create-task endpoint carrying a valid, configured API token in the designated header succeeds and creates a task — verified by integration test.
- [x] The task created via the API-token path flows through the same idempotent push/pull sync contract as a normally-created task (e.g. reappears correctly on a subsequent `/sync/pull`, and a duplicate/retried create does not create a duplicate task) — verified by integration test exercising create-then-sync.
- [x] A request to the create-task endpoint with a missing or invalid API token is rejected (`401`/`403`) — verified by integration test.
- [x] The same valid API token, presented on any endpoint other than create-task (including admin-only endpoints), is rejected — verified by integration test covering at least one read endpoint and one admin-only endpoint (e.g. `/auth/members`).
- [x] The API token's scope enforcement lives entirely server-side (no client-trusted scope flag) — verified by code review/test asserting the server rejects out-of-scope use regardless of client-supplied metadata.

### #047 resolution

- [x] Before owner setup exists, hash-less account login behavior is whatever the first-run flow requires (no fallback needed since no login is reachable pre-owner). Once the owner account is created via first-run setup, a subsequent attempt to authenticate as any hash-less account using the value of `DEV_LOGIN_PASSWORD` fails — verified by integration test: create owner, seed/simulate a hash-less account, attempt fallback-password login, assert rejection.
- [x] A space restored from a backup snapshot containing a hash-less user (`BackupUserRow.password_hash: None`, the grounded #047 resurrection path) does not become authenticatable via the shared fallback value once an owner already exists — verified by integration test combining restore + fallback-login attempt.
- [x] `docs/exec-plans/tech-debt-tracker.md` item #047 is moved to "Closed" with a link to this feature's branch/PR once the above is verified in Acceptance.

### Offline-first (cross-cutting)

- [x] An already-authenticated device, after a prior successful online load, hard-reloads while offline and still renders the cached app shell and locally-persisted tasks — the login-wall gate does not block this on a live server round-trip — verified by E2E offline-continuity test (extending the existing pattern in `docs/RELIABILITY.md` / `web/tests/e2e`).

## Open questions for design

- Where does `token_version` live (per-user DB column, per-session table, JWT claim re-checked against a DB value, or another mechanism), and how does the per-call check stay within the latency budgets in `docs/RELIABILITY.md`?
- What exactly is on the gate's allowlist — precise route/path list for both the SvelteKit client routes and the server API paths (login, first-run, health, and anything else structurally required, e.g. static assets/service worker)?
- How does first-run setup provision the owner's password, and what is the precise mechanical fate of `DEV_LOGIN_PASSWORD` — made optional (absent disables the fallback entirely, even pre-owner) or removed outright in favor of first-run provisioning? How does this interact with the existing fail-closed boot preflight (`validate_boot_secrets`) that currently mandates `DEV_LOGIN_PASSWORD` be set at all?
- What is the storage/format for the static API token (env var, DB-stored, rotatable?) and how is it compared server-side (constant-time comparison requirement, per the FileTube conceptual pattern)?
- What is the exact owner-facing mechanism/UI for bumping `token_version` (explicit "sign out everywhere" action, automatic bump on password change, or both)?
- How does the client detect "no owner exists yet" to decide between rendering first-run vs. login (a dedicated unauthenticated status-check endpoint, or inferred from a `401` shape)?

## Design

### Approach

The current stack already gives us most of what we need. `ctx_from_headers`
(`server/src/routes/types.rs`) is the single Bearer-only authentication boundary,
and it *already* performs one per-request DB lookup (`role_from_membership`) to
derive the caller's role. Every protected handler already funnels through it and
returns `401` when it fails. The client already treats a `401`/`403` from
`api.me()` as "session invalid → anonymous" (`web/src/lib/stores/auth.ts`), and it
already resolves to `authenticated` from *locally-persisted* state when the server
is merely unreachable (network error, not an auth failure). This means the wall,
the `token_version` revocation check, and offline-first continuity can be built by
*extending* existing seams rather than inventing new machinery.

Three coordinated changes deliver the feature:

1. **F-A gate.** Server: add a per-user `token_version` column, embed it as a `tv`
   claim in the JWT, and fold the version comparison into the existing per-request
   identity query (no new round-trip). Add two unauthenticated endpoints —
   `GET /auth/status` (does an owner exist?) and `POST /auth/setup` (first-run
   owner provisioning) — plus `POST /auth/revoke-sessions` (bump `token_version`).
   Client: render a full-screen `LoginWall` in `+layout.svelte` whenever auth
   resolves to `anonymous`, so no list/task/Sidebar content ever paints for an
   unauthenticated visitor; the wall picks first-run vs login from `/auth/status`.
   Remove the login form embedded in `Sidebar.svelte`'s account panel.

2. **F-B API token.** Add an optional operator-configured `TASK_API_TOKEN` env var
   and a *dedicated* ingest route `POST /api/tasks` that authenticates via a
   `ctx_from_api_token` verifier (constant-time comparison) resolving to the owner
   identity, then calls the exact same `create_task_for_ctx` used by the REST and
   sync paths. Because the token is only ever inspected by this one route's
   verifier, it is structurally incapable of authenticating any other endpoint —
   scope is enforced by wiring, not by a runtime flag that could be forgotten.

3. **#047 closure.** Delete the shared-fallback branch in `password_matches_for_user`
   (hash-only auth), retire `DEV_LOGIN_PASSWORD` from `AppState` and the boot
   preflight (`validate_boot_secrets` keeps mandating `JWT_SECRET` only), and let
   first-run provision the owner's real hash through the existing `hash_password`
   path. Once an owner exists, no hash-less account — including one resurrected via
   backup restore — can authenticate, because there is no longer any credential
   path that accepts a value other than the account's own bcrypt hash.

### Resolved design questions

- **Q1 — `token_version` storage + latency.** New `token_version integer not null
  default 0` column on the `user` table (per-user, not per-session). Embedded as a
  `tv` claim in the issued JWT. Re-checked on every request by *widening the query
  that already runs* inside `ctx_from_headers`: `role_from_membership` becomes a
  single joined read `select m.role, u.token_version from membership m join user u
  on u.id = m.user_id where m.space_id = ?1 and m.user_id = ?2`. If the claim `tv`
  does not equal the stored `token_version`, return `401`. This adds one column to
  an existing indexed primary-key/joined lookup — no extra round-trip, microsecond
  cost — so it does not touch the `docs/RELIABILITY.md` budgets (which govern the
  client-side <16 ms UI interaction and the <500 ms WAN sync-ack envelope; this is
  server-side and already on the request's critical path). Backward compatibility:
  `tv` is deserialized with `#[serde(default)]` so pre-existing tokens (no `tv`)
  read as `0`, matching the default column value — existing sessions survive the
  deploy and are only invalidated by a deliberate bump.

- **Q2 — Exact gate allowlist.** Server pre-auth reachable set: `GET /health`,
  `GET /` (static banner), `POST /auth/login`, `GET /auth/status`,
  `POST /auth/setup`, and CORS `OPTIONS` preflight. `POST /api/tasks` is reachable
  without a session but requires the API token (separate credential, not "public").
  Everything else — `/lists/*`, `/tasks/*`, `/sync/*`, and all `/auth/*` except
  `login`/`status`/`setup` — funnels through `ctx_from_headers` and returns `401`
  when unauthenticated or revoked. Client: the app is a static SPA, so the wall is
  a client-side render gate in `+layout.svelte`, not SSR route guards. Static assets
  (favicon, `manifest.webmanifest`, service worker, self-hosted fonts, icon/streak
  assets) stay unconditionally cacheable so the offline shell boots. No flash of app
  content: the layout renders (a) a minimal splash while `auth.status === 'loading'`,
  (b) `<LoginWall/>` while `anonymous`, (c) the existing Sidebar + `<slot/>` only
  while `authenticated`. Offline cold-boot for an already-authenticated device is
  preserved by the *existing* `auth.hydrate()` behavior: a stored token plus cached
  user, with `api.me()` failing on a *network* error (not `401`), resolves to
  `authenticated` against local state — the wall keys off that state and never
  blocks on a live round-trip. Revocation lands only when a call actually reaches
  the server and returns `401` (decision 2).

- **Q3 — `DEV_LOGIN_PASSWORD` fate + boot preflight.** Removed outright, not merely
  gated. The fallback branch in `password_matches_for_user` (auth.rs ~275-280) is
  deleted so authentication is hash-only; `AppState.login_password` and the
  `DEV_LOGIN_PASSWORD` arm of `validate_boot_secrets` are removed (the preflight
  keeps mandating `JWT_SECRET`, resolving #047's "boot-mandatory even where it
  gates nothing" complaint). The hash-less auto-upgrade path in `login` (~314-324)
  is removed with it (unreachable once the fallback is gone). First-run provisions
  the owner's real bcrypt hash via `hash_password`; existing hash-less members are
  provisioned by the admin `auth_set_member_password` flow. A backup restored with
  `BackupUserRow.password_hash: None` therefore has no login path at all — the
  grounded #047 resurrection is closed by construction. Operators may leave a stale
  `DEV_LOGIN_PASSWORD` in `.env`; it is simply ignored (documented as deprecated).

- **Q4 — API token storage + comparison + scope.** Operator-configured env var
  `TASK_API_TOKEN` (optional; absent ⇒ `POST /api/tasks` returns `404`, feature
  disabled). Env-var, not DB-stored: keeps it out of space backups, matches the
  single-binary self-hosted model, and rotates via restart. Held on
  `AppState.api_token: Option<String>`; validated at boot when present (fail-closed
  minimum length, e.g. ≥ 24 chars) alongside the other secrets. Compared with a
  constant-time equality check (`subtle::ConstantTimeEq`, or a hand-rolled
  length-independent compare) inside a dedicated `ctx_from_api_token` verifier that
  reads the `X-TaskSync-Api-Token` header. On success it resolves the single-owner
  admin identity from `membership` and returns a `RequestCtx { role: Admin,
  scope: AuthScope::ApiTaskCreate, .. }`. Scope is server-authoritative because the
  verifier is wired to exactly one route; no other handler consults the token
  header, and `ctx_from_headers` never accepts it. `AuthScope` is also carried on
  `RequestCtx` as defense-in-depth. Created tasks are attributed to the owner
  (`created_by_user_id`/`assignee_user_id = owner`) and flow through the shared
  `create_task_for_ctx`, so idempotency, tombstone-clear, and pull propagation are
  identical to UI/sync creates (sync determinism preserved). Callers pass a stable
  `id` for idempotent retries, exactly like the REST/sync contract.

- **Q5 — Owner-facing revoke-all.** Both automatic and explicit. Automatic:
  `auth_change_password` and admin `auth_set_member_password` bump the affected
  user's `token_version`. For self password-change the acting device would otherwise
  log itself out, so `auth_change_password` re-issues a fresh token in its response
  body (client swaps the stored token) — killing *other* sessions while keeping the
  current one; `auth_set_member_password` bumps the *target* user (the admin's own
  session is untouched). Explicit: a new `POST /auth/revoke-sessions` increments the
  caller's own `token_version`, surfaced in the Sidebar account panel as a "Sign out
  everywhere" button (distinct from the existing local-only "Sign out"). Propagation:
  every previously-issued session carries the old `tv`; on its next server contact
  the widened `ctx_from_headers` query sees the mismatch and returns `401`, which the
  client already routes to `anonymous` → the wall's login screen.

- **Q6 — First-run vs login detection.** A dedicated unauthenticated
  `GET /auth/status` → `{ "owner_exists": bool }` (true iff an `admin` membership
  exists). Chosen over inferring from a `401` shape because a `401` from `/auth/me`
  is ambiguous (missing token vs expired token vs revoked vs no owner); a purpose-built
  status endpoint is explicit, cheap, leaks nothing, and lets the wall deterministically
  branch. `LoginWall` fetches it on mount: `owner_exists === false` → first-run setup
  form; otherwise → login form. If the fetch fails (offline), default to the login
  form — a returning device is normally already `authenticated` (so never reaches the
  wall), and no one can complete setup offline anyway.

### Component changes

**Server — `server/migrations/0017_user_token_version.sql` (new)**

- `alter table user add column token_version integer not null default 0;` Reversible
  (drop column). No backfill needed; default `0` matches the `#[serde(default)]` claim.

**Server — `server/src/routes/types.rs`**

- `AuthClaims`: add `#[serde(default)] tv: i64`.
- `issue_token`: add a `token_version: i64` parameter, write it to `tv`.
- `AppState`: remove `login_password`; add `api_token: Option<String>`.
- `app_state`: stop reading `DEV_LOGIN_PASSWORD`; read `TASK_API_TOKEN` (optional).
- `validate_boot_secrets`: drop the `DEV_LOGIN_PASSWORD` check; keep `JWT_SECRET`;
  add an optional `TASK_API_TOKEN` length check when present (fail-closed).
- `role_from_membership` → `resolve_identity` returning `(Role, token_version)` from
  one joined query; `ctx_from_headers` compares `tv` and returns `401` on mismatch.
- Add `enum AuthScope { Session, ApiTaskCreate }`; add `scope` to `RequestCtx`
  (`ctx_from_headers` sets `Session`).
- Add `ctx_from_api_token(headers, state)`: constant-time compare of
  `X-TaskSync-Api-Token` against `state.api_token`, resolve the owner admin, return
  an `ApiTaskCreate`-scoped `RequestCtx`. Add a `constant_time_eq` helper (or
  `subtle` dep).

**Server — `server/src/routes/auth.rs`**

- `password_matches_for_user`: delete the shared-fallback branch (hash-only; missing
  hash ⇒ `Ok(false)`).
- `login`: load the user's `token_version`, pass it to `issue_token`; remove the
  hash-less auto-upgrade block.
- `auth_change_password`: after writing the new hash, bump `token_version`, re-issue
  a token, and return it (`200 { token }` instead of `204`).
- `auth_set_member_password`: bump the target user's `token_version`.
- New `auth_status` (`GET /status`, unauthenticated): `{ owner_exists }`.
- New `auth_setup` (`POST /setup`, unauthenticated, self-guarded): reject `409` if an
  admin already exists; else transactionally create space (if absent), user with
  `hash_password`ed password, and admin membership; return a login-shaped token.
- New `auth_revoke_sessions` (`POST /revoke-sessions`, authenticated): bump caller's
  `token_version`; `204`.
- `auth_routes`: register `/status`, `/setup`, `/revoke-sessions`.

**Server — `server/src/routes/integrations.rs` (new) + `mod.rs` + `main.rs`**

- New module exposing `integration_routes` with `POST /tasks` →
  `create_task_via_api_token`, which calls `ctx_from_api_token` then the shared
  `create_task_for_ctx`; returns `404` when `api_token` is `None`.
- `mod.rs`: declare module, `pub use integration_routes`.
- `main.rs`: `.nest("/api", integration_routes(...))`; add
  `x-tasksync-api-token` to the CORS `allow_headers`; remove `DEV_LOGIN_PASSWORD`
  from any boot messaging.

**Client — `web/src/routes/+layout.svelte`**

- After `auth.hydrate()`, render an auth gate: splash while `loading`,
  `<LoginWall/>` while `anonymous`, existing shell (`Sidebar` + `<slot/>`) only while
  `authenticated`. This replaces the current `{#if appReady}<slot/>` gate as the point
  where app content is withheld.

**Client — `web/src/lib/components/LoginWall.svelte` (new)**

- Full-screen. On mount calls `api.authStatus()`; renders first-run setup form when
  `owner_exists === false`, else the login form (moved out of `Sidebar.svelte`).
  Calls `auth.login()` / `auth.setupOwner()`. Props in / events out; store access
  limited to `auth` (mirrors the existing intentional-store-access components).

**Client — `web/src/lib/components/Sidebar.svelte`**

- Remove the anonymous `{:else}` login form block (~1332-1375); keep the
  authenticated identity/edit-profile/change-password panel and add a "Sign out
  everywhere" button calling `auth.revokeAllSessions()`.

**Client — `web/src/lib/stores/auth.ts`, `api/client.ts`, `shared/types/auth.ts`**

- `auth.ts`: add `setupOwner(...)` (POST setup, then persist token/user like `login`),
  `revokeAllSessions()` (POST revoke, then `logout()` locally). `login` unchanged;
  `changePassword` consumer updates the stored token from the new response.
- `client.ts`: add `authStatus()`, `setupOwner(body)`, `revokeSessions()`; update
  `changePassword` return type to carry a token.
- `shared/types/auth.ts`: add `AuthStatusResponse`, `AuthSetupRequest`, and reuse the
  login response shape for setup.

### Data model changes

- `user` gains `token_version integer not null default 0`. Documented in
  `docs/ARCHITECTURE.md` (`User { ..., token_version }`).
- No changes to `task`, `list`, `membership`, tombstone, or sync tables — API-created
  tasks reuse the existing schema and code paths.

### API changes

- New: `GET /auth/status`, `POST /auth/setup`, `POST /auth/revoke-sessions`,
  `POST /api/tasks` (API-token authenticated).
- Changed: `PATCH /auth/password` now returns `200 { token }` instead of `204`.
- Changed (internal, not a wire break): every existing protected endpoint now also
  rejects a stale-`token_version` session with `401`.
- New request header consumed on one route: `X-TaskSync-Api-Token`.

### Alternatives considered

- **Revocation store (Q1):** a per-session/JWT denylist table checked each request.
  Rejected: adds write + read state and a cleanup job for marginal benefit over a
  monotonic per-user counter; the counter reuses the query already on the request
  path and matches the single-owner model. A stateless short-lived-token + refresh
  scheme was also rejected as a larger auth rewrite outside scope.
- **Gate enforcement (Q2):** SvelteKit SSR `load`-guards / `hooks.server.ts`.
  Rejected: the app ships as a static SPA (adapter-static for the Capacitor shell),
  so there is no server render to guard, and an SSR guard would fight offline-first.
  A client render gate against locally-persisted session state is the only approach
  that keeps offline cold-boot working.
- **#047 (Q3):** make `DEV_LOGIN_PASSWORD` optional but keep a fallback gated on
  "no owner yet." Rejected in favor of outright removal: once first-run exists there
  is no pre-owner login surface that needs a fallback, so retaining the branch only
  preserves attack surface and a boot-secret with no purpose.
- **API token (Q4):** DB-stored, admin-rotatable token, and/or routing the token
  through `ctx_from_headers` with a scope flag every handler must check. Rejected:
  DB storage leaks into backups and adds CRUD scope creep for a single-owner MVP;
  threading a scope flag through ~15 handlers is exactly the "someone forgets a check"
  hazard — a dedicated verifier on a dedicated route makes out-of-scope use
  impossible by construction. Reusing the `Authorization` header for the token was
  rejected to keep the JWT boundary unambiguous.
- **Revoke-all (Q5):** explicit-only, or password-change-only. Rejected: password
  change without revocation leaves stolen sessions alive; an explicit control without
  auto-bump surprises users who change a password expecting a sign-out. Both, with
  current-device re-issue, covers the cases without logging the acting device out.
- **First-run detection (Q6):** infer from a `401` shape or a sentinel error body.
  Rejected: overloads `401` semantics and couples the client to error internals; a
  one-line status endpoint is unambiguous and testable.

### Risks and mitigations

- **Risk:** the wall blocks an already-authenticated device that is offline on cold
  boot. → **Mitigation:** gate on `auth.status`, which already resolves to
  `authenticated` from cached token+user on a network (non-`401`) failure; add an
  E2E offline-continuity test (extends the `docs/RELIABILITY.md` pattern).
- **Risk:** a deploy invalidates every live session (forced global re-login). →
  **Mitigation:** `#[serde(default)]` `tv` reads old tokens as `0`, matching the new
  column default, so existing sessions keep working until a deliberate bump.
- **Risk:** `token_version` check adds per-request latency. → **Mitigation:** folded
  into the existing identity query (no new round-trip); benchmark unaffected — see
  Performance impact.
- **Risk:** API token leaks admin abilities or is accepted off its one route. →
  **Mitigation:** dedicated verifier + dedicated route + `ApiTaskCreate` scope; add
  integration tests asserting the token is rejected on a read endpoint and on
  `/auth/members`, and that `create_task_for_ctx` idempotency holds.
- **Risk:** removing the fallback locks out a legacy hash-less admin. →
  **Mitigation:** any admin who has ever logged in already carries a bcrypt hash (the
  old auto-upgrade ran on first login); document that a genuinely hash-less space is
  recovered via first-run/`auth_set_member_password`.
- **Risk:** constant-time compare done naively leaks length/timing. →
  **Mitigation:** use `subtle::ConstantTimeEq` (or a vetted length-independent
  helper) with a unit test.
- **Follow-up (out of scope):** a public login wall widens brute-force surface. Flag
  a rate-limiting tech-debt item at `/done` (login-attempt throttling), consistent
  with the exec plan's out-of-scope note.

### Performance impact

No expected impact on the `docs/RELIABILITY.md` budgets. The client budgets
(primary UI actions <16 ms, sound onset <20 ms, 10k-task search <100 ms) are not on
any path this feature touches; the wall is a one-time render-gate decision at boot.
Server-side, the `token_version` check reuses the identity query already executed by
`ctx_from_headers` (one added column on an indexed lookup), and the API-token verifier
runs only on `POST /api/tasks`. The <500 ms WAN sync-ack envelope is unaffected.

## Task breakdown

Ordered so all server-side auth changes and the migration land before any client
gate work, and so the #047 fallback removal (T5) is sequenced **after** first-run
setup (T4) — deleting the shared `DEV_LOGIN_PASSWORD` fallback must never leave a
fresh deployment with no owner-provisioning path. Each task is independently
testable with a definition of done that includes the `docs/CONTRIBUTING.md` test
requirements (server: `cargo test` + `cargo fmt -- --check` + `cargo clippy -D warnings`;
web: `npm run lint` + `npm run check` + `npm run test`, plus `npm run test:e2e:smoke`
for user-visible/cross-module flows).

### Server (must precede client work)

- **T1 — Migration: `user.token_version` column.**
  Add `server/migrations/0017_user_token_version.sql`:
  `token_version integer not null default 0`, reversible (drop column), no backfill.
  *DoD:* migration applies on a fresh DB and reverses; column is NOT NULL DEFAULT 0;
  `cargo test/fmt/clippy` green. (AC: session carries a `token_version`.)

- **T2 — `token_version` claim + per-request revocation check.**
  `types.rs`: `#[serde(default)] tv: i64` on `AuthClaims`; `issue_token` gains a
  `token_version` param; `role_from_membership` → `resolve_identity` returning
  `(Role, token_version)` from one joined query; `ctx_from_headers` returns `401` on
  `tv` mismatch. `auth.rs`: `login` loads and passes the user's `token_version`.
  *DoD:* integration test issue→bump→`401`; test that a pre-existing token with no `tv`
  reads as `0` and still authenticates against the default-0 column; no new round-trip;
  `cargo test/fmt/clippy` green. (AC: `token_version` matches on login; bump → next call `401`.)

- **T3 — Revoke-sessions endpoint + password-change bumps.**
  `auth.rs`: `auth_change_password` bumps caller's `token_version`, re-issues a token,
  returns `200 { token }` (was `204`); `auth_set_member_password` bumps the **target**
  user; new `auth_revoke_sessions` (`POST /revoke-sessions`, authenticated) bumps the
  caller and returns `204`; register the route.
  *DoD:* integration tests — revoke-all end-to-end (bump → old `401` → fresh login OK),
  self password-change keeps the acting device alive while old token is rejected, admin
  set-member-password revokes the target only; `cargo test/fmt/clippy` green.
  (AC: owner has an accessible revoke-all action.)

- **T4 — First-run status + setup endpoints (unauthenticated).**
  `auth.rs`: `auth_status` (`GET /status`) → `{ owner_exists }`; `auth_setup`
  (`POST /setup`, self-guarded) → `409` if an admin exists, else transactionally create
  space (if absent) + `hash_password`-ed user + admin membership, return a login-shaped
  token; register both routes on the pre-auth allowlist.
  *DoD:* integration tests — empty DB → `owner_exists=false` and setup succeeds; after
  setup → `owner_exists=true`; second setup → `409`; `/status` and `/setup` reachable
  without a session; `cargo test/fmt/clippy` green.
  (AC: fresh deployment shows first-run; second first-run rejected; status/setup public.)

- **T5 — #047 closure: remove `DEV_LOGIN_PASSWORD` shared fallback.** *(after T4)*
  `auth.rs`: delete the shared-fallback branch in `password_matches_for_user` (hash-only;
  missing hash ⇒ `Ok(false)`); remove the hash-less auto-upgrade in `login`. `types.rs`:
  remove `AppState.login_password`, stop reading `DEV_LOGIN_PASSWORD`, drop it from
  `validate_boot_secrets` (keep the `JWT_SECRET` mandate). Migrate existing
  fallback-dependent server tests to real hashed credentials / first-run setup.
  *DoD:* integration tests — after owner setup, hash-less account + `DEV_LOGIN_PASSWORD`
  value is rejected; backup-restored hash-less user (`password_hash: None`) not
  authenticatable; boot preflight no longer mandates `DEV_LOGIN_PASSWORD` but still
  fails-closed on unset `JWT_SECRET`; all migrated tests green; `cargo test/fmt/clippy`
  green. (AC: #047 resolution; tracker moved to Closed at Acceptance.)

- **T6 — API-token verifier + scope (F-B infra).**
  `types.rs`: `AppState.api_token: Option<String>` from `TASK_API_TOKEN` (optional);
  boot validation (fail-closed length ≥ 24 when present); `enum AuthScope { Session,
  ApiTaskCreate }` + `scope` on `RequestCtx` (`ctx_from_headers` sets `Session`);
  `ctx_from_api_token` doing a constant-time compare of `X-TaskSync-Api-Token`, resolving
  the owner admin, returning an `ApiTaskCreate`-scoped ctx; add `constant_time_eq` (or
  `subtle`).
  *DoD:* unit tests for constant-time compare (equal/unequal/differing-length), verifier
  accept/reject, and too-short-token boot rejection; `cargo test/fmt/clippy` green.
  (AC: scope enforcement lives server-side.)

- **T7 — `POST /api/tasks` ingest route (F-B endpoint).**
  New `integrations.rs` with `integration_routes`: `POST /tasks` →
  `create_task_via_api_token` → `ctx_from_api_token` → shared `create_task_for_ctx`;
  `404` when `api_token` is `None`. Wire `mod.rs` + `main.rs` (`.nest("/api", ...)`, add
  `x-tasksync-api-token` to CORS `allow_headers`, drop `DEV_LOGIN_PASSWORD` boot
  messaging).
  *DoD:* integration tests — valid token creates a task; missing/invalid → `401/403`;
  retried create (same `id`) does not duplicate; task reappears on `/sync/pull`; token on
  a read endpoint and on `/auth/members` rejected; unset token → `404`;
  `cargo test/fmt/clippy` green. (AC: all F-B criteria.)

### Client (after all server tasks)

- **T8 — Auth store + API client + types.**
  `shared/types/auth.ts`: `AuthStatusResponse`, `AuthSetupRequest`, reuse login response
  for setup. `api/client.ts`: `authStatus()`, `setupOwner(body)`, `revokeSessions()`;
  `changePassword` returns a token. `stores/auth.ts`: `setupOwner(...)`,
  `revokeAllSessions()`, and `changePassword` token swap; `login` unchanged.
  *DoD:* vitest unit tests for setupOwner, revokeAllSessions, changePassword token swap;
  `npm run lint/check/test` green.

- **T9 — LoginWall component.**
  `web/src/lib/components/LoginWall.svelte`: full-screen; on mount `api.authStatus()`;
  first-run form when `owner_exists === false`, else login form (moved out of Sidebar);
  offline status-fetch failure defaults to login form; store access limited to `auth`.
  *DoD:* vitest unit test — renders setup vs login for both states + fetch-failure;
  `npm run lint/check/test` green. (AC: fresh deployment → first-run; owner exists → login.)

- **T10 — Layout auth gate + Sidebar login-form removal + Sign out everywhere.**
  `+layout.svelte`: replace the `appReady` gate with an auth gate (splash while
  `loading`, `<LoginWall/>` while `anonymous`, shell only while `authenticated`);
  offline cold-boot preserved via existing cached-token resolution. `Sidebar.svelte`:
  remove the anonymous login form block; add a "Sign out everywhere" button calling
  `auth.revokeAllSessions()`.
  *DoD:* E2E smoke — unauthenticated visitor sees no task/list content and lands on the
  wall; fresh DB → first-run, owner-exists → login; Sidebar has no reachable anonymous
  login form; offline-continuity (authenticated device hard-reloads offline, still
  renders cached shell + local tasks). `npm run lint/check/test/test:e2e:smoke` green.
  (AC: gate redirect/no-flash, Sidebar login removed, offline-first cross-cutting.)

### Docs

- **T11 — ARCHITECTURE + tech-debt tracker.**
  `docs/ARCHITECTURE.md`: `User { …, token_version }`; document `GET /auth/status`,
  `POST /auth/setup`, `POST /auth/revoke-sessions`, `POST /api/tasks`, the
  `X-TaskSync-Api-Token` header, the `PATCH /auth/password` → `200 { token }` change, and
  `DEV_LOGIN_PASSWORD` removal. Prepare `tech-debt-tracker.md` #047 → Closed with a link
  to this feature's branch/PR (finalized at Acceptance).
  *DoD:* docs reflect the schema + endpoint changes; #047 entry references this feature;
  no contradiction with `docs/RELIABILITY.md` budgets. (AC: #047 moved to Closed.)

## Progress log

- 2026-07-18: Discovery complete. PM wrote this exec plan anchoring the four user-confirmed decisions from kickoff (fold in #047; `token_version`-based revocation, server-contact-bound; API token scoped to create-task only; single-owner model). Grounded against current implementation: menu-first login lives in `Sidebar.svelte`'s account section (~line 1216 onward), `ctx_from_headers` (`server/src/routes/types.rs`) is the single Bearer-only auth boundary post-auth-hardening, `password_matches_for_user` (`server/src/routes/auth.rs` ~262) is the #047 fallback path, and `+layout.svelte`'s existing `appReady`/hydration gate is the likely anchor point for the client-side wall (mechanism left to Principal Engineer). Routed for `/design`.
- 2026-07-18: Design complete. PE resolved all six open questions (see Resolved design questions Q1-Q6), authored the component-by-component change list, alternatives, risks, and performance impact, and confirmed no RELIABILITY budget regression (token_version folded into the existing per-request identity lookup; API-token verifier only on POST /api/tasks). Routed for `/tasks`.
- 2026-07-18: Tasks broken into 12 discrete, independently-testable units (T1-T11 planned; T12 added as a QA fast-follow) with server-before-client ordering and T5 (#047 removal) sequenced after T4 (first-run setup). Implementation ran T1→T12; every task reported done, re-verified green by the build-specialist at each `/verify`, with full server (`cargo test/fmt/clippy`) and web (`lint/check/test` + `test:e2e:smoke`) gates passing.
- 2026-07-18: QA review returned APPROVE with two non-blocking WARNINGs (auth_setup `space_id` not trimmed/empty-checked; stale `scripts/2-serve.ps1` operator messaging still referencing `DEV_LOGIN_PASSWORD`); both fixed in T12 before merge.
- 2026-07-18: Acceptance complete — product-manager validated all 19 acceptance criteria PASS (F-A gated login wall 10/10, F-B programmatic task-creation API 5/5, #047 resolution 3/3, offline-first cross-cutting 1/1) against the shipped code and tests. Feature closed; exec plan archived to `completed/`. Tech-debt #047 moved to Closed referencing `feat/gated-login-wall-and-task-api`; new tech-debt #048 (login-attempt rate limiting) filed per the exec plan's out-of-scope brute-force follow-up.

## Decision log

- 2026-07-18: User-confirmed at kickoff (anchored verbatim from `.state/inbox/product-manager.md`, not re-litigated in Discovery):
  1. Fold in tech-debt #047 — first-run admin setup replaces the shared `DEV_LOGIN_PASSWORD` fallback login; the fallback is disabled once a real admin account exists. This feature resolves #047, not deferred to a separate branch.
  2. Revocation model = `token_version`. Embedded in the issued session, re-checked by the server on every sync/API call. Offline use stays fully usable against locally-persisted session state; revocation takes effect on the next server contact, not instantly offline.
  3. API token scope is minimal. The programmatic API token acts as the admin/owner identity but authorizes ONLY the create-task endpoint — nothing admin-only, nothing else. Server-authoritative; scope cannot be client-trusted.
  4. Single-owner self-hosted model. First-run creates one admin/owner account; that is effectively the only account. Requirements are designed around a single-owner deployment, not multi-tenant onboarding.
