use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use super::lists::{get_lists, ListRow};
use super::tasks::{
    create_task, update_task_meta, update_task_status, CreateTask, DeletedTaskRow, TaskRow,
    UpdateTaskMeta, UpdateTaskStatus,
};
use super::types::{app_state, ctx_from_headers, AppState, Role};

#[derive(Deserialize)]
pub(super) struct SyncPullBody {
    pub(super) since_ts: Option<i64>,
}

#[derive(Serialize)]
pub(super) struct SyncPullResponse {
    pub(super) protocol: &'static str,
    pub(super) cursor_ts: i64,
    pub(super) lists: Vec<ListRow>,
    pub(super) tasks: Vec<TaskRow>,
    pub(super) deleted_tasks: Vec<DeletedTaskRow>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum SyncPushChange {
    CreateTask { op_id: String, body: CreateTask },
    UpdateTask { op_id: String, task_id: String, body: UpdateTaskMeta },
    UpdateTaskStatus { op_id: String, task_id: String, status: String },
}

#[derive(Deserialize)]
pub(super) struct SyncPushBody {
    pub(super) changes: Vec<SyncPushChange>,
}

#[derive(Serialize)]
pub(super) struct SyncPushRejected {
    pub(super) op_id: String,
    pub(super) status: u16,
    pub(super) error: String,
}

#[derive(Serialize)]
pub(super) struct SyncPushResponse {
    pub(super) protocol: &'static str,
    pub(super) cursor_ts: i64,
    pub(super) applied: Vec<TaskRow>,
    pub(super) rejected: Vec<SyncPushRejected>,
}

fn headers_for_ctx(ctx: &super::types::RequestCtx) -> Result<HeaderMap, StatusCode> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-space-id",
        HeaderValue::from_str(&ctx.space_id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    );
    headers.insert(
        "x-user-id",
        HeaderValue::from_str(&ctx.user_id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    );
    Ok(headers)
}

async fn sync_cursor_for_ctx(
    state: &AppState,
    ctx: &super::types::RequestCtx,
) -> Result<i64, StatusCode> {
    if ctx.role == Role::Admin {
        let task_cursor: i64 =
            sqlx::query_scalar("select coalesce(max(updated_ts), 0) from task where space_id = ?1")
                .bind(&ctx.space_id)
                .fetch_one(&state.pool)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let tombstone_cursor: i64 = sqlx::query_scalar(
            "select coalesce(max(deleted_ts), 0) from task_tombstone where space_id = ?1",
        )
        .bind(&ctx.space_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(task_cursor.max(tombstone_cursor));
    }

    let task_cursor: i64 = sqlx::query_scalar(
        "select coalesce(max(t.updated_ts), 0) from task t join list_grant g on g.list_id = t.list_id and g.space_id = t.space_id where t.space_id = ?1 and g.user_id = ?2",
    )
    .bind(&ctx.space_id)
    .bind(&ctx.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tombstone_cursor: i64 = sqlx::query_scalar(
        "select coalesce(max(t.deleted_ts), 0) from task_tombstone t join list_grant g on g.list_id = t.list_id and g.space_id = t.space_id where t.space_id = ?1 and g.user_id = ?2",
    )
    .bind(&ctx.space_id)
    .bind(&ctx.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(task_cursor.max(tombstone_cursor))
}

async fn deleted_tasks_for_ctx(
    state: &AppState,
    ctx: &super::types::RequestCtx,
) -> Result<Vec<DeletedTaskRow>, StatusCode> {
    if ctx.role == Role::Admin {
        return sqlx::query_as::<_, DeletedTaskRow>(
            "select task_id as id, deleted_ts from task_tombstone where space_id = ?1 order by deleted_ts asc",
        )
        .bind(&ctx.space_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    }

    sqlx::query_as::<_, DeletedTaskRow>(
        "select t.task_id as id, t.deleted_ts from task_tombstone t join list_grant g on g.list_id = t.list_id and g.space_id = t.space_id where t.space_id = ?1 and g.user_id = ?2 order by t.deleted_ts asc",
    )
    .bind(&ctx.space_id)
    .bind(&ctx.user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub(super) async fn sync_pull(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SyncPullBody>,
) -> Result<Json<SyncPullResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let scoped_headers = headers_for_ctx(&ctx)?;

    let lists = get_lists(State(state.clone()), scoped_headers.clone()).await?.0;
    let mut tasks = super::tasks::get_tasks(State(state.clone()), scoped_headers).await?.0;
    let mut deleted_tasks = deleted_tasks_for_ctx(&state, &ctx).await?;
    if let Some(since_ts) = body.since_ts {
        tasks.retain(|task| task.updated_ts >= since_ts);
        deleted_tasks.retain(|entry| entry.deleted_ts >= since_ts);
    }

    let cursor_ts = sync_cursor_for_ctx(&state, &ctx).await?;
    Ok(Json(SyncPullResponse { protocol: "delta-v1", cursor_ts, lists, tasks, deleted_tasks }))
}

pub(super) async fn sync_push(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SyncPushBody>,
) -> Result<Json<SyncPushResponse>, StatusCode> {
    if body.changes.len() > 500 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let ctx = ctx_from_headers(&headers, &state).await?;
    let scoped_headers = headers_for_ctx(&ctx)?;
    let mut applied = Vec::new();
    let mut rejected = Vec::new();

    for change in body.changes {
        match change {
            SyncPushChange::CreateTask { op_id, body } => {
                match create_task(State(state.clone()), scoped_headers.clone(), Json(body)).await {
                    Ok((_status, Json(task))) => applied.push(task),
                    Err(status) => rejected.push(SyncPushRejected {
                        op_id,
                        status: status.as_u16(),
                        error: status.canonical_reason().unwrap_or("request failed").to_string(),
                    }),
                }
            }
            SyncPushChange::UpdateTask { op_id, task_id, body } => {
                match update_task_meta(
                    State(state.clone()),
                    scoped_headers.clone(),
                    axum::extract::Path(task_id),
                    Json(body),
                )
                .await
                {
                    Ok(Json(task)) => applied.push(task),
                    Err(status) => rejected.push(SyncPushRejected {
                        op_id,
                        status: status.as_u16(),
                        error: status.canonical_reason().unwrap_or("request failed").to_string(),
                    }),
                }
            }
            SyncPushChange::UpdateTaskStatus { op_id, task_id, status: next_status } => {
                match update_task_status(
                    State(state.clone()),
                    scoped_headers.clone(),
                    axum::extract::Path(task_id),
                    Json(UpdateTaskStatus { status: next_status }),
                )
                .await
                {
                    Ok(Json(task)) => applied.push(task),
                    Err(status) => rejected.push(SyncPushRejected {
                        op_id,
                        status: status.as_u16(),
                        error: status.canonical_reason().unwrap_or("request failed").to_string(),
                    }),
                }
            }
        }
    }

    let cursor_ts = sync_cursor_for_ctx(&state, &ctx).await?;
    Ok(Json(SyncPushResponse { protocol: "delta-v1", cursor_ts, applied, rejected }))
}

pub fn sync_routes(pool: &sqlx::SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new().route("/pull", post(sync_pull)).route("/push", post(sync_push)).with_state(state)
}
