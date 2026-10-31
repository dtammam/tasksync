//! End-to-end tests for the integration API, driven through the real route
//! table (`integration_router`) so routing, extractors, bodies, scopes and
//! error rendering are all exercised. Plan:
//! `docs/exec-plans/active/2026-10-31-integration-api-read-complete.md`.

use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header::AUTHORIZATION, HeaderMap, Method, Request, StatusCode};
use axum::{Json, Router};
use chrono::{Local, NaiveDate, TimeZone};
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Row, SqlitePool};
use tower::Service;

use super::clock::Clock;
use super::integrations::integration_router;
use super::sync::{sync_pull, SyncPullBody};
use super::task_actions::{complete_loaded, uncomplete_loaded, ActionError, TASK_COLUMNS};
use super::tasks::TaskRow;
use super::types::{
    check_api_identity, issue_token, resolve_api_identity, AppState, Role, API_TOKEN_HEADER,
};

const CREATE_TOKEN: &str = "create-only-token-0123456789abcdef";
const AGENT_TOKEN: &str = "agent-token-0123456789abcdef-xyz";

/// Local noon on 2026-10-31 — "today" for every test here.
fn noon_ms() -> i64 {
    Local
        .from_local_datetime(
            &NaiveDate::from_ymd_opt(2026, 10, 31).unwrap().and_hms_opt(12, 0, 0).unwrap(),
        )
        .single()
        .expect("local noon")
        .timestamp_millis()
}

fn yesterday_evening_ms() -> i64 {
    noon_ms() - 16 * 60 * 60 * 1000
}

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite");
    sqlx::migrate!("./migrations").run(&pool).await.expect("migrations");
    for sql in [
        "insert into space (id, name) values ('s1', 'Default')",
        "insert into user (id, email, display, password_hash) values ('u-admin', 'admin@example.com', 'Admin', 'x')",
        "insert into membership (id, space_id, user_id, role) values ('m-admin', 's1', 'u-admin', 'admin')",
        "insert into user (id, email, display, password_hash) values ('u-contrib', 'contrib@example.com', 'Contributor', 'x')",
        "insert into membership (id, space_id, user_id, role) values ('m-contrib', 's1', 'u-contrib', 'contributor')",
        "insert into list (id, space_id, name, list_order) values ('l-test', 's1', 'Agent Test', 'a')",
        "insert into list_grant (id, space_id, list_id, user_id) values ('g1', 's1', 'l-test', 'u-contrib')",
    ] {
        sqlx::query(sql).execute(&pool).await.expect(sql);
    }
    pool
}

fn state(pool: &SqlitePool, api: Option<&str>, agent: Option<&str>) -> AppState {
    AppState {
        pool: pool.clone(),
        jwt_secret: "test-secret".to_string(),
        api_token: api.map(str::to_string),
        agent_token: agent.map(str::to_string),
        api_user_email: None,
        clock: Clock { fixed_now_ms: Some(noon_ms()) },
    }
}

struct Task<'a> {
    id: &'a str,
    title: &'a str,
    status: &'a str,
    my_day: bool,
    due: Option<&'a str>,
    rule: Option<&'a str>,
    punted_from: Option<&'a str>,
    punted_on: Option<&'a str>,
    occurrences: i64,
    completed_ts: Option<i64>,
    created_by: &'a str,
    updated_ts: i64,
}

impl Default for Task<'_> {
    fn default() -> Self {
        Task {
            id: "t1",
            title: "Task",
            status: "pending",
            my_day: false,
            due: None,
            rule: None,
            punted_from: None,
            punted_on: None,
            occurrences: 0,
            completed_ts: None,
            created_by: "u-admin",
            updated_ts: SEEDED_UPDATED_TS,
        }
    }
}

const SEEDED_UPDATED_TS: i64 = 1_000;

async fn insert(pool: &SqlitePool, t: Task<'_>) {
    sqlx::query(
        "insert into task (id, space_id, title, status, list_id, my_day, priority, task_order, updated_ts, created_ts, recur_rule, due_date, punted_from_due_date, punted_on_date, emoji, occurrences_completed, completed_ts, created_by_user_id) values (?1, 's1', ?2, ?3, 'l-test', ?4, 0, 'a', ?5, 1, ?6, ?7, ?8, ?9, '🧘', ?10, ?11, ?12)",
    )
    .bind(t.id)
    .bind(t.title)
    .bind(t.status)
    .bind(i64::from(t.my_day))
    .bind(t.updated_ts)
    .bind(t.rule)
    .bind(t.due)
    .bind(t.punted_from)
    .bind(t.punted_on)
    .bind(t.occurrences)
    .bind(t.completed_ts)
    .bind(t.created_by)
    .execute(pool)
    .await
    .expect("insert task");
}

async fn call(
    router: &Router,
    method: Method,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Vec<u8>) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        req = req.header(API_TOKEN_HEADER, token);
    }
    let body = match body {
        Some(v) => {
            req = req.header("content-type", "application/json");
            Body::from(v.to_string())
        }
        None => Body::empty(),
    };
    // `Router` is always ready, so `call` without `poll_ready` is sound; this
    // avoids needing tower's `util` feature just for `oneshot`.
    let res = router.clone().call(req.body(body).unwrap()).await.expect("route call");
    let status = res.status();
    let bytes = to_bytes(res.into_body(), usize::MAX).await.expect("body").to_vec();
    (status, bytes)
}

async fn call_json(
    router: &Router,
    method: Method,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let (status, bytes) = call(router, method, uri, token, body).await;
    let json =
        if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).expect("json") };
    (status, json)
}

async fn row(pool: &SqlitePool, id: &str) -> Value {
    let r = sqlx::query(
        "select status, due_date, occurrences_completed, completed_ts, punted_from_due_date, punted_on_date, updated_ts, emoji, title from task where id = ?1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .expect("row");
    json!({
        "status": r.get::<String, _>("status"),
        "due_date": r.get::<Option<String>, _>("due_date"),
        "occurrences_completed": r.get::<i64, _>("occurrences_completed"),
        "completed_ts": r.get::<Option<i64>, _>("completed_ts"),
        "punted_from_due_date": r.get::<Option<String>, _>("punted_from_due_date"),
        "punted_on_date": r.get::<Option<String>, _>("punted_on_date"),
        "updated_ts": r.get::<i64, _>("updated_ts"),
        "emoji": r.get::<Option<String>, _>("emoji"),
        "title": r.get::<String, _>("title"),
    })
}

fn without_updated_ts(mut v: Value) -> Value {
    v.as_object_mut().unwrap().remove("updated_ts");
    v
}

// ── Scopes and gates (A1) ───────────────────────────────────────────────────

#[tokio::test]
async fn create_only_token_is_forbidden_on_read_and_complete_routes() {
    let pool = pool().await;
    insert(&pool, Task::default()).await;
    let router = integration_router(state(&pool, Some(CREATE_TOKEN), Some(AGENT_TOKEN)));
    for (method, uri) in [
        (Method::GET, "/tasks"),
        (Method::GET, "/lists"),
        (Method::POST, "/tasks/t1/complete"),
        (Method::POST, "/tasks/t1/uncomplete"),
    ] {
        let (status, body) = call_json(&router, method, uri, Some(CREATE_TOKEN), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{uri}");
        assert_eq!(body["error"]["code"], "forbidden_scope", "{uri}");
    }
    assert_eq!(row(&pool, "t1").await["status"], "pending", "nothing written");
}

#[tokio::test]
async fn agent_token_works_on_every_route_including_create() {
    let pool = pool().await;
    insert(&pool, Task::default()).await;
    let router = integration_router(state(&pool, Some(CREATE_TOKEN), Some(AGENT_TOKEN)));
    assert_eq!(
        call(&router, Method::GET, "/tasks", Some(AGENT_TOKEN), None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(&router, Method::GET, "/lists", Some(AGENT_TOKEN), None).await.0,
        StatusCode::OK
    );
    let complete = call(&router, Method::POST, "/tasks/t1/complete", Some(AGENT_TOKEN), None).await;
    assert_eq!(complete.0, StatusCode::OK);
    let undo = call(&router, Method::POST, "/tasks/t1/uncomplete", Some(AGENT_TOKEN), None).await;
    assert_eq!(undo.0, StatusCode::OK);
    let (status, _) = call(
        &router,
        Method::POST,
        "/tasks",
        Some(AGENT_TOKEN),
        Some(json!({"title": "From agent", "list_id": "l-test"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn agent_token_alone_enables_create() {
    let pool = pool().await;
    let router = integration_router(state(&pool, None, Some(AGENT_TOKEN)));
    let (status, _) = call(
        &router,
        Method::POST,
        "/tasks",
        Some(AGENT_TOKEN),
        Some(json!({"title": "From agent", "list_id": "l-test"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn missing_or_wrong_token_is_unauthorized() {
    let pool = pool().await;
    insert(&pool, Task::default()).await;
    let router = integration_router(state(&pool, Some(CREATE_TOKEN), Some(AGENT_TOKEN)));
    for token in [None, Some("not-the-token-at-all-0123456789")] {
        for (method, uri) in [
            (Method::GET, "/tasks"),
            (Method::GET, "/lists"),
            (Method::POST, "/tasks/t1/complete"),
            (Method::POST, "/tasks/t1/uncomplete"),
        ] {
            let (status, body) = call_json(&router, method, uri, token, None).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri} {token:?}");
            assert_eq!(body["error"]["code"], "unauthorized");
        }
    }
}

#[tokio::test]
async fn new_routes_are_concealed_404_without_the_agent_token() {
    let pool = pool().await;
    insert(&pool, Task::default()).await;
    for api in [None, Some(CREATE_TOKEN)] {
        let router = integration_router(state(&pool, api, None));
        for (method, uri) in [
            (Method::GET, "/tasks"),
            (Method::GET, "/lists"),
            (Method::POST, "/tasks/t1/complete"),
            (Method::POST, "/tasks/t1/uncomplete"),
        ] {
            let (status, body) = call(&router, method, uri, Some(CREATE_TOKEN), None).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
            assert!(body.is_empty(), "feature-off 404 must be empty: {uri}");
        }
    }
}

// ── Acting identity (D2) ────────────────────────────────────────────────────

#[tokio::test]
async fn acting_identity_follows_email_then_oldest_admin() {
    let pool = pool().await;
    let fallback = resolve_api_identity(&pool, None).await.unwrap().unwrap();
    assert_eq!((fallback.1.as_str(), fallback.2), ("u-admin", Role::Admin));
    let contrib = resolve_api_identity(&pool, Some("CONTRIB@example.com")).await.unwrap().unwrap();
    assert_eq!((contrib.1.as_str(), contrib.2), ("u-contrib", Role::Contributor));
    assert!(resolve_api_identity(&pool, Some("nobody@example.com")).await.unwrap().is_none());
}

#[tokio::test]
async fn contributor_identity_cannot_complete_tasks_it_did_not_create() {
    let pool = pool().await;
    insert(&pool, Task::default()).await;
    let mut st = state(&pool, None, Some(AGENT_TOKEN));
    st.api_user_email = Some("contrib@example.com".into());
    let router = integration_router(st);
    let (status, body) =
        call_json(&router, Method::POST, "/tasks/t1/complete", Some(AGENT_TOKEN), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"]["code"], "forbidden");
}

#[tokio::test]
async fn unknown_acting_email_is_unauthorized() {
    let pool = pool().await;
    let mut st = state(&pool, None, Some(AGENT_TOKEN));
    st.api_user_email = Some("nobody@example.com".into());
    let router = integration_router(st);
    let (status, _) = call(&router, Method::GET, "/tasks", Some(AGENT_TOKEN), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ── Complete (A2) ───────────────────────────────────────────────────────────

async fn agent_router(pool: &SqlitePool) -> Router {
    integration_router(state(pool, None, Some(AGENT_TOKEN)))
}

#[tokio::test]
async fn completing_a_daily_task_advances_it_and_preserves_other_fields() {
    let pool = pool().await;
    insert(
        &pool,
        Task {
            title: "Morning meditation",
            due: Some("2026-10-31"),
            rule: Some("daily"),
            occurrences: 4,
            completed_ts: Some(yesterday_evening_ms()),
            ..Task::default()
        },
    )
    .await;
    let router = agent_router(&pool).await;
    let (status, body) = call_json(
        &router,
        Method::POST,
        "/tasks/t1/complete",
        Some(AGENT_TOKEN),
        Some(json!({"expected_due_date": "2026-10-31"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["completed"], true);
    assert_eq!(body["already_done"], false);
    assert_eq!(body["previous_due_date"], "2026-10-31");
    assert_eq!(body["next_due_date"], "2026-11-01");
    let r = row(&pool, "t1").await;
    assert_eq!(r["status"], "pending");
    assert_eq!(r["due_date"], "2026-11-01");
    assert_eq!(r["occurrences_completed"], 5);
    assert_eq!(r["completed_ts"], noon_ms());
    assert_eq!(r["emoji"], "🧘");
    assert_eq!(r["title"], "Morning meditation");
    assert!(r["updated_ts"].as_i64().unwrap() > SEEDED_UPDATED_TS);
    assert_eq!(body["task"]["due_date"], "2026-11-01", "response carries the written row");
}

#[tokio::test]
async fn completing_a_weekly_and_a_punted_daily_task() {
    let pool = pool().await;
    insert(
        &pool,
        Task { id: "w", due: Some("2026-10-31"), rule: Some("weekly"), ..Task::default() },
    )
    .await;
    insert(
        &pool,
        Task {
            id: "p",
            due: Some("2026-10-31"),
            rule: Some("daily"),
            punted_from: Some("2026-10-30"),
            punted_on: Some("2026-10-30"),
            ..Task::default()
        },
    )
    .await;
    let router = agent_router(&pool).await;
    call(&router, Method::POST, "/tasks/w/complete", Some(AGENT_TOKEN), None).await;
    call(&router, Method::POST, "/tasks/p/complete", Some(AGENT_TOKEN), None).await;
    assert_eq!(row(&pool, "w").await["due_date"], "2026-11-07");
    let p = row(&pool, "p").await;
    assert_eq!(p["due_date"], "2026-11-01");
    assert_eq!(p["punted_from_due_date"], Value::Null, "punt state cleared");
    assert_eq!(p["punted_on_date"], Value::Null, "punt state cleared");
}

#[tokio::test]
async fn completing_a_one_off_marks_it_done() {
    let pool = pool().await;
    insert(&pool, Task { my_day: true, ..Task::default() }).await;
    let router = agent_router(&pool).await;
    let (status, body) =
        call_json(&router, Method::POST, "/tasks/t1/complete", Some(AGENT_TOKEN), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["next_due_date"], Value::Null);
    let r = row(&pool, "t1").await;
    assert_eq!(r["status"], "done");
    assert_eq!(r["completed_ts"], noon_ms());
}

#[tokio::test]
async fn repeating_a_completion_is_already_done_and_writes_nothing() {
    let pool = pool().await;
    insert(
        &pool,
        Task { id: "d", due: Some("2026-10-31"), rule: Some("daily"), ..Task::default() },
    )
    .await;
    insert(&pool, Task { id: "o", ..Task::default() }).await;
    let router = agent_router(&pool).await;
    for (id, body) in
        [("d", Some(json!({"expected_due_date": "2026-10-31"}))), ("d", None), ("o", None)]
    {
        let uri = format!("/tasks/{id}/complete");
        call(&router, Method::POST, &uri, Some(AGENT_TOKEN), body.clone()).await;
        let after_first = row(&pool, id).await;
        let (status, again) = call_json(&router, Method::POST, &uri, Some(AGENT_TOKEN), body).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(again["already_done"], true, "{id}");
        assert_eq!(again["previous_due_date"], Value::Null);
        assert_eq!(row(&pool, id).await, after_first, "retry must not write ({id})");
        if id == "d" {
            // Reset so the no-precondition variant starts from the same state.
            sqlx::query(
                "update task set due_date = '2026-10-31', completed_ts = null where id = 'd'",
            )
            .execute(&pool)
            .await
            .unwrap();
        }
    }
}

#[tokio::test]
async fn stale_expected_due_date_is_a_mismatch() {
    let pool = pool().await;
    insert(&pool, Task { due: Some("2026-10-31"), rule: Some("daily"), ..Task::default() }).await;
    let router = agent_router(&pool).await;
    let before = row(&pool, "t1").await;
    let (status, body) = call_json(
        &router,
        Method::POST,
        "/tasks/t1/complete",
        Some(AGENT_TOKEN),
        Some(json!({"expected_due_date": "2026-10-29"})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "due_date_mismatch");
    assert_eq!(row(&pool, "t1").await, before);
}

#[tokio::test]
async fn malformed_bodies_and_unknown_ids_are_rejected() {
    let pool = pool().await;
    insert(&pool, Task::default()).await;
    let router = agent_router(&pool).await;
    for body in [json!({"expected_due": "2026-10-31"}), json!({"expected_due_date": "Oct 31"})] {
        let (status, err) =
            call_json(&router, Method::POST, "/tasks/t1/complete", Some(AGENT_TOKEN), Some(body))
                .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(err["error"]["code"], "invalid_request");
    }
    assert_eq!(row(&pool, "t1").await["status"], "pending");
    let (status, err) =
        call_json(&router, Method::POST, "/tasks/nope/complete", Some(AGENT_TOKEN), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(err["error"]["code"], "not_found");
}

// ── Uncomplete (A3) ─────────────────────────────────────────────────────────

async fn complete_then_uncomplete(
    pool: &SqlitePool,
    id: &str,
    use_previous: bool,
) -> (Value, Value) {
    let router = agent_router(pool).await;
    let before = row(pool, id).await;
    let (_, done) =
        call_json(&router, Method::POST, &format!("/tasks/{id}/complete"), Some(AGENT_TOKEN), None)
            .await;
    let undo_body = use_previous.then(|| {
        json!({"previous_due_date": done["previous_due_date"], "expected_due_date": done["next_due_date"]})
    });
    let (status, body) = call_json(
        &router,
        Method::POST,
        &format!("/tasks/{id}/uncomplete"),
        Some(AGENT_TOKEN),
        undo_body,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["uncompleted"], true);
    (before, row(pool, id).await)
}

#[tokio::test]
async fn uncomplete_restores_daily_weekly_and_one_off_exactly() {
    let pool = pool().await;
    insert(
        &pool,
        Task {
            id: "d",
            due: Some("2026-10-31"),
            rule: Some("daily"),
            occurrences: 3,
            ..Task::default()
        },
    )
    .await;
    insert(
        &pool,
        Task { id: "w", due: Some("2026-10-31"), rule: Some("weekly"), ..Task::default() },
    )
    .await;
    insert(&pool, Task { id: "o", due: Some("2026-11-02"), ..Task::default() }).await;
    for id in ["d", "w", "o"] {
        let (before, after) = complete_then_uncomplete(&pool, id, false).await;
        assert_eq!(without_updated_ts(after), without_updated_ts(before), "{id}");
    }
}

#[tokio::test]
async fn uncomplete_with_previous_due_date_is_exact_at_month_end() {
    let pool = pool().await;
    insert(&pool, Task { due: Some("2026-01-31"), rule: Some("monthly"), ..Task::default() }).await;
    let (before, after) = complete_then_uncomplete(&pool, "t1", true).await;
    assert_eq!(without_updated_ts(after), without_updated_ts(before));
}

#[tokio::test]
async fn uncomplete_with_previous_due_date_is_exact_for_every_month_end() {
    // Gate r3: real month ends after a shorter month, and Feb 29.
    for (rule, due) in [
        ("monthly", "2026-03-31"),
        ("monthly", "2026-10-31"),
        ("monthly", "2026-05-31"),
        ("quarterly", "2026-05-31"),
        ("annual", "2024-02-29"),
        ("lastDayOfMonth", "2026-03-31"),
        ("lastDayOfMonth", "2028-02-29"),
        ("weekdays", "2026-10-30"),
    ] {
        let pool = pool().await;
        insert(&pool, Task { due: Some(due), rule: Some(rule), ..Task::default() }).await;
        let (before, after) = complete_then_uncomplete(&pool, "t1", true).await;
        assert_eq!(without_updated_ts(after), without_updated_ts(before), "{rule} {due}");
    }
}

#[tokio::test]
async fn uncomplete_without_previous_due_date_steps_back_like_the_web_app() {
    let pool = pool().await;
    insert(&pool, Task { due: Some("2026-01-31"), rule: Some("monthly"), ..Task::default() }).await;
    let (_, after) = complete_then_uncomplete(&pool, "t1", false).await;
    // Feb 28 - 1 month: the lossy step the web undo also takes.
    assert_eq!(after["due_date"], "2026-01-28");
}

#[tokio::test]
async fn uncomplete_of_punted_tasks() {
    let pool = pool().await;
    // Punted daily: previous_due_date is an exact inverse, so it is restored.
    insert(
        &pool,
        Task {
            id: "pd",
            due: Some("2026-10-31"),
            rule: Some("daily"),
            punted_from: Some("2026-10-30"),
            punted_on: Some("2026-10-30"),
            ..Task::default()
        },
    )
    .await;
    // Punted weekly: the pre-punt date is not an inverse of the new due date,
    // so undo steps back one occurrence onto the task's cadence instead.
    insert(
        &pool,
        Task {
            id: "pw",
            due: Some("2026-10-25"),
            rule: Some("weekly"),
            punted_from: Some("2026-10-24"),
            punted_on: Some("2026-10-24"),
            ..Task::default()
        },
    )
    .await;
    let (before, after) = complete_then_uncomplete(&pool, "pd", true).await;
    for field in ["status", "due_date", "occurrences_completed"] {
        assert_eq!(after[field], before[field], "{field}");
    }
    let (_, after) = complete_then_uncomplete(&pool, "pw", true).await;
    assert_eq!(after["due_date"], "2026-10-24");
    assert_eq!(after["occurrences_completed"], 0);
}

#[tokio::test]
async fn complete_uncomplete_cycles_cannot_walk_the_due_date() {
    let pool = pool().await;
    insert(
        &pool,
        Task { id: "w", due: Some("2026-10-31"), rule: Some("weekly"), ..Task::default() },
    )
    .await;
    insert(
        &pool,
        Task { id: "a", due: Some("2026-10-31"), rule: Some("annual"), ..Task::default() },
    )
    .await;
    insert(
        &pool,
        Task { id: "l", due: Some("2026-10-31"), rule: Some("lastDayOfMonth"), ..Task::default() },
    )
    .await;
    insert(
        &pool,
        Task { id: "k", due: Some("2026-10-30"), rule: Some("weekdays"), ..Task::default() },
    )
    .await;
    let router = agent_router(&pool).await;
    for (id, forged) in [
        ("w", "2026-11-06"),
        ("w", "2026-11-12"),
        ("w", "2026-10-30"),
        ("a", "2027-03-15"),
        ("a", "2026-01-01"),
        // Exact preimages that are off the cadence (gate r2).
        ("l", "2026-10-03"),
        ("l", "2026-10-17"),
        ("k", "2026-11-01"),
        ("k", "2026-10-31"),
    ] {
        call(&router, Method::POST, &format!("/tasks/{id}/complete"), Some(AGENT_TOKEN), None)
            .await;
        let (status, _) = call_json(
            &router,
            Method::POST,
            &format!("/tasks/{id}/uncomplete"),
            Some(AGENT_TOKEN),
            Some(json!({ "previous_due_date": forged })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let original = if id == "k" { "2026-10-30" } else { "2026-10-31" };
        assert_eq!(row(&pool, id).await["due_date"], original, "{id} {forged}");
    }
}

#[tokio::test]
async fn previous_due_date_outside_one_step_is_not_honored() {
    let pool = pool().await;
    insert(&pool, Task { due: Some("2026-10-31"), rule: Some("daily"), ..Task::default() }).await;
    let router = agent_router(&pool).await;
    call(&router, Method::POST, "/tasks/t1/complete", Some(AGENT_TOKEN), None).await;
    let (status, _) = call_json(
        &router,
        Method::POST,
        "/tasks/t1/uncomplete",
        Some(AGENT_TOKEN),
        Some(json!({"previous_due_date": "1999-01-01"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(row(&pool, "t1").await["due_date"], "2026-10-31", "fell back to one step back");
}

#[tokio::test]
async fn uncomplete_with_nothing_to_undo_is_not_completed() {
    let pool = pool().await;
    insert(&pool, Task { id: "o", ..Task::default() }).await;
    insert(
        &pool,
        Task {
            id: "r",
            due: Some("2026-11-01"),
            rule: Some("daily"),
            completed_ts: Some(yesterday_evening_ms()),
            ..Task::default()
        },
    )
    .await;
    let router = agent_router(&pool).await;
    for id in ["o", "r"] {
        let before = row(&pool, id).await;
        let (status, body) = call_json(
            &router,
            Method::POST,
            &format!("/tasks/{id}/uncomplete"),
            Some(AGENT_TOKEN),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{id}");
        assert_eq!(body["error"]["code"], "not_completed");
        assert_eq!(row(&pool, id).await, before);
    }
}

// ── Sync visibility (A4) ────────────────────────────────────────────────────

#[tokio::test]
async fn a_completion_appears_in_sync_pull_after_the_prior_cursor() {
    let pool = pool().await;
    insert(&pool, Task { due: Some("2026-10-31"), rule: Some("daily"), ..Task::default() }).await;
    let st = state(&pool, None, Some(AGENT_TOKEN));
    let token = issue_token("u-admin", "s1", 0, &st.jwt_secret).unwrap();
    let mut session = HeaderMap::new();
    session.insert(AUTHORIZATION, format!("Bearer {token}").parse().unwrap());

    let before =
        sync_pull(State(st.clone()), session.clone(), Json(SyncPullBody { since_ts: None }))
            .await
            .expect("pull")
            .0;
    let router = integration_router(st.clone());
    call(&router, Method::POST, "/tasks/t1/complete", Some(AGENT_TOKEN), None).await;

    let after =
        sync_pull(State(st), session, Json(SyncPullBody { since_ts: Some(before.cursor_ts + 1) }))
            .await
            .expect("pull")
            .0;
    let pulled = after.tasks.iter().find(|t| t.id == "t1").expect("completion pulled");
    assert_eq!(pulled.due_date.as_deref(), Some("2026-11-01"));
}

// ── Read (A6 through the route) ─────────────────────────────────────────────

#[tokio::test]
async fn read_routes_return_today_view_and_lists() {
    let pool = pool().await;
    insert(&pool, Task { id: "a", title: "Morning Meditation", my_day: true, ..Task::default() })
        .await;
    insert(&pool, Task { id: "b", title: "Due later", due: Some("2026-11-05"), ..Task::default() })
        .await;
    insert(
        &pool,
        Task {
            id: "c",
            title: "Walk",
            due: Some("2026-11-01"),
            rule: Some("daily"),
            my_day: true,
            completed_ts: Some(noon_ms() - 60_000),
            ..Task::default()
        },
    )
    .await;
    let router = agent_router(&pool).await;

    let (status, body) = call_json(&router, Method::GET, "/tasks", Some(AGENT_TOKEN), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["today"], "2026-10-31");
    assert_eq!(body["view"], "today");
    let ids: Vec<&str> =
        body["tasks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["a", "c"]);
    let walk = &body["tasks"][1];
    assert_eq!(walk["is_recurring"], true);
    assert_eq!(walk["done_today"], true);
    assert_eq!(walk["next_due_date"], "2026-11-02");

    let (_, body) =
        call_json(&router, Method::GET, "/tasks?view=all&q=MEDITATION", Some(AGENT_TOKEN), None)
            .await;
    assert_eq!(body["tasks"].as_array().unwrap().len(), 1);

    let (_, body) =
        call_json(&router, Method::GET, "/tasks?include_done_today=false", Some(AGENT_TOKEN), None)
            .await;
    let ids: Vec<&str> =
        body["tasks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["a", "c"], "c is still My Day pending through its my_day flag");

    for bad in ["/tasks?view=week", "/tasks?status=finished", "/tasks?include_done_today=yes"] {
        let (status, body) = call_json(&router, Method::GET, bad, Some(AGENT_TOKEN), None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
        assert_eq!(body["error"]["code"], "invalid_query");
    }

    let (status, body) = call_json(&router, Method::GET, "/lists", Some(AGENT_TOKEN), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["id"], "l-test");
    assert_eq!(body[0]["name"], "Agent Test");
}

// ── Guards (gate r1: each survived mutation before these tests) ─────────────

async fn load(pool: &SqlitePool, id: &str) -> TaskRow {
    sqlx::query_as::<_, TaskRow>(&format!("select {TASK_COLUMNS} from task where id = ?1"))
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("load task")
}

async fn touch(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "update task set updated_ts = updated_ts + 5, title = 'edited elsewhere' where id = ?1",
    )
    .bind(id)
    .execute(pool)
    .await
    .expect("touch");
}

#[tokio::test]
async fn a_write_that_lost_the_race_is_rejected_and_changes_nothing() {
    let pool = pool().await;
    insert(
        &pool,
        Task { id: "r", due: Some("2026-10-31"), rule: Some("daily"), ..Task::default() },
    )
    .await;
    insert(&pool, Task { id: "o", ..Task::default() }).await;
    let st = state(&pool, None, Some(AGENT_TOKEN));

    for id in ["r", "o"] {
        let stale = load(&pool, id).await;
        touch(&pool, id).await;
        let edited = row(&pool, id).await;
        let err = complete_loaded(&st, stale, None).await.err();
        assert_eq!(err, Some(ActionError::ConcurrentUpdate), "complete {id}");
        assert_eq!(row(&pool, id).await, edited, "complete {id} must not write");
    }

    // Uncomplete, both branches.
    let router = integration_router(st.clone());
    for id in ["r", "o"] {
        call(&router, Method::POST, &format!("/tasks/{id}/complete"), Some(AGENT_TOKEN), None)
            .await;
        let stale = load(&pool, id).await;
        touch(&pool, id).await;
        let edited = row(&pool, id).await;
        let err = uncomplete_loaded(&st, stale, None, None).await.err();
        assert_eq!(err, Some(ActionError::ConcurrentUpdate), "uncomplete {id}");
        assert_eq!(row(&pool, id).await, edited, "uncomplete {id} must not write");
    }
}

#[tokio::test]
async fn stale_preconditions_are_rejected_on_every_branch() {
    let pool = pool().await;
    insert(&pool, Task { id: "o", due: Some("2026-11-02"), ..Task::default() }).await;
    insert(
        &pool,
        Task { id: "r", due: Some("2026-10-31"), rule: Some("daily"), ..Task::default() },
    )
    .await;
    let router = agent_router(&pool).await;

    // One-off complete with a stale due date.
    let (status, body) = call_json(
        &router,
        Method::POST,
        "/tasks/o/complete",
        Some(AGENT_TOKEN),
        Some(json!({"expected_due_date": "2026-11-01"})),
    )
    .await;
    assert_eq!(
        (status, body["error"]["code"].as_str()),
        (StatusCode::CONFLICT, Some("due_date_mismatch"))
    );
    assert_eq!(row(&pool, "o").await["status"], "pending");

    // Uncomplete with a stale due date, recurring and one-off.
    for id in ["r", "o"] {
        call(&router, Method::POST, &format!("/tasks/{id}/complete"), Some(AGENT_TOKEN), None)
            .await;
        let before = row(&pool, id).await;
        let (status, body) = call_json(
            &router,
            Method::POST,
            &format!("/tasks/{id}/uncomplete"),
            Some(AGENT_TOKEN),
            Some(json!({"expected_due_date": "1999-01-01"})),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{id}");
        assert_eq!(body["error"]["code"], "due_date_mismatch", "{id}");
        assert_eq!(row(&pool, id).await, before, "{id} must not write");
    }
}

#[tokio::test]
async fn updated_ts_advances_past_a_future_stored_value() {
    let pool = pool().await;
    let future = noon_ms() + 10 * 60 * 1000;
    insert(
        &pool,
        Task {
            due: Some("2026-10-31"),
            rule: Some("daily"),
            updated_ts: future,
            ..Task::default()
        },
    )
    .await;
    let router = agent_router(&pool).await;
    call(&router, Method::POST, "/tasks/t1/complete", Some(AGENT_TOKEN), None).await;
    assert_eq!(row(&pool, "t1").await["updated_ts"], future + 1);
    call(&router, Method::POST, "/tasks/t1/uncomplete", Some(AGENT_TOKEN), None).await;
    assert_eq!(row(&pool, "t1").await["updated_ts"], future + 2);
}

#[tokio::test]
async fn a_recurring_task_marked_done_behaves_as_a_one_off() {
    let pool = pool().await;
    insert(
        &pool,
        Task {
            status: "done",
            due: Some("2026-10-31"),
            rule: Some("daily"),
            occurrences: 2,
            ..Task::default()
        },
    )
    .await;
    let router = agent_router(&pool).await;
    let before = row(&pool, "t1").await;
    let (_, body) =
        call_json(&router, Method::POST, "/tasks/t1/complete", Some(AGENT_TOKEN), None).await;
    assert_eq!(body["already_done"], true);
    assert_eq!(row(&pool, "t1").await, before);
    call(&router, Method::POST, "/tasks/t1/uncomplete", Some(AGENT_TOKEN), None).await;
    let after = row(&pool, "t1").await;
    assert_eq!(after["status"], "pending");
    assert_eq!(after["due_date"], "2026-10-31", "due date untouched");
    assert_eq!(after["occurrences_completed"], 2);
}

#[tokio::test]
async fn an_unparseable_query_is_coded_and_only_after_the_gates() {
    let pool = pool().await;
    let uri = "/tasks?view=today&view=all";
    let off = integration_router(state(&pool, Some(CREATE_TOKEN), None));
    let (status, body) = call(&off, Method::GET, uri, Some(CREATE_TOKEN), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(body.is_empty(), "feature-off must stay concealed");

    let on = agent_router(&pool).await;
    let (status, _) = call(&on, Method::GET, uri, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body) = call_json(&on, Method::GET, uri, Some(AGENT_TOKEN), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "invalid_query");
}

#[tokio::test]
async fn boot_identity_check_rejects_an_unknown_email() {
    let pool = pool().await;
    check_api_identity(&pool, None).await.expect("unset is fine");
    check_api_identity(&pool, Some("Admin@Example.com")).await.expect("known email is fine");
    assert!(check_api_identity(&pool, Some("nobody@example.com")).await.is_err());
}
