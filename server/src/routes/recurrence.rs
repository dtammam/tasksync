//! Server-side recurrence date math — the Rust twin of
//! `web/src/lib/tasks/recurrence.ts`. Both implementations are pinned by the
//! same case table, `shared/fixtures/recurrence-cases.json`, so a completion
//! made through the integration API lands on exactly the date a tap in the
//! web app would. Change one side only together with the table and the other.
//!
//! Dates are calendar dates (`NaiveDate`): no time zone or DST is involved in
//! the arithmetic itself. Month steps clamp to the last day of the target
//! month (`checked_add_months`), matching the TS `addMonths`.

use chrono::{Datelike, Duration, Months, NaiveDate, Weekday};

pub(super) const RECURRENCE_RULES: [&str; 9] = [
    "daily",
    "weekdays",
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "biannual",
    "annual",
    "lastDayOfMonth",
];

pub(super) fn is_recurrence_rule(rule: Option<&str>) -> bool {
    rule.is_some_and(|rule| RECURRENCE_RULES.contains(&rule))
}

/// Parses a wire-format `YYYY-MM-DD` date. Anything else is `None`.
pub(super) fn parse_iso_date(value: &str) -> Option<NaiveDate> {
    if value.len() != 10 {
        return None;
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

pub(super) fn format_iso_date(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn is_weekend(date: NaiveDate) -> bool {
    matches!(date.weekday(), Weekday::Sat | Weekday::Sun)
}

fn step_weekday(date: NaiveDate, forward: bool) -> NaiveDate {
    let step = if forward { Duration::days(1) } else { Duration::days(-1) };
    let mut d = date + step;
    while is_weekend(d) {
        d += step;
    }
    d
}

fn add_months(date: NaiveDate, months: i32) -> Option<NaiveDate> {
    if months >= 0 {
        date.checked_add_months(Months::new(months as u32))
    } else {
        date.checked_sub_months(Months::new(months.unsigned_abs()))
    }
}

/// Last day of the month `month_offset` months after `date`'s month.
fn last_day_of_month(date: NaiveDate, month_offset: i32) -> Option<NaiveDate> {
    let first = date.with_day(1)?;
    let first_of_following = add_months(first, month_offset + 1)?;
    first_of_following.pred_opt()
}

/// One step forward. `None` for an unknown rule (mirrors the TS `undefined`).
pub(super) fn next_due(date: NaiveDate, rule: &str) -> Option<NaiveDate> {
    match rule {
        "daily" => Some(date + Duration::days(1)),
        "weekdays" => Some(step_weekday(date, true)),
        "weekly" => Some(date + Duration::days(7)),
        "biweekly" => Some(date + Duration::days(14)),
        "monthly" => add_months(date, 1),
        "quarterly" => add_months(date, 3),
        "biannual" => add_months(date, 6),
        "annual" => add_months(date, 12),
        "lastDayOfMonth" => last_day_of_month(date, 1),
        _ => None,
    }
}

/// One step back. An unknown rule returns the input (mirrors the TS
/// `prevDueForRecurrence`).
pub(super) fn prev_due(date: NaiveDate, rule: &str) -> NaiveDate {
    let prev = match rule {
        "daily" => Some(date - Duration::days(1)),
        "weekdays" => Some(step_weekday(date, false)),
        "weekly" => Some(date - Duration::days(7)),
        "biweekly" => Some(date - Duration::days(14)),
        "monthly" => add_months(date, -1),
        "quarterly" => add_months(date, -3),
        "biannual" => add_months(date, -6),
        "annual" => add_months(date, -12),
        "lastDayOfMonth" => last_day_of_month(date, -1),
        _ => None,
    };
    prev.unwrap_or(date)
}

/// The due date a recurring task moves to when its current occurrence is
/// completed — the twin of TS `nextDueAfterCurrent`: one step from the anchor
/// (`punted_from_due_date ?? due_date`, or `today` when both are absent),
/// advanced until it is past the current `due_date`. Returns `due_date`
/// unchanged for an unknown rule or an unparseable anchor.
pub(super) fn next_due_after_current(
    due_date: Option<&str>,
    punted_from_due_date: Option<&str>,
    rule: Option<&str>,
    today: NaiveDate,
) -> Option<String> {
    let keep = || due_date.map(str::to_string);
    let Some(rule) = rule.filter(|rule| is_recurrence_rule(Some(rule))) else {
        return keep();
    };
    let anchor = match punted_from_due_date.or(due_date) {
        Some(raw) => match parse_iso_date(raw) {
            Some(date) => date,
            None => return keep(),
        },
        None => today,
    };
    let Some(mut next) = next_due(anchor, rule) else {
        return keep();
    };
    if let Some(due) = due_date.and_then(parse_iso_date) {
        while next <= due {
            match next_due(next, rule) {
                Some(candidate) if candidate != next => next = candidate,
                _ => break,
            }
        }
    }
    Some(format_iso_date(next))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct DateCase {
        date: String,
        rule: String,
        expected: Option<String>,
    }

    #[derive(Deserialize)]
    struct AfterCurrentCase {
        due: String,
        punted_from: Option<String>,
        rule: String,
        expected: String,
    }

    #[derive(Deserialize)]
    struct Cases {
        next: Vec<DateCase>,
        prev: Vec<DateCase>,
        after_current: Vec<AfterCurrentCase>,
    }

    fn cases() -> Cases {
        serde_json::from_str(include_str!("../../../shared/fixtures/recurrence-cases.json"))
            .expect("parse shared/fixtures/recurrence-cases.json")
    }

    fn d(value: &str) -> NaiveDate {
        parse_iso_date(value).expect("valid fixture date")
    }

    #[test]
    fn parity_next() {
        for c in cases().next {
            let got = next_due(d(&c.date), &c.rule).map(format_iso_date);
            assert_eq!(got, c.expected, "{} {}", c.rule, c.date);
        }
    }

    #[test]
    fn parity_prev() {
        for c in cases().prev {
            let got = format_iso_date(prev_due(d(&c.date), &c.rule));
            assert_eq!(Some(got), c.expected, "{} {}", c.rule, c.date);
        }
    }

    #[test]
    fn parity_after_current() {
        let today = d("2026-10-31");
        for c in cases().after_current {
            let got = next_due_after_current(
                Some(&c.due),
                c.punted_from.as_deref(),
                Some(&c.rule),
                today,
            );
            assert_eq!(
                got.as_deref(),
                Some(c.expected.as_str()),
                "{} due={} punted_from={:?}",
                c.rule,
                c.due,
                c.punted_from
            );
        }
    }

    #[test]
    fn table_covers_every_rule() {
        let all = cases();
        for rule in RECURRENCE_RULES {
            assert!(all.next.iter().any(|c| c.rule == rule), "next lacks {rule}");
            assert!(all.prev.iter().any(|c| c.rule == rule), "prev lacks {rule}");
        }
    }

    #[test]
    fn missing_anchor_steps_from_today() {
        let today = d("2026-10-31");
        assert_eq!(
            next_due_after_current(None, None, Some("daily"), today).as_deref(),
            Some("2026-11-01")
        );
        assert_eq!(next_due_after_current(None, None, None, today), None);
    }

    #[test]
    fn parse_iso_date_rejects_non_canonical_input() {
        assert!(parse_iso_date("2026-1-5").is_none());
        assert!(parse_iso_date("2026-02-30").is_none());
        assert!(parse_iso_date("2026-10-31T00:00").is_none());
        assert!(parse_iso_date("2026-10-31").is_some());
    }
}
