alter table task add column priority integer not null default 0;
alter table task add column punted_from_due_date text;
alter table task add column punted_on_date text;
