use axum::http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{
    env,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone)]
pub(super) struct AppState {
    pub(super) pool: SqlitePool,
    pub(super) jwt_secret: String,
    pub(super) login_password: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct AuthClaims {
    pub(super) sub: String,
    pub(super) space_id: String,
    pub(super) exp: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Role {
    Admin,
    Contributor,
}

#[derive(Clone, Debug)]
pub(super) struct RequestCtx {
    pub(super) space_id: String,
    pub(super) user_id: String,
    pub(super) role: Role,
}

pub(super) fn app_state(pool: &SqlitePool) -> AppState {
    AppState {
        pool: pool.clone(),
        jwt_secret: env::var("JWT_SECRET").unwrap_or_else(|_| "tasksync-dev-secret".to_string()),
        login_password: env::var("DEV_LOGIN_PASSWORD").unwrap_or_else(|_| "tasksync".to_string()),
    }
}

pub(super) fn unix_now_secs() -> usize {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as usize).unwrap_or(0)
}

pub(super) fn issue_token(
    user_id: &str,
    space_id: &str,
    secret: &str,
) -> Result<String, StatusCode> {
    let claims = AuthClaims {
        sub: user_id.to_string(),
        space_id: space_id.to_string(),
        exp: unix_now_secs() + (60 * 60 * 24 * 30),
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub(super) fn hash_password(password: &str) -> Result<String, StatusCode> {
    hash(password, DEFAULT_COST).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub(super) fn verify_password(password: &str, password_hash: &str) -> Result<bool, StatusCode> {
    verify(password, password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub(super) fn password_meets_policy(password: &str) -> bool {
    password.trim().chars().count() >= 8
}

pub(super) async fn role_from_membership(
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

pub(super) async fn ctx_from_headers(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<RequestCtx, StatusCode> {
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

pub(super) fn normalize_avatar_icon(raw: Option<String>) -> Option<String> {
    raw.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(trimmed.chars().take(4).collect())
    })
}

pub(super) const SOUND_THEMES: [&str; 8] = [
    "chime_soft",
    "click_pop",
    "sparkle_short",
    "wood_tick",
    "bell_crisp",
    "marimba_blip",
    "pulse_soft",
    "custom_file",
];

pub(super) const UI_FONTS: [&str; 23] = [
    "sora",
    "sono",
    "inter",
    "inter-tight",
    "jetbrains-mono",
    "atkinson-hyperlegible",
    "atkinson-hyperlegible-next",
    "ibm-plex-sans",
    "ibm-plex-mono",
    "ibm-plex-serif",
    "roboto",
    "roboto-slab",
    "roboto-mono",
    "dm-mono",
    "comfortaa",
    "poppins",
    "victor-mono",
    "pt-sans",
    "pt-serif",
    "pt-mono",
    "georgia",
    "sf-pro",
    "system",
];

pub(super) const UI_THEMES: [&str; 17] = [
    "default",
    "dark",
    "light",
    "shades-of-coffee",
    "miami-beach",
    "simple-dark",
    "matrix",
    "black-gold",
    "okabe-ito",
    "theme-from-1970",
    "shades-of-gray-light",
    "catppuccin-latte",
    "catppuccin-frappe",
    "catppuccin-macchiato",
    "catppuccin-mocha",
    "you-need-a-dark-mode",
    "butterfly",
];

pub(super) const BACKUP_SCHEMA_V1: &str = "tasksync-space-backup-v1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SoundPlaylistEntry {
    pub(super) id: Option<String>,
    pub(super) name: Option<String>,
    pub(super) data_url: String,
}

pub(super) fn normalize_sound_theme(raw: Option<String>) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if SOUND_THEMES.contains(&trimmed) {
        return Ok(Some(trimmed.to_string()));
    }
    Err(StatusCode::BAD_REQUEST)
}

pub(super) fn normalize_sound_file_name(raw: Option<String>) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > 180 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Some(trimmed.to_string()))
}

pub(super) fn normalize_sound_data_url(raw: Option<String>) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if !trimmed.starts_with("data:audio/") {
        return Err(StatusCode::BAD_REQUEST);
    }
    if trimmed.len() > 3_000_000 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Some(trimmed.to_string()))
}

pub(super) fn normalize_custom_sound_files_json(
    raw: Option<String>,
) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 12_000_000 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let parsed = serde_json::from_str::<Vec<SoundPlaylistEntry>>(trimmed)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    if parsed.is_empty() {
        return Ok(None);
    }
    if parsed.len() > 8 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut normalized: Vec<SoundPlaylistEntry> = Vec::with_capacity(parsed.len());
    for entry in parsed {
        let data_url =
            normalize_sound_data_url(Some(entry.data_url))?.ok_or(StatusCode::BAD_REQUEST)?;
        let id = normalize_sound_file_name(entry.id)?;
        let name = normalize_sound_file_name(entry.name)?;
        normalized.push(SoundPlaylistEntry { id, name, data_url });
    }
    serde_json::to_string(&normalized).map(Some).map_err(|_| StatusCode::BAD_REQUEST)
}

pub(super) fn parse_custom_sound_files_json(raw: &str) -> Option<Vec<SoundPlaylistEntry>> {
    serde_json::from_str::<Vec<SoundPlaylistEntry>>(raw).ok()
}

pub(super) fn normalize_profile_attachments(
    raw: Option<String>,
) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 120_000 {
        return Err(StatusCode::BAD_REQUEST);
    }
    serde_json::from_str::<serde_json::Value>(trimmed).map_err(|_| StatusCode::BAD_REQUEST)?;
    Ok(Some(trimmed.to_string()))
}

pub(super) fn normalize_ui_font(raw: Option<String>) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if UI_FONTS.contains(&trimmed) {
        return Ok(Some(trimmed.to_string()));
    }
    Err(StatusCode::BAD_REQUEST)
}

pub(super) fn normalize_completion_quotes_json(
    raw: Option<String>,
) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 8_000 {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Some(trimmed.to_string()))
}

pub(super) fn normalize_ui_theme(raw: Option<String>) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    if UI_THEMES.contains(&trimmed) {
        return Ok(Some(trimmed.to_string()));
    }
    Err(StatusCode::BAD_REQUEST)
}

pub(super) fn normalize_ui_sidebar_panels(
    raw: Option<String>,
) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 2_000 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let parsed =
        serde_json::from_str::<serde_json::Value>(trimmed).map_err(|_| StatusCode::BAD_REQUEST)?;
    let Some(obj) = parsed.as_object() else {
        return Err(StatusCode::BAD_REQUEST);
    };
    for key in ["lists", "members", "sound", "backups", "account"] {
        if let Some(value) = obj.get(key) {
            if !value.is_boolean() {
                return Err(StatusCode::BAD_REQUEST);
            }
        }
    }
    Ok(Some(trimmed.to_string()))
}

pub(super) fn normalize_ui_list_sort(raw: Option<String>) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 200 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let parsed =
        serde_json::from_str::<serde_json::Value>(trimmed).map_err(|_| StatusCode::BAD_REQUEST)?;
    let Some(obj) = parsed.as_object() else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let mode = obj.get("mode").and_then(|value| value.as_str()).unwrap_or("created");
    let direction = obj.get("direction").and_then(|value| value.as_str()).unwrap_or("asc");
    if !matches!(mode, "created" | "alpha" | "due_date") {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !matches!(direction, "asc" | "desc") {
        return Err(StatusCode::BAD_REQUEST);
    }
    serde_json::to_string(&serde_json::json!({
        "mode": mode,
        "direction": direction,
    }))
    .map(Some)
    .map_err(|_| StatusCode::BAD_REQUEST)
}

pub(super) fn normalize_streak_settings_json(
    raw: Option<String>,
) -> Result<Option<String>, StatusCode> {
    let Some(value) = raw else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 512 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let parsed =
        serde_json::from_str::<serde_json::Value>(trimmed).map_err(|_| StatusCode::BAD_REQUEST)?;
    let Some(obj) = parsed.as_object() else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
    let theme = obj.get("theme").and_then(|v| v.as_str()).unwrap_or("ddr");
    let reset_mode = obj.get("resetMode").and_then(|v| v.as_str()).unwrap_or("daily");
    if !matches!(theme, "ddr" | "thps") {
        return Err(StatusCode::BAD_REQUEST);
    }
    if !matches!(reset_mode, "daily" | "endless") {
        return Err(StatusCode::BAD_REQUEST);
    }
    serde_json::to_string(&serde_json::json!({
        "enabled": enabled,
        "theme": theme,
        "resetMode": reset_mode,
    }))
    .map(Some)
    .map_err(|_| StatusCode::BAD_REQUEST)
}

pub(super) fn is_unique_violation(err: &sqlx::Error) -> bool {
    match err {
        sqlx::Error::Database(db_err) => db_err.message().contains("UNIQUE constraint failed"),
        _ => false,
    }
}

pub(super) fn is_valid_task_status(status: &str) -> bool {
    matches!(status, "pending" | "done" | "cancelled")
}

pub(super) fn normalize_task_priority(raw: Option<i64>) -> Result<Option<i64>, StatusCode> {
    let Some(priority) = raw else {
        return Ok(None);
    };
    if (0..=3).contains(&priority) {
        return Ok(Some(priority));
    }
    Err(StatusCode::BAD_REQUEST)
}
