//! Server-owned task completion: the same transitions `tasks.toggle()` and
//! `tasks.undoRecurringCompletion()` make in `web/src/lib/stores/tasks.ts`,
//! so a check-off from the integration API is indistinguishable from a tap.
//!
//! Generic over `RequestCtx` (no API-token assumptions); the contributor rule
//! matches `update_task_status_for_ctx` (creator only).
//!
//! Every write is one `UPDATE … WHERE updated_ts = <value read>`: if the task
//! changed between the read and the write, nothing is written and the caller
//! gets `ConcurrentUpdate`. `updated_ts` always moves forward (at least one past
//! the stored value) so `/sync/pull` carries the change even when a client
//! wrote a future timestamp.

use chrono::NaiveDate;
use serde::Serialize;

use super::clock::local_date_of_ms;
use super::recurrence::{
    format_iso_date, is_recurrence_rule, next_due, next_due_after_current, parse_iso_date, prev_due,
};
use super::tasks::TaskRow;
use super::types::{AppState, RequestCtx, Role};

pub(super) const TASK_COLUMNS: &str = "id, space_id, title, status, list_id, my_day, priority, task_order as \"order\", updated_ts, created_ts, url, recur_rule, due_date, punted_from_due_date, punted_on_date, emoji, occurrences_completed, completed_ts, notes, assignee_user_id, created_by_user_id";

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ActionError {
    NotFound,
    Forbidden,
    /// A supplied date is not `YYYY-MM-DD`.
    InvalidDate,
    /// `expected_due_date` differs from the task's current due date.
    DueDateMismatch,
    /// Uncomplete with nothing to undo.
    NotCompleted,
    /// The task changed between read and write.
    ConcurrentUpdate,
    Internal,
}

#[derive(Serialize)]
pub(super) struct CompleteOutcome {
    pub(super) task: TaskRow,
    pub(super) completed: bool,
    /// True when nothing was written because this occurrence was already
    /// complete (a retried request lands here).
    pub(super) already_done: bool,
    /// The due date before this completion; pass it to uncomplete. `null`
    /// when `already_done`.
    pub(super) previous_due_date: Option<String>,
    /// The recurring task's due date after this completion; `null` for a
    /// one-off task.
    pub(super) next_due_date: Option<String>,
}

#[derive(Serialize)]
pub(super) struct UncompleteOutcome {
    pub(super) task: TaskRow,
    pub(super) uncompleted: bool,
}

fn completed_on(ts: Option<i64>, today: NaiveDate) -> bool {
    ts.and_then(local_date_of_ms) == Some(today)
}

fn validate_optional_date(value: Option<&str>) -> Result<(), ActionError> {
    match value {
        Some(raw) if parse_iso_date(raw).is_none() => Err(ActionError::InvalidDate),
        _ => Ok(()),
    }
}

/// True when `expected` is given and differs from the task's due date.
fn due_mismatch(task: &TaskRow, expected: Option<&str>) -> bool {
    expected.is_some_and(|expected| task.due_date.as_deref() != Some(expected))
}

/// Recurring-occurrence semantics apply exactly when the web app's toggle
/// would take its recurring branch: a valid rule and a status other than
/// `done`. A recurring task marked `done` (only reachable through the raw
/// status route) behaves as a one-off, as in the web app.
fn uses_recurring_path(task: &TaskRow) -> bool {
    is_recurrence_rule(task.recur_rule.as_deref()) && task.status != "done"
}

async fn load_task(state: &AppState, ctx: &RequestCtx, id: &str) -> Result<TaskRow, ActionError> {
    let task = sqlx::query_as::<_, TaskRow>(&format!(
        "select {TASK_COLUMNS} from task where id = ?1 and space_id = ?2 limit 1"
    ))
    .bind(id)
    .bind(&ctx.space_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ActionError::Internal)?
    .ok_or(ActionError::NotFound)?;
    if ctx.role == Role::Contributor && task.created_by_user_id.as_deref() != Some(&ctx.user_id) {
        return Err(ActionError::Forbidden);
    }
    Ok(task)
}

/// `previous` may be restored by undo only if completing from it yields
/// `current` (an exact inverse) AND it is itself on the rule's cadence —
/// one step from its own predecessor. The second clause rejects dates no
/// occurrence could have had, e.g. a Sunday for `weekdays` or the 3rd for
/// `lastDayOfMonth`, which are still exact preimages (gate r2).
fn is_exact_previous(previous: NaiveDate, current: NaiveDate, rule: &str) -> bool {
    next_due(previous, rule) == Some(current)
        && next_due(prev_due(previous, rule), rule) == Some(previous)
}

fn next_updated_ts(task: &TaskRow, now: i64) -> i64 {
    now.max(task.updated_ts + 1)
}

pub(super) async fn complete_task_for_ctx(
    state: &AppState,
    ctx: &RequestCtx,
    id: &str,
    expected_due_date: Option<&str>,
) -> Result<CompleteOutcome, ActionError> {
    validate_optional_date(expected_due_date)?;
    let task = load_task(state, ctx, id).await?;
    complete_loaded(state, task, expected_due_date).await
}

/// The decision and the guarded write for an already-loaded (and
/// permission-checked) `task`. Split from `complete_task_for_ctx` so a test
/// can change the row between the read and the write.
pub(super) async fn complete_loaded(
    state: &AppState,
    task: TaskRow,
    expected_due_date: Option<&str>,
) -> Result<CompleteOutcome, ActionError> {
    let today = state.clock.today();
    let now = state.clock.now_ms();

    if uses_recurring_path(&task) {
        let completed_today = task.status == "pending" && completed_on(task.completed_ts, today);
        // The caller is asking about an occurrence that is no longer current.
        // If one was completed today, that is a retry of it; otherwise the
        // caller's view is stale.
        if due_mismatch(&task, expected_due_date) {
            return if completed_today {
                Ok(already_done(task))
            } else {
                Err(ActionError::DueDateMismatch)
            };
        }
        // Without a precondition, "done today" is the only retry signal.
        if expected_due_date.is_none() && completed_today {
            return Ok(already_done(task));
        }
        let next = next_due_after_current(
            task.due_date.as_deref(),
            task.punted_from_due_date.as_deref(),
            task.recur_rule.as_deref(),
            today,
        );
        let updated = sqlx::query_as::<_, TaskRow>(&format!(
            "update task set status = 'pending', due_date = ?1, occurrences_completed = ?2, completed_ts = ?3, punted_from_due_date = null, punted_on_date = null, updated_ts = ?4 where id = ?5 and space_id = ?6 and updated_ts = ?7 returning {TASK_COLUMNS}"
        ))
        .bind(&next)
        .bind(task.occurrences_completed + 1)
        .bind(now)
        .bind(next_updated_ts(&task, now))
        .bind(&task.id)
        .bind(&task.space_id)
        .bind(task.updated_ts)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ActionError::Internal)?
        .ok_or(ActionError::ConcurrentUpdate)?;
        return Ok(CompleteOutcome {
            previous_due_date: task.due_date,
            next_due_date: updated.due_date.clone(),
            task: updated,
            completed: true,
            already_done: false,
        });
    }

    if task.status == "done" {
        return Ok(already_done(task));
    }
    if due_mismatch(&task, expected_due_date) {
        return Err(ActionError::DueDateMismatch);
    }
    let updated = sqlx::query_as::<_, TaskRow>(&format!(
        "update task set status = 'done', completed_ts = ?1, punted_from_due_date = null, punted_on_date = null, updated_ts = ?2 where id = ?3 and space_id = ?4 and updated_ts = ?5 returning {TASK_COLUMNS}"
    ))
    .bind(now)
    .bind(next_updated_ts(&task, now))
    .bind(&task.id)
    .bind(&task.space_id)
    .bind(task.updated_ts)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ActionError::Internal)?
    .ok_or(ActionError::ConcurrentUpdate)?;
    Ok(CompleteOutcome {
        previous_due_date: task.due_date,
        next_due_date: None,
        task: updated,
        completed: true,
        already_done: false,
    })
}

fn already_done(task: TaskRow) -> CompleteOutcome {
    let next_due_date = if uses_recurring_path(&task) { task.due_date.clone() } else { None };
    CompleteOutcome {
        task,
        completed: true,
        already_done: true,
        previous_due_date: None,
        next_due_date,
    }
}

/// Undo a completion.
///
/// - Recurring task completed today: due date steps back, occurrences
///   decrement (floor 0), `completed_ts` clears (the prior completion time is
///   not kept anywhere; the web undo clears it too). `previous_due_date` (from
///   the complete response) is restored only when it is an exact inverse —
///   `next_due(previous) == current` — which makes month-end undo exact
///   (Jan 31 → Feb 28 → Jan 31) while giving a caller no way to pick a date
///   the task's cadence would not produce: repeated complete/uncomplete cycles
///   cannot walk the due date anywhere. Otherwise the step back is
///   `prev_due(current)`, as the web app does; that is also what a punted
///   task gets (its pre-punt anchor is not recoverable). Punt state is not
///   restored (the web undo does not either).
/// - Done task: back to `pending`, `completed_ts` cleared.
pub(super) async fn uncomplete_task_for_ctx(
    state: &AppState,
    ctx: &RequestCtx,
    id: &str,
    previous_due_date: Option<&str>,
    expected_due_date: Option<&str>,
) -> Result<UncompleteOutcome, ActionError> {
    validate_optional_date(previous_due_date)?;
    validate_optional_date(expected_due_date)?;
    let task = load_task(state, ctx, id).await?;
    uncomplete_loaded(state, task, previous_due_date, expected_due_date).await
}

/// The decision and the guarded write for an already-loaded `task`; see
/// `complete_loaded`.
pub(super) async fn uncomplete_loaded(
    state: &AppState,
    task: TaskRow,
    previous_due_date: Option<&str>,
    expected_due_date: Option<&str>,
) -> Result<UncompleteOutcome, ActionError> {
    let today = state.clock.today();
    let now = state.clock.now_ms();

    if uses_recurring_path(&task) {
        if task.status != "pending" || !completed_on(task.completed_ts, today) {
            return Err(ActionError::NotCompleted);
        }
        if due_mismatch(&task, expected_due_date) {
            return Err(ActionError::DueDateMismatch);
        }
        let rule = task.recur_rule.as_deref().unwrap_or_default();
        let restored = match task.due_date.as_deref().and_then(parse_iso_date) {
            Some(current) => {
                let exact = previous_due_date
                    .and_then(parse_iso_date)
                    .filter(|previous| is_exact_previous(*previous, current, rule));
                let date = exact.unwrap_or_else(|| prev_due(current, rule));
                Some(format_iso_date(date))
            }
            None => task.due_date.clone(),
        };
        let updated = sqlx::query_as::<_, TaskRow>(&format!(
            "update task set due_date = ?1, occurrences_completed = ?2, completed_ts = null, updated_ts = ?3 where id = ?4 and space_id = ?5 and updated_ts = ?6 returning {TASK_COLUMNS}"
        ))
        .bind(&restored)
        .bind((task.occurrences_completed - 1).max(0))
        .bind(next_updated_ts(&task, now))
        .bind(&task.id)
        .bind(&task.space_id)
        .bind(task.updated_ts)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ActionError::Internal)?
        .ok_or(ActionError::ConcurrentUpdate)?;
        return Ok(UncompleteOutcome { task: updated, uncompleted: true });
    }

    if task.status != "done" {
        return Err(ActionError::NotCompleted);
    }
    if due_mismatch(&task, expected_due_date) {
        return Err(ActionError::DueDateMismatch);
    }
    let updated = sqlx::query_as::<_, TaskRow>(&format!(
        "update task set status = 'pending', completed_ts = null, updated_ts = ?1 where id = ?2 and space_id = ?3 and updated_ts = ?4 returning {TASK_COLUMNS}"
    ))
    .bind(next_updated_ts(&task, now))
    .bind(&task.id)
    .bind(&task.space_id)
    .bind(task.updated_ts)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ActionError::Internal)?
    .ok_or(ActionError::ConcurrentUpdate)?;
    Ok(UncompleteOutcome { task: updated, uncompleted: true })
}
