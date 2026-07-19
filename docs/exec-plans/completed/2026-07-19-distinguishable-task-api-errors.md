# Distinguishable Error Responses for POST /api/tasks

## Goal

Give the programmatic task-creation API (`POST /api/tasks`) distinguishable,
script-legible error responses for every failure mode that occurs once the
feature is enabled and a caller has presented an API token — so an automation
client (iOS Shortcuts, `curl`, etc.) reading a raw HTTP response can tell
"unknown `list_id`" apart from "bad token" apart from "scope rejected" — while
never weakening the deliberate 404-when-disabled concealment that makes the
endpoint indistinguishable from a nonexistent route when `TASK_API_TOKEN` is
unset.

## Scope

- **Feature-off concealment (`TASK_API_TOKEN` unset) stays exactly as it is
  today.** Bare `404`, empty body, no new/changed headers. This is the one
  case this feature must NOT touch (see Constraints).
- **Every failure mode that is reached only when the feature is enabled**
  (i.e., every rejection AFTER the feature-off gate check in
  `create_task_via_api_token`) gains a JSON error body carrying a stable,
  machine-readable `code` field the caller can branch on:
  - `401` — missing/invalid API token, or an unresolvable owner identity.
  - `403` — scope mismatch (defense-in-depth `AuthScope` check).
  - `404` — unknown `list_id` (the exact case that collided with the
    concealment `404` in the 2026-07-19 debugging session). This body is
    non-empty and its `code` is provably different from the feature-off
    `404`, so a caller can tell the two apart by body content alone.
  - `400` — request-body validation failures surfaced by `create_task_for_ctx`
    (e.g. invalid priority).
  - `409` — idempotent-create conflict.
  - `500` — internal/database error. Body stays generic (a stable `code`
    only) — no leaked internal error text (SQL/db-driver messages, stack
    traces).
- **Change is scoped to `POST /api/tasks` only** (`server/src/routes/
  integrations.rs`). The browser session route `POST /tasks`
  (`server/src/routes/tasks.rs`) keeps its existing bare-status-code error
  contract unchanged, even though both routes share `create_task_for_ctx`.
  How the new JSON bodies get attached without changing the shared function's
  contract for the browser route is a Principal Engineer design decision.
- **Server-side log lines on every rejected create on this route** (401, 403,
  404-unknown-list, 400, 409, 500), naming the failure category, so the owner
  can diagnose from server logs even for cases where the response body must
  stay minimal. The raw API token value is never logged. (This was flagged as
  a "nice-to-have" in the debugging writeup; pulled into scope here because it
  is low-risk, server-only, and directly serves the stated diagnosability
  goal — see Decision log.)

## Out of scope

- Any weakening, removal, or modification of the feature-off `404`
  concealment — status code, body, headers, or timing. Any proposal that
  leaks the endpoint's existence to an unauthenticated/no-token caller is
  rejected outright.
- Changing the error/response contract of `POST /tasks` (browser session
  route) or of any other existing endpoint.
- Distinguishing the sub-causes of `401` (missing header vs. wrong token
  value vs. unresolvable owner identity) in the response body. These stay
  behind a single generic `code` to avoid creating a new oracle a prober
  could use to narrow down *why* a guess failed. (Flagged for user
  confirmation — see Open questions.)
- Exposing internal error details (stack traces, raw SQL/db-driver messages)
  in the `500` body.
- Rate limiting / brute-force hardening on this or any auth-adjacent route —
  tracked separately as tech-debt #048, not part of this feature.
- Reverse-proxy / infrastructure-level misroute detection. Out of the
  application's control. Noted as a side-benefit, not a delivered feature:
  once the app's own two `404` cases are reliably distinguishable, a proxy
  misroute (typically the proxy's own error page, different `Content-Type`,
  or a body that doesn't match either of the app's shapes) becomes
  identifiable by elimination — no explicit proxy-detection logic is being
  added to produce that outcome.
- Any client-side (SvelteKit web app) changes. This is a server-only surface
  consumed by external automation clients, not the app itself.
- **Cross-check against `docs/CONTRIBUTING.md`:** none of the above defers
  required test coverage. Every in-scope change (new error bodies, log
  lines) still requires `cargo test` + `cargo fmt -- --check` +
  `cargo clippy -D warnings` coverage per "Tests required per PR" — nothing
  here is deferred testing.

## Constraints

- **Concealment (non-negotiable).** When `TASK_API_TOKEN` is unset, `POST
  /api/tasks` must remain byte-for-byte identical to its current behavior:
  same status (`404`), empty body, no new or changed response headers, and no
  observable timing signal that discloses the feature exists. This is a hard
  stop — no requirement in this plan may compromise it, and Acceptance must
  verify it with a direct before/after comparison, not just "still returns
  404."
- **Server-authoritative auth/scope enforcement is unaffected.** This
  feature only changes what a rejection's response body and server logs
  contain — it must not change which requests are accepted or rejected, nor
  weaken `ctx_from_api_token`'s constant-time comparison or the
  `AuthScope::ApiTaskCreate` check.
- **Offline-first: not applicable.** This is a server-only change to a
  server-to-server/automation API surface; it does not touch the SvelteKit
  client or its offline behavior.
- **Sync determinism unaffected.** No change to `create_task_for_ctx`'s
  insert, idempotency, or tombstone-clear behavior — only to how its
  failures are reported to the caller and to logs.
- **No secret material in responses or logs.** The `X-TaskSync-Api-Token`
  value must never appear in a response body or a log line, on success or
  failure.
- **Quality gates.** Never `--no-verify`. `cargo fmt -- --check`, `cargo
  clippy -D warnings`, and `cargo test` must stay green, with new tests
  covering every new response shape and the unchanged feature-off case.

## Open questions

- Confirm: should `401` stay a single generic `code` regardless of cause
  (missing header / wrong token / unresolvable owner), or is there value in
  distinguishing "no token presented" from "token present but wrong" for a
  legitimate caller who's mistyped their token? Current default in this plan:
  single generic code, to avoid adding a new probing oracle.
- Confirm: is it acceptable that the browser-facing `POST /tasks` route keeps
  its existing bare-status-code contract while `POST /api/tasks` gains JSON
  bodies, even though both call the same `create_task_for_ctx`? (Default:
  yes — scope is intentionally limited to the API-token route.)
- For Principal Engineer: what's the exact JSON error shape and `code`
  taxonomy (e.g. `unknown_list`, `unauthorized`, `forbidden_scope`,
  `invalid_priority`, `conflict`, `internal_error`)? Not prescribed here.
- For Principal Engineer: mechanism for attaching JSON bodies to
  `create_task_for_ctx`'s existing `Result<_, StatusCode>` failures without
  changing the browser route's contract — translate/wrap at the
  `integrations.rs` call site, or widen the shared error type in a way the
  browser route can ignore? Left as a design decision.
- Should the log line for the unknown-`list_id` case include the caller-
  supplied `list_id` value (safe, non-secret, and exactly what's needed to
  diagnose the 2026-07-19 incident) — assumed yes, but flagging since it's
  the one piece of request-derived data proposed for logging.

## Acceptance criteria

- [x] `TASK_API_TOKEN` unset → `POST /api/tasks` returns a response that is
      byte-for-byte unchanged from pre-feature behavior: `404`, empty body,
      identical header set (no new `Content-Type` or other header) — verified
      by a regression test comparing the full raw response, not just the
      status code.
- [x] `TASK_API_TOKEN` set, valid token, request references a `list_id` that
      does not exist in the caller's space → `404` with a non-empty JSON body
      carrying a stable `code`, provably distinguishable from the
      feature-off `404` by body content alone — verified by integration
      test.
- [x] `TASK_API_TOKEN` set, missing or invalid token header → `401` with a
      JSON body carrying a stable `code` — verified by integration test.
- [x] `TASK_API_TOKEN` set, valid token but scope assertion fails (defense-
      in-depth `AuthScope` check) → `403` with a JSON body carrying a stable
      `code` — verified at the mapping/render level (`forbidden_scope()`
      constructor + handler gate-3 wiring) because gate 3 is structurally
      unreachable via the real auth path (a token minted by
      `ctx_from_api_token` always carries `AuthScope::ApiTaskCreate`); this
      matches the plan's anticipated fallback in the Test surface AC4 note.
- [x] `TASK_API_TOKEN` set, valid token, request body fails
      `create_task_for_ctx` validation (e.g. invalid priority) → `400` with a
      JSON body carrying a stable `code` — verified by integration test.
- [x] `TASK_API_TOKEN` set, valid token, idempotent-create conflict → `409`
      with a JSON body carrying a stable `code` — verified by integration
      test.
- [x] Internal/database error path → `500` with a JSON body carrying a
      generic stable `code` and no leaked internal error text (SQL/db-driver
      messages, stack traces) — verified by test and/or code review.
- [x] A server-side log line is emitted for every rejected create on this
      route (`401`, `403`, `404`-unknown-list, `400`, `409`, `500`) naming
      the failure category; the raw API token value never appears in a log
      line — verified by test asserting log output for at least one
      representative case per category, plus a code-review check confirming
      the token is never passed to a log macro.
- [x] Across the full set of named failure modes, the feature-off `404` is
      the ONLY empty-body response on this route — every other error path
      returns the new JSON error shape — verified by an exhaustive test
      matrix.
- [x] The browser session route `POST /tasks`'s existing response contract
      and test suite are unchanged — its existing tests pass unmodified, and
      no new JSON error body appears there as a side effect of any shared-
      code change.
- [x] The success path for `POST /api/tasks` (task created, existing status +
      task JSON body) is unchanged — verified by existing/new integration
      test.
- [x] `cargo fmt -- --check`, `cargo clippy -D warnings`, and `cargo test`
      (including all new tests) pass — corroborated from the build-specialist's
      green run (93/93 cargo tests) as the acceptance PM session had no shell
      tool.

## Design

### Approach

All changes are confined to `server/src/routes/integrations.rs` (the
`POST /api/tasks` handler) plus its tests in `server/src/routes/mod.rs`. The
shared `create_task_for_ctx` in `server/src/routes/tasks.rs` and the browser
`POST /tasks` handler that calls it are not touched, so the browser route's
`Result<_, StatusCode>` contract and its existing tests remain byte-for-byte
unchanged.

The handler today returns `Result<(StatusCode, Json<TaskRow>), StatusCode>`.
Axum renders the `Err(StatusCode)` branch as a bare status code with an empty
body and no `Content-Type` — that is exactly what produces the indistinguishable
empty-body responses. The fix changes only the **error half** of that return
type to a new, purpose-built `ApiTaskError` type local to `integrations.rs` that
implements `IntoResponse`. The success half stays `(StatusCode, Json<TaskRow>)`,
so the success path is provably unchanged.

`ApiTaskError` has exactly two shapes: a `Concealed` variant that renders
identically to today's bare `404` (empty body, no `Content-Type`), reserved for
the feature-off gate; and a `Coded { status, code }` variant that renders as
`(status, Json(ErrorBody { error: { code } }))`. Every post-gate failure the
handler can reach is translated — at the `integrations.rs` call site, per
call-site — from the shared function's `StatusCode` into a `Coded` value. The
shared function never learns about JSON bodies; the boundary owns the entire
error-shape translation.

### Error `code` taxonomy

JSON error body schema (only for the `Coded` variant; `Concealed` has no body):

```json
{ "error": { "code": "unknown_list", "message": "..." } }
```

- `error` — object (namespaced so it never collides with the success `TaskRow`
  shape, which has no `error` field).
- `error.code` — string; the **stable, machine-legible** contract a client
  branches on. Values are a closed set of `snake_case` literals (below).
- `error.message` — string; a **static** human-readable hint per code (no
  request data except where explicitly noted, no internal/DB text). Present for
  operator ergonomics; `code` is the stable key clients must key off.

Because the shared function collapses every failure to a bare `StatusCode`, the
boundary can only observe **status-level** granularity. Each status maps to
exactly one code per call-site — sub-causes behind a single status are not
distinguished (consistent with the user-approved "401 stays generic" decision).

| Failure mode | HTTP | `code` | Origin |
|---|---|---|---|
| Feature off (`TASK_API_TOKEN` unset) | 404 | *(none — empty body)* | handler gate 1 |
| Missing/invalid token, or owner identity unresolvable | 401 | `unauthorized` | `ctx_from_api_token` → 401 |
| Owner-lookup DB error | 500 | `internal_error` | `ctx_from_api_token` → 500 |
| Scope assertion fails (`AuthScope` check) | 403 | `forbidden_scope` | handler gate 3 |
| Unknown `list_id` | 404 | `unknown_list` | `create_task_for_ctx` → 404 |
| Body validation (e.g. invalid priority) | 400 | `invalid_request` | `create_task_for_ctx` → 400 |
| Idempotent-create conflict | 409 | `conflict` | `create_task_for_ctx` → 409 |
| Contributor-not-granted (defensive; unreachable on this route) | 403 | `forbidden` | `create_task_for_ctx` → 403 |
| Internal/DB error | 500 | `internal_error` | `create_task_for_ctx` → 500 |

The two `404`s are provably distinct **by body**: the feature-off `404` has an
empty body and no `Content-Type`; the unknown-`list_id` `404` carries
`{"error":{"code":"unknown_list",...}}` with `Content-Type: application/json`.
A caller reading the raw response can tell them apart without inspecting the
status line. `ctx_from_api_token` never returns `404`, so there is no third
source of `404` to disambiguate.

Note on the `400` code: `invalid_request` (not `invalid_priority`) is
deliberate. The boundary sees only a bare `400` from `create_task_for_ctx` and
cannot tell *which* validation failed; today priority is the sole trigger, but a
priority-specific code would silently mislead the moment another `400` validation
is added upstream. `invalid_request` stays honest at status-level granularity.

### Mapping mechanism

`ApiTaskError` lives in `integrations.rs` and owns rendering:

```rust
enum ApiTaskError {
    Concealed,                                   // feature-off: bare 404, empty body
    Coded { status: StatusCode, code: &'static str },
}

impl IntoResponse for ApiTaskError {
    fn into_response(self) -> Response {
        match self {
            // Byte-for-byte identical to today's `Err(StatusCode::NOT_FOUND)`.
            ApiTaskError::Concealed => StatusCode::NOT_FOUND.into_response(),
            ApiTaskError::Coded { status, code } => {
                let message = message_for_code(code);           // static lookup
                (status, Json(ErrorBody::new(code, message))).into_response()
            }
        }
    }
}
```

Translation is per call-site, so the same status from different origins is never
ambiguous — each origin has its own small `StatusCode → (status, code)` map:

```rust
// Auth: only 401 and 500 are reachable here.
fn from_auth(status: StatusCode) -> ApiTaskError {
    match status {
        StatusCode::UNAUTHORIZED => ApiTaskError::coded(status, "unauthorized"),
        _ => ApiTaskError::coded(StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
    }
}

// Shared create: 404 / 400 / 409 / 403 / 500.
fn from_create(status: StatusCode) -> ApiTaskError {
    match status {
        StatusCode::NOT_FOUND   => ApiTaskError::coded(status, "unknown_list"),
        StatusCode::BAD_REQUEST => ApiTaskError::coded(status, "invalid_request"),
        StatusCode::CONFLICT    => ApiTaskError::coded(status, "conflict"),
        StatusCode::FORBIDDEN   => ApiTaskError::coded(status, "forbidden"),
        _ => ApiTaskError::coded(StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
    }
}
```

The handler keeps its exact control-flow order (gate → auth → scope → create),
so **which requests are accepted or rejected does not change** — only what a
rejection renders:

```rust
) -> Result<(StatusCode, Json<TaskRow>), ApiTaskError> {
    if state.api_token.is_none() {
        return Err(ApiTaskError::Concealed);           // gate 1: unchanged, no log
    }
    let ctx = ctx_from_api_token(&headers, &state)
        .await
        .map_err(ApiTaskError::from_auth)?;            // gate 2
    if ctx.scope != AuthScope::ApiTaskCreate {
        return Err(ApiTaskError::forbidden_scope());   // gate 3
    }
    let requested_list_id = body.list_id.clone();      // capture before move
    let (status, rec) = create_task_for_ctx(&state, &ctx, body)
        .await
        .map_err(ApiTaskError::from_create)?;          // gate 4
    Ok((status, Json(rec)))
}
```

`create_task_for_ctx` is called with the same arguments and its signature is
unchanged, so the browser `POST /tasks` handler (which calls the same function
and maps its `StatusCode` straight through axum) is entirely unaffected — no
JSON body can appear there. `requested_list_id` is cloned before `body` is moved
into the shared call, purely so the unknown-list log line can name it (see
Logging); it does not alter the create path.

### Logging

A server-side log line is emitted for every **rejected create after gate 1**,
via `tracing` (already a dependency; the fmt subscriber is initialised in
`main.rs`). Emission happens in the handler at the point of rejection, so
rendering (`IntoResponse`) stays a pure function of the error. To keep log
content testable without a new dev-dependency, the log *message* per category is
produced by a pure helper (`reject_log_message(code) -> &'static str` and, for
the unknown-list case, a formatter that appends the caller-supplied `list_id`);
tests assert the pure helper directly, and a code-review check confirms the
`tracing` macro is wired at each rejection and that the raw token is never an
argument.

| Category | Level | Names |
|---|---|---|
| `unauthorized` (401) | `warn` | "rejected: unauthorized (missing/invalid token or owner unresolved)" |
| `forbidden_scope` (403) | `warn` | "rejected: scope mismatch" |
| `unknown_list` (404) | `warn` | "rejected: unknown list_id" + structured `list_id` field |
| `invalid_request` (400) | `warn` | "rejected: invalid request body" |
| `conflict` (409) | `warn` | "rejected: idempotent-create conflict" |
| `forbidden` (403) | `warn` | "rejected: forbidden" |
| `internal_error` (500) | `error` | "failed: internal error" |

Levels follow `docs/CONTRIBUTING.md` "fail fast and visibly": client-caused
rejections are `warn` (expected/recoverable), true server faults are `error`.

**Recommendation on the open question:** the unknown-`list_id` line **should**
include the caller-supplied `list_id` (as a structured `tracing` field, e.g.
`list_id = %requested_list_id`). It is non-secret, caller-supplied data and is
exactly the value that would have collapsed the 2026-07-19 debugging session
from many round trips to one glance at the log. No other request-derived value
is logged. The API token is never passed to any log macro on any path.

The **feature-off gate emits no log line** — it is not a "rejected create" (the
feature is off, the endpoint is nominally absent), it is excluded from the
acceptance list of logged categories, and keeping it a pure early return avoids
both a new observable side effect and log-spam from scanners probing a disabled
route. This preserves the "unchanged feature-off path" guarantee end to end.

### Components to change

- **`server/src/routes/integrations.rs`** (primary): add the `ApiTaskError`
  enum + `ErrorBody` serde struct + `IntoResponse` impl + per-call-site mapping
  helpers (`from_auth`, `from_create`, `forbidden_scope`) + the pure
  `reject_log_message` helper; change `create_task_via_api_token`'s error return
  type from `StatusCode` to `ApiTaskError` and add the `tracing` calls. Keep
  everything module-private (`pub(super)` only where tests need it).
- **`server/src/routes/mod.rs`** (tests): update the existing
  `create_task_via_api_token_*` tests to assert against `ApiTaskError`
  (status + code accessors) instead of bare `StatusCode`, and add the new
  failure-matrix, byte-for-byte concealment, and log-message tests.
- **`docs/ARCHITECTURE.md`**: extend the "Programmatic task-creation API" bullet
  (line ~89) to note that post-gate failures now return a JSON `{ error: { code } }`
  body with a stable code while the feature-off `404` stays empty-bodied.

No new module or file is introduced — `ApiTaskError` is a small, cohesive type
local to the one handler that needs it, consistent with the module's existing
"deliberately thin" boundary role.

### Data model impact

None. No schema, migration, column, or query change. `create_task_for_ctx`'s
insert/idempotency/tombstone-clear behavior is untouched.

### Risks

- **Concealment regression (highest).** If `ApiTaskError::Concealed` ever
  rendered a `Content-Type` or non-empty body, the feature's existence would
  leak. → Mitigation: `Concealed` delegates to `StatusCode::NOT_FOUND.into_response()`
  (the exact expression axum used before), and a dedicated regression test
  compares the full raw response (status + header set + body bytes) against a
  baseline `StatusCode::NOT_FOUND` response, not just the status code.
- **Empty body leaking onto a post-gate path.** A future edit could accidentally
  return `Concealed` (or a bodyless status) for a real rejection. → Mitigation:
  an exhaustive failure-matrix test asserts the feature-off case is the *only*
  empty-body response and every other named failure carries a non-empty JSON
  body with a code.
- **Browser-route contamination.** Widening shared error handling could leak a
  JSON body onto `POST /tasks`. → Mitigation: the shared function's signature is
  untouched; the browser handler's tests run unmodified; a test asserts the
  browser route still yields bare status codes on an unknown list.
- **Secret leakage into logs.** → Mitigation: only failure category and (for
  unknown-list) `list_id` are logged; the token/headers are never passed to a
  macro; enforced by test on the pure message helper + code review.
- **Accept/reject behavior drift.** Changing the return type could tempt a
  control-flow change. → Mitigation: gate ordering and every early-return
  condition are preserved verbatim; only the `Err(...)` payloads change.

### Alternatives considered

- **Widen the shared error type** (`create_task_for_ctx -> Result<_, SharedError>`
  where `SharedError` carries a code). *Rejected.* It forces the browser
  `POST /tasks` route to adopt the new error type, risking a JSON body or
  contract change on a route that is explicitly out of scope, and it spreads
  error-shape concerns into the shared insert logic (violating single
  responsibility). Boundary mapping keeps the blast radius to one handler.
- **Return `axum::response::Response` directly from the handler** (drop the
  `Result` entirely, build responses inline). *Rejected.* It discards the
  typed success/error split, makes the success path harder to assert in tests,
  and scatters status/body construction through the handler body. The two-shape
  `ApiTaskError` keeps rendering centralized and the success type intact.
- **Add a `tracing-test` / subscriber-capture dev-dependency** to assert emitted
  log output directly. *Rejected for now.* Capturing the global subscriber is
  brittle under parallel tests and adds a dependency; asserting the pure
  `reject_log_message` helper plus a code-review check on macro wiring gives the
  same signal deterministically. (If richer log assertions are wanted later,
  thread-local `with_default` capture is the low-risk upgrade — noted, not
  deferred coverage.)

### Performance impact

No expected impact on any `docs/RELIABILITY.md` budget. This is a server-only
change on a non-UI automation endpoint; it adds only a cheap enum construction,
a static string lookup, and one log line per *rejected* request (the success
path adds nothing but an unconditional `list_id` clone of a short string). It
touches no client code, no sync path, and no query.

### Test surface

All in `server/src/routes/mod.rs` (`cargo test`), extending the existing
`create_task_via_api_token_*` suite. New/updated cases, each mapped to an
acceptance criterion:

- **Feature-off byte-for-byte regression** (AC1): call the handler with
  `api_token: None`, render the `Err(ApiTaskError::Concealed)` via
  `.into_response()`, and assert status `404`, an empty body (`to_bytes` == 0
  length), and **no `Content-Type` header** — compared against a baseline
  `StatusCode::NOT_FOUND.into_response()`, not just the status code.
- **Unknown `list_id`** (AC2): valid token, non-existent `list_id` → `404`,
  body parses to `{"error":{"code":"unknown_list", ...}}`; assert the body is
  non-empty and `code == "unknown_list"`, and assert it differs from the
  feature-off body (empty). Proves the two `404`s are distinguishable.
- **Missing/invalid token** (AC3): update the two existing 401 tests
  (missing header, wrong value) to assert `status == 401` and
  `code == "unauthorized"`.
- **Scope mismatch** (AC4): construct a context that reaches gate 3 with a
  non-`ApiTaskCreate` scope → `403`, `code == "forbidden_scope"`. (Exercised at
  the mapping-helper level if a real `AuthScope::Session` ctx can't be minted on
  this route; assert `from`-mapping + handler wiring.)
- **Body validation** (AC5): valid token, `priority` out of `0..=3` → `400`,
  `code == "invalid_request"`.
- **Idempotent-create conflict** (AC6): drive `create_task_for_ctx` to its
  `CONFLICT` branch → `409`, `code == "conflict"`. (Also assert the existing
  same-id retry still returns `200` on the success path, unchanged.)
- **Internal error** (AC7): assert `from_create`/`from_auth` map `500` to
  `code == "internal_error"` and that the rendered body contains no dynamic /
  internal text — pure-mapper + render assertion (no live DB fault needed).
- **Log output per category** (AC8): assert the pure `reject_log_message` helper
  returns the correct category string for each code, and that the unknown-list
  formatter includes the supplied `list_id`; code-review confirms macros are
  wired and the token is never an argument.
- **Exhaustive empty-body matrix** (AC9): iterate every named failure mode,
  render each, and assert exactly one (feature-off) has an empty body while all
  others carry a non-empty JSON body with a `code`.
- **Browser route unchanged** (AC10): the existing `create_task` (`POST /tasks`)
  tests run unmodified; add one assertion that an unknown `list_id` on the
  browser route still yields a bare `Err(StatusCode::NOT_FOUND)` (no JSON body).
- **Success path unchanged** (AC11): existing "creates task owned by admin" and
  "reappears on sync pull" tests remain green with the new return type
  (success half is still `(StatusCode, Json<TaskRow>)`).
- **Gates** (AC12): `cargo fmt -- --check`, `cargo clippy -D warnings`,
  `cargo test` all green.

## Task breakdown

Two tasks, deliberately kept small so an SDE isn't forced to re-read the same
`integrations.rs` handler across many sessions. T1 owns the response-shape half
(the enum, the boundary mappers, the handler return-type change, and all
response-body tests); T2 owns the observability + docs tail (rejection logging,
the pure log-message helper, the ARCHITECTURE bullet, and the final gate pass).
The split is response-surface vs. server-log-surface — each is independently
testable and the concealment invariant is verified in T1 where the response
shape is defined.

### T1 — ApiTaskError type + handler error-shape wiring + response tests

**Files:** `server/src/routes/integrations.rs`, `server/src/routes/mod.rs`

Introduce a module-private `ApiTaskError` enum with exactly two shapes:
`Concealed` (renders byte-for-byte identical to today's
`Err(StatusCode::NOT_FOUND)` — empty body, no `Content-Type`, reserved for the
feature-off gate) and `Coded { status, code: &'static str }` (renders as
`(status, Json(ErrorBody { error: { code, message } }))`). Add the `ErrorBody`
serde struct, the `IntoResponse` impl, a static `message_for_code` lookup, and
the per-call-site mappers `from_auth` (401 → `unauthorized`, else 500 →
`internal_error`) and `from_create` (404 → `unknown_list`, 400 →
`invalid_request`, 409 → `conflict`, 403 → `forbidden`, else 500 →
`internal_error`), plus a `forbidden_scope()` constructor (403 →
`forbidden_scope`). Change `create_task_via_api_token`'s error return type from
`StatusCode` to `ApiTaskError`, preserving the exact gate ordering
(feature-off → auth → scope → create) so which requests are accepted/rejected
is unchanged — only the `Err(...)` payloads change. Do **not** touch
`create_task_for_ctx`'s signature or the browser `POST /tasks` handler. Add the
response tests for AC1–6, AC9–11 (concealment byte-for-byte regression,
unknown-list, 401, scope, validation, conflict, empty-body matrix, browser
route unchanged, success path unchanged).

**Done when:** `ApiTaskError` renders both shapes correctly;
`create_task_via_api_token` returns
`Result<(StatusCode, Json<TaskRow>), ApiTaskError>` with gate ordering preserved
verbatim; every post-gate failure carries a coded JSON body while the
feature-off `404` stays empty-bodied and `Content-Type`-free (verified against a
`NOT_FOUND` baseline); browser `POST /tasks` tests pass unmodified and still
yield bare status codes; success path unchanged; all listed response tests pass
under `cargo test`.

### T2 — Rejection logging + ARCHITECTURE doc + final gate pass

**Files:** `server/src/routes/integrations.rs`, `server/src/routes/mod.rs`,
`docs/ARCHITECTURE.md`

Add a `tracing` log line for every rejected create **after gate 1**, emitted at
the point of rejection so `IntoResponse` stays a pure function of the error:
`unauthorized` (401, `warn`), `forbidden_scope` (403, `warn`), `unknown_list`
(404, `warn` + structured `list_id` field), `invalid_request` (400, `warn`),
`conflict` (409, `warn`), `forbidden` (403, `warn`), `internal_error` (500,
`error`). Levels follow `docs/CONTRIBUTING.md` "fail fast and visibly". Clone
the caller-supplied `list_id` before `body` is moved into `create_task_for_ctx`
purely so the unknown-list line can name it (`%requested_list_id`) — no
create-path change. The feature-off gate emits **no** log line (pure early
return). The raw `X-TaskSync-Api-Token` value / headers must **never** be passed
to any log macro on any path. Extract the per-category message into a pure
`reject_log_message(code) -> &'static str` helper (plus the unknown-list
formatter that appends `list_id`) so it is testable without a subscriber-capture
dev-dependency. Add the AC7 (500 → `internal_error`, no leaked internal text)
and AC8 (log-message helper + token-never-logged) tests. Update the
`docs/ARCHITECTURE.md` "Programmatic task-creation API" bullet (~line 89) to
note post-gate failures now return a JSON `{ error: { code } }` body with a
stable code while the feature-off `404` stays empty-bodied.

**Done when:** a `tracing` line is emitted per rejected-create category at the
correct level with the token never passed to a log macro (helper test + code
review); the unknown-list line includes the caller-supplied `list_id`; the
feature-off gate emits no log line; `reject_log_message` and 500
`internal_error` tests pass; `docs/ARCHITECTURE.md` bullet updated;
`cargo fmt -- --check`, `cargo clippy -D warnings`, and `cargo test` all pass.

## Progress log

- 2026-07-19: Discovery complete. PM wrote this exec plan from the
  2026-07-19 production debugging session (iOS Shortcut POSTing to
  `POST /api/tasks` got indistinguishable empty-body `404`s across three
  possible causes; actual cause was an invalid `list_id` — `"tasks"`/
  `"inbox"` instead of the real slug `"l-inbox"`). Grounded against
  `server/src/routes/integrations.rs` (`create_task_via_api_token`, the
  feature-off gate ordering) and `server/src/routes/tasks.rs`
  (`create_task_for_ctx`, the `list_exists.is_none()` unknown-list guard
  shared with the browser route). Elevated the "server-side log lines"
  nice-to-have into scope (low-risk, server-only, directly serves the
  stated goal). No conflicts found with `docs/ARCHITECTURE.md`, no active
  exec plans in `docs/exec-plans/active/`, and no tech-debt-tracker item
  this creates or resolves beyond the existing #048 (rate limiting, noted
  as explicitly out of scope here). Routed for `/design`.
- 2026-07-19: Feature COMPLETE — accepted 12/12, archived to `completed/`.
  Implementation landed on branch `feat/distinguishable-task-api-errors`:
  T1 (ApiTaskError two-shape enum — `Concealed` byte-for-byte 404 +
  `Coded { status, code }` JSON `{ error: { code, message } }`; `from_auth`/
  `from_create`/`forbidden_scope` boundary mappers; handler error return-type
  change; response tests AC1-6/9-11) and T2 (per-category `tracing` rejection
  logs + pure `reject_log_message` helper, token never passed to a log macro;
  `docs/ARCHITECTURE.md` bullet reconciled; AC7/AC8 tests). Shared
  `create_task_for_ctx` and the browser `POST /tasks` route left untouched.
  Verification ALL GREEN (build-specialist: 93/93 `cargo test`,
  `cargo fmt -- --check`, `cargo clippy -D warnings` clean; web
  lint/check/380 unit/24 smoke green — web unaffected, server-only change).
  QA review APPROVE (0 CRITICAL, 0 WARNING; two non-blocking SUGGESTIONs —
  unreachable catch-all arms in `message_for_code`/`reject_log_message` and
  loose status/code pairs vs a closed enum — reviewed and accepted as-is).
  Acceptance ACCEPTED 12/12: two non-blocking evidence-quality notes — AC4
  verified at the mapping/render level (gate 3 structurally unreachable via
  the real auth path, matching this plan's anticipated fallback) and AC12
  corroborated from the build-specialist's green run (PM session had no shell
  tool). Concealment invariant (feature-off 404 byte-for-byte unchanged)
  verified by direct before/after comparison. No new tech debt created.

## Decision log

- 2026-07-19: PM decision — new JSON error bodies apply ONLY to
  `POST /api/tasks`; the browser `POST /tasks` route's error contract is
  deliberately left unchanged, even though both share
  `create_task_for_ctx`. Rationale: minimizes blast radius, avoids touching
  browser-client-facing behavior and its existing test suite, and the
  production pain reported is specific to the automation/API-token caller.
- 2026-07-19: PM decision — `401` responses use a single generic `code`
  regardless of the specific cause (missing token / wrong token / owner
  unresolvable), rather than distinguishing sub-causes. Rationale: avoids
  handing a prober a new oracle to narrow down why an authentication attempt
  failed; flagged in Open questions for user confirmation before `/design`.
- 2026-07-19: PM decision — the "server-side log lines on rejected creates"
  nice-to-have from the debugging writeup is pulled into scope (not left as
  optional). Rationale: it's server-only (no response-surface risk to the
  concealment constraint), directly addresses the stated diagnosability
  goal, and aligns with `docs/CONTRIBUTING.md`'s "fail fast and visibly" /
  "no silent catch blocks" standards.
