-- Logically reversible via: alter table user drop column token_version;
alter table user add column token_version integer not null default 0;
