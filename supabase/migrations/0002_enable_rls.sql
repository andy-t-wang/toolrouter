alter table api_keys enable row level security;
alter table requests enable row level security;
alter table endpoint_status enable row level security;
alter table health_checks enable row level security;
alter table wallet_accounts enable row level security;
alter table credit_accounts enable row level security;
alter table credit_ledger_entries enable row level security;
alter table wallet_transactions enable row level security;

revoke all on table api_keys from anon, authenticated;
revoke all on table requests from anon, authenticated;
revoke all on table endpoint_status from anon, authenticated;
revoke all on table health_checks from anon, authenticated;
revoke all on table wallet_accounts from anon, authenticated;
revoke all on table credit_accounts from anon, authenticated;
revoke all on table credit_ledger_entries from anon, authenticated;
revoke all on table wallet_transactions from anon, authenticated;

grant select (
  id,
  user_id,
  caller_id,
  created_at,
  disabled_at
) on table api_keys to authenticated;

grant select on table requests to authenticated;
grant select on table endpoint_status to authenticated;
grant select on table health_checks to authenticated;
grant select on table wallet_accounts to authenticated;
grant select on table credit_accounts to authenticated;
grant select on table credit_ledger_entries to authenticated;
grant select on table wallet_transactions to authenticated;

drop policy if exists "api_keys_select_own" on api_keys;
create policy "api_keys_select_own"
on api_keys
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "requests_select_own" on requests;
create policy "requests_select_own"
on requests
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "endpoint_status_select_authenticated" on endpoint_status;
create policy "endpoint_status_select_authenticated"
on endpoint_status
for select
to authenticated
using (true);

drop policy if exists "health_checks_select_authenticated" on health_checks;
create policy "health_checks_select_authenticated"
on health_checks
for select
to authenticated
using (true);

drop policy if exists "wallet_accounts_select_own" on wallet_accounts;
create policy "wallet_accounts_select_own"
on wallet_accounts
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "credit_accounts_select_own" on credit_accounts;
create policy "credit_accounts_select_own"
on credit_accounts
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "credit_ledger_entries_select_own" on credit_ledger_entries;
create policy "credit_ledger_entries_select_own"
on credit_ledger_entries
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "wallet_transactions_select_own" on wallet_transactions;
create policy "wallet_transactions_select_own"
on wallet_transactions
for select
to authenticated
using (user_id = auth.uid());

comment on table api_keys is
  'RLS enabled. Authenticated users can read only their own key metadata; key_hash is not granted to client roles. Router writes use the service role.';

comment on table requests is
  'RLS enabled. Authenticated users can read only request rows owned by their auth.uid(). Router writes use the service role.';

comment on table endpoint_status is
  'RLS enabled. Authenticated users can read global endpoint status. Writes use the service role.';

comment on table health_checks is
  'RLS enabled. Authenticated users can read global health-check history. Writes use the service role.';

comment on table wallet_accounts is
  'RLS enabled. Authenticated users can read only their own Crossmint wallet metadata. Writes use the service role.';

comment on table credit_accounts is
  'RLS enabled. Authenticated users can read only their own ToolRouter credit balance. Writes use the service role.';

comment on table credit_ledger_entries is
  'RLS enabled. Authenticated users can read only their own credit ledger entries. Writes use the service role.';

comment on table wallet_transactions is
  'RLS enabled. Authenticated users can read only their own wallet transaction records. Writes use the service role.';
