alter table user add column sound_enabled integer not null default 1;
alter table user add column sound_volume integer not null default 60;
alter table user add column sound_theme text not null default 'chime_soft';
alter table user add column custom_sound_file_id text;
alter table user add column custom_sound_file_name text;
alter table user add column custom_sound_data_url text;
alter table user add column profile_attachments text;
