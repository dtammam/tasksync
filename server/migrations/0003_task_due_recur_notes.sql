alter table task add column due_date text;
alter table task add column occurrences_completed integer not null default 0;
alter table task add column notes text;
