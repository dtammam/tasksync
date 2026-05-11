use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use super::types::{ctx_from_headers, AppState};

// ---------------------------------------------------------------------------
// Wire types (camelCase — must match shared/types/streak.ts exactly)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreakOpRequestBody {
    pub(super) op_key: String,
    pub(super) kind: String,     // 'increment'|'break'|'day_complete'|'reset'
    pub(super) occurred_at: i64, // ms epoch from client (advisory only)
    #[serde(default)]
    pub(super) cause: Option<String>, // 'punt'|'skip'|'delete'|'manual', only when kind=='break'
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreakOpResponseBody {
    pub(super) revision: i64,
    pub(super) count: i64,
    pub(super) last_reset_date: String, // ISO YYYY-MM-DD (never null in response)
    pub(super) day_complete_date: Option<String>,
    pub(super) applied_this_call: bool,
    pub(super) day_complete_fired_this_call: bool,
}

// ---------------------------------------------------------------------------
// Date helpers (private — implementation details)
// ---------------------------------------------------------------------------

fn today_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/// Returns `Err(BAD_REQUEST)` if `kind` is not one of the four known values.
fn validate_kind(kind: &str) -> Result<(), StatusCode> {
    match kind {
        "increment" | "break" | "day_complete" | "reset" => Ok(()),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}

/// Returns `Err(BAD_REQUEST)` if a non-empty `cause` is provided but is not
/// one of the four known break-cause values.
fn validate_cause(cause: &Option<String>) -> Result<(), StatusCode> {
    if let Some(c) = cause {
        match c.as_str() {
            "punt" | "skip" | "delete" | "manual" => Ok(()),
            _ => Err(StatusCode::BAD_REQUEST),
        }
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Row type used to load current streak state
// ---------------------------------------------------------------------------

struct StreakRow {
    count: i64,
    last_reset_date: Option<String>,
    day_complete_date: Option<String>,
    revision: i64,
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub(super) async fn auth_apply_streak_op(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<StreakOpRequestBody>,
) -> Result<Json<StreakOpResponseBody>, StatusCode> {
    // --- Auth ---
    let ctx = ctx_from_headers(&headers, &state).await?;

    // --- Input validation ---
    if body.op_key.is_empty() || body.op_key.len() > 128 {
        return Err(StatusCode::BAD_REQUEST);
    }
    validate_kind(&body.kind)?;
    if body.kind == "break" {
        validate_cause(&body.cause)?;
    }
    // Suppress unused-variable warning for occurred_at — it is received per
    // wire contract but the server uses its own clock (advisory only).
    let _ = body.occurred_at;

    let today = today_iso();
    let now = now_ms();

    // --- Begin transaction ---
    // Issue BEGIN IMMEDIATE directly on a connection acquired from the pool so
    // SQLite serializes concurrent writers, closing the dedup-vs-update race
    // window between Step 3 and Step 6.
    // (sqlx::Pool::begin() defaults to BEGIN DEFERRED, which would only acquire
    // a write lock on the first write statement — too late for our
    // SELECT-then-UPDATE pattern.)
    let mut conn = state.pool.acquire().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *conn)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Step 1: Ensure a user_streak row exists (brand-new users after migration).
    sqlx::query(
        "insert or ignore into user_streak \
         (user_id, count, last_reset_date, day_complete_date, revision, updated_ts) \
         values (?1, 0, ?2, NULL, 0, ?3)",
    )
    .bind(&ctx.user_id)
    .bind(&today)
    .bind(now)
    .execute(&mut *conn)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Step 2: Load current row.
    let row: Option<(i64, Option<String>, Option<String>, i64)> = sqlx::query_as(
        "select count, last_reset_date, day_complete_date, revision \
         from user_streak where user_id = ?1",
    )
    .bind(&ctx.user_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let prev = match row {
        Some((count, last_reset_date, day_complete_date, revision)) => {
            StreakRow { count, last_reset_date, day_complete_date, revision }
        }
        None => {
            // Should not happen after step 1, but be defensive.
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Step 3: Dedup check — replay short-circuit.
    let already_applied: Option<i64> =
        sqlx::query_scalar("select 1 from user_streak_op where user_id = ?1 and op_key = ?2")
            .bind(&ctx.user_id)
            .bind(&body.op_key)
            .fetch_optional(&mut *conn)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (applied_this_call, day_complete_fired_this_call) = if already_applied.is_some() {
        // Replay: return canonical state unchanged.
        tracing::debug!(
            user_id = %ctx.user_id,
            op_key = %body.op_key,
            "streak op replay (idempotent)"
        );

        // Step 7 (prune) still runs even on replay.
        sqlx::query(
            "delete from user_streak_op \
             where user_id = ?1 and applied_date < date('now', '-7 days')",
        )
        .bind(&ctx.user_id)
        .execute(&mut *conn)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        sqlx::query("COMMIT")
            .execute(&mut *conn)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let last_reset_date = prev.last_reset_date.clone().unwrap_or_else(|| today.clone());
        return Ok(Json(StreakOpResponseBody {
            revision: prev.revision,
            count: prev.count,
            last_reset_date,
            day_complete_date: prev.day_complete_date.clone(),
            applied_this_call: false,
            day_complete_fired_this_call: false,
        }));
    } else {
        // Step 4 – 6: apply the op.

        // --- Reset: prune today's ops BEFORE inserting the new dedup row ---
        if body.kind == "reset" {
            sqlx::query("delete from user_streak_op where user_id = ?1 and applied_date = ?2")
                .bind(&ctx.user_id)
                .bind(&today)
                .execute(&mut *conn)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }

        // --- Compute next state per op-kind rules ---
        let (next_count, next_last_reset_date, next_day_complete_date, fired) =
            apply_op_kind(&body.kind, &prev, &today);

        // Step 5: Bump revision and update row.
        let next_revision = prev.revision + 1;
        sqlx::query(
            "update user_streak \
             set count = ?1, last_reset_date = ?2, day_complete_date = ?3, \
                 revision = ?4, updated_ts = ?5 \
             where user_id = ?6",
        )
        .bind(next_count)
        .bind(&next_last_reset_date)
        .bind(&next_day_complete_date)
        .bind(next_revision)
        .bind(now)
        .bind(&ctx.user_id)
        .execute(&mut *conn)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Step 6: Insert dedup row (insert or ignore is defensive against races).
        sqlx::query(
            "insert or ignore into user_streak_op \
             (user_id, op_key, op_kind, applied_ts, applied_date) \
             values (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&ctx.user_id)
        .bind(&body.op_key)
        .bind(&body.kind)
        .bind(now)
        .bind(&today)
        .execute(&mut *conn)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Step 7: Prune dedup rows older than 7 days.
        sqlx::query(
            "delete from user_streak_op \
             where user_id = ?1 and applied_date < date('now', '-7 days')",
        )
        .bind(&ctx.user_id)
        .execute(&mut *conn)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Step 8: Commit.
        sqlx::query("COMMIT")
            .execute(&mut *conn)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Step 9: Build response from computed values.
        let response = StreakOpResponseBody {
            revision: next_revision,
            count: next_count,
            last_reset_date: next_last_reset_date,
            day_complete_date: next_day_complete_date,
            applied_this_call: true,
            day_complete_fired_this_call: fired,
        };
        return Ok(Json(response));
    };

    // This is unreachable but satisfies the compiler's type-inference for the
    // outer binding (the two branches both return early).
    #[allow(unreachable_code)]
    Ok(Json(StreakOpResponseBody {
        revision: prev.revision,
        count: prev.count,
        last_reset_date: prev.last_reset_date.unwrap_or(today),
        day_complete_date: prev.day_complete_date,
        applied_this_call,
        day_complete_fired_this_call,
    }))
}

// ---------------------------------------------------------------------------
// Op-kind rules (conflict-resolution rules 1–4 from design)
// ---------------------------------------------------------------------------

/// Returns `(next_count, next_last_reset_date, next_day_complete_date, day_complete_fired)`.
fn apply_op_kind(kind: &str, prev: &StreakRow, today: &str) -> (i64, String, Option<String>, bool) {
    match kind {
        // Rule 1: increment
        "increment" => (prev.count + 1, today.to_string(), prev.day_complete_date.clone(), false),
        // Rule 2: break
        "break" => (
            0,
            today.to_string(),
            prev.day_complete_date.clone(), // break does NOT clear day_complete
            false,
        ),
        // Rule 3: day_complete
        "day_complete" => {
            let next_last_reset = prev.last_reset_date.clone().unwrap_or_else(|| today.to_string());
            let fired = prev.day_complete_date.as_deref() != Some(today);
            (prev.count, next_last_reset, Some(today.to_string()), fired)
        }
        // Rule 4: reset
        "reset" => (
            0,
            today.to_string(),
            None, // reset clears day_complete so user can earn fresh celebration
            false,
        ),
        // Unreachable — caller already validated kind.
        _ => (prev.count, today.to_string(), prev.day_complete_date.clone(), false),
    }
}
