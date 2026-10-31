use axum::http::{header::AUTHORIZATION, HeaderMap, HeaderName, StatusCode};
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::{
    env,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use super::clock::{validate_tz, Clock, ZONEINFO_DIR};

/// Request header carrying the programmatic API token (F-B). Read by
/// `ctx_from_api_token` only — `ctx_from_headers` never inspects it, and the
/// verifier never inspects `Authorization`. The two auth paths are disjoint
/// by construction.
pub(super) const API_TOKEN_HEADER: HeaderName = HeaderName::from_static("x-tasksync-api-token");

/// Fail-closed minimum length for an operator-configured `TASK_API_TOKEN`.
/// Enforced at boot (`validate_boot_secrets`) when the variable is present;
/// absent is fine (the programmatic API is simply disabled).
pub(super) const API_TOKEN_MIN_LEN: usize = 24;

#[derive(Clone)]
pub(super) struct AppState {
    pub(super) pool: SqlitePool,
    pub(super) jwt_secret: String,
    /// Optional static token for the programmatic task-creation API (F-B).
    /// `None` when `TASK_API_TOKEN` is unset. Scope: create only.
    pub(super) api_token: Option<String>,
    /// Optional static token for the integration API (`TASK_AGENT_TOKEN`).
    /// Scopes: read, complete, create. `None` hides the read/complete routes.
    pub(super) agent_token: Option<String>,
    /// `TASK_API_USER_EMAIL`: the user both API tokens act as. `None` means
    /// the oldest admin membership.
    pub(super) api_user_email: Option<String>,
    pub(super) clock: Clock,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct AuthClaims {
    pub(super) sub: String,
    pub(super) space_id: String,
    pub(super) exp: usize,
    /// Session token_version, re-checked against the user's stored value on
    /// every request (see `ctx_from_headers`). `#[serde(default)]` on an
    /// `i64` deserializes a missing claim as `0`, matching the `user.
    /// token_version` column's `default 0` — pre-existing tokens minted
    /// before this claim existed keep authenticating until a deliberate
    /// bump.
    #[serde(default)]
    pub(super) tv: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Role {
    Admin,
    Contributor,
}

/// One permission an API token can carry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ApiScope {
    Read,
    Complete,
    Create,
}

/// The set of `ApiScope`s a static API token carries. Each configured token
/// maps to one constant here; a new token kind is a new constant, not a new
/// code path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ApiScopes {
    pub(super) read: bool,
    pub(super) complete: bool,
    pub(super) create: bool,
}

impl ApiScopes {
    /// `TASK_API_TOKEN`.
    pub(super) const CREATE_ONLY: Self = ApiScopes { read: false, complete: false, create: true };
    /// `TASK_AGENT_TOKEN`.
    pub(super) const AGENT: Self = ApiScopes { read: true, complete: true, create: true };

    pub(super) fn allows(self, scope: ApiScope) -> bool {
        match scope {
            ApiScope::Read => self.read,
            ApiScope::Complete => self.complete,
            ApiScope::Create => self.create,
        }
    }
}

/// What kind of caller resolved this `RequestCtx`. Carried as
/// defense-in-depth alongside `role`: `scope` distinguishes "a real session"
/// from "a static API token, limited to these scopes", so every integration
/// handler asserts the scope it needs even though the two auth paths already
/// resolve disjoint identities.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum AuthScope {
    Session,
    Api(ApiScopes),
}

impl AuthScope {
    /// True only for an API-token caller whose scopes include `scope`.
    pub(super) fn allows_api(self, scope: ApiScope) -> bool {
        matches!(self, AuthScope::Api(scopes) if scopes.allows(scope))
    }
}

#[derive(Clone, Debug)]
pub(super) struct RequestCtx {
    pub(super) space_id: String,
    pub(super) user_id: String,
    pub(super) role: Role,
    pub(super) scope: AuthScope,
}

pub(super) const JWT_SECRET_DENYLIST: [&str; 2] = ["tasksync-dev-secret", "change-me"];

/// Validates a single secret value against the fail-closed boot policy.
///
/// Pure (no env access) so the full matrix is unit-testable without env-var
/// mutation. Fails on unset, empty/whitespace-only, or an exact match against
/// the known-default denylist; the error names the variable, the reason, and
/// the fix.
fn validate_secret(name: &str, value: Option<String>, denylist: &[&str]) -> Result<String, String> {
    match value {
        None => Err(format!("{name} is unset — set it in .env (see .env.example)")),
        Some(v) if v.trim().is_empty() => {
            Err(format!("{name} is empty — set it in .env (see .env.example)"))
        }
        Some(v) if denylist.contains(&v.as_str()) => Err(format!(
            "{name} is a known default (\"{v}\") — set a real value in .env (see .env.example)"
        )),
        Some(v) => Ok(v),
    }
}

/// Validates an optional `TASK_API_TOKEN` against the fail-closed minimum
/// length. Pure (no env access) so it is unit-testable without env-var
/// mutation, mirroring `validate_secret`. Absent is not an error — the
/// programmatic API is simply disabled; only a *present but too-short* value
/// fails closed.
fn validate_api_token_length(value: Option<&str>) -> Result<(), String> {
    validate_named_token_length("TASK_API_TOKEN", value)
}

/// `validate_api_token_length` for any token variable, so `TASK_AGENT_TOKEN`
/// gets the identical fail-closed minimum.
fn validate_named_token_length(name: &str, value: Option<&str>) -> Result<(), String> {
    match value {
        None => Ok(()),
        Some(v) if v.trim().chars().count() < API_TOKEN_MIN_LEN => Err(format!(
            "{name} is shorter than {API_TOKEN_MIN_LEN} characters — set a longer value in .env (see .env.example) or unset it to disable that API"
        )),
        Some(_) => Ok(()),
    }
}

/// The two API tokens carry different scopes, so they must differ: with equal
/// values a create-only caller would silently gain the agent scopes.
fn validate_distinct_api_tokens(api: Option<&str>, agent: Option<&str>) -> Result<(), String> {
    match (api.map(str::trim), agent.map(str::trim)) {
        (Some(a), Some(b)) if !a.is_empty() && a == b => {
            Err("TASK_AGENT_TOKEN must differ from TASK_API_TOKEN — they carry different scopes"
                .to_string())
        }
        _ => Ok(()),
    }
}

/// Boot preflight: refuses default/placeholder secrets in every run mode.
///
/// Reads `JWT_SECRET` from the environment. Called from `main()` before the
/// database connect; `app_state()` relies on this having passed.
///
/// `DEV_LOGIN_PASSWORD` is deliberately NOT validated here (#047 closure):
/// the shared-fallback login it used to gate no longer exists (auth is
/// hash-only — see `password_matches_for_user`), so mandating it at boot
/// would only block operators over a variable that gates nothing. A stale
/// `DEV_LOGIN_PASSWORD` left in `.env` is simply ignored.
///
/// `TASK_API_TOKEN` (F-B, programmatic task-creation API) is optional — its
/// absence is not a failure, the feature is simply off — but when present it
/// must meet the fail-closed minimum length so a short/guessable value can
/// never reach production.
pub fn validate_boot_secrets() -> Result<(), String> {
    let mut failures: Vec<String> = Vec::new();
    if let Err(message) =
        validate_secret("JWT_SECRET", env::var("JWT_SECRET").ok(), &JWT_SECRET_DENYLIST)
    {
        failures.push(message);
    }
    let api_token = env::var("TASK_API_TOKEN").ok();
    let agent_token = env::var("TASK_AGENT_TOKEN").ok();
    if let Err(message) = validate_api_token_length(api_token.as_deref()) {
        failures.push(message);
    }
    if let Err(message) = validate_named_token_length("TASK_AGENT_TOKEN", agent_token.as_deref()) {
        failures.push(message);
    }
    if let Err(message) = validate_distinct_api_tokens(api_token.as_deref(), agent_token.as_deref())
    {
        failures.push(message);
    }
    match validate_tz(env::var("TZ").ok().as_deref(), Path::new(ZONEINFO_DIR)) {
        Ok(Some(warning)) => tracing::warn!("{warning}"),
        Ok(None) => {}
        Err(message) => failures.push(message),
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("\n"))
    }
}

fn non_empty_env(name: &str) -> Option<String> {
    env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

pub(super) fn app_state(pool: &SqlitePool) -> AppState {
    let api_token = non_empty_env("TASK_API_TOKEN");
    if api_token.is_some() {
        tracing::info!("programmatic task-creation API enabled (TASK_API_TOKEN configured)");
    }
    let agent_token = non_empty_env("TASK_AGENT_TOKEN");
    if agent_token.is_some() {
        tracing::info!("integration API enabled (TASK_AGENT_TOKEN configured)");
    }
    AppState {
        pool: pool.clone(),
        jwt_secret: env::var("JWT_SECRET")
            .expect("JWT_SECRET validated by validate_boot_secrets at boot"),
        api_token,
        agent_token,
        api_user_email: non_empty_env("TASK_API_USER_EMAIL"),
        clock: Clock::default(),
    }
}

/// Resolves the identity both API tokens act as: the user named by
/// `TASK_API_USER_EMAIL` (case-insensitive), or the oldest admin membership
/// when unset. The role comes from that membership, so a contributor's
/// permissions still apply. `Ok(None)` when no membership matches.
pub(super) async fn resolve_api_identity(
    pool: &SqlitePool,
    email: Option<&str>,
) -> Result<Option<(String, String, Role)>, sqlx::Error> {
    let row: Option<(String, String, String)> = match email {
        Some(email) => {
            sqlx::query_as(
                "select m.space_id, m.user_id, m.role from membership m join user u on u.id = m.user_id where lower(u.email) = lower(?1) order by m.rowid asc limit 1",
            )
            .bind(email)
            .fetch_optional(pool)
            .await?
        }
        None => {
            sqlx::query_as(
                "select m.space_id, m.user_id, m.role from membership m where m.role = 'admin' order by m.rowid asc limit 1",
            )
            .fetch_optional(pool)
            .await?
        }
    };
    Ok(row.and_then(|(space_id, user_id, role)| {
        let role = match role.as_str() {
            "admin" => Role::Admin,
            "contributor" => Role::Contributor,
            _ => return None,
        };
        Some((space_id, user_id, role))
    }))
}

/// Post-migration boot check: a configured `TASK_API_USER_EMAIL` must name a
/// member, or every API call would fail at request time instead of at boot.
pub async fn validate_api_identity(pool: &SqlitePool) -> Result<(), String> {
    let Some(email) = non_empty_env("TASK_API_USER_EMAIL") else { return Ok(()) };
    match resolve_api_identity(pool, Some(&email)).await {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(format!(
            "TASK_API_USER_EMAIL=\"{email}\" matches no member — fix it or unset it to act as the oldest admin"
        )),
        Err(err) => Err(format!("could not check TASK_API_USER_EMAIL: {err}")),
    }
}

pub(super) fn unix_now_secs() -> usize {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as usize).unwrap_or(0)
}

pub(super) fn issue_token(
    user_id: &str,
    space_id: &str,
    token_version: i64,
    secret: &str,
) -> Result<String, StatusCode> {
    let claims = AuthClaims {
        sub: user_id.to_string(),
        space_id: space_id.to_string(),
        exp: unix_now_secs() + (60 * 60 * 24 * 30),
        tv: token_version,
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

/// Resolves the caller's role AND current server-side `token_version` in a
/// single joined query (membership JOIN user) — this is the one per-request
/// DB round-trip `ctx_from_headers` performs; the `token_version` revocation
/// check is folded into it rather than adding a second query.
pub(super) async fn resolve_identity(
    pool: &SqlitePool,
    space_id: &str,
    user_id: &str,
) -> Result<(Role, i64), StatusCode> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "select m.role, u.token_version from membership m join user u on u.id = m.user_id where m.space_id = ?1 and m.user_id = ?2 limit 1",
    )
    .bind(space_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    match row {
        Some((role_str, token_version)) => match role_str.as_str() {
            "admin" => Ok((Role::Admin, token_version)),
            "contributor" => Ok((Role::Contributor, token_version)),
            _ => Err(StatusCode::UNAUTHORIZED),
        },
        None => Err(StatusCode::UNAUTHORIZED),
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
            let (role, token_version) =
                resolve_identity(&state.pool, &decoded.claims.space_id, &decoded.claims.sub)
                    .await?;
            if decoded.claims.tv != token_version {
                return Err(StatusCode::UNAUTHORIZED);
            }
            return Ok(RequestCtx {
                space_id: decoded.claims.space_id,
                user_id: decoded.claims.sub,
                role,
                scope: AuthScope::Session,
            });
        }
    }

    Err(StatusCode::UNAUTHORIZED)
}

/// Length-independent equality check for secret comparison.
///
/// Both inputs are first hashed with SHA-256 to fixed-length 32-byte
/// digests, then compared. This means the comparison NEVER short-circuits
/// or panics on a raw length mismatch between the caller-supplied value and
/// the configured secret (a naive `a == b` or `a.as_bytes() == b.as_bytes()`
/// on `&str`/`&[u8]` returns `false` fast for differing lengths, which is a
/// timing side-channel); comparing two same-length digests instead removes
/// that early exit. The final digest-to-digest comparison via `==` is safe
/// precisely because both operands are fixed-length hashes of the secrets,
/// not the variable-length secrets themselves.
pub(super) fn constant_time_eq(a: &str, b: &str) -> bool {
    let digest_a = Sha256::digest(a.as_bytes());
    let digest_b = Sha256::digest(b.as_bytes());
    digest_a == digest_b
}

/// Resolves a `RequestCtx` for the static-token integration API.
///
/// Disjoint from `ctx_from_headers`: this verifier reads ONLY the
/// `X-TaskSync-Api-Token` header and never inspects `Authorization`;
/// `ctx_from_headers` never inspects the API-token header. The matched token
/// fixes the scopes (`TASK_AGENT_TOKEN` → `ApiScopes::AGENT`,
/// `TASK_API_TOKEN` → `ApiScopes::CREATE_ONLY`). A caller presenting a valid
/// token does NOT get to pick an arbitrary `uid`/`space_id` — the identity is
/// resolved server-side by `resolve_api_identity`, without trusting client
/// input.
///
/// Consumed by every handler in `integrations.rs`.
pub(super) async fn ctx_from_api_token(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<RequestCtx, StatusCode> {
    if state.api_token.is_none() && state.agent_token.is_none() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let Some(provided) = headers.get(API_TOKEN_HEADER).and_then(|v| v.to_str().ok()) else {
        return Err(StatusCode::UNAUTHORIZED);
    };
    // Both comparisons always run, so timing does not reveal which token
    // (if any) is configured.
    let matches =
        |configured: Option<&str>| configured.is_some_and(|c| constant_time_eq(provided, c));
    let agent_match = matches(state.agent_token.as_deref());
    let create_match = matches(state.api_token.as_deref());
    let scopes = if agent_match {
        ApiScopes::AGENT
    } else if create_match {
        ApiScopes::CREATE_ONLY
    } else {
        return Err(StatusCode::UNAUTHORIZED);
    };

    let (space_id, user_id, role) =
        resolve_api_identity(&state.pool, state.api_user_email.as_deref())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::UNAUTHORIZED)?;
    Ok(RequestCtx { space_id, user_id, role, scope: AuthScope::Api(scopes) })
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

#[cfg(test)]
mod tests {
    use super::{
        constant_time_eq, validate_api_token_length, validate_secret, JWT_SECRET_DENYLIST,
    };

    // The full fail-closed matrix is tested through the PURE `validate_secret`
    // by passing `Option<String>` values directly — no env-var mutation, which
    // would be racy under parallel test execution.

    #[test]
    fn validate_secret_rejects_unset_value_naming_variable_and_fix() {
        let err = validate_secret("JWT_SECRET", None, &JWT_SECRET_DENYLIST).unwrap_err();
        assert!(err.contains("JWT_SECRET"), "error should name the variable: {err}");
        assert!(err.contains("unset"), "error should state the reason: {err}");
        assert!(err.contains(".env.example"), "error should point at the fix: {err}");
    }

    #[test]
    fn validate_secret_rejects_empty_value() {
        let err =
            validate_secret("JWT_SECRET", Some(String::new()), &JWT_SECRET_DENYLIST).unwrap_err();
        assert!(err.contains("JWT_SECRET"), "error should name the variable: {err}");
        assert!(err.contains("empty"), "error should state the reason: {err}");
    }

    #[test]
    fn validate_secret_rejects_whitespace_only_value() {
        let err = validate_secret("JWT_SECRET", Some("   ".to_string()), &JWT_SECRET_DENYLIST)
            .unwrap_err();
        assert!(err.contains("empty"), "whitespace-only should count as empty: {err}");
    }

    #[test]
    fn validate_secret_rejects_every_denylisted_jwt_secret_literal() {
        for literal in JWT_SECRET_DENYLIST {
            let err =
                validate_secret("JWT_SECRET", Some(literal.to_string()), &JWT_SECRET_DENYLIST)
                    .unwrap_err();
            assert!(err.contains("known default"), "should reject {literal:?}: {err}");
            assert!(err.contains(literal), "error should show the rejected value: {err}");
        }
    }

    #[test]
    fn validate_secret_accepts_a_real_value_and_returns_it_unchanged() {
        let value = validate_secret(
            "JWT_SECRET",
            Some("a-genuinely-random-32-byte-secret".to_string()),
            &JWT_SECRET_DENYLIST,
        )
        .expect("real value should validate");
        assert_eq!(value, "a-genuinely-random-32-byte-secret");
    }

    #[test]
    fn validate_secret_applies_denylists_per_variable_not_globally() {
        // "tasksync" is not in JWT_SECRET_DENYLIST (it was only ever
        // denylisted for the now-removed DEV_LOGIN_PASSWORD variable), so it
        // validates fine here — `validate_secret` checks only the denylist it
        // is given, never a global list.
        let value =
            validate_secret("JWT_SECRET", Some("tasksync".to_string()), &JWT_SECRET_DENYLIST)
                .expect("value outside this variable's denylist should validate");
        assert_eq!(value, "tasksync");
    }

    #[test]
    fn constant_time_eq_returns_true_for_equal_inputs() {
        assert!(constant_time_eq("a-secret-value", "a-secret-value"));
    }

    #[test]
    fn constant_time_eq_returns_false_for_unequal_same_length_inputs() {
        assert!(!constant_time_eq("a-secret-value1", "a-secret-value2"));
    }

    #[test]
    fn constant_time_eq_returns_false_without_panicking_for_differing_lengths() {
        // The whole point of hashing both sides first: a raw byte-slice `==`
        // would short-circuit false immediately on length mismatch (a timing
        // signal) or, with a naive fixed-window compare, could panic/index
        // out of bounds. Hashing first means both sides are always 32 bytes.
        assert!(!constant_time_eq("short", "a-much-longer-secret-value"));
        assert!(!constant_time_eq("a-much-longer-secret-value", "short"));
        assert!(!constant_time_eq("", "a-much-longer-secret-value"));
        assert!(!constant_time_eq("a-much-longer-secret-value", ""));
    }

    #[test]
    fn constant_time_eq_treats_empty_strings_as_equal_to_each_other() {
        assert!(constant_time_eq("", ""));
    }

    #[test]
    fn validate_api_token_length_accepts_absent_value() {
        validate_api_token_length(None).expect("absent TASK_API_TOKEN should not fail closed");
    }

    #[test]
    fn validate_api_token_length_accepts_value_at_minimum_length() {
        let value = "a".repeat(super::API_TOKEN_MIN_LEN);
        validate_api_token_length(Some(&value)).expect(">= minimum length should validate");
    }

    #[test]
    fn validate_api_token_length_rejects_value_shorter_than_minimum() {
        let value = "a".repeat(super::API_TOKEN_MIN_LEN - 1);
        let err = validate_api_token_length(Some(&value)).unwrap_err();
        assert!(err.contains("TASK_API_TOKEN"), "error should name the variable: {err}");
        assert!(err.contains("24"), "error should state the minimum length: {err}");
    }
}
