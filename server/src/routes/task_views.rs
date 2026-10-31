//! Read-side task selection for the integration API (`GET /api/tasks`).
//!
//! `view=today` reproduces the web app's My Day (`myDayPending` plus,
//! optionally, `myDayCompleted` without its punted-today clause) from
//! `web/src/lib/stores/tasks.ts`. Pure functions over `TaskRow`s, so the
//! selection is pinned by `shared/fixtures/my-day-cases.json`, which the web
//! suite runs against the real stores.

use chrono::NaiveDate;
use serde::Serialize;

use super::clock::local_date_of_ms;
use super::recurrence::{format_iso_date, is_recurrence_rule, next_due_after_current};
use super::tasks::TaskRow;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum View {
    Today,
    All,
}

impl View {
    pub(super) fn parse(raw: Option<&str>) -> Option<View> {
        match raw.unwrap_or("today") {
            "today" => Some(View::Today),
            "all" => Some(View::All),
            _ => None,
        }
    }

    pub(super) fn as_str(self) -> &'static str {
        match self {
            View::Today => "today",
            View::All => "all",
        }
    }
}

#[derive(Debug)]
pub(super) struct TaskFilters {
    pub(super) view: View,
    /// Lower-cased title substring.
    pub(super) q: Option<String>,
    pub(super) list_id: Option<String>,
    pub(super) status: Option<String>,
    /// `view=today` only: also return My Day items completed today.
    pub(super) include_done_today: bool,
}

/// A `TaskRow` plus the fields a caller needs to act on it without
/// re-implementing recurrence.
#[derive(Serialize)]
pub(super) struct ApiTask {
    #[serde(flatten)]
    pub(super) task: TaskRow,
    pub(super) is_recurring: bool,
    pub(super) done_today: bool,
    /// The due date completing this task now would move it to; `null` for a
    /// one-off task.
    pub(super) next_due_date: Option<String>,
}

fn completed_on(ts: Option<i64>, today: NaiveDate) -> bool {
    ts.and_then(local_date_of_ms) == Some(today)
}

fn is_recurring(task: &TaskRow) -> bool {
    is_recurrence_rule(task.recur_rule.as_deref())
}

/// Web `isAssignedToUser`: the assignee, else the creator.
fn is_assigned_to(task: &TaskRow, user_id: &str) -> bool {
    task.assignee_user_id.as_deref().or(task.created_by_user_id.as_deref()) == Some(user_id)
}

/// Web `inMyDay`.
fn in_my_day(task: &TaskRow, today: &str) -> bool {
    task.my_day != 0 || task.due_date.as_deref() == Some(today)
}

/// Web `isMissedTask`.
fn is_missed(task: &TaskRow, today: &str) -> bool {
    task.status == "pending" && task.due_date.as_deref().is_some_and(|due| due < today)
}

/// Web `wasCompletedToday` (one-off done today; `updated_ts` stands in for a
/// missing `completed_ts`, as on the client).
fn was_completed_today(task: &TaskRow, today: NaiveDate) -> bool {
    task.status == "done" && completed_on(task.completed_ts.or(Some(task.updated_ts)), today)
}

/// Web `wasRecurringCompletedToday`.
fn was_recurring_completed_today(task: &TaskRow, today: NaiveDate) -> bool {
    is_recurring(task) && task.status == "pending" && completed_on(task.completed_ts, today)
}

/// True when the task's current occurrence was completed today.
pub(super) fn done_today(task: &TaskRow, today: NaiveDate) -> bool {
    was_completed_today(task, today) || was_recurring_completed_today(task, today)
}

/// Web `myDayPending` membership.
pub(super) fn in_my_day_pending(task: &TaskRow, user_id: &str, today: NaiveDate) -> bool {
    let today_str = format_iso_date(today);
    is_assigned_to(task, user_id)
        && in_my_day(task, &today_str)
        && !is_missed(task, &today_str)
        && task.status == "pending"
}

/// Web `myDayCompleted` membership, minus its punted-today clause (a punt is
/// not a completion).
pub(super) fn in_my_day_done(task: &TaskRow, user_id: &str, today: NaiveDate) -> bool {
    let today_str = format_iso_date(today);
    is_assigned_to(task, user_id)
        && ((in_my_day(task, &today_str) && was_completed_today(task, today))
            || was_recurring_completed_today(task, today))
}

pub(super) fn annotate(task: TaskRow, today: NaiveDate) -> ApiTask {
    let recurring = is_recurring(&task);
    let next_due_date = if recurring {
        next_due_after_current(
            task.due_date.as_deref(),
            task.punted_from_due_date.as_deref(),
            task.recur_rule.as_deref(),
            today,
        )
    } else {
        None
    };
    ApiTask { is_recurring: recurring, done_today: done_today(&task, today), next_due_date, task }
}

/// Applies `filters` to `rows` (already permission-scoped and in
/// `task_order`), preserving order.
pub(super) fn select_tasks(
    rows: Vec<TaskRow>,
    filters: &TaskFilters,
    user_id: &str,
    today: NaiveDate,
) -> Vec<ApiTask> {
    rows.into_iter()
        .filter(|task| match filters.view {
            View::All => true,
            View::Today => {
                in_my_day_pending(task, user_id, today)
                    || (filters.include_done_today && in_my_day_done(task, user_id, today))
            }
        })
        .filter(|task| filters.list_id.as_deref().is_none_or(|id| task.list_id == id))
        .filter(|task| filters.status.as_deref().is_none_or(|status| task.status == status))
        .filter(|task| filters.q.as_deref().is_none_or(|q| task.title.to_lowercase().contains(q)))
        .map(|task| annotate(task, today))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, NaiveDateTime, TimeZone};
    use serde::Deserialize;

    /// One task in `shared/fixtures/my-day-cases.json`. Completion times are
    /// local wall-clock strings so the fixture means the same thing in every
    /// time zone.
    #[derive(Deserialize)]
    struct FixtureTask {
        id: String,
        title: String,
        status: String,
        my_day: bool,
        due_date: Option<String>,
        recur_rule: Option<String>,
        completed_at: Option<String>,
        #[serde(default)]
        updated_at: Option<String>,
        assignee_user_id: Option<String>,
        created_by_user_id: Option<String>,
    }

    #[derive(Deserialize)]
    struct Fixture {
        today: String,
        user_id: String,
        tasks: Vec<FixtureTask>,
        expected_pending: Vec<String>,
        expected_done_today: Vec<String>,
    }

    fn local_ms(wall: &str) -> i64 {
        let naive = NaiveDateTime::parse_from_str(wall, "%Y-%m-%dT%H:%M").expect("fixture time");
        Local
            .from_local_datetime(&naive)
            .single()
            .expect("unambiguous local time")
            .timestamp_millis()
    }

    fn row(t: FixtureTask) -> TaskRow {
        let completed_ts = t.completed_at.as_deref().map(local_ms);
        let updated_ts = t.updated_at.as_deref().map(local_ms).or(completed_ts).unwrap_or(0);
        TaskRow {
            id: t.id,
            space_id: "s1".into(),
            title: t.title,
            status: t.status,
            list_id: "l1".into(),
            my_day: i64::from(t.my_day),
            priority: 0,
            order: "a".into(),
            updated_ts,
            created_ts: 0,
            url: None,
            recur_rule: t.recur_rule,
            due_date: t.due_date,
            punted_from_due_date: None,
            punted_on_date: None,
            emoji: None,
            occurrences_completed: 0,
            completed_ts,
            notes: None,
            assignee_user_id: t.assignee_user_id,
            created_by_user_id: t.created_by_user_id,
        }
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../../../shared/fixtures/my-day-cases.json"))
            .expect("parse shared/fixtures/my-day-cases.json")
    }

    fn filters(view: View, include_done_today: bool) -> TaskFilters {
        TaskFilters { view, q: None, list_id: None, status: None, include_done_today }
    }

    fn ids(tasks: &[ApiTask]) -> Vec<String> {
        tasks.iter().map(|t| t.task.id.clone()).collect()
    }

    #[test]
    fn today_view_matches_web_my_day_fixture() {
        let f = fixture();
        let today = NaiveDate::parse_from_str(&f.today, "%Y-%m-%d").expect("today");
        let rows: Vec<TaskRow> = f.tasks.into_iter().map(row).collect();

        let pending: Vec<String> = rows
            .iter()
            .filter(|t| in_my_day_pending(t, &f.user_id, today))
            .map(|t| t.id.clone())
            .collect();
        assert_eq!(pending, f.expected_pending);

        let done: Vec<String> = rows
            .iter()
            .filter(|t| in_my_day_done(t, &f.user_id, today))
            .map(|t| t.id.clone())
            .collect();
        assert_eq!(done, f.expected_done_today);

        let without_done = select_tasks(rows, &filters(View::Today, false), &f.user_id, today);
        assert_eq!(ids(&without_done), f.expected_pending);
    }

    #[test]
    fn filters_compose_and_q_is_case_insensitive() {
        let f = fixture();
        let today = NaiveDate::parse_from_str(&f.today, "%Y-%m-%d").expect("today");
        let rows: Vec<TaskRow> = f.tasks.into_iter().map(row).collect();
        let mut by_title = filters(View::All, false);
        by_title.q = Some("meditation".into());
        let got = select_tasks(rows, &by_title, &f.user_id, today);
        assert!(!got.is_empty());
        assert!(got.iter().all(|t| t.task.title.to_lowercase().contains("meditation")));
    }

    #[test]
    fn annotate_reports_next_due_and_done_today() {
        let f = fixture();
        let today = NaiveDate::parse_from_str(&f.today, "%Y-%m-%d").expect("today");
        for t in f.tasks.into_iter().map(row) {
            let recurring = is_recurrence_rule(t.recur_rule.as_deref());
            let api = annotate(t, today);
            assert_eq!(api.is_recurring, recurring);
            assert_eq!(api.next_due_date.is_some(), recurring, "{}", api.task.id);
        }
    }
}
