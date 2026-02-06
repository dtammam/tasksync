use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use std::{
    env,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: SqlitePool,
    jwt_secret: String,
    login_password: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AuthClaims {
    sub: String,
    space_id: String,
    exp: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Role {
    Admin,
    Contributor,
}

#[derive(Clone, Debug)]
struct RequestCtx {
    space_id: String,
    user_id: String,
    role: Role,
}

fn app_state(pool: &SqlitePool) -> AppState {
    AppState {
        pool: pool.clone(),
        jwt_secret: env::var("JWT_SECRET").unwrap_or_else(|_| "tasksync-dev-secret".to_string()),
        login_password: env::var("DEV_LOGIN_PASSWORD").unwrap_or_else(|_| "tasksync".to_string()),
    }
}

fn unix_now_secs() -> usize {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as usize).unwrap_or(0)
}

fn issue_token(user_id: &str, space_id: &str, secret: &str) -> Result<String, StatusCode> {
    let claims = AuthClaims {
        sub: user_id.to_string(),
        space_id: space_id.to_string(),
        exp: unix_now_secs() + (60 * 60 * 24 * 30),
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn role_from_membership(
    pool: &SqlitePool,
    space_id: &str,
    user_id: &str,
) -> Result<Role, StatusCode> {
    let role_str: Option<String> = sqlx::query_scalar(
        "select role from membership where space_id = ?1 and user_id = ?2 limit 1",
    )
    .bind(space_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    match role_str.as_deref() {
        Some("admin") => Ok(Role::Admin),
        Some("contributor") => Ok(Role::Contributor),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

async fn ctx_from_headers(headers: &HeaderMap, state: &AppState) -> Result<RequestCtx, StatusCode> {
    if let Some(auth) = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            let decoded = decode::<AuthClaims>(
                token,
                &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
                &Validation::default(),
            )
            .map_err(|_| StatusCode::UNAUTHORIZED)?;
            let role =
                role_from_membership(&state.pool, &decoded.claims.space_id, &decoded.claims.sub)
                    .await?;
            return Ok(RequestCtx {
                space_id: decoded.claims.space_id,
                user_id: decoded.claims.sub,
                role,
            });
        }
    }

    let space_id = headers
        .get("x-space-id")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?
        .to_string();
    let user_id = headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?
        .to_string();

    let role = role_from_membership(&state.pool, &space_id, &user_id).await?;

    Ok(RequestCtx { space_id, user_id, role })
}

pub fn list_routes(pool: &SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new()
        .route("/", get(get_lists).post(create_list))
        .route("/:id", patch(update_list).delete(delete_list))
        .with_state(state)
}

pub fn task_routes(pool: &SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new()
        .route("/", get(get_tasks).post(create_task))
        .route("/:id", patch(update_task_meta))
        .route("/:id/status", post(update_task_status))
        .with_state(state)
}

pub fn auth_routes(pool: &SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new().route("/login", post(login)).route("/me", get(auth_me)).with_state(state)
}

#[derive(Deserialize)]
struct LoginBody {
    email: String,
    password: String,
    space_id: Option<String>,
}

#[derive(Serialize, FromRow)]
struct LoginUserRow {
    user_id: String,
    email: String,
    display: String,
    role: String,
}

#[derive(Serialize)]
struct LoginResponse {
    token: String,
    user_id: String,
    email: String,
    display: String,
    space_id: String,
    role: String,
}

#[derive(Serialize, FromRow)]
struct AuthMeResponse {
    user_id: String,
    email: String,
    display: String,
    space_id: String,
    role: String,
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Json<LoginResponse>, StatusCode> {
    if body.password != state.login_password {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let email = body.email.trim();
    if email.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let space_id = body.space_id.unwrap_or_else(|| "s1".to_string());
    let user = sqlx::query_as::<_, LoginUserRow>(
        "select u.id as user_id, u.email, u.display, m.role from user u join membership m on m.user_id = u.id where lower(u.email) = lower(?1) and m.space_id = ?2 limit 1",
    )
    .bind(email)
    .bind(&space_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    let token = issue_token(&user.user_id, &space_id, &state.jwt_secret)?;
    Ok(Json(LoginResponse {
        token,
        user_id: user.user_id,
        email: user.email,
        display: user.display,
        space_id,
        role: user.role,
    }))
}

async fn auth_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AuthMeResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let me = sqlx::query_as::<_, AuthMeResponse>(
        "select u.id as user_id, u.email, u.display, m.space_id, m.role from user u join membership m on m.user_id = u.id where u.id = ?1 and m.space_id = ?2 limit 1",
    )
    .bind(&ctx.user_id)
    .bind(&ctx.space_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;
    Ok(Json(me))
}

#[derive(Serialize, FromRow)]
struct ListRow {
    id: String,
    space_id: String,
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

#[derive(Deserialize)]
struct UpdateList {
    name: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    order: Option<String>,
}

async fn get_lists(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ListRow>>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let lists = sqlx::query_as::<_, ListRow>(
		"select id, space_id, name, icon, color, list_order as \"order\" from list where space_id = ?1 order by list_order asc",
	)
	.bind(&ctx.space_id)
	.fetch_all(&state.pool)
	.await
	.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(lists))
}

async fn create_list(
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

async fn update_list(
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

async fn delete_list(
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

#[derive(Serialize, FromRow)]
struct TaskRow {
    id: String,
    space_id: String,
    title: String,
    status: String,
    list_id: String,
    my_day: i64,
    order: String,
    updated_ts: i64,
    created_ts: i64,
    url: Option<String>,
    recur_rule: Option<String>,
    attachments: Option<String>,
    due_date: Option<String>,
    occurrences_completed: i64,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct CreateTask {
    title: String,
    list_id: String,
    order: Option<String>,
    my_day: Option<bool>,
    url: Option<String>,
    recur_rule: Option<String>,
    attachments: Option<String>,
    due_date: Option<String>,
    notes: Option<String>,
}

async fn get_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<TaskRow>>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let rows = sqlx::query_as::<_, TaskRow>(
		"select id, space_id, title, status, list_id, my_day, task_order as \"order\", updated_ts, created_ts, url, recur_rule, attachments, due_date, occurrences_completed, notes from task where space_id = ?1 order by task_order asc",
	)
	.bind(&ctx.space_id)
	.fetch_all(&state.pool)
	.await
	.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

async fn create_task(
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

    let id = Uuid::new_v4().to_string();
    let order = body.order.unwrap_or_else(|| "z".into());
    let now = chrono::Utc::now().timestamp_millis();
    let my_day = if body.my_day.unwrap_or(false) { 1 } else { 0 };
    let rec = sqlx::query_as::<_, TaskRow>(
		"insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, url, recur_rule, attachments, due_date, occurrences_completed, notes) values (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?11, 0, ?12) returning id, space_id, title, status, list_id, my_day, task_order as \"order\", updated_ts, created_ts, url, recur_rule, attachments, due_date, occurrences_completed, notes",
	)
	.bind(&id)
	.bind(&ctx.space_id)
	.bind(&body.title)
	.bind(&body.list_id)
	.bind(my_day)
	.bind(&order)
	.bind(now)
	.bind(&body.url)
	.bind(&body.recur_rule)
	.bind(&body.attachments)
	.bind(&body.due_date)
	.bind(&body.notes)
	.fetch_one(&state.pool)
	.await
	.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((StatusCode::CREATED, Json(rec)))
}

#[derive(Deserialize)]
struct UpdateTaskStatus {
    status: String,
}

#[derive(Deserialize)]
struct UpdateTaskMeta {
    title: Option<String>,
    status: Option<String>,
    list_id: Option<String>,
    my_day: Option<bool>,
    url: Option<String>,
    recur_rule: Option<String>,
    attachments: Option<String>,
    due_date: Option<String>,
    notes: Option<String>,
    occurrences_completed: Option<i64>,
}

async fn update_task_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<UpdateTaskStatus>,
) -> Result<Json<TaskRow>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;

    if ctx.role == Role::Contributor {
        return Err(StatusCode::FORBIDDEN);
    }

    let now = chrono::Utc::now().timestamp_millis();
    let rec = sqlx::query_as::<_, TaskRow>(
		"update task set status = ?1, updated_ts = ?2 where id = ?3 and space_id = ?4 returning id, space_id, title, status, list_id, my_day, task_order as \"order\", updated_ts, created_ts",
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

async fn update_task_meta(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<UpdateTaskMeta>,
) -> Result<Json<TaskRow>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role == Role::Contributor {
        return Err(StatusCode::FORBIDDEN);
    }

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

    let now = chrono::Utc::now().timestamp_millis();
    let my_day = body.my_day.unwrap_or(false);
    let rec = sqlx::query_as::<_, TaskRow>(
		"update task set title = coalesce(?1, title), status = coalesce(?2, status), list_id = coalesce(?3, list_id), my_day = case when ?4 then 1 else my_day end, url = coalesce(?5, url), recur_rule = coalesce(?6, recur_rule), attachments = coalesce(?7, attachments), due_date = coalesce(?8, due_date), occurrences_completed = coalesce(?9, occurrences_completed), notes = coalesce(?10, notes), updated_ts = ?11 where id = ?12 and space_id = ?13 returning id, space_id, title, status, list_id, my_day, task_order as \"order\", updated_ts, created_ts, url, recur_rule, attachments, due_date, occurrences_completed, notes",
	)
	.bind(&body.title)
	.bind(&body.status)
	.bind(&body.list_id)
	.bind(my_day)
	.bind(&body.url)
	.bind(&body.recur_rule)
	.bind(&body.attachments)
	.bind(&body.due_date)
	.bind(body.occurrences_completed)
	.bind(&body.notes)
	.bind(now)
	.bind(&id)
	.bind(&ctx.space_id)
	.fetch_one(&state.pool)
	.await
	.map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(rec))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;
    use axum::Json;
    use sqlx::SqlitePool;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory sqlite");
        sqlx::migrate!("./migrations").run(&pool).await.expect("migrations");

        sqlx::query("insert into space (id, name) values ('s1', 'Default')")
            .execute(&pool)
            .await
            .expect("insert space");
        sqlx::query(
            "insert into user (id, email, display) values ('u-admin', 'admin@example.com', 'Admin')",
        )
        .execute(&pool)
        .await
        .expect("insert user");
        sqlx::query(
            "insert into membership (id, space_id, user_id, role) values ('m-admin', 's1', 'u-admin', 'admin')",
        )
        .execute(&pool)
        .await
        .expect("insert membership");

        pool
    }

    fn test_state(pool: &SqlitePool) -> AppState {
        AppState {
            pool: pool.clone(),
            jwt_secret: "test-secret".to_string(),
            login_password: "test-pass".to_string(),
        }
    }

    #[tokio::test]
    async fn login_returns_token_for_valid_credentials() {
        let pool = setup_pool().await;
        let state = test_state(&pool);

        let response = login(
            State(state.clone()),
            Json(LoginBody {
                email: "admin@example.com".to_string(),
                password: "test-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await
        .expect("login should succeed")
        .0;

        assert!(!response.token.is_empty());

        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            format!("Bearer {}", response.token).parse().expect("auth header"),
        );
        let ctx = ctx_from_headers(&headers, &state).await.expect("ctx");
        assert_eq!(ctx.user_id, "u-admin");
        assert_eq!(ctx.space_id, "s1");
        assert_eq!(ctx.role, Role::Admin);
    }

    #[tokio::test]
    async fn login_rejects_invalid_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let result = login(
            State(state),
            Json(LoginBody {
                email: "admin@example.com".to_string(),
                password: "wrong".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await;
        assert_eq!(result.err(), Some(StatusCode::UNAUTHORIZED));
    }
}
