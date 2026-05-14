-- Canonical production credit mutations live in SQL so Supabase-backed accounts
-- can use row locks and idempotent ledger writes. Earlier transition
-- migrations (0004/0005/0007) are intentionally left in place because they may
-- already be applied remotely.

create or replace function toolrouter_reserve_credits(
  p_user_id uuid,
  p_amount_usd numeric,
  p_reservation_id text,
  p_ledger_id text,
  p_api_key_id text default null,
  p_trace_id text default null,
  p_endpoint_id text default null
)
returns table (
  credit_reservation_id text,
  credit_reserved_usd numeric,
  credit_captured_usd numeric,
  credit_released_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row credit_accounts%rowtype;
begin
  if p_amount_usd <= 0 then
    raise exception 'maxUsd must be greater than zero'
      using errcode = '22023';
  end if;

  select *
  into account_row
  from credit_accounts
  where user_id = p_user_id
  for update;

  if not found then
    insert into credit_accounts(user_id, available_usd, pending_usd, reserved_usd, currency)
    values (p_user_id, 0, 0, 0, 'USD')
    returning * into account_row;
  end if;

  if account_row.available_usd < p_amount_usd then
    raise exception 'insufficient ToolRouter credits'
      using errcode = 'P0001';
  end if;

  update credit_accounts
  set available_usd = available_usd - p_amount_usd,
      reserved_usd = reserved_usd + p_amount_usd,
      updated_at = now()
  where user_id = p_user_id;

  insert into credit_ledger_entries(
    id, user_id, type, amount_usd, currency, source, reference_id, metadata
  )
  values (
    p_ledger_id,
    p_user_id,
    'reserve',
    p_amount_usd,
    'USD',
    'request',
    p_reservation_id,
    jsonb_build_object(
      'api_key_id', p_api_key_id,
      'trace_id', p_trace_id,
      'endpoint_id', p_endpoint_id
    )
  )
  on conflict (id) do nothing;

  return query select p_reservation_id, p_amount_usd, 0::numeric, 0::numeric;
end;
$$;

create or replace function toolrouter_finalize_credit_reservation(
  p_user_id uuid,
  p_reserved_usd numeric,
  p_captured_usd numeric,
  p_reservation_id text,
  p_capture_ledger_id text default null,
  p_release_ledger_id text default null,
  p_payment_reference text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  credit_reservation_id text,
  credit_reserved_usd numeric,
  credit_captured_usd numeric,
  credit_released_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  captured numeric := least(greatest(coalesce(p_captured_usd, 0), 0), p_reserved_usd);
  released numeric := p_reserved_usd - captured;
begin
  perform 1 from credit_accounts where user_id = p_user_id for update;

  update credit_accounts
  set available_usd = available_usd + released,
      reserved_usd = greatest(reserved_usd - p_reserved_usd, 0),
      updated_at = now()
  where user_id = p_user_id;

  if captured > 0 and p_capture_ledger_id is not null then
    insert into credit_ledger_entries(id, user_id, type, amount_usd, currency, source, reference_id, metadata)
    values (
      p_capture_ledger_id,
      p_user_id,
      'capture',
      captured,
      'USD',
      'request',
      p_reservation_id,
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('payment_reference', p_payment_reference)
    )
    on conflict (id) do nothing;
  end if;

  if released > 0 and p_release_ledger_id is not null then
    insert into credit_ledger_entries(id, user_id, type, amount_usd, currency, source, reference_id, metadata)
    values (p_release_ledger_id, p_user_id, 'release', released, 'USD', 'request', p_reservation_id, coalesce(p_metadata, '{}'::jsonb))
    on conflict (id) do nothing;
  end if;

  return query select p_reservation_id, p_reserved_usd, captured, released;
end;
$$;

create or replace function toolrouter_settle_credit_purchase(
  p_purchase_id text,
  p_wallet_account_id text,
  p_funding_reference text,
  p_funding_transaction_id text,
  p_ledger_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns credit_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  purchase_row credit_purchases%rowtype;
begin
  select *
  into purchase_row
  from credit_purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'credit purchase not found'
      using errcode = 'P0002';
  end if;

  if purchase_row.status = 'funded' then
    return purchase_row;
  end if;

  perform 1 from credit_accounts where user_id = purchase_row.user_id for update;

  update credit_accounts
  set available_usd = available_usd + purchase_row.amount_usd,
      updated_at = now()
  where user_id = purchase_row.user_id;

  update credit_purchases
  set status = 'funded',
      wallet_account_id = coalesce(p_wallet_account_id, wallet_account_id),
      funding_provider_reference = coalesce(p_funding_reference, funding_provider_reference),
      funding_transaction_id = coalesce(p_funding_transaction_id, funding_transaction_id),
      error = null,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
  where id = p_purchase_id
  returning * into purchase_row;

  insert into credit_ledger_entries(id, user_id, type, amount_usd, currency, source, reference_id, metadata)
  values (
    p_ledger_id,
    purchase_row.user_id,
    'top_up_settled',
    purchase_row.amount_usd,
    'USD',
    'stripe',
    coalesce(purchase_row.provider_checkout_session_id, purchase_row.id),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (id) do nothing;

  return purchase_row;
end;
$$;

revoke all on function toolrouter_reserve_credits(uuid, numeric, text, text, text, text, text) from public;
revoke all on function toolrouter_finalize_credit_reservation(uuid, numeric, numeric, text, text, text, text, jsonb) from public;
revoke all on function toolrouter_settle_credit_purchase(text, text, text, text, text, jsonb) from public;

grant execute on function toolrouter_reserve_credits(uuid, numeric, text, text, text, text, text) to service_role;
grant execute on function toolrouter_finalize_credit_reservation(uuid, numeric, numeric, text, text, text, text, jsonb) to service_role;
grant execute on function toolrouter_settle_credit_purchase(text, text, text, text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
