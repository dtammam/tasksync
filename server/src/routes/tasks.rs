use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::types::{
    app_state, ctx_from_headers, is_unique_violation, is_valid_task_status,
    normalize_task_priority, AppState, Role,
};

#[derive(Serialize, FromRow)]
pub(super) struct TaskRow {
    pub(super) id: String,
    pub(super) space_id: String,
    pub(super) title: String,
    pub(super) status: String,
    pub(super) list_id: String,
    pub(super) my_day: i64,
    pub(super) priority: i64,
    pub(super) order: String,
    pub(super) updated_ts: i64,
    pub(super) created_ts: i64,
    pub(super) url: Option<String>,
    pub(super) recur_rule: Option<String>,
    pub(super) due_date: Option<String>,
    pub(super) punted_from_due_date: Option<String>,
    pub(super) punted_on_date: Option<String>,
    pub(super) occurrences_completed: i64,
    pub(super) completed_ts: Option<i64>,
    pub(super) notes: Option<String>,
    pub(super) assignee_user_id: Option<String>,
    pub(super) created_by_user_id: Option<String>,
}

#[derive(Serialize, FromRow)]
pub(super) struct DeletedTaskRow {
    pub(super) id: String,
    pub(super) deleted_ts: i64,
}

#[derive(Deserialize)]
pub(super) struct CreateTask {
    pub(super) id: Option<String>,
    pub(super) title: String,
    pub(super) list_id: String,
    pub(super) order: Option<String>,
    pub(super) my_day: Option<bool>,
    pub(super) priority: Option<i64>,
    pub(super) url: Option<String>,
    pub(super) recur_rule: Option<String>,
    pub(super) due_date: Option<String>,
    pub(super) punted_from_due_date: Option<String>,
    pub(super) punted_on_date: Option<String>,
    pub(super) notes: Option<String>,
    #[allow(dead_code)]
    pub(super) assignee_user_id: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct UpdateTaskStatus {
    pub(super) status: String,
}

#[derive(Deserialize)]
pub(super) struct UpdateTaskMeta {
    pub(super) title: Option<String>,
    pub(super) status: Option<String>,
    pub(super) list_id: Option<String>,
    pub(super) my_day: Option<bool>,
    pub(super) priority: Option<i64>,
    pub(super) url: Option<String>,
    pub(super) recur_rule: Option<String>,
    pub(super) due_date: Option<String>,
    pub(super) punted_from_due_date: Option<String>,
    pub(super) punted_on_date: Option<String>,
    pub(super) notes: Option<String>,
    pub(super) occurrences_completed: Option<i64>,
    pub(super) completed_ts: Option<i64>,
    pub(super) assignee_user_id: Option<String>,
}

pub(super) async fn get_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<TaskRow>>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let rows = if ctx.role == Role::Admin {
        sqlx::query_as::<_, TaskRow>(
            "select id, space_id, title, status, list_id, my_day, priority, task_order as \"order\", updated_ts, created_ts, url, recur_rule, due_date, punted_from_due_date, punted_on_date, occurrences_completed, completed_ts, notes, assignee_user_id, created_by_user_id from task where space_id = ?1 order by task_order asc",
        )
        .bind(&ctx.space_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    } else {
        sqlx::query_as::<_, TaskRow>(
            "select t.id, t.space_id, t.title, t.status, t.list_id, t.my_day, t.priority, t.task_order as \"order\", t.updated_ts, t.created_ts, t.url, t.recur_rule, t.due_date, t.punted_from_due_date, t.punted_on_date, t.occurrences_completed, t.completed_ts, t.notes, t.assignee_user_id, t.created_by_user_id from task t join list_grant g on g.list_id = t.list_id and g.space_id = t.space_id where t.space_id = ?1 and g.user_id = ?2 order by t.task_order asc",
        )
        .bind(&ctx.space_id)
        .bind(&ctx.user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    Ok(Json(rows))
}

pub(super) async fn create_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTask>,
) -> Result<(StatusCode, Json<TaskRow>), StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;

    // ensure list belongs to space
    let list_exists: Option<i64> =
        sqlx::query_scalar("select 1 from list where id = ?1 and space_id = ?2")
            .bind(&body.list_id)
            .bind(&ctx.space_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if list_exists.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    if ctx.role == Role::Contributor {
        let allowed = sqlx::query_scalar::<_, i64>(
            "select count(1) from list_grant where list_id = ?1 and user_id = ?2 and space_id = ?3",
        )
        .bind(&body.list_id)
        .bind(&ctx.user_id)
        .bind(&ctx.space_id)
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);
        if allowed == 0 {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    let assignee_user_id = ctx.user_id.clone();

    let id = body
        .id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let order = body.order.unwrap_or_else(|| "z".into());
    let now = chrono::Utc::now().timestamp_millis();
    let my_day = if ctx.role == Role::Contributor {
        0
    } else if body.my_day.unwrap_or(false) {
        1
    } else {
        0
    };
    let priority = normalize_task_priority(body.priority)?;
    let priority = priority.unwrap_or(0);
    let punted_from_due_date = body.punted_from_due_date.clone();
    let punted_on_date = body.punted_on_date.clone();
    let insert_result = sqlx::query_as::<_, TaskRow>(
		"insert into task (id, space_id, title, status, list_id, my_day, priority, task_order, updated_ts, created_ts, url, recur_rule, due_date, punted_from_due_date, punted_on_date, occurrences_completed, completed_ts, notes, assignee_user_id, created_by_user_id) values (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, ?12, ?13, 0, null, ?14, ?15, ?16) returning id, space_id, title, status, list_id, my_day, priority, task_order as \"order\", updated_ts, created_ts, url, recur_rule, due_date, punted_from_due_date, punted_on_date, occurrences_completed, completed_ts, notes, assignee_user_id, created_by_user_id",
	)
	.bind(&id)
	.bind(&ctx.space_id)
	.bind(&body.title)
	.bind(&body.list_id)
	.bind(my_day)
	.bind(priority)
	.bind(&order)
	.bind(now)
	.bind(&body.url)
	.bind(&body.recur_rule)
	.bind(&body.due_date)
	.bind(&punted_from_due_date)
	.bind(&punted_on_date)
	.bind(&body.notes)
    .bind(&assignee_user_id)
    .bind(&ctx.user_id)
	.fetch_one(&state.pool)
	.await;
    let (status, rec) = match insert_result {
        Ok(inserted) => (StatusCode::CREATED, inserted),
        Err(err) => {
            if !is_unique_violation(&err) {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
            let existing = sqlx::query_as::<_, TaskRow>(
				"select id, space_id, title, status, list_id, my_day, priority, task_order as \"order\", updated_ts, created_ts, url, recur_rule, due_date, punted_from_due_date, punted_on_date, occurrences_completed, completed_ts, notes, assignee_user_id, created_by_user_id from task where id = ?1 and space_id = ?2 limit 1",
			)
			.bind(&id)
			.bind(&ctx.space_id)
			.fetch_optional(&state.pool)
			.await
			.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::CONFLICT)?;
            (StatusCode::OK, existing)
        }
    };

    sqlx::query("delete from task_tombstone where task_id = ?1 and space_id = ?2")
        .bind(&rec.id)
        .bind(&ctx.space_id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((status, Json(rec)))
}

pub(super) async fn update_task_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<UpdateTaskStatus>,
) -> Result<Json<TaskRow>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if !is_valid_task_status(&body.status) {
        return Err(StatusCode::BAD_REQUEST);
    }

    if ctx.role == Role::Contributor {
        let created_by_user_id: Option<String> = sqlx::query_scalar(
            "select created_by_user_id from task where id = ?1 and space_id = ?2 limit 1",
        )
        .bind(&id)
        .bind(&ctx.space_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let Some(created_by_user_id) = created_by_user_id else {
            return Err(StatusCode::NOT_FOUND);
        };
        if created_by_user_id != ctx.user_id {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    let now = chrono::Utc::now().timestamp_millis();
    let rec = sqlx::query_as::<_, TaskRow>(
		"update task set status = ?1, completed_ts = case when ?1 = 'done' then coalesce(completed_ts, ?2) else null end, updated_ts = ?2 where id = ?3 and space_id = ?4 returning id, space_id, title, status, list_id, my_day, priority, task_order as \"order\", updated_ts, created_ts, url, recur_rule, due_date, punted_from_due_date, punted_on_date, occurrences_completed, completed_ts, notes, assignee_user_id, created_by_user_id",
	)
	.bind(&body.status)
	.bind(now)
	.bind(&id)
	.bind(&ctx.space_id)
	.fetch_one(&state.pool)
	.await
	.map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(rec))
}

pub(super) async fn delete_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;

    if ctx.role == Role::Contributor {
        let created_by_user_id: Option<String> = sqlx::query_scalar(
            "select created_by_user_id from task where id = ?1 and space_id = ?2 limit 1",
        )
        .bind(&id)
        .bind(&ctx.space_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let Some(created_by_user_id) = created_by_user_id else {
            return Err(StatusCode::NOT_FOUND);
        };
        if created_by_user_id != ctx.user_id {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    let now = chrono::Utc::now().timestamp_millis();
    let mut tx = state.pool.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let deleted_list_id: Option<String> =
        sqlx::query_scalar("delete from task where id = ?1 and space_id = ?2 returning list_id")
            .bind(&id)
            .bind(&ctx.space_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(list_id) = deleted_list_id else {
        return Err(StatusCode::NOT_FOUND);
    };
    sqlx::query(
        "insert into task_tombstone (task_id, space_id, list_id, deleted_ts) values (?1, ?2, ?3, ?4) on conflict(task_id, space_id) do update set list_id = excluded.list_id, deleted_ts = excluded.deleted_ts",
    )
    .bind(&id)
    .bind(&ctx.space_id)
    .bind(&list_id)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn update_task_meta(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<UpdateTaskMeta>,
) -> Result<Json<TaskRow>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if let Some(status) = body.status.as_deref() {
        if !is_valid_task_status(status) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    let priority = normalize_task_priority(body.priority)?;

    if let Some(list_id) = &body.list_id {
        let exists: Option<i64> =
            sqlx::query_scalar("select 1 from list where id = ?1 and space_id = ?2")
                .bind(list_id)
                .bind(&ctx.space_id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if exists.is_none() {
            return Err(StatusCode::NOT_FOUND);
        }
    }
    let mut my_day = body.my_day.map(|value| if value { 1_i64 } else { 0_i64 });
    let mut assignee_user_id = body.assignee_user_id.clone();

    if ctx.role == Role::Contributor {
        #[derive(FromRow)]
        struct ContributorTaskPermission {
            created_by_user_id: Option<String>,
            assignee_user_id: Option<String>,
        }

        let existing = sqlx::query_as::<_, ContributorTaskPermission>(
            "select created_by_user_id, assignee_user_id from task where id = ?1 and space_id = ?2 limit 1",
        )
        .bind(&id)
        .bind(&ctx.space_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

        if existing.created_by_user_id.as_deref() != Some(ctx.user_id.as_str()) {
            return Err(StatusCode::FORBIDDEN);
        }

        if body.my_day == Some(true) {
            return Err(StatusCode::FORBIDDEN);
        }
        my_day = None;

        if let Some(next_assignee) = &body.assignee_user_id {
            if existing.assignee_user_id.as_deref() != Some(next_assignee.as_str()) {
                return Err(StatusCode::FORBIDDEN);
            }
        }
        assignee_user_id = None;

        if let Some(list_id) = &body.list_id {
            let grant_exists: Option<i64> = sqlx::query_scalar(
                "select 1 from list_grant where space_id = ?1 and user_id = ?2 and list_id = ?3 limit 1",
            )
            .bind(&ctx.space_id)
            .bind(&ctx.user_id)
            .bind(list_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            if grant_exists.is_none() {
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }

    if let Some(assignee_user_id) = &assignee_user_id {
        let exists: Option<i64> =
            sqlx::query_scalar("select 1 from membership where space_id = ?1 and user_id = ?2")
                .bind(&ctx.space_id)
                .bind(assignee_user_id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if exists.is_none() {
            return Err(StatusCode::NOT_FOUND);
        }
    }

    let now = chrono::Utc::now().timestamp_millis();
    let rec = sqlx::query_as::<_, TaskRow>(
        "update task set title = coalesce(?1, title), status = coalesce(?2, status), list_id = coalesce(?3, list_id), my_day = coalesce(?4, my_day), priority = coalesce(?5, priority), url = coalesce(?6, url), recur_rule = coalesce(?7, recur_rule), due_date = coalesce(?8, due_date), punted_from_due_date = ?9, punted_on_date = ?10, occurrences_completed = coalesce(?11, occurrences_completed), completed_ts = case when ?12 is not null then ?12 when ?2 is null then completed_ts when ?2 = 'done' then coalesce(completed_ts, ?15) else null end, notes = coalesce(?13, notes), assignee_user_id = coalesce(?14, assignee_user_id), updated_ts = ?15 where id = ?16 and space_id = ?17 returning id, space_id, title, status, list_id, my_day, priority, task_order as \"order\", updated_ts, created_ts, url, recur_rule, due_date, punted_from_due_date, punted_on_date, occurrences_completed, completed_ts, notes, assignee_user_id, created_by_user_id",
    )
    .bind(&body.title)
    .bind(&body.status)
    .bind(&body.list_id)
    .bind(my_day)
    .bind(priority)
    .bind(&body.url)
    .bind(&body.recur_rule)
    .bind(&body.due_date)
    .bind(&body.punted_from_due_date)
    .bind(&body.punted_on_date)
    .bind(body.occurrences_completed)
    .bind(body.completed_ts)
    .bind(&body.notes)
    .bind(&assignee_user_id)
    .bind(now)
    .bind(&id)
    .bind(&ctx.space_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(rec))
}

pub fn task_routes(pool: &sqlx::SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new()
        .route("/", get(get_tasks).post(create_task))
        .route("/:id", patch(update_task_meta).delete(delete_task))
        .route("/:id/status", post(update_task_status))
        .with_state(state)
}
