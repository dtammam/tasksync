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
    routing::post,
    Json, Router,
};

use super::tasks::{create_task_for_ctx, CreateTask, TaskRow};
use super::types::{app_state, ctx_from_api_token, AppState, AuthScope};

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
pub(super) async fn create_task_via_api_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTask>,
) -> Result<(StatusCode, Json<TaskRow>), StatusCode> {
    if state.api_token.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }
    let ctx = ctx_from_api_token(&headers, &state).await?;
    if ctx.scope != AuthScope::ApiTaskCreate {
        return Err(StatusCode::FORBIDDEN);
    }
    let (status, rec) = create_task_for_ctx(&state, &ctx, body).await?;
    Ok((status, Json(rec)))
}

pub fn integration_routes(pool: &sqlx::SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new().route("/tasks", post(create_task_via_api_token)).with_state(state)
}
