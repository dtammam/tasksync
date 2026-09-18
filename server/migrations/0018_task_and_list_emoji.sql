-- Logically reversible via: alter table task drop column emoji;
--                            alter table list drop column default_emoji;
alter table task add column emoji text;
alter table list add column default_emoji text;
