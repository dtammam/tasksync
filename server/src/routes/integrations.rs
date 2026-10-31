//! Static-token integration API, nested under `/api` in `main.rs`:
//!
//! - `POST /api/tasks` — create (F-B; scope `create`).
//! - `GET /api/tasks`, `GET /api/lists` — read (scope `read`).
//! - `POST /api/tasks/:id/complete`, `POST /api/tasks/:id/uncomplete` —
//!   check off / undo exactly as a tap in the web app would (scope `complete`).
//!
//! Deliberately thin: authentication is entirely delegated to
//! `ctx_from_api_token`, inserts to the SAME `create_task_for_ctx` the browser
//! route uses, selection to `task_views`, and completion to `task_actions`.
//! This module adds only the feature-off gates, the scope checks, query
//! parsing, and the error mapping. `docs/API.md` is the caller-facing contract.

use axum::{
    body::Bytes,
    extract::{rejection::QueryRejection, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use super::lists::{get_lists_for_ctx, ListRow};
use super::recurrence::format_iso_date;
use super::task_actions::{
    complete_task_for_ctx, uncomplete_task_for_ctx, ActionError, CompleteOutcome, UncompleteOutcome,
};
use super::task_views::{select_tasks, ApiTask, TaskFilters, View};
use super::tasks::{create_task_for_ctx, get_tasks_for_ctx, CreateTask, TaskRow};
use super::types::{
    app_state, ctx_from_api_token, is_valid_task_status, ApiScope, AppState, RequestCtx,
};

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

    /// Maps a `StatusCode` from a shared read helper (`get_tasks_for_ctx`,
    /// `get_lists_for_ctx`; only `500` is reachable) to a coded error.
    pub(super) fn from_read(_status: StatusCode) -> Self {
        ApiTaskError::coded(StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
    }

    pub(super) fn from_action(err: ActionError) -> Self {
        match err {
            ActionError::NotFound => ApiTaskError::coded(StatusCode::NOT_FOUND, "not_found"),
            ActionError::Forbidden => ApiTaskError::coded(StatusCode::FORBIDDEN, "forbidden"),
            ActionError::InvalidDate => {
                ApiTaskError::coded(StatusCode::BAD_REQUEST, "invalid_request")
            }
            ActionError::DueDateMismatch => {
                ApiTaskError::coded(StatusCode::CONFLICT, "due_date_mismatch")
            }
            ActionError::NotCompleted => ApiTaskError::coded(StatusCode::CONFLICT, "not_completed"),
            ActionError::ConcurrentUpdate => {
                ApiTaskError::coded(StatusCode::CONFLICT, "concurrent_update")
            }
            ActionError::Internal => {
                ApiTaskError::coded(StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
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
        "not_found" => "no task with this id is visible to this token",
        "invalid_query" => "a query parameter has an invalid value",
        "due_date_mismatch" => "expected_due_date does not match the task's current due_date — re-read the task",
        "not_completed" => "the task has no completion to undo (one-off not done, or recurring not completed today)",
        "concurrent_update" => "the task changed while this request ran — re-read and retry",
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
        "not_found" => "rejected: unknown task id",
        "invalid_query" => "rejected: invalid query parameter",
        "due_date_mismatch" => "rejected: expected_due_date mismatch",
        "not_completed" => "rejected: nothing to uncomplete",
        "concurrent_update" => "rejected: concurrent update",
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
/// 1. Feature-off gate — neither `TASK_API_TOKEN` nor `TASK_AGENT_TOKEN` is
///    configured (both carry the create scope), so the endpoint does not
///    exist at all (`404`), checked BEFORE calling the verifier so an unset
///    token never reaches `ctx_from_api_token` (which would otherwise return
///    `401`).
/// 2. `ctx_from_api_token` authenticates the header against the configured
///    tokens and resolves the acting identity server-side.
/// 3. A defense-in-depth scope assertion (`ApiScope::Create`) via
///    `authorize`.
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
    if state.api_token.is_none() && state.agent_token.is_none() {
        // Feature-off gate: pure early return, no log line (see
        // `log_rejection`'s docs — this is not a "rejected create").
        return Err(ApiTaskError::Concealed);
    }
    let ctx = authorize(&state, &headers, ApiScope::Create).await?;
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

/// Gates 2 and 3 shared by every handler: authenticate the token, then
/// assert it carries `scope`. Each rejection is logged at the point it
/// happens.
async fn authorize(
    state: &AppState,
    headers: &HeaderMap,
    scope: ApiScope,
) -> Result<RequestCtx, ApiTaskError> {
    let ctx = ctx_from_api_token(headers, state).await.map_err(|status| {
        let err = ApiTaskError::from_auth(status);
        log_rejection(&err);
        err
    })?;
    if !ctx.scope.allows_api(scope) {
        let err = ApiTaskError::forbidden_scope();
        log_rejection(&err);
        return Err(err);
    }
    Ok(ctx)
}

/// Feature-off gate for the read and complete routes: they exist only when
/// `TASK_AGENT_TOKEN` is configured (the create-only token can never use
/// them), and otherwise render the same empty 404 as an unknown route.
fn agent_routes_enabled(state: &AppState) -> Result<(), ApiTaskError> {
    if state.agent_token.is_none() {
        return Err(ApiTaskError::Concealed);
    }
    Ok(())
}

fn reject(err: ApiTaskError) -> ApiTaskError {
    log_rejection(&err);
    err
}

/// `GET /api/lists` — the same rows as the session `GET /lists`.
pub(super) async fn get_lists_via_api_token(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ListRow>>, ApiTaskError> {
    agent_routes_enabled(&state)?;
    let ctx = authorize(&state, &headers, ApiScope::Read).await?;
    let lists = get_lists_for_ctx(&state, &ctx)
        .await
        .map_err(|status| reject(ApiTaskError::from_read(status)))?;
    Ok(Json(lists))
}

/// Query string for `GET /api/tasks`. Every field is a raw string so a bad
/// value yields the coded `invalid_query` error. The handler takes the
/// extractor as a `Result`, so a query serde cannot parse at all (e.g. a
/// repeated `view=`) is also mapped to `invalid_query` — and only after the
/// feature-off gate and authentication, so it cannot reveal the route.
#[derive(Deserialize)]
pub(super) struct TaskQuery {
    pub(super) view: Option<String>,
    pub(super) q: Option<String>,
    pub(super) list_id: Option<String>,
    pub(super) status: Option<String>,
    pub(super) include_done_today: Option<String>,
}

fn parse_task_query(query: TaskQuery) -> Option<TaskFilters> {
    let view = View::parse(query.view.as_deref())?;
    let include_done_today = match query.include_done_today.as_deref() {
        None | Some("true") => true,
        Some("false") => false,
        Some(_) => return None,
    };
    if let Some(status) = query.status.as_deref() {
        if !is_valid_task_status(status) {
            return None;
        }
    }
    let q = query.q.map(|q| q.trim().to_lowercase()).filter(|q| !q.is_empty());
    let list_id = query.list_id.filter(|id| !id.is_empty());
    Some(TaskFilters { view, q, list_id, status: query.status, include_done_today })
}

#[derive(Serialize)]
pub(super) struct TaskListResponse {
    /// The server's calendar date (`TZ`), which `view=today` and
    /// `done_today` are computed against.
    pub(super) today: String,
    pub(super) view: &'static str,
    pub(super) tasks: Vec<ApiTask>,
}

/// `GET /api/tasks?view=today|all&q=&list_id=&status=&include_done_today=`
pub(super) async fn get_tasks_via_api_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Result<Query<TaskQuery>, QueryRejection>,
) -> Result<Json<TaskListResponse>, ApiTaskError> {
    agent_routes_enabled(&state)?;
    let ctx = authorize(&state, &headers, ApiScope::Read).await?;
    let filters = query
        .ok()
        .and_then(|Query(query)| parse_task_query(query))
        .ok_or_else(|| reject(ApiTaskError::coded(StatusCode::BAD_REQUEST, "invalid_query")))?;
    let rows = get_tasks_for_ctx(&state, &ctx)
        .await
        .map_err(|status| reject(ApiTaskError::from_read(status)))?;
    let today = state.clock.today();
    let tasks = select_tasks(rows, &filters, &ctx.user_id, today);
    Ok(Json(TaskListResponse { today: format_iso_date(today), view: filters.view.as_str(), tasks }))
}

/// Parses an optional JSON body: empty means "no fields". Unknown fields are
/// rejected (`deny_unknown_fields` on the body types) so a misspelled
/// precondition fails loudly instead of being silently skipped.
fn parse_optional_body<T: serde::de::DeserializeOwned + Default>(
    bytes: &[u8],
) -> Result<T, ApiTaskError> {
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(T::default());
    }
    serde_json::from_slice(bytes)
        .map_err(|_| reject(ApiTaskError::coded(StatusCode::BAD_REQUEST, "invalid_request")))
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(super) struct CompleteBody {
    /// The `due_date` the caller read. Makes a retry idempotent and stops a
    /// stale caller from completing the wrong occurrence.
    pub(super) expected_due_date: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(super) struct UncompleteBody {
    /// `previous_due_date` from the complete response; honored only when it is
    /// within one recurrence step before the current due date.
    pub(super) previous_due_date: Option<String>,
    pub(super) expected_due_date: Option<String>,
}

/// `POST /api/tasks/:id/complete`. The body is optional.
pub(super) async fn complete_task_via_api_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<CompleteOutcome>, ApiTaskError> {
    agent_routes_enabled(&state)?;
    let ctx = authorize(&state, &headers, ApiScope::Complete).await?;
    let body: CompleteBody = parse_optional_body(&body)?;
    let outcome = complete_task_for_ctx(&state, &ctx, &id, body.expected_due_date.as_deref())
        .await
        .map_err(|err| reject(ApiTaskError::from_action(err)))?;
    Ok(Json(outcome))
}

/// `POST /api/tasks/:id/uncomplete`. The body is optional.
pub(super) async fn uncomplete_task_via_api_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<UncompleteOutcome>, ApiTaskError> {
    agent_routes_enabled(&state)?;
    let ctx = authorize(&state, &headers, ApiScope::Complete).await?;
    let body: UncompleteBody = parse_optional_body(&body)?;
    let outcome = uncomplete_task_for_ctx(
        &state,
        &ctx,
        &id,
        body.previous_due_date.as_deref(),
        body.expected_due_date.as_deref(),
    )
    .await
    .map_err(|err| reject(ApiTaskError::from_action(err)))?;
    Ok(Json(outcome))
}

pub fn integration_routes(pool: &sqlx::SqlitePool) -> Router {
    integration_router(app_state(pool))
}

/// The route table over an explicit state, so tests can drive the real
/// routing, extractors, and bodies with a configured token and pinned clock.
pub(super) fn integration_router(state: AppState) -> Router {
    Router::new()
        .route("/tasks", get(get_tasks_via_api_token).post(create_task_via_api_token))
        .route("/lists", get(get_lists_via_api_token))
        .route("/tasks/:id/complete", post(complete_task_via_api_token))
        .route("/tasks/:id/uncomplete", post(uncomplete_task_via_api_token))
        .with_state(state)
}
