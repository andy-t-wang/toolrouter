alter table requests
  add column if not exists agentkit_value_type text,
  add column if not exists agentkit_value_label text;

alter table wallet_accounts
  add column if not exists agentkit_verified boolean not null default false,
  add column if not exists agentkit_human_id_hash text,
  add column if not exists agentkit_verified_at timestamptz,
  add column if not exists agentkit_last_checked_at timestamptz,
  add column if not exists agentkit_verification_error text;

revoke all on table wallet_accounts from anon, authenticated;
grant select (
  id,
  user_id,
  provider,
  wallet_locator,
  address,
  chain_id,
  asset,
  status,
  metadata,
  created_at,
  updated_at,
  agentkit_verified,
  agentkit_verified_at,
  agentkit_last_checked_at,
  agentkit_verification_error
) on table wallet_accounts to authenticated;

create or replace view toolrouter_monitoring_daily
with (security_invoker = true)
as
select
  user_id,
  date_trunc('day', ts) as day,
  count(*) as total_requests,
  count(*) filter (where ok is false or status_code >= 400 or error is not null) as error_requests,
  count(*) filter (where path = 'agentkit') as agentkit_requests,
  count(*) filter (where path in ('x402', 'agentkit_to_x402')) as x402_requests,
  coalesce(sum(coalesce(credit_captured_usd, amount_usd, 0)), 0) as paid_usd
from requests
group by user_id, date_trunc('day', ts);

grant select on table toolrouter_monitoring_daily to authenticated;

comment on view toolrouter_monitoring_daily is
  'Per-user daily monitoring rollup for dashboard request counts, errors, AgentKit usage, x402 usage, and paid totals. security_invoker preserves request table RLS.';

comment on column wallet_accounts.agentkit_verified is
  'True when the wallet address resolves to an AgentBook human id at last check.';

comment on column wallet_accounts.agentkit_human_id_hash is
  'SHA-256 hash of the AgentBook human id. The raw human id must not be exposed to browser clients.';
