alter table task add column created_by_user_id text references user(id);
alter table task add column assignee_user_id text references user(id);

update task
set created_by_user_id = coalesce(
	created_by_user_id,
	(select m.user_id from membership m where m.space_id = task.space_id order by m.role asc, m.user_id asc limit 1)
)
where created_by_user_id is null;

update task
set assignee_user_id = coalesce(assignee_user_id, created_by_user_id)
where assignee_user_id is null;

create index if not exists idx_task_assignee on task(assignee_user_id);
create index if not exists idx_task_created_by on task(created_by_user_id);
