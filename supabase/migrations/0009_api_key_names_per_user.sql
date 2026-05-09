alter table api_keys
drop constraint if exists api_keys_caller_id_key;

drop index if exists api_keys_user_caller_active_key;
create unique index api_keys_user_caller_active_key
on api_keys(user_id, caller_id)
where disabled_at is null;

create index if not exists api_keys_user_caller_id_idx
on api_keys(user_id, caller_id);

comment on index api_keys_user_caller_active_key is
  'API key caller IDs are unique only per user and only while the key is active.';
