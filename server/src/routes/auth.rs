use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

use super::types::{
    app_state, ctx_from_headers, hash_password, is_unique_violation, is_valid_task_status,
    normalize_avatar_icon, normalize_completion_quotes_json, normalize_custom_sound_files_json,
    normalize_profile_attachments, normalize_sound_data_url, normalize_sound_file_name,
    normalize_sound_theme, normalize_streak_settings_json, normalize_ui_font,
    normalize_ui_list_sort, normalize_ui_sidebar_panels, normalize_ui_theme,
    parse_custom_sound_files_json, password_meets_policy, unix_now_secs, verify_password, AppState,
    Role, BACKUP_SCHEMA_V1, SOUND_THEMES,
};

#[derive(Deserialize)]
pub(super) struct LoginBody {
    pub(super) email: String,
    pub(super) password: String,
    pub(super) space_id: Option<String>,
}

#[derive(Serialize, FromRow)]
pub(super) struct LoginUserRow {
    pub(super) user_id: String,
    pub(super) email: String,
    pub(super) display: String,
    pub(super) avatar_icon: Option<String>,
    pub(super) password_hash: Option<String>,
    pub(super) role: String,
    pub(super) token_version: i64,
}

#[derive(Serialize)]
pub(super) struct LoginResponse {
    pub(super) token: String,
    pub(super) user_id: String,
    pub(super) email: String,
    pub(super) display: String,
    pub(super) avatar_icon: Option<String>,
    pub(super) space_id: String,
    pub(super) role: String,
}

/// Shared response shape for endpoints that re-issue a fresh session token
/// for the acting device (revoke-sessions, self change-password).
#[derive(Serialize)]
pub(super) struct TokenResponse {
    pub(super) token: String,
}

/// Response for the unauthenticated first-run status check
/// (`GET /auth/status`): `true` iff an `admin` membership already exists
/// anywhere in the deployment, which is what the client uses to decide
/// between rendering first-run setup vs. the login screen.
#[derive(Serialize)]
pub(super) struct AuthStatusResponse {
    pub(super) owner_exists: bool,
}

/// Request body for the unauthenticated, self-guarded first-run owner
/// provisioning endpoint (`POST /auth/setup`).
#[derive(Deserialize)]
pub(super) struct AuthSetupBody {
    pub(super) email: String,
    pub(super) display: String,
    pub(super) password: String,
    pub(super) avatar_icon: Option<String>,
    pub(super) space_id: Option<String>,
}

#[derive(Serialize, FromRow)]
pub(super) struct AuthMeResponse {
    pub(super) user_id: String,
    pub(super) email: String,
    pub(super) display: String,
    pub(super) avatar_icon: Option<String>,
    pub(super) space_id: String,
    pub(super) role: String,
}

#[derive(Serialize, FromRow)]
pub(super) struct AuthMemberResponse {
    pub(super) user_id: String,
    pub(super) email: String,
    pub(super) display: String,
    pub(super) avatar_icon: Option<String>,
    pub(super) space_id: String,
    pub(super) role: String,
}

#[derive(Deserialize)]
pub(super) struct UpdateProfileBody {
    pub(super) display: Option<String>,
    pub(super) avatar_icon: Option<String>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub(super) struct SoundSettingsResponse {
    pub(super) enabled: bool,
    pub(super) volume: i64,
    pub(super) theme: String,
    pub(super) custom_sound_file_id: Option<String>,
    pub(super) custom_sound_file_name: Option<String>,
    pub(super) custom_sound_data_url: Option<String>,
    pub(super) custom_sound_files_json: Option<String>,
    pub(super) profile_attachments_json: Option<String>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub(super) struct UiPreferencesResponse {
    pub(super) theme: String,
    pub(super) font: Option<String>,
    pub(super) completion_quotes_json: Option<String>,
    pub(super) sidebar_panels_json: Option<String>,
    pub(super) list_sort_json: Option<String>,
    pub(super) streak_settings_json: Option<String>,
    pub(super) streak_state_json: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UpdateSoundSettingsBody {
    pub(super) enabled: Option<bool>,
    pub(super) volume: Option<i64>,
    pub(super) theme: Option<String>,
    pub(super) custom_sound_file_id: Option<String>,
    pub(super) custom_sound_file_name: Option<String>,
    pub(super) custom_sound_data_url: Option<String>,
    pub(super) custom_sound_files_json: Option<String>,
    pub(super) profile_attachments_json: Option<String>,
    pub(super) clear_custom_sound: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UpdateUiPreferencesBody {
    pub(super) theme: Option<String>,
    pub(super) font: Option<String>,
    pub(super) completion_quotes_json: Option<String>,
    pub(super) sidebar_panels_json: Option<String>,
    pub(super) list_sort_json: Option<String>,
    pub(super) streak_settings_json: Option<String>,
    pub(super) streak_state_json: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, FromRow)]
pub(super) struct BackupSpaceRow {
    pub(super) id: String,
    pub(super) name: String,
}

#[derive(Clone, Serialize, Deserialize, FromRow)]
pub(super) struct BackupUserRow {
    pub(super) id: String,
    pub(super) email: String,
    pub(super) display: String,
    pub(super) avatar_icon: Option<String>,
    pub(super) password_hash: Option<String>,
    pub(super) sound_enabled: bool,
    pub(super) sound_volume: i64,
    pub(super) sound_theme: String,
    pub(super) custom_sound_file_id: Option<String>,
    pub(super) custom_sound_file_name: Option<String>,
    pub(super) custom_sound_data_url: Option<String>,
    pub(super) custom_sound_files_json: Option<String>,
    pub(super) profile_attachments: Option<String>,
    pub(super) ui_theme: Option<String>,
    pub(super) ui_sidebar_panels: Option<String>,
    pub(super) ui_list_sort: Option<String>,
    pub(super) ui_font: Option<String>,
    pub(super) ui_completion_quotes: Option<String>,
    pub(super) streak_settings_json: Option<String>,
    pub(super) streak_state_json: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, FromRow)]
pub(super) struct BackupMembershipRow {
    pub(super) id: String,
    pub(super) space_id: String,
    pub(super) user_id: String,
    pub(super) role: String,
}

#[derive(Clone, Serialize, Deserialize, FromRow)]
pub(super) struct BackupListRow {
    pub(super) id: String,
    pub(super) space_id: String,
    pub(super) name: String,
    pub(super) icon: Option<String>,
    pub(super) color: Option<String>,
    pub(super) list_order: String,
}

#[derive(Clone, Serialize, Deserialize, FromRow)]
pub(super) struct BackupListGrantRow {
    pub(super) id: String,
    pub(super) space_id: String,
    pub(super) list_id: String,
    pub(super) user_id: String,
}

#[derive(Clone, Serialize, Deserialize, FromRow)]
pub(super) struct BackupTaskRow {
    pub(super) id: String,
    pub(super) space_id: String,
    pub(super) title: String,
    pub(super) status: String,
    pub(super) list_id: String,
    pub(super) my_day: i64,
    pub(super) priority: i64,
    pub(super) task_order: String,
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

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct SpaceBackupBundle {
    pub(super) schema: String,
    pub(super) exported_at_ts: i64,
    pub(super) space: BackupSpaceRow,
    pub(super) users: Vec<BackupUserRow>,
    pub(super) memberships: Vec<BackupMembershipRow>,
    pub(super) lists: Vec<BackupListRow>,
    pub(super) list_grants: Vec<BackupListGrantRow>,
    pub(super) tasks: Vec<BackupTaskRow>,
}

#[derive(Serialize)]
pub(super) struct RestoreBackupResponse {
    pub(super) restored_at_ts: i64,
    pub(super) space_id: String,
    pub(super) users: i64,
    pub(super) memberships: i64,
    pub(super) lists: i64,
    pub(super) list_grants: i64,
    pub(super) tasks: i64,
}

#[derive(Deserialize)]
pub(super) struct ChangePasswordBody {
    pub(super) current_password: String,
    pub(super) new_password: String,
}

#[derive(Deserialize)]
pub(super) struct CreateMemberBody {
    pub(super) email: String,
    pub(super) display: String,
    pub(super) role: String,
    pub(super) password: String,
    pub(super) avatar_icon: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct SetMemberPasswordBody {
    pub(super) password: String,
}

#[derive(Serialize, FromRow)]
pub(super) struct ListGrantResponse {
    pub(super) user_id: String,
    pub(super) list_id: String,
}

#[derive(Deserialize)]
pub(super) struct SetListGrantBody {
    pub(super) user_id: String,
    pub(super) list_id: String,
    pub(super) granted: bool,
}

pub(super) async fn password_matches_for_user(
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
    // Hash-only auth (#047): a missing/blank hash has NO valid login path.
    // There is deliberately no shared-fallback comparison here anymore —
    // first-run setup (`auth_setup`) and the admin `auth_set_member_password`
    // flow are the only ways a user ever gets a usable password.
    Ok(false)
}

pub(super) async fn login(
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
        "select u.id as user_id, u.email, u.display, u.avatar_icon, u.password_hash, m.role, u.token_version from user u join membership m on m.user_id = u.id where lower(u.email) = lower(?1) and m.space_id = ?2 limit 1",
    )
    .bind(email)
    .bind(&space_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    let password_ok = password_matches_for_user(&state, &user.user_id, password).await?;
    if !password_ok {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token =
        super::types::issue_token(&user.user_id, &space_id, user.token_version, &state.jwt_secret)?;
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

/// Unauthenticated first-run status check. Deliberately does NOT call
/// `ctx_from_headers` — that absence is what keeps this route reachable
/// pre-auth (there is no separate middleware allowlist; each pre-auth route
/// is simply a handler that never funnels through the auth boundary).
pub(super) async fn auth_status(
    State(state): State<AppState>,
) -> Result<Json<AuthStatusResponse>, StatusCode> {
    let owner_exists: bool =
        sqlx::query_scalar("select exists(select 1 from membership where role = 'admin')")
            .fetch_one(&state.pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(AuthStatusResponse { owner_exists }))
}

/// Unauthenticated, self-guarded first-run owner provisioning. Deliberately
/// does NOT call `ctx_from_headers` (see `auth_status`).
///
/// Concurrency-safe by construction: the password is hashed BEFORE opening
/// the transaction (bcrypt is expensive; doing it first keeps the guarded
/// critical section short and guarantees a hashing failure never leaves a
/// half-created owner), then a single transaction re-runs the admin-exists
/// guard and performs the space/user/membership inserts. Re-checking the
/// guard *inside* the same transaction that does the inserts is what
/// prevents two concurrent `/setup` calls from both winning the race — the
/// loser's transaction rolls back (on `Err` the `Transaction` is dropped
/// without `commit()`, which issues a `ROLLBACK`) and observes `409`.
pub(super) async fn auth_setup(
    State(state): State<AppState>,
    Json(body): Json<AuthSetupBody>,
) -> Result<(StatusCode, Json<LoginResponse>), StatusCode> {
    let email = body.email.trim().to_lowercase();
    let display = body.display.trim().to_string();
    let password = body.password.trim();
    if email.is_empty() || display.is_empty() || !password_meets_policy(password) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let space_id = match body.space_id {
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(StatusCode::BAD_REQUEST);
            }
            trimmed.to_string()
        }
        None => "s1".to_string(),
    };
    let avatar_icon = normalize_avatar_icon(body.avatar_icon);

    let password_hash = hash_password(password)?;

    let mut tx = state.pool.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let owner_exists: bool =
        sqlx::query_scalar("select exists(select 1 from membership where role = 'admin')")
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if owner_exists {
        return Err(StatusCode::CONFLICT);
    }

    sqlx::query("insert into space (id, name) values (?1, ?2) on conflict(id) do nothing")
        .bind(&space_id)
        .bind("Default")
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_id = format!("u-{}", Uuid::new_v4());
    let insert_user_res = sqlx::query(
        "insert into user (id, email, display, avatar_icon, password_hash) values (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&display)
    .bind(&avatar_icon)
    .bind(&password_hash)
    .execute(&mut *tx)
    .await;
    if let Err(err) = insert_user_res {
        if is_unique_violation(&err) {
            return Err(StatusCode::CONFLICT);
        }
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let membership_id = format!("m-{}", Uuid::new_v4());
    sqlx::query(
        "insert into membership (id, space_id, user_id, role) values (?1, ?2, ?3, 'admin')",
    )
    .bind(membership_id)
    .bind(&space_id)
    .bind(&user_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // token_version starts at the `user.token_version` column default (0).
    let token = super::types::issue_token(&user_id, &space_id, 0, &state.jwt_secret)?;
    Ok((
        StatusCode::CREATED,
        Json(LoginResponse {
            token,
            user_id,
            email,
            display,
            avatar_icon,
            space_id,
            role: "admin".to_string(),
        }),
    ))
}

pub(super) async fn auth_me(
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

pub(super) async fn auth_update_me(
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

pub(super) async fn load_sound_settings_for_user(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<SoundSettingsResponse, StatusCode> {
    sqlx::query_as::<_, SoundSettingsResponse>(
        "select coalesce(sound_enabled, 1) as enabled, coalesce(sound_volume, 60) as volume, coalesce(sound_theme, 'chime_soft') as theme, custom_sound_file_id, custom_sound_file_name, custom_sound_data_url, custom_sound_files_json, profile_attachments as profile_attachments_json from user where id = ?1 limit 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)
}

pub(super) async fn auth_get_sound(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SoundSettingsResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let settings = load_sound_settings_for_user(&state.pool, &ctx.user_id).await?;
    Ok(Json(settings))
}

pub(super) async fn auth_update_sound(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateSoundSettingsBody>,
) -> Result<Json<SoundSettingsResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let current = load_sound_settings_for_user(&state.pool, &ctx.user_id).await?;

    let clear_custom_sound = body.clear_custom_sound.unwrap_or(false);
    let has_custom_sound_file_id = body.custom_sound_file_id.is_some();
    let has_custom_sound_file_name = body.custom_sound_file_name.is_some();
    let has_custom_sound_data_url = body.custom_sound_data_url.is_some();
    let has_custom_sound_files_json = body.custom_sound_files_json.is_some();
    let has_profile_attachments_json = body.profile_attachments_json.is_some();
    let next_enabled = body.enabled.unwrap_or(current.enabled);
    let next_volume =
        body.volume.map(|value| value.clamp(0, 100)).unwrap_or(current.volume.clamp(0, 100));
    let next_theme = normalize_sound_theme(body.theme)?.unwrap_or(current.theme);

    let next_custom_sound_file_id = if clear_custom_sound {
        None
    } else if has_custom_sound_file_id {
        normalize_sound_file_name(body.custom_sound_file_id)?
    } else {
        current.custom_sound_file_id
    };
    let next_custom_sound_file_name = if clear_custom_sound {
        None
    } else if has_custom_sound_file_name {
        normalize_sound_file_name(body.custom_sound_file_name)?
    } else {
        current.custom_sound_file_name
    };
    let next_custom_sound_data_url = if clear_custom_sound {
        None
    } else if has_custom_sound_data_url {
        normalize_sound_data_url(body.custom_sound_data_url)?
    } else {
        current.custom_sound_data_url
    };
    let next_custom_sound_files_json = if clear_custom_sound {
        None
    } else if has_custom_sound_files_json {
        normalize_custom_sound_files_json(body.custom_sound_files_json)?
    } else {
        current.custom_sound_files_json
    };
    let first_playlist_sound = next_custom_sound_files_json
        .as_ref()
        .and_then(|raw| parse_custom_sound_files_json(raw))
        .and_then(|entries| entries.into_iter().next());
    let next_custom_sound_data_url = if has_custom_sound_data_url || clear_custom_sound {
        next_custom_sound_data_url
    } else {
        first_playlist_sound
            .as_ref()
            .map(|entry| entry.data_url.clone())
            .or(next_custom_sound_data_url)
    };
    let next_custom_sound_file_name = if has_custom_sound_file_name || clear_custom_sound {
        next_custom_sound_file_name
    } else {
        first_playlist_sound
            .as_ref()
            .and_then(|entry| entry.name.clone())
            .or(next_custom_sound_file_name)
    };
    let next_custom_sound_file_id = if has_custom_sound_file_id || clear_custom_sound {
        next_custom_sound_file_id
    } else {
        first_playlist_sound
            .as_ref()
            .and_then(|entry| entry.id.clone())
            .or(next_custom_sound_file_id)
    };
    let next_profile_attachments_json = if has_profile_attachments_json {
        normalize_profile_attachments(body.profile_attachments_json)?
    } else {
        current.profile_attachments_json
    };

    sqlx::query(
        "update user set sound_enabled = ?1, sound_volume = ?2, sound_theme = ?3, custom_sound_file_id = ?4, custom_sound_file_name = ?5, custom_sound_data_url = ?6, custom_sound_files_json = ?7, profile_attachments = ?8 where id = ?9",
    )
    .bind(next_enabled)
    .bind(next_volume)
    .bind(&next_theme)
    .bind(&next_custom_sound_file_id)
    .bind(&next_custom_sound_file_name)
    .bind(&next_custom_sound_data_url)
    .bind(&next_custom_sound_files_json)
    .bind(&next_profile_attachments_json)
    .bind(&ctx.user_id)
    .execute(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let updated = load_sound_settings_for_user(&state.pool, &ctx.user_id).await?;
    Ok(Json(updated))
}

pub(super) async fn load_ui_preferences_for_user(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<UiPreferencesResponse, StatusCode> {
    sqlx::query_as::<_, UiPreferencesResponse>(
        "select coalesce(ui_theme, 'default') as theme, ui_font as font, ui_completion_quotes as completion_quotes_json, ui_sidebar_panels as sidebar_panels_json, ui_list_sort as list_sort_json, streak_settings_json, streak_state_json from user where id = ?1 limit 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)
}

pub(super) async fn auth_get_preferences(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UiPreferencesResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let preferences = load_ui_preferences_for_user(&state.pool, &ctx.user_id).await?;
    Ok(Json(preferences))
}

pub(super) async fn auth_update_preferences(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateUiPreferencesBody>,
) -> Result<Json<UiPreferencesResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let current = load_ui_preferences_for_user(&state.pool, &ctx.user_id).await?;

    let next_theme = normalize_ui_theme(body.theme)?.unwrap_or_else(|| current.theme.clone());
    let next_font = if body.font.is_some() { normalize_ui_font(body.font)? } else { current.font };
    let next_completion_quotes_json = if body.completion_quotes_json.is_some() {
        normalize_completion_quotes_json(body.completion_quotes_json)?
    } else {
        current.completion_quotes_json
    };
    let next_sidebar_panels_json = if body.sidebar_panels_json.is_some() {
        normalize_ui_sidebar_panels(body.sidebar_panels_json)?
    } else {
        current.sidebar_panels_json
    };
    let next_list_sort_json = if body.list_sort_json.is_some() {
        normalize_ui_list_sort(body.list_sort_json)?
    } else {
        current.list_sort_json
    };
    let next_streak_settings_json = if body.streak_settings_json.is_some() {
        normalize_streak_settings_json(body.streak_settings_json)?
    } else {
        current.streak_settings_json
    };
    let next_streak_state_json = if body.streak_state_json.is_some() {
        body.streak_state_json
    } else {
        current.streak_state_json
    };

    sqlx::query(
        "update user set ui_theme = ?1, ui_sidebar_panels = ?2, ui_list_sort = ?3, ui_font = ?4, ui_completion_quotes = ?5, streak_settings_json = ?6, streak_state_json = ?7 where id = ?8",
    )
    .bind(&next_theme)
    .bind(&next_sidebar_panels_json)
    .bind(&next_list_sort_json)
    .bind(&next_font)
    .bind(&next_completion_quotes_json)
    .bind(&next_streak_settings_json)
    .bind(&next_streak_state_json)
    .bind(&ctx.user_id)
    .execute(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let updated = load_ui_preferences_for_user(&state.pool, &ctx.user_id).await?;
    Ok(Json(updated))
}

pub(super) async fn load_space_backup(
    pool: &SqlitePool,
    space_id: &str,
) -> Result<SpaceBackupBundle, StatusCode> {
    let space =
        sqlx::query_as::<_, BackupSpaceRow>("select id, name from space where id = ?1 limit 1")
            .bind(space_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::NOT_FOUND)?;

    let users = sqlx::query_as::<_, BackupUserRow>(
        "select u.id, u.email, u.display, u.avatar_icon, u.password_hash, coalesce(u.sound_enabled, 1) as sound_enabled, coalesce(u.sound_volume, 60) as sound_volume, coalesce(u.sound_theme, 'chime_soft') as sound_theme, u.custom_sound_file_id, u.custom_sound_file_name, u.custom_sound_data_url, u.custom_sound_files_json, u.profile_attachments, u.ui_theme, u.ui_sidebar_panels, u.ui_list_sort, u.ui_font, u.ui_completion_quotes, u.streak_settings_json, u.streak_state_json from user u join membership m on m.user_id = u.id where m.space_id = ?1 order by u.id asc",
    )
    .bind(space_id)
    .fetch_all(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let memberships = sqlx::query_as::<_, BackupMembershipRow>(
        "select id, space_id, user_id, role from membership where space_id = ?1 order by id asc",
    )
    .bind(space_id)
    .fetch_all(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let lists = sqlx::query_as::<_, BackupListRow>(
        "select id, space_id, name, icon, color, list_order from list where space_id = ?1 order by list_order asc",
    )
    .bind(space_id)
    .fetch_all(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let list_grants = sqlx::query_as::<_, BackupListGrantRow>(
        "select id, space_id, list_id, user_id from list_grant where space_id = ?1 order by id asc",
    )
    .bind(space_id)
    .fetch_all(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let tasks = sqlx::query_as::<_, BackupTaskRow>(
        "select id, space_id, title, status, list_id, my_day, priority, task_order, updated_ts, created_ts, url, recur_rule, due_date, punted_from_due_date, punted_on_date, occurrences_completed, completed_ts, notes, assignee_user_id, created_by_user_id from task where space_id = ?1 order by task_order asc",
    )
    .bind(space_id)
    .fetch_all(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(SpaceBackupBundle {
        schema: BACKUP_SCHEMA_V1.to_string(),
        exported_at_ts: unix_now_secs() as i64,
        space,
        users,
        memberships,
        lists,
        list_grants,
        tasks,
    })
}

pub(super) async fn auth_export_backup(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SpaceBackupBundle>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    let backup = load_space_backup(&state.pool, &ctx.space_id).await?;
    Ok(Json(backup))
}

pub(super) async fn auth_restore_backup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SpaceBackupBundle>,
) -> Result<Json<RestoreBackupResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    if body.schema != BACKUP_SCHEMA_V1 {
        return Err(StatusCode::BAD_REQUEST);
    }
    if body.space.id.trim().is_empty() || body.space.id != ctx.space_id {
        return Err(StatusCode::BAD_REQUEST);
    }

    let has_admin_actor = body.memberships.iter().any(|membership| {
        membership.space_id == ctx.space_id
            && membership.user_id == ctx.user_id
            && membership.role == "admin"
    });
    if !has_admin_actor {
        return Err(StatusCode::BAD_REQUEST);
    }

    for user in &body.users {
        if user.id.trim().is_empty()
            || user.email.trim().is_empty()
            || user.display.trim().is_empty()
            || user.sound_volume < 0
            || user.sound_volume > 100
            || !SOUND_THEMES.contains(&user.sound_theme.as_str())
            || normalize_custom_sound_files_json(user.custom_sound_files_json.clone()).is_err()
            || normalize_ui_theme(user.ui_theme.clone()).is_err()
            || normalize_ui_sidebar_panels(user.ui_sidebar_panels.clone()).is_err()
            || normalize_ui_list_sort(user.ui_list_sort.clone()).is_err()
            || normalize_ui_font(user.ui_font.clone()).is_err()
            || normalize_completion_quotes_json(user.ui_completion_quotes.clone()).is_err()
            || normalize_streak_settings_json(user.streak_settings_json.clone()).is_err()
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    for membership in &body.memberships {
        if membership.space_id != ctx.space_id
            || membership.user_id.trim().is_empty()
            || membership.id.trim().is_empty()
            || !(membership.role == "admin" || membership.role == "contributor")
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    for list in &body.lists {
        if list.space_id != ctx.space_id || list.id.trim().is_empty() || list.name.trim().is_empty()
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    for grant in &body.list_grants {
        if grant.space_id != ctx.space_id
            || grant.id.trim().is_empty()
            || grant.list_id.trim().is_empty()
            || grant.user_id.trim().is_empty()
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    for task in &body.tasks {
        if task.space_id != ctx.space_id
            || task.id.trim().is_empty()
            || task.list_id.trim().is_empty()
            || task.title.trim().is_empty()
            || !is_valid_task_status(&task.status)
            || !(0..=3).contains(&task.priority)
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let mut tx = state.pool.begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query("insert into space (id, name) values (?1, ?2) on conflict(id) do update set name = excluded.name")
        .bind(&body.space.id)
        .bind(&body.space.name)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    for user in &body.users {
        let next_ui_theme = normalize_ui_theme(user.ui_theme.clone())
            .map_err(|_| StatusCode::BAD_REQUEST)?
            .unwrap_or_else(|| "default".to_string());
        let next_ui_sidebar_panels = normalize_ui_sidebar_panels(user.ui_sidebar_panels.clone())
            .map_err(|_| StatusCode::BAD_REQUEST)?;
        let next_ui_list_sort = normalize_ui_list_sort(user.ui_list_sort.clone())
            .map_err(|_| StatusCode::BAD_REQUEST)?;
        let next_ui_font =
            normalize_ui_font(user.ui_font.clone()).map_err(|_| StatusCode::BAD_REQUEST)?;
        let next_ui_completion_quotes =
            normalize_completion_quotes_json(user.ui_completion_quotes.clone())
                .map_err(|_| StatusCode::BAD_REQUEST)?;
        let next_custom_sound_files_json =
            normalize_custom_sound_files_json(user.custom_sound_files_json.clone())
                .map_err(|_| StatusCode::BAD_REQUEST)?;
        let next_streak_settings_json =
            normalize_streak_settings_json(user.streak_settings_json.clone())
                .map_err(|_| StatusCode::BAD_REQUEST)?;
        sqlx::query(
            "insert into user (id, email, display, avatar_icon, password_hash, sound_enabled, sound_volume, sound_theme, custom_sound_file_id, custom_sound_file_name, custom_sound_data_url, custom_sound_files_json, profile_attachments, ui_theme, ui_sidebar_panels, ui_list_sort, ui_font, ui_completion_quotes, streak_settings_json, streak_state_json) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20) on conflict(id) do update set email = excluded.email, display = excluded.display, avatar_icon = excluded.avatar_icon, password_hash = excluded.password_hash, sound_enabled = excluded.sound_enabled, sound_volume = excluded.sound_volume, sound_theme = excluded.sound_theme, custom_sound_file_id = excluded.custom_sound_file_id, custom_sound_file_name = excluded.custom_sound_file_name, custom_sound_data_url = excluded.custom_sound_data_url, custom_sound_files_json = excluded.custom_sound_files_json, profile_attachments = excluded.profile_attachments, ui_theme = excluded.ui_theme, ui_sidebar_panels = excluded.ui_sidebar_panels, ui_list_sort = excluded.ui_list_sort, ui_font = excluded.ui_font, ui_completion_quotes = excluded.ui_completion_quotes, streak_settings_json = excluded.streak_settings_json, streak_state_json = excluded.streak_state_json",
        )
        .bind(&user.id)
        .bind(&user.email)
        .bind(&user.display)
        .bind(&user.avatar_icon)
        .bind(&user.password_hash)
        .bind(user.sound_enabled)
        .bind(user.sound_volume)
        .bind(&user.sound_theme)
        .bind(&user.custom_sound_file_id)
        .bind(&user.custom_sound_file_name)
        .bind(&user.custom_sound_data_url)
        .bind(&next_custom_sound_files_json)
        .bind(&user.profile_attachments)
        .bind(&next_ui_theme)
        .bind(&next_ui_sidebar_panels)
        .bind(&next_ui_list_sort)
        .bind(&next_ui_font)
        .bind(&next_ui_completion_quotes)
        .bind(&next_streak_settings_json)
        .bind(&user.streak_state_json)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    sqlx::query("delete from task where space_id = ?1")
        .bind(&ctx.space_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("delete from task_tombstone where space_id = ?1")
        .bind(&ctx.space_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("delete from list_grant where space_id = ?1")
        .bind(&ctx.space_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("delete from list where space_id = ?1")
        .bind(&ctx.space_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("delete from membership where space_id = ?1")
        .bind(&ctx.space_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    for membership in &body.memberships {
        sqlx::query("insert into membership (id, space_id, user_id, role) values (?1, ?2, ?3, ?4)")
            .bind(&membership.id)
            .bind(&membership.space_id)
            .bind(&membership.user_id)
            .bind(&membership.role)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    for list in &body.lists {
        sqlx::query(
            "insert into list (id, space_id, name, icon, color, list_order) values (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&list.id)
        .bind(&list.space_id)
        .bind(&list.name)
        .bind(&list.icon)
        .bind(&list.color)
        .bind(&list.list_order)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    for grant in &body.list_grants {
        sqlx::query(
            "insert into list_grant (id, space_id, list_id, user_id) values (?1, ?2, ?3, ?4)",
        )
        .bind(&grant.id)
        .bind(&grant.space_id)
        .bind(&grant.list_id)
        .bind(&grant.user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    for task in &body.tasks {
        sqlx::query(
            "insert into task (id, space_id, title, status, list_id, my_day, priority, task_order, updated_ts, created_ts, url, recur_rule, due_date, punted_from_due_date, punted_on_date, occurrences_completed, completed_ts, notes, assignee_user_id, created_by_user_id) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        )
        .bind(&task.id)
        .bind(&task.space_id)
        .bind(&task.title)
        .bind(&task.status)
        .bind(&task.list_id)
        .bind(task.my_day)
        .bind(task.priority)
        .bind(&task.task_order)
        .bind(task.updated_ts)
        .bind(task.created_ts)
        .bind(&task.url)
        .bind(&task.recur_rule)
        .bind(&task.due_date)
        .bind(&task.punted_from_due_date)
        .bind(&task.punted_on_date)
        .bind(task.occurrences_completed)
        .bind(task.completed_ts)
        .bind(&task.notes)
        .bind(&task.assignee_user_id)
        .bind(&task.created_by_user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(RestoreBackupResponse {
        restored_at_ts: unix_now_secs() as i64,
        space_id: ctx.space_id,
        users: body.users.len() as i64,
        memberships: body.memberships.len() as i64,
        lists: body.lists.len() as i64,
        list_grants: body.list_grants.len() as i64,
        tasks: body.tasks.len() as i64,
    }))
}

pub(super) async fn auth_change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChangePasswordBody>,
) -> Result<Json<TokenResponse>, StatusCode> {
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
    // Write the new hash and bump the caller's own token_version in one
    // statement so both changes are atomic — a partial write can never
    // leave a fresh hash paired with a stale, still-valid token_version.
    // Bumping revokes every OTHER previously-issued session for this user;
    // the acting device stays logged in via the freshly re-issued token
    // below (returning token_version avoids a second round-trip).
    let new_token_version: i64 = sqlx::query_scalar(
        "update user set password_hash = ?1, token_version = token_version + 1 where id = ?2 returning token_version",
    )
    .bind(new_password_hash)
    .bind(&ctx.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let token = super::types::issue_token(
        &ctx.user_id,
        &ctx.space_id,
        new_token_version,
        &state.jwt_secret,
    )?;
    Ok(Json(TokenResponse { token }))
}

/// Self-service "sign out everywhere": bumps the caller's own token_version,
/// which revokes every previously-issued session for this user on their next
/// server contact (per the `ctx_from_headers` tv-vs-token_version check). The
/// acting device stays logged in via a freshly re-issued token in the
/// response so it does not immediately lock itself out.
pub(super) async fn auth_revoke_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<TokenResponse>, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    let new_token_version: i64 = sqlx::query_scalar(
        "update user set token_version = token_version + 1 where id = ?1 returning token_version",
    )
    .bind(&ctx.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let token = super::types::issue_token(
        &ctx.user_id,
        &ctx.space_id,
        new_token_version,
        &state.jwt_secret,
    )?;
    Ok(Json(TokenResponse { token }))
}

pub(super) async fn auth_members(
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

pub(super) async fn auth_create_member(
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

pub(super) async fn auth_delete_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let ctx = ctx_from_headers(&headers, &state).await?;
    if ctx.role != Role::Admin {
        return Err(StatusCode::FORBIDDEN);
    }
    if user_id == ctx.user_id {
        return Err(StatusCode::BAD_REQUEST);
    }

    let member_role: Option<String> = sqlx::query_scalar(
        "select role from membership where space_id = ?1 and user_id = ?2 limit 1",
    )
    .bind(&ctx.space_id)
    .bind(&user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let Some(member_role) = member_role else {
        return Err(StatusCode::NOT_FOUND);
    };

    if member_role == "admin" {
        let admin_count: i64 = sqlx::query_scalar(
            "select count(1) from membership where space_id = ?1 and role = 'admin'",
        )
        .bind(&ctx.space_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if admin_count <= 1 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    sqlx::query("delete from list_grant where space_id = ?1 and user_id = ?2")
        .bind(&ctx.space_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result = sqlx::query("delete from membership where space_id = ?1 and user_id = ?2")
        .bind(&ctx.space_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn auth_set_member_password(
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
    // Write the target's new hash and bump the TARGET's token_version in one
    // statement — atomic, and keyed on the path `user_id`, NOT `ctx.user_id`,
    // so the acting admin's own session (and token_version) is left
    // untouched while every other session the target held is revoked.
    sqlx::query(
        "update user set password_hash = ?1, token_version = token_version + 1 where id = ?2",
    )
    .bind(password_hash)
    .bind(&user_id)
    .execute(&state.pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn auth_grants(
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

pub(super) async fn auth_set_grant(
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

pub fn auth_routes(pool: &sqlx::SqlitePool) -> Router {
    let state = app_state(pool);
    Router::new()
        .route("/login", post(login))
        .route("/status", get(auth_status))
        .route("/setup", post(auth_setup))
        .route("/me", get(auth_me).patch(auth_update_me))
        .route("/sound", get(auth_get_sound).patch(auth_update_sound))
        .route("/preferences", get(auth_get_preferences).patch(auth_update_preferences))
        .route("/backup", get(auth_export_backup).post(auth_restore_backup))
        .route("/password", patch(auth_change_password))
        .route("/revoke-sessions", post(auth_revoke_sessions))
        .route("/members", get(auth_members).post(auth_create_member))
        .route("/members/:user_id", delete(auth_delete_member))
        .route("/members/:user_id/password", patch(auth_set_member_password))
        .route("/grants", get(auth_grants).put(auth_set_grant))
        .with_state(state)
}
