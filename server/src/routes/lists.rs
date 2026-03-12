use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::types::{app_state, ctx_from_headers, AppState, Role};

#[derive(Serialize, FromRow)]
pub(super) struct ListRow {
    pub(super) id: String,
    pub(super) space_id: String,
    pub(super) name: String,
    pub(super) icon: Option<String>,
    pub(super) color: Option<String>,
    pub(super) order: String,
}

#[derive(Deserialize)]
pub(super) struct CreateList {
    pub(super) name: String,
    pub(super) icon: Option<String>,
    pub(super) color: Option<String>,
    pub(super) order: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct UpdateList {
    pub(super) name: Option<String>,
    pub(super) icon: Option<String>,
    pub(super) color: Option<String>,
    pub(super) order: Option<String>,
}

pub(super) async fn get_lists(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ListRow>>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let lists = if ctx.role == Role::Admin {
        sqlx::query_as::<_, ListRow>(
            "select id, space_id, name, icon, color, list_order as \"order\" from list where space_id = ?1 order by list_order asc",
        )
        .bind(&ctx.space_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    } else {
        sqlx::query_as::<_, ListRow>(
            "select l.id, l.space_id, l.name, l.icon, l.color, l.list_order as \"order\" from list l join list_grant g on g.list_id = l.id and g.space_id = l.space_id where l.space_id = ?1 and g.user_id = ?2 order by l.list_order asc",
        )
        .bind(&ctx.space_id)
        .bind(&ctx.user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    Ok(Json(lists))
}

pub(super) async fn create_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateList>,
) -> Result<(StatusCode, Json<ListRow>), StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let id = Uuid::new_v4().to_string();
    let order = body.order.unwrap_or_else(|| "z".into());
    let rec = sqlx::query_as::<_, ListRow>(
		"insert into list (id, space_id, name, icon, color, list_order) values (?1, ?2, ?3, ?4, ?5, ?6) returning id, space_id, name, icon, color, list_order as \"order\"",
	)
	.bind(&id)
	.bind(&ctx.space_id)
	.bind(&body.name)
	.bind(&body.icon)
	.bind(&body.color)
	.bind(&order)
	.fetch_one(&state.pool)
	.await
	.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((StatusCode::CREATED, Json(rec)))
}

pub(super) async fn update_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<UpdateList>,
) -> Result<Json<ListRow>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let rec = sqlx::query_as::<_, ListRow>(
		"update list set name = coalesce(?1, name), icon = coalesce(?2, icon), color = coalesce(?3, color), list_order = coalesce(?4, list_order) where id = ?5 and space_id = ?6 returning id, space_id, name, icon, color, list_order as \"order\"",
	)
	.bind(&body.name)
	.bind(&body.icon)
	.bind(&body.color)
	.bind(&body.order)
	.bind(&id)
	.bind(&ctx.space_id)
	.fetch_one(&state.pool)
	.await
	.map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(rec))
}

pub(super) async fn delete_list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }

    let task_count: i64 =
        sqlx::query_scalar("select count(1) from task where list_id = ?1 and space_id = ?2")
            .bind(&id)
            .bind(&ctx.space_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if task_count > 0 {
        return Err(StatusCode::CONFLICT);
    }

    let rows = sqlx::query("delete from list where id = ?1 and space_id = ?2")
        .bind(&id)
        .bind(&ctx.space_id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if rows.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub fn list_routes(pool: &sqlx::SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new()
        .route("/", get(get_lists).post(create_list))
        .route("/:id", patch(update_list).delete(delete_list))
        .with_state(state)
}
