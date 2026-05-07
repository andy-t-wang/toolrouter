create index if not exists api_keys_user_id_idx on api_keys(user_id);
create index if not exists credit_purchases_wallet_account_id_idx on credit_purchases(wallet_account_id);
create index if not exists wallet_transactions_wallet_account_id_idx on wallet_transactions(wallet_account_id);

drop policy if exists "api_keys_select_own" on api_keys;
create policy "api_keys_select_own"
on api_keys
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "requests_select_own" on requests;
create policy "requests_select_own"
on requests
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "wallet_accounts_select_own" on wallet_accounts;
create policy "wallet_accounts_select_own"
on wallet_accounts
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "credit_accounts_select_own" on credit_accounts;
create policy "credit_accounts_select_own"
on credit_accounts
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "credit_ledger_entries_select_own" on credit_ledger_entries;
create policy "credit_ledger_entries_select_own"
on credit_ledger_entries
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "wallet_transactions_select_own" on wallet_transactions;
create policy "wallet_transactions_select_own"
on wallet_transactions
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "credit_purchases_select_own" on credit_purchases;
create policy "credit_purchases_select_own"
on credit_purchases
for select
to authenticated
using (user_id = (select auth.uid()));

select pg_notify('pgrst', 'reload schema');
