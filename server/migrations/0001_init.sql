create table if not exists list (
    id text primary key,
    name text not null,
    icon text,
    color text,
    list_order text not null
);

create table if not exists task (
    id text primary key,
    title text not null,
    status text not null check(status in ('pending','done','cancelled')),
    list_id text not null references list(id) on delete cascade,
    my_day integer not null default 0,
    task_order text not null,
    updated_ts integer not null
);

create index if not exists idx_task_list on task(list_id);
