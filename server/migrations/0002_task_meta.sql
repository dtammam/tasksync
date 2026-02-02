alter table task add column url text;
alter table task add column recur_rule text;
-- store attachments as JSON text; optional
alter table task add column attachments text;
