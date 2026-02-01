use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
}

pub fn list_routes(pool: &SqlitePool) -> Router {
    let state = AppState { pool: pool.clone() };
    Router::new().route("/", get(get_lists).post(create_list)).with_state(state)
}

pub fn task_routes(pool: &SqlitePool) -> Router {
    let state = AppState { pool: pool.clone() };
    Router::new()
        .route("/", get(get_tasks).post(create_task))
        .route("/:id", post(update_task_status))
        .with_state(state)
}

#[derive(Serialize, FromRow)]
struct ListRow {
    id: String,
    name: String,
    icon: Option<String>,
    color: Option<String>,
    order: String,
}

#[derive(Deserialize)]
struct CreateList {
    name: String,
    icon: Option<String>,
    color: Option<String>,
    order: Option<String>,
}

async fn get_lists(State(state): State<AppState>) -> Result<Json<Vec<ListRow>>, StatusCode> {
    let lists = sqlx::query_as::<_, ListRow>(
        "select id, name, icon, color, list_order as \"order\" from list order by list_order asc",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(lists))
}

async fn create_list(
    State(state): State<AppState>,
    Json(body): Json<CreateList>,
) -> Result<(StatusCode, Json<ListRow>), StatusCode> {
    let id = Uuid::new_v4().to_string();
    let order = body.order.unwrap_or_else(|| "z".into());
    let rec = sqlx::query_as::<_, ListRow>(
		"insert into list (id, name, icon, color, list_order) values (?1, ?2, ?3, ?4, ?5) returning id, name, icon, color, list_order as \"order\"",
	)
	.bind(&id)
	.bind(&body.name)
	.bind(&body.icon)
	.bind(&body.color)
	.bind(&order)
	.fetch_one(&state.pool)
	.await
	.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((StatusCode::CREATED, Json(rec)))
}

#[derive(Serialize, FromRow)]
struct TaskRow {
    id: String,
    title: String,
    status: String,
    list_id: String,
    my_day: i64,
    order: String,
    updated_ts: i64,
}

#[derive(Deserialize)]
struct CreateTask {
    title: String,
    list_id: String,
    order: Option<String>,
    my_day: Option<bool>,
}

async fn get_tasks(State(state): State<AppState>) -> Result<Json<Vec<TaskRow>>, StatusCode> {
    let rows = sqlx::query_as::<_, TaskRow>(
		"select id, title, status, list_id, my_day, task_order as \"order\", updated_ts from task order by task_order asc",
	)
	.fetch_all(&state.pool)
	.await
	.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

async fn create_task(
    State(state): State<AppState>,
    Json(body): Json<CreateTask>,
) -> Result<(StatusCode, Json<TaskRow>), StatusCode> {
    let id = Uuid::new_v4().to_string();
    let order = body.order.unwrap_or_else(|| "z".into());
    let now = chrono::Utc::now().timestamp_millis();
    let my_day = if body.my_day.unwrap_or(false) { 1 } else { 0 };
    let rec = sqlx::query_as::<_, TaskRow>(
		"insert into task (id, title, status, list_id, my_day, task_order, updated_ts) values (?1, ?2, 'pending', ?3, ?4, ?5, ?6) returning id, title, status, list_id, my_day, task_order as \"order\", updated_ts",
	)
	.bind(&id)
	.bind(&body.title)
	.bind(&body.list_id)
	.bind(my_day)
	.bind(&order)
	.bind(now)
	.fetch_one(&state.pool)
	.await
	.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((StatusCode::CREATED, Json(rec)))
}

#[derive(Deserialize)]
struct UpdateTaskStatus {
    status: String,
}

async fn update_task_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateTaskStatus>,
) -> Result<Json<TaskRow>, StatusCode> {
    // TODO: enforce role once auth is wired; for now allow all.
    let now = chrono::Utc::now().timestamp_millis();
    let rec = sqlx::query_as::<_, TaskRow>(
		"update task set status = ?1, updated_ts = ?2 where id = ?3 returning id, title, status, list_id, my_day, task_order as \"order\", updated_ts",
	)
	.bind(&body.status)
	.bind(now)
	.bind(&id)
	.fetch_one(&state.pool)
	.await
	.map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(rec))
}
