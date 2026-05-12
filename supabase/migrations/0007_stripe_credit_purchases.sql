create table if not exists credit_purchases (
  id text primary key,
  user_id uuid not null references auth.users(id),
  amount_usd numeric not null,
  currency text not null default 'USD',
  provider text not null default 'stripe',
  provider_checkout_session_id text unique,
  provider_payment_intent_id text,
  status text not null check (status in (
    'checkout_pending',
    'funding_pending',
    'funded',
    'funding_failed',
    'checkout_failed'
  )),
  wallet_account_id text references wallet_accounts(id),
  funding_transaction_id text,
  funding_provider_reference text,
  checkout_url text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_purchases_user_created_idx on credit_purchases(user_id, created_at desc);
create index if not exists credit_purchases_status_idx on credit_purchases(status);
create index if not exists credit_purchases_checkout_session_idx on credit_purchases(provider_checkout_session_id);

alter table credit_purchases enable row level security;
revoke all on table credit_purchases from anon, authenticated;

grant select (
  id,
  user_id,
  amount_usd,
  currency,
  provider,
  provider_checkout_session_id,
  provider_payment_intent_id,
  status,
  wallet_account_id,
  funding_transaction_id,
  funding_provider_reference,
  error,
  created_at,
  updated_at
) on table credit_purchases to authenticated;

drop policy if exists "credit_purchases_select_own" on credit_purchases;
create policy "credit_purchases_select_own"
on credit_purchases
for select
to authenticated
using (user_id = auth.uid());

comment on table credit_purchases is
  'Stripe checkout and agent-wallet funding lifecycle for ToolRouter credits. Users can read only their own purchase state; writes use the service role.';

revoke all on table wallet_accounts from anon, authenticated;
grant select (
  id,
  user_id,
  provider,
  status,
  created_at,
  updated_at,
  agentkit_verified,
  agentkit_verified_at,
  agentkit_last_checked_at,
  agentkit_verification_error
) on table wallet_accounts to authenticated;

comment on table wallet_accounts is
  'RLS enabled. Authenticated users can read only their own badge-safe agent account state. Address, locator, metadata, and signing details stay server-side.';

select pg_notify('pgrst', 'reload schema');
