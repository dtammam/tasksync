alter table task add column completed_ts integer;

update task
set completed_ts = coalesce(completed_ts, updated_ts)
where status = 'done';
