-- Clear stale punt state left behind by the COALESCE bug in update_task_meta.
--
-- The invariant for valid punt state: due_date must equal punted_on_date + 1 day.
-- Each punt moves a task one calendar day forward and records today as punted_on_date,
-- so if due_date has advanced further than that, the task was completed and rolled
-- forward but the punt fields were not cleared (the server preserved them via COALESCE
-- instead of overwriting with NULL).
--
-- Touch updated_ts so clients pick up the correction on their next incremental pull.
update task
set
    punted_from_due_date = null,
    punted_on_date = null,
    updated_ts = cast(strftime('%s', 'now') * 1000 as integer)
where
    punted_on_date is not null
    and punted_from_due_date is not null
    and due_date > date(punted_on_date, '+1 day');
