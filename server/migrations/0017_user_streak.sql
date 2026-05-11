-- 0017_user_streak.sql
-- Server-authoritative streak: dedicated tables for canonical state and
-- idempotency dedup, plus a seed from the legacy user.streak_state_json blob
-- so existing per-user counts are preserved across deploy.
--
-- Idempotent on rerun: all DDL uses `if not exists` and the seed uses
-- `insert or ignore`. The legacy `user.streak_state_json` column is intentionally
-- retained for rolling-deploy compatibility (older clients still read it on
-- preferences GET); a follow-up migration will drop it after the next stable
-- release window. See docs/exec-plans/active/2026-05-10-server-authoritative-streak.md
-- (Design > Backwards compatibility) for the full rollout plan.

create table if not exists user_streak (
    user_id           text primary key references user (id) on delete cascade,
    count             integer not null default 0 check (count >= 0),
    last_reset_date   text,
    day_complete_date text,
    revision          integer not null default 0,
    updated_ts        integer not null
);

create table if not exists user_streak_op (
    user_id      text    not null references user (id) on delete cascade,
    op_key       text    not null,
    op_kind      text    not null check (
        op_kind in ('increment', 'break', 'day_complete', 'reset')
    ),
    applied_ts   integer not null,
    applied_date text    not null,
    primary key (user_id, op_key)
);

create index if not exists idx_user_streak_op_user_date
    on user_streak_op (user_id, applied_date);

-- Seed user_streak from legacy user.streak_state_json (blob retired in this
-- design but column kept for rolling-deploy compatibility). json_extract
-- returns NULL for missing/invalid JSON; coalesce defaults guard count.
insert or ignore into user_streak (
    user_id,
    count,
    last_reset_date,
    day_complete_date,
    revision,
    updated_ts
)
select
    u.id,
    cast(coalesce(json_extract(u.streak_state_json, '$.count'), 0) as integer),
    json_extract(u.streak_state_json, '$.lastResetDate'),
    json_extract(u.streak_state_json, '$.dayCompleteDate'),
    0,
    cast(strftime('%s', 'now') * 1000 as integer)
from user as u;
