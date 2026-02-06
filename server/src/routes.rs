use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use bcrypt::{hash, verify, DEFAULT_COST};
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

fn hash_password(password: &str) -> Result<String, StatusCode> {
    hash(password, DEFAULT_COST).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn verify_password(password: &str, password_hash: &str) -> Result<bool, StatusCode> {
    verify(password, password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn password_meets_policy(password: &str) -> bool {
    password.trim().chars().count() >= 8
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
    Router::new()
        .route("/login", post(login))
        .route("/me", get(auth_me).patch(auth_update_me))
        .route("/password", patch(auth_change_password))
        .route("/members", get(auth_members).post(auth_create_member))
        .route("/members/:user_id/password", patch(auth_set_member_password))
        .route("/grants", get(auth_grants).put(auth_set_grant))
        .with_state(state)
}

fn normalize_avatar_icon(raw: Option<String>) -> Option<String> {
    raw.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(trimmed.chars().take(4).collect())
    })
}

fn is_unique_violation(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::Database(db_err) => db_err.message().contains("UNIQUE constraint failed"),
        _ => false,
    }
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
    avatar_icon: Option<String>,
    password_hash: Option<String>,
    role: String,
}

#[derive(Serialize)]
struct LoginResponse {
    token: String,
    user_id: String,
    email: String,
    display: String,
    avatar_icon: Option<String>,
    space_id: String,
    role: String,
}

#[derive(Serialize, FromRow)]
struct AuthMeResponse {
    user_id: String,
    email: String,
    display: String,
    avatar_icon: Option<String>,
    space_id: String,
    role: String,
}

#[derive(Serialize, FromRow)]
struct AuthMemberResponse {
    user_id: String,
    email: String,
    display: String,
    avatar_icon: Option<String>,
    space_id: String,
    role: String,
}

#[derive(Deserialize)]
struct UpdateProfileBody {
    display: Option<String>,
    avatar_icon: Option<String>,
}

#[derive(Deserialize)]
struct ChangePasswordBody {
    current_password: String,
    new_password: String,
}

#[derive(Deserialize)]
struct CreateMemberBody {
    email: String,
    display: String,
    role: String,
    password: String,
    avatar_icon: Option<String>,
}

#[derive(Deserialize)]
struct SetMemberPasswordBody {
    password: String,
}

#[derive(Serialize, FromRow)]
struct ListGrantResponse {
    user_id: String,
    list_id: String,
}

#[derive(Deserialize)]
struct SetListGrantBody {
    user_id: String,
    list_id: String,
    granted: bool,
}

async fn password_matches_for_user(
    state: &AppState,
    user_id: &str,
    candidate_password: &str,
) -> Result<bool, StatusCode> {
    let stored_hash: Option<String> =
        sqlx::query_scalar("select password_hash from user where id = ?1")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .flatten();

    if let Some(hash_value) = stored_hash.as_ref() {
        if !hash_value.trim().is_empty() {
            return verify_password(candidate_password, hash_value);
        }
    }
    Ok(candidate_password == state.login_password.trim())
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Json<LoginResponse>, StatusCode> {
    let password = body.password.trim();
    if password.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let email = body.email.trim();
    if email.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let space_id = body.space_id.unwrap_or_else(|| "s1".to_string());
    let user = sqlx::query_as::<_, LoginUserRow>(
        "select u.id as user_id, u.email, u.display, u.avatar_icon, u.password_hash, m.role from user u join membership m on m.user_id = u.id where lower(u.email) = lower(?1) and m.space_id = ?2 limit 1",
    )
    .bind(email)
    .bind(&space_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    let has_password_hash =
        user.password_hash.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false);
    // Keep a legacy fallback so existing rows without hashes can still sign in once and auto-upgrade.
    let password_ok = password_matches_for_user(&state, &user.user_id, password).await?;
    if !password_ok {
        return Err(StatusCode::UNAUTHORIZED);
    }

    if !has_password_hash {
        let upgraded_hash = hash_password(password)?;
        sqlx::query(
            "update user set password_hash = ?1 where id = ?2 and (password_hash is null or trim(password_hash) = '')",
        )
        .bind(upgraded_hash)
        .bind(&user.user_id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    let token = issue_token(&user.user_id, &space_id, &state.jwt_secret)?;
    Ok(Json(LoginResponse {
        token,
        user_id: user.user_id,
        email: user.email,
        display: user.display,
        avatar_icon: user.avatar_icon,
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
        "select u.id as user_id, u.email, u.display, u.avatar_icon, m.space_id, m.role from user u join membership m on m.user_id = u.id where u.id = ?1 and m.space_id = ?2 limit 1",
    )
    .bind(&ctx.user_id)
    .bind(&ctx.space_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;
    Ok(Json(me))
}

async fn auth_update_me(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateProfileBody>,
) -> Result<Json<AuthMeResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let display = body
        .display
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let clear_avatar =
        body.avatar_icon.as_ref().map(|value| value.trim().is_empty()).unwrap_or(false);
    let avatar_icon = if clear_avatar { None } else { normalize_avatar_icon(body.avatar_icon) };
    sqlx::query(
        "update user set display = coalesce(?1, display), avatar_icon = case when ?2 then null when ?3 is not null then ?3 else avatar_icon end where id = ?4",
    )
    .bind(display)
    .bind(clear_avatar)
    .bind(avatar_icon)
    .bind(&ctx.user_id)
    .execute(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    auth_me(State(state), headers).await
}

async fn auth_change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordBody>,
) -> Result<StatusCode, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let current_password = body.current_password.trim();
    let new_password = body.new_password.trim();
    if current_password.is_empty() || !password_meets_policy(new_password) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let current_password_ok =
        password_matches_for_user(&state, &ctx.user_id, current_password).await?;
    if !current_password_ok {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let new_password_hash = hash_password(new_password)?;
    sqlx::query("update user set password_hash = ?1 where id = ?2")
        .bind(new_password_hash)
        .bind(&ctx.user_id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn auth_members(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AuthMemberResponse>>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let members = sqlx::query_as::<_, AuthMemberResponse>(
        "select u.id as user_id, u.email, u.display, u.avatar_icon, m.space_id, m.role from user u join membership m on m.user_id = u.id where m.space_id = ?1 order by u.display asc",
    )
    .bind(&ctx.space_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(members))
}

async fn auth_create_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateMemberBody>,
) -> Result<(StatusCode, Json<AuthMemberResponse>), StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }

    let email = body.email.trim().to_lowercase();
    let display = body.display.trim();
    let password = body.password.trim();
    if email.is_empty() || display.is_empty() || !password_meets_policy(password) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if body.role != "admin" && body.role != "contributor" {
        return Err(StatusCode::BAD_REQUEST);
    }
    let password_hash = hash_password(password)?;

    let existing_user_id: Option<String> =
        sqlx::query_scalar("select id from user where lower(email) = lower(?1) limit 1")
            .bind(&email)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_id = if let Some(found) = existing_user_id {
        sqlx::query(
            "update user set password_hash = case when password_hash is null or trim(password_hash) = '' then ?1 else password_hash end where id = ?2",
        )
        .bind(&password_hash)
        .bind(&found)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        found
    } else {
        let new_user_id = format!("u-{}", Uuid::new_v4());
        sqlx::query(
            "insert into user (id, email, display, avatar_icon, password_hash) values (?1, ?2, ?3, ?4, ?5)",
        )
            .bind(&new_user_id)
            .bind(&email)
            .bind(display)
            .bind(normalize_avatar_icon(body.avatar_icon))
            .bind(&password_hash)
            .execute(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        new_user_id
    };

    let membership_id = format!("m-{}", Uuid::new_v4());
    let membership_res =
        sqlx::query("insert into membership (id, space_id, user_id, role) values (?1, ?2, ?3, ?4)")
            .bind(membership_id)
            .bind(&ctx.space_id)
            .bind(&user_id)
            .bind(&body.role)
            .execute(&state.pool)
            .await;
    if let Err(err) = membership_res {
        if is_unique_violation(&err) {
            return Err(StatusCode::CONFLICT);
        }
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let member = sqlx::query_as::<_, AuthMemberResponse>(
        "select u.id as user_id, u.email, u.display, u.avatar_icon, m.space_id, m.role from user u join membership m on m.user_id = u.id where u.id = ?1 and m.space_id = ?2 limit 1",
    )
    .bind(&user_id)
    .bind(&ctx.space_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((StatusCode::CREATED, Json(member)))
}

async fn auth_set_member_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(body): Json<SetMemberPasswordBody>,
) -> Result<StatusCode, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let password = body.password.trim();
    if !password_meets_policy(password) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let member_exists: Option<i64> =
        sqlx::query_scalar("select 1 from membership where space_id = ?1 and user_id = ?2")
            .bind(&ctx.space_id)
            .bind(&user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if member_exists.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let password_hash = hash_password(password)?;
    sqlx::query("update user set password_hash = ?1 where id = ?2")
        .bind(password_hash)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn auth_grants(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ListGrantResponse>>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let grants = sqlx::query_as::<_, ListGrantResponse>(
        "select g.user_id, g.list_id from list_grant g join membership m on m.user_id = g.user_id and m.space_id = g.space_id where g.space_id = ?1 and m.role = 'contributor' order by g.user_id asc, g.list_id asc",
    )
    .bind(&ctx.space_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(grants))
}

async fn auth_set_grant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SetListGrantBody>,
) -> Result<Json<ListGrantResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let membership_role: Option<String> = sqlx::query_scalar(
        "select role from membership where space_id = ?1 and user_id = ?2 limit 1",
    )
    .bind(&ctx.space_id)
    .bind(&body.user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if membership_role.as_deref() != Some("contributor") {
        return Err(StatusCode::BAD_REQUEST);
    }
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
    if body.granted {
        let grant_id = format!("g-{}", Uuid::new_v4());
        sqlx::query(
            "insert or ignore into list_grant (id, space_id, list_id, user_id) values (?1, ?2, ?3, ?4)",
        )
        .bind(grant_id)
        .bind(&ctx.space_id)
        .bind(&body.list_id)
        .bind(&body.user_id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        sqlx::query("delete from list_grant where space_id = ?1 and list_id = ?2 and user_id = ?3")
            .bind(&ctx.space_id)
            .bind(&body.list_id)
            .bind(&body.user_id)
            .execute(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(Json(ListGrantResponse { user_id: body.user_id, list_id: body.list_id }))
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
    assignee_user_id: Option<String>,
    created_by_user_id: Option<String>,
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
    assignee_user_id: Option<String>,
}

async fn get_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<TaskRow>>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let rows = if ctx.role == Role::Admin {
        sqlx::query_as::<_, TaskRow>(
            "select id, space_id, title, status, list_id, my_day, task_order as \"order\", updated_ts, created_ts, url, recur_rule, attachments, due_date, occurrences_completed, notes, assignee_user_id, created_by_user_id from task where space_id = ?1 order by task_order asc",
        )
        .bind(&ctx.space_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    } else {
        sqlx::query_as::<_, TaskRow>(
            "select t.id, t.space_id, t.title, t.status, t.list_id, t.my_day, t.task_order as \"order\", t.updated_ts, t.created_ts, t.url, t.recur_rule, t.attachments, t.due_date, t.occurrences_completed, t.notes, t.assignee_user_id, t.created_by_user_id from task t join list_grant g on g.list_id = t.list_id and g.space_id = t.space_id where t.space_id = ?1 and g.user_id = ?2 order by t.task_order asc",
        )
        .bind(&ctx.space_id)
        .bind(&ctx.user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
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

    let assignee_user_id = body.assignee_user_id.clone().unwrap_or_else(|| ctx.user_id.clone());
    let assignee_exists: Option<i64> =
        sqlx::query_scalar("select 1 from membership where space_id = ?1 and user_id = ?2")
            .bind(&ctx.space_id)
            .bind(&assignee_user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if assignee_exists.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let id = Uuid::new_v4().to_string();
    let order = body.order.unwrap_or_else(|| "z".into());
    let now = chrono::Utc::now().timestamp_millis();
    let my_day = if body.my_day.unwrap_or(false) { 1 } else { 0 };
    let rec = sqlx::query_as::<_, TaskRow>(
		"insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, url, recur_rule, attachments, due_date, occurrences_completed, notes, assignee_user_id, created_by_user_id) values (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?13, ?14) returning id, space_id, title, status, list_id, my_day, task_order as \"order\", updated_ts, created_ts, url, recur_rule, attachments, due_date, occurrences_completed, notes, assignee_user_id, created_by_user_id",
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
    .bind(&assignee_user_id)
    .bind(&ctx.user_id)
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
    assignee_user_id: Option<String>,
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
		"update task set status = ?1, updated_ts = ?2 where id = ?3 and space_id = ?4 returning id, space_id, title, status, list_id, my_day, task_order as \"order\", updated_ts, created_ts, url, recur_rule, attachments, due_date, occurrences_completed, notes, assignee_user_id, created_by_user_id",
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
    if let Some(assignee_user_id) = &body.assignee_user_id {
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
    let my_day = body.my_day.unwrap_or(false);
    let rec = sqlx::query_as::<_, TaskRow>(
		"update task set title = coalesce(?1, title), status = coalesce(?2, status), list_id = coalesce(?3, list_id), my_day = case when ?4 then 1 else my_day end, url = coalesce(?5, url), recur_rule = coalesce(?6, recur_rule), attachments = coalesce(?7, attachments), due_date = coalesce(?8, due_date), occurrences_completed = coalesce(?9, occurrences_completed), notes = coalesce(?10, notes), assignee_user_id = coalesce(?11, assignee_user_id), updated_ts = ?12 where id = ?13 and space_id = ?14 returning id, space_id, title, status, list_id, my_day, task_order as \"order\", updated_ts, created_ts, url, recur_rule, attachments, due_date, occurrences_completed, notes, assignee_user_id, created_by_user_id",
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
    .bind(&body.assignee_user_id)
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
        let test_password_hash = hash_password("test-pass").expect("hash test password");

        sqlx::query("insert into space (id, name) values ('s1', 'Default')")
            .execute(&pool)
            .await
            .expect("insert space");
        sqlx::query(
            "insert into user (id, email, display, password_hash) values ('u-admin', 'admin@example.com', 'Admin', ?1)",
        )
        .bind(&test_password_hash)
        .execute(&pool)
        .await
        .expect("insert user");
        sqlx::query(
            "insert into membership (id, space_id, user_id, role) values ('m-admin', 's1', 'u-admin', 'admin')",
        )
        .execute(&pool)
        .await
        .expect("insert membership");
        sqlx::query(
            "insert into user (id, email, display, password_hash) values ('u-contrib', 'contrib@example.com', 'Contributor', ?1)",
        )
        .bind(&test_password_hash)
        .execute(&pool)
        .await
        .expect("insert contributor");
        sqlx::query(
            "insert into membership (id, space_id, user_id, role) values ('m-contrib', 's1', 'u-contrib', 'contributor')",
        )
        .execute(&pool)
        .await
        .expect("insert contributor membership");
        sqlx::query(
            "insert into list (id, space_id, name, list_order) values ('goal-management', 's1', 'Goal Management', 'a')",
        )
        .execute(&pool)
        .await
        .expect("insert list");
        sqlx::query(
            "insert into list_grant (id, space_id, list_id, user_id) values ('g-contrib-goal', 's1', 'goal-management', 'u-contrib')",
        )
        .execute(&pool)
        .await
        .expect("insert grant");

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

    #[tokio::test]
    async fn login_supports_legacy_password_and_upgrades_hash() {
        let pool = setup_pool().await;
        sqlx::query("update user set password_hash = null where id = 'u-admin'")
            .execute(&pool)
            .await
            .expect("clear password hash");
        let state = test_state(&pool);

        let response = login(
            State(state),
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

        let upgraded_hash: Option<String> =
            sqlx::query_scalar("select password_hash from user where id = 'u-admin'")
                .fetch_optional(&pool)
                .await
                .expect("load upgraded hash");
        assert!(upgraded_hash.as_deref().map(|value| value.starts_with("$2")).unwrap_or(false));
    }

    #[tokio::test]
    async fn update_profile_sets_avatar_icon() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let updated = auth_update_me(
            State(state),
            headers,
            Json(UpdateProfileBody {
                display: Some("Admin Prime".to_string()),
                avatar_icon: Some("⭐".to_string()),
            }),
        )
        .await
        .expect("update profile should work")
        .0;

        assert_eq!(updated.display, "Admin Prime");
        assert_eq!(updated.avatar_icon.as_deref(), Some("⭐"));
    }

    #[tokio::test]
    async fn user_can_change_password_and_login_with_new_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let status = auth_change_password(
            State(state.clone()),
            headers,
            Json(ChangePasswordBody {
                current_password: "test-pass".to_string(),
                new_password: "new-test-pass".to_string(),
            }),
        )
        .await
        .expect("change password should work");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let old_login = login(
            State(state.clone()),
            Json(LoginBody {
                email: "admin@example.com".to_string(),
                password: "test-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await;
        assert_eq!(old_login.err(), Some(StatusCode::UNAUTHORIZED));

        let new_login = login(
            State(state),
            Json(LoginBody {
                email: "admin@example.com".to_string(),
                password: "new-test-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await
        .expect("new password login should work")
        .0;
        assert_eq!(new_login.user_id, "u-admin");
    }

    #[tokio::test]
    async fn change_password_rejects_wrong_current_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let result = auth_change_password(
            State(state),
            headers,
            Json(ChangePasswordBody {
                current_password: "wrong-pass".to_string(),
                new_password: "new-test-pass".to_string(),
            }),
        )
        .await;
        assert_eq!(result.err(), Some(StatusCode::UNAUTHORIZED));
    }

    #[tokio::test]
    async fn admin_can_create_member_and_manage_grants() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let created = auth_create_member(
            State(state.clone()),
            headers.clone(),
            Json(CreateMemberBody {
                email: "wife@example.com".to_string(),
                display: "Wife".to_string(),
                role: "contributor".to_string(),
                password: "password123".to_string(),
                avatar_icon: Some("🦊".to_string()),
            }),
        )
        .await
        .expect("create member should work")
        .1
         .0;
        assert_eq!(created.role, "contributor");
        assert_eq!(created.avatar_icon.as_deref(), Some("🦊"));

        let granted = auth_set_grant(
            State(state.clone()),
            headers.clone(),
            Json(SetListGrantBody {
                user_id: created.user_id.clone(),
                list_id: "goal-management".to_string(),
                granted: true,
            }),
        )
        .await
        .expect("set grant should work")
        .0;
        assert_eq!(granted.user_id, created.user_id);
        assert_eq!(granted.list_id, "goal-management");

        let grants = auth_grants(State(state), headers).await.expect("load grants should work").0;
        assert!(grants
            .iter()
            .any(|grant| grant.user_id == created.user_id && grant.list_id == "goal-management"));
    }

    #[tokio::test]
    async fn created_member_can_login_with_member_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let created = auth_create_member(
            State(state.clone()),
            headers,
            Json(CreateMemberBody {
                email: "newmember@example.com".to_string(),
                display: "New Member".to_string(),
                role: "contributor".to_string(),
                password: "memberpass123".to_string(),
                avatar_icon: None,
            }),
        )
        .await
        .expect("create member should work")
        .1
         .0;

        let login_response = login(
            State(state),
            Json(LoginBody {
                email: created.email,
                password: "memberpass123".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await
        .expect("member login should work")
        .0;
        assert_eq!(login_response.user_id, created.user_id);
    }

    #[tokio::test]
    async fn admin_create_member_rejects_short_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let result = auth_create_member(
            State(state),
            headers,
            Json(CreateMemberBody {
                email: "weakpass@example.com".to_string(),
                display: "Weak Pass".to_string(),
                role: "contributor".to_string(),
                password: "short".to_string(),
                avatar_icon: None,
            }),
        )
        .await;
        assert_eq!(result.err(), Some(StatusCode::BAD_REQUEST));
    }

    #[tokio::test]
    async fn admin_can_reset_member_password() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut admin_headers = HeaderMap::new();
        admin_headers.insert("x-space-id", "s1".parse().expect("space"));
        admin_headers.insert("x-user-id", "u-admin".parse().expect("user"));

        let status = auth_set_member_password(
            State(state.clone()),
            admin_headers,
            Path("u-contrib".to_string()),
            Json(SetMemberPasswordBody { password: "contrib-reset-pass".to_string() }),
        )
        .await
        .expect("admin reset should work");
        assert_eq!(status, StatusCode::NO_CONTENT);

        let old_login = login(
            State(state.clone()),
            Json(LoginBody {
                email: "contrib@example.com".to_string(),
                password: "test-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await;
        assert_eq!(old_login.err(), Some(StatusCode::UNAUTHORIZED));

        let new_login = login(
            State(state),
            Json(LoginBody {
                email: "contrib@example.com".to_string(),
                password: "contrib-reset-pass".to_string(),
                space_id: Some("s1".to_string()),
            }),
        )
        .await
        .expect("contrib login with reset password should work")
        .0;
        assert_eq!(new_login.user_id, "u-contrib");
    }

    #[tokio::test]
    async fn contributor_cannot_manage_members_or_grants() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let create_result = auth_create_member(
            State(state.clone()),
            headers.clone(),
            Json(CreateMemberBody {
                email: "blocked@example.com".to_string(),
                display: "Blocked".to_string(),
                role: "contributor".to_string(),
                password: "password123".to_string(),
                avatar_icon: Some("🚫".to_string()),
            }),
        )
        .await;
        assert_eq!(create_result.err(), Some(StatusCode::FORBIDDEN));

        let reset_result = auth_set_member_password(
            State(state.clone()),
            headers.clone(),
            Path("u-admin".to_string()),
            Json(SetMemberPasswordBody { password: "blocked123".to_string() }),
        )
        .await;
        assert_eq!(reset_result.err(), Some(StatusCode::FORBIDDEN));

        let grant_result = auth_set_grant(
            State(state),
            headers,
            Json(SetListGrantBody {
                user_id: "u-contrib".to_string(),
                list_id: "goal-management".to_string(),
                granted: true,
            }),
        )
        .await;
        assert_eq!(grant_result.err(), Some(StatusCode::FORBIDDEN));
    }

    #[tokio::test]
    async fn contributor_can_create_task_assigned_to_admin() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let created = create_task(
            State(state),
            headers,
            Json(CreateTask {
                title: "Assigned by contributor".to_string(),
                list_id: "goal-management".to_string(),
                order: Some("z".to_string()),
                my_day: Some(false),
                url: None,
                recur_rule: None,
                attachments: None,
                due_date: None,
                notes: None,
                assignee_user_id: Some("u-admin".to_string()),
            }),
        )
        .await
        .expect("create should work")
        .1
         .0;

        assert_eq!(created.assignee_user_id.as_deref(), Some("u-admin"));
        assert_eq!(created.created_by_user_id.as_deref(), Some("u-contrib"));
    }

    #[tokio::test]
    async fn contributor_cannot_update_or_reassign_task() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t1', 's1', 'Task', 'pending', 'goal-management', 0, 'a', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let result = update_task_meta(
            State(state),
            headers,
            Path("t1".to_string()),
            Json(UpdateTaskMeta {
                title: None,
                status: None,
                list_id: None,
                my_day: None,
                url: None,
                recur_rule: None,
                attachments: None,
                due_date: None,
                notes: None,
                occurrences_completed: None,
                assignee_user_id: Some("u-contrib".to_string()),
            }),
        )
        .await;
        assert_eq!(result.err(), Some(StatusCode::FORBIDDEN));
    }

    #[tokio::test]
    async fn contributor_reads_only_granted_lists_and_admin_tasks_within_them() {
        let pool = setup_pool().await;
        let state = test_state(&pool);
        sqlx::query(
            "insert into list (id, space_id, name, list_order) values ('admin-private', 's1', 'Admin Private', 'z')",
        )
        .execute(&pool)
        .await
        .expect("insert private list");
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-visible', 's1', 'Admin visible task', 'pending', 'goal-management', 0, 'a', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert visible task");
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, task_order, updated_ts, created_ts, occurrences_completed, assignee_user_id, created_by_user_id) values ('t-hidden', 's1', 'Admin hidden task', 'pending', 'admin-private', 0, 'b', 1, 1, 0, 'u-admin', 'u-admin')",
        )
        .execute(&pool)
        .await
        .expect("insert hidden task");

        let mut headers = HeaderMap::new();
        headers.insert("x-space-id", "s1".parse().expect("space"));
        headers.insert("x-user-id", "u-contrib".parse().expect("user"));

        let visible_lists =
            get_lists(State(state.clone()), headers.clone()).await.expect("lists should load").0;
        assert_eq!(visible_lists.len(), 1);
        assert_eq!(visible_lists[0].id, "goal-management");

        let visible_tasks = get_tasks(State(state), headers).await.expect("tasks should load").0;
        assert_eq!(visible_tasks.len(), 1);
        assert_eq!(visible_tasks[0].id, "t-visible");
        assert_eq!(visible_tasks[0].created_by_user_id.as_deref(), Some("u-admin"));
    }
}
