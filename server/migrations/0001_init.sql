create table if not exists space (
    id text primary key,
    name text not null
);

create table if not exists user (
    id text primary key,
    email text not null unique,
    display text not null
);

create table if not exists membership (
    id text primary key,
    space_id text not null references space(id) on delete cascade,
    user_id text not null references user(id) on delete cascade,
    role text not null check(role in ('admin','contributor'))
);

create unique index if not exists ux_membership_space_user on membership(space_id, user_id);

create table if not exists list (
    id text primary key,
    space_id text not null references space(id) on delete cascade,
    name text not null,
    icon text,
    color text,
    list_order text not null
);

create table if not exists list_grant (
    id text primary key,
    space_id text not null references space(id) on delete cascade,
    list_id text not null references list(id) on delete cascade,
    user_id text not null references user(id) on delete cascade
);

create unique index if not exists ux_list_grant on list_grant(list_id, user_id);

create table if not exists task (
    id text primary key,
    space_id text not null references space(id) on delete cascade,
    title text not null,
    status text not null check(status in ('pending','done','cancelled')),
    list_id text not null references list(id) on delete cascade,
    my_day integer not null default 0,
    task_order text not null,
    updated_ts integer not null,
    created_ts integer not null
);

create index if not exists idx_task_list on task(list_id);
create index if not exists idx_task_space on task(space_id);
