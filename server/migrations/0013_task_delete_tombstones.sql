create table if not exists task_tombstone (
    task_id text not null,
    space_id text not null references space(id) on delete cascade,
    list_id text not null references list(id) on delete cascade,
    deleted_ts integer not null,
    primary key (task_id, space_id)
);

create index if not exists idx_task_tombstone_space_deleted
    on task_tombstone(space_id, deleted_ts);
