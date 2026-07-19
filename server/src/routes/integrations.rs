//! Programmatic task-creation API (F-B): a single `POST /tasks` route
//! (nested under `/api` in `main.rs`, so the effective path is
//! `POST /api/tasks`) that lets an external/automated caller create a task
//! using the static `X-TaskSync-Api-Token` header instead of a session.
//!
//! Deliberately thin: authentication/authorization is entirely delegated to
//! `ctx_from_api_token`, and the actual insert is entirely delegated to the
//! SAME `create_task_for_ctx` the browser `POST /tasks` route uses — this
//! module adds no divergent validation or sync behavior, only the
//! feature-off gate and the scope check.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Serialize;

use super::tasks::{create_task_for_ctx, CreateTask, TaskRow};
use super::types::{app_state, ctx_from_api_token, AppState, AuthScope};

/// Error shape rendered by `create_task_via_api_token`.
///
/// Exactly two shapes, deliberately: `Concealed` (reserved solely for the
/// feature-off gate) renders byte-for-byte identical to the pre-feature
/// `Err(StatusCode::NOT_FOUND)` — empty body, no `Content-Type` — so an
/// unauthenticated/no-token caller cannot distinguish "feature off" from
/// "route does not exist". Every failure reached AFTER that gate is `Coded`,
/// carrying a stable machine-legible `code` a caller can branch on. See
/// `docs/exec-plans/active/2026-07-19-distinguishable-task-api-errors.md`
/// ("Mapping mechanism") for the full design.
#[derive(Debug)]
pub(super) enum ApiTaskError {
    Concealed,
    Coded { status: StatusCode, code: &'static str },
}

impl ApiTaskError {
    fn coded(status: StatusCode, code: &'static str) -> Self {
        ApiTaskError::Coded { status, code }
    }

    /// Gate 3 (defense-in-depth scope assertion) constructor.
    pub(super) fn forbidden_scope() -> Self {
        ApiTaskError::coded(StatusCode::FORBIDDEN, "forbidden_scope")
    }

    /// Maps `ctx_from_api_token`'s `StatusCode` (only `401`/`500` are
    /// reachable there) to a coded error.
    pub(super) fn from_auth(status: StatusCode) -> Self {
        match status {
            StatusCode::UNAUTHORIZED => ApiTaskError::coded(status, "unauthorized"),
            _ => ApiTaskError::coded(StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        }
    }

    /// Maps `create_task_for_ctx`'s `StatusCode`
    /// (`404`/`400`/`409`/`403`/`500`) to a coded error.
    pub(super) fn from_create(status: StatusCode) -> Self {
        match status {
            StatusCode::NOT_FOUND => ApiTaskError::coded(status, "unknown_list"),
            StatusCode::BAD_REQUEST => ApiTaskError::coded(status, "invalid_request"),
            StatusCode::CONFLICT => ApiTaskError::coded(status, "conflict"),
            StatusCode::FORBIDDEN => ApiTaskError::coded(status, "forbidden"),
            _ => ApiTaskError::coded(StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        }
    }

    /// The stable `code` for a `Coded` error, or `None` for `Concealed` (the
    /// feature-off gate, which is not a rejected create and carries no
    /// code). Used only to dispatch logging — `into_response` below reads
    /// the `code` it already holds directly.
    fn code(&self) -> Option<&'static str> {
        match self {
            ApiTaskError::Coded { code, .. } => Some(*code),
            ApiTaskError::Concealed => None,
        }
    }
}

impl IntoResponse for ApiTaskError {
    fn into_response(self) -> Response {
        match self {
            // Byte-for-byte identical to today's `Err(StatusCode::NOT_FOUND)`
            // — the exact expression axum used before this change. Pure: no
            // logging happens here (see `log_rejection`/`log_create_rejection`
            // below, called from the handler at the point of rejection).
            ApiTaskError::Concealed => StatusCode::NOT_FOUND.into_response(),
            ApiTaskError::Coded { status, code } => {
                let message = message_for_code(code);
                (status, Json(ErrorBody::new(code, message))).into_response()
            }
        }
    }
}

/// `{ "error": { "code": "...", "message": "..." } }` — namespaced under
/// `error` so it never collides with the success `TaskRow` shape, which has
/// no `error` field.
#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: &'static str,
}

impl ErrorBody {
    fn new(code: &'static str, message: &'static str) -> Self {
        ErrorBody { error: ErrorDetail { code, message } }
    }
}

/// Static, human-readable hint per `code`. Deliberately static: no request
/// data and no internal/DB text ever flows into a response body.
fn message_for_code(code: &'static str) -> &'static str {
    match code {
        "unauthorized" => "missing or invalid API token",
        "forbidden_scope" => "token does not have permission to perform this action",
        "unknown_list" => "list_id does not exist in this space",
        "invalid_request" => "request body failed validation",
        "conflict" => "a task with this id already exists and could not be reconciled",
        "forbidden" => "not permitted to create tasks in this list",
        "internal_error" => "an internal error occurred",
        _ => "request failed",
    }
}

/// Pure, testable log-message text per rejection category — the server-log
/// counterpart to `message_for_code`, but never rendered in a response body.
/// Deliberately pure (no `tracing` call inside) so log content can be
/// asserted without a subscriber-capture dev-dependency. `unknown_list`'s
/// caller-supplied `list_id` is NOT embedded here (this function knows only
/// the `code`); see `unknown_list_log_message` for that category.
pub(super) fn reject_log_message(code: &'static str) -> &'static str {
    match code {
        "unauthorized" => "rejected: unauthorized (missing/invalid token or owner unresolved)",
        "forbidden_scope" => "rejected: scope mismatch",
        "unknown_list" => "rejected: unknown list_id",
        "invalid_request" => "rejected: invalid request body",
        "conflict" => "rejected: idempotent-create conflict",
        "forbidden" => "rejected: forbidden",
        "internal_error" => "failed: internal error",
        _ => "rejected: request failed",
    }
}

/// Formats the `unknown_list` rejection log message, naming the
/// caller-supplied `list_id` inline. `list_id` is caller-supplied but
/// non-secret — exactly the value that would have collapsed the
/// 2026-07-19 debugging session from many round trips to one glance at the
/// log. No other request-derived value is ever logged, and the API token
/// is never passed to this or any log-message function.
pub(super) fn unknown_list_log_message(list_id: &str) -> String {
    format!("{} (list_id={list_id})", reject_log_message("unknown_list"))
}

/// Emits the rejection log line for a `Coded` error at the correct level —
/// `error` for `internal_error` (a true server fault), `warn` for every
/// other rejected-create category (client-caused, expected/recoverable) —
/// per `docs/CONTRIBUTING.md` "fail fast and visibly". Called from the
/// handler at the point of rejection, never from `IntoResponse`, so
/// rendering stays a pure function of the error. `Concealed` (the
/// feature-off gate) is not a "rejected create" and gets no log line by
/// design — this function is a no-op for it.
fn log_rejection(err: &ApiTaskError) {
    let Some(code) = err.code() else { return };
    if code == "internal_error" {
        tracing::error!("{}", reject_log_message(code));
    } else {
        tracing::warn!("{}", reject_log_message(code));
    }
}

/// Same as `log_rejection`, but for the `create_task_for_ctx` call site,
/// where the caller-supplied `list_id` is available and must be named in
/// the `unknown_list` case (both as structured `tracing` field and in the
/// message text). Every other code from this call site falls back to
/// `log_rejection`.
fn log_create_rejection(err: &ApiTaskError, list_id: &str) {
    if err.code() == Some("unknown_list") {
        tracing::warn!(list_id = %list_id, "{}", unknown_list_log_message(list_id));
    } else {
        log_rejection(err);
    }
}

/// Ingest handler for the programmatic task-creation API.
///
/// Order matters:
/// 1. Feature-off gate — `state.api_token.is_none()` means `TASK_API_TOKEN`
///    was never configured, so the endpoint does not exist at all (`404`),
///    checked BEFORE calling the verifier so an unset token never reaches
///    `ctx_from_api_token` (which would otherwise return `401`).
/// 2. `ctx_from_api_token` authenticates the header against the configured
///    token and resolves the owner identity server-side.
/// 3. A defense-in-depth scope assertion — this is the read that makes
///    `AuthScope::ApiTaskCreate` and `RequestCtx.scope` genuinely used.
/// 4. The shared `create_task_for_ctx` path — identical validation,
///    idempotency, and tombstone-clear behavior to the browser create-task
///    route and the sync path.
///
/// Gate ordering is preserved verbatim from the pre-`ApiTaskError` version —
/// only the `Err(...)` payloads changed, not which requests are accepted or
/// rejected.
pub(super) async fn create_task_via_api_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTask>,
) -> Result<(StatusCode, Json<TaskRow>), ApiTaskError> {
    if state.api_token.is_none() {
        // Feature-off gate: pure early return, no log line (see
        // `log_rejection`'s docs — this is not a "rejected create").
        return Err(ApiTaskError::Concealed);
    }
    let ctx = ctx_from_api_token(&headers, &state).await.map_err(|status| {
        let err = ApiTaskError::from_auth(status);
        log_rejection(&err);
        err
    })?;
    if ctx.scope != AuthScope::ApiTaskCreate {
        let err = ApiTaskError::forbidden_scope();
        log_rejection(&err);
        return Err(err);
    }
    // Cloned before `body` moves into `create_task_for_ctx`, purely so the
    // `unknown_list` rejection can name it in the log line. Does not alter
    // the create path or `create_task_for_ctx`'s signature/arguments.
    let requested_list_id = body.list_id.clone();
    let (status, rec) = create_task_for_ctx(&state, &ctx, body).await.map_err(|status| {
        let err = ApiTaskError::from_create(status);
        log_create_rejection(&err, &requested_list_id);
        err
    })?;
    Ok((status, Json(rec)))
}

pub fn integration_routes(pool: &sqlx::SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new().route("/tasks", post(create_task_via_api_token)).with_state(state)
}
