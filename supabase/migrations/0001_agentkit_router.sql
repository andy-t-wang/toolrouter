create table if not exists api_keys (
  id text primary key,
  user_id uuid not null references auth.users(id),
  caller_id text not null unique,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table if not exists requests (
  id text primary key,
  ts timestamptz not null default now(),
  trace_id text not null,
  user_id uuid not null references auth.users(id),
  api_key_id text not null references api_keys(id),
  caller_id text not null,
  endpoint_id text not null,
  category text,
  url_host text not null,
  status_code integer,
  ok boolean not null,
  path text not null,
  charged boolean not null,
  estimated_usd numeric,
  amount_usd numeric,
  currency text,
  payment_reference text,
  payment_network text,
  payment_error text,
  credit_reservation_id text,
  credit_reserved_usd numeric,
  credit_captured_usd numeric,
  credit_released_usd numeric,
  latency_ms integer,
  error text,
  body jsonb
);

create table if not exists endpoint_status (
  endpoint_id text primary key,
  status text not null check (status in ('healthy', 'degraded', 'failing', 'unverified')),
  last_checked_at timestamptz,
  status_code integer,
  latency_ms integer,
  path text,
  charged boolean not null default false,
  estimated_usd numeric,
  amount_usd numeric,
  currency text,
  payment_reference text,
  payment_network text,
  payment_error text,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists health_checks (
  id text primary key,
  endpoint_id text not null,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('healthy', 'degraded', 'failing', 'unverified')),
  status_code integer,
  latency_ms integer,
  path text,
  charged boolean not null default false,
  estimated_usd numeric,
  amount_usd numeric,
  currency text,
  payment_reference text,
  payment_network text,
  payment_error text,
  error text
);

create table if not exists wallet_accounts (
  id text primary key,
  user_id uuid not null unique references auth.users(id),
  provider text not null default 'crossmint',
  wallet_locator text not null,
  address text,
  chain_id text not null default 'eip155:8453',
  asset text not null default 'USDC',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_accounts (
  user_id uuid primary key references auth.users(id),
  available_usd numeric not null default 0,
  pending_usd numeric not null default 0,
  reserved_usd numeric not null default 0,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (available_usd >= 0),
  check (pending_usd >= 0),
  check (reserved_usd >= 0)
);

create table if not exists credit_ledger_entries (
  id text primary key,
  ts timestamptz not null default now(),
  user_id uuid not null references auth.users(id),
  type text not null check (type in (
    'top_up_pending',
    'top_up_settled',
    'top_up_failed',
    'reserve',
    'capture',
    'release',
    'adjustment'
  )),
  amount_usd numeric not null,
  currency text not null default 'USD',
  source text not null,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists wallet_transactions (
  id text primary key,
  ts timestamptz not null default now(),
  user_id uuid not null references auth.users(id),
  wallet_account_id text references wallet_accounts(id),
  provider text not null default 'crossmint',
  provider_reference text not null unique,
  kind text not null check (kind in ('top_up', 'payment', 'refund')),
  status text not null check (status in ('pending', 'success', 'failed')),
  amount_usd numeric,
  currency text,
  chain_id text,
  asset text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists requests_endpoint_ts_idx on requests(endpoint_id, ts desc);
create index if not exists requests_user_ts_idx on requests(user_id, ts desc);
create index if not exists requests_api_key_ts_idx on requests(api_key_id, ts desc);
create index if not exists requests_trace_idx on requests(trace_id);
create index if not exists health_checks_endpoint_checked_idx on health_checks(endpoint_id, checked_at desc);
create index if not exists endpoint_status_status_idx on endpoint_status(status);
create index if not exists wallet_accounts_user_idx on wallet_accounts(user_id);
create index if not exists credit_ledger_entries_user_ts_idx on credit_ledger_entries(user_id, ts desc);
create index if not exists wallet_transactions_user_ts_idx on wallet_transactions(user_id, ts desc);
create index if not exists wallet_transactions_provider_reference_idx on wallet_transactions(provider_reference);
