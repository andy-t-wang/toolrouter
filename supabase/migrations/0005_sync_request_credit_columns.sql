alter table requests
  add column if not exists credit_reservation_id text,
  add column if not exists credit_reserved_usd numeric,
  add column if not exists credit_captured_usd numeric,
  add column if not exists credit_released_usd numeric;

select pg_notify('pgrst', 'reload schema');
