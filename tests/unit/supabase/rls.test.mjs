import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/0002_enable_rls.sql", import.meta.url), "utf8");
const monitoringMigration = readFileSync(new URL("../../../supabase/migrations/0006_monitoring_agentkit_wallet.sql", import.meta.url), "utf8");
const purchasesMigration = readFileSync(new URL("../../../supabase/migrations/0007_stripe_credit_purchases.sql", import.meta.url), "utf8");
const perfMigration = readFileSync(new URL("../../../supabase/migrations/0008_rls_perf_indexes.sql", import.meta.url), "utf8");
const apiKeyNamesMigration = readFileSync(
  new URL("../../../supabase/migrations/0009_api_key_names_per_user.sql", import.meta.url),
  "utf8",
);
const endpointTasksMigration = readFileSync(
  new URL("../../../supabase/migrations/0010_endpoint_tasks.sql", import.meta.url),
  "utf8",
);
const endpointTasksNullableMigration = readFileSync(
  new URL("../../../supabase/migrations/0011_endpoint_tasks_nullable_provider_task_id.sql", import.meta.url),
  "utf8",
);

describe("Supabase RLS migration", () => {
  it("enables RLS on every durable router table", () => {
    for (const table of [
      "api_keys",
      "requests",
      "endpoint_status",
      "health_checks",
      "wallet_accounts",
      "credit_accounts",
      "credit_ledger_entries",
      "wallet_transactions",
    ]) {
      assert.match(migration, new RegExp(`alter table ${table} enable row level security;`));
    }
    assert.match(purchasesMigration, /alter table credit_purchases enable row level security;/);
    assert.match(endpointTasksMigration, /alter table public\.endpoint_tasks enable row level security;/);
  });

  it("does not grant client roles access to API key hashes", () => {
    assert.match(migration, /revoke all on table api_keys from anon, authenticated;/);
    assert.match(migration, /grant select \([\s\S]*caller_id[\s\S]*disabled_at[\s\S]*\) on table api_keys to authenticated;/);
    assert.doesNotMatch(
      migration.match(/grant select \([\s\S]*?\) on table api_keys to authenticated;/)?.[0] || "",
      /key_hash/,
    );
  });

  it("keeps raw provider health errors and payment references out of browser grants", () => {
    const endpointGrant =
      migration.match(/grant select \([\s\S]*?\) on table endpoint_status to authenticated;/)?.[0] || "";
    const healthGrant =
      migration.match(/grant select \([\s\S]*?\) on table health_checks to authenticated;/)?.[0] || "";

    assert.match(endpointGrant, /endpoint_id/);
    assert.match(healthGrant, /endpoint_id/);
    for (const grant of [endpointGrant, healthGrant]) {
      assert.doesNotMatch(grant, /payment_reference/);
      assert.doesNotMatch(grant, /payment_error/);
      assert.doesNotMatch(grant, /\berror\b/);
    }
    assert.doesNotMatch(endpointGrant, /last_error/);
  });


  it("scopes user-owned data by auth.uid", () => {
    assert.match(migration, /api_keys_select_own/);
    assert.match(migration, /requests_select_own/);
    assert.match(migration, /wallet_accounts_select_own/);
    assert.match(migration, /credit_accounts_select_own/);
    assert.match(migration, /credit_ledger_entries_select_own/);
    assert.match(migration, /wallet_transactions_select_own/);
    assert.match(purchasesMigration, /credit_purchases_select_own/);
    assert.doesNotMatch(endpointTasksMigration, /create policy endpoint_tasks_select_own/);
    assert.match(migration, /using \(user_id = auth\.uid\(\)\);/);
    assert.match(purchasesMigration, /using \(user_id = auth\.uid\(\)\);/);
    assert.match(perfMigration, /using \(user_id = \(select auth\.uid\(\)\)\);/);
    assert.match(endpointTasksMigration, /revoke all on public\.endpoint_tasks from anon, authenticated;/);
    assert.doesNotMatch(endpointTasksMigration, /grant select on public\.endpoint_tasks to authenticated;/);
  });

  it("adds covering indexes for foreign keys used by production tables", () => {
    assert.match(perfMigration, /create index if not exists api_keys_user_id_idx on api_keys\(user_id\);/);
    assert.match(
      perfMigration,
      /create index if not exists credit_purchases_wallet_account_id_idx on credit_purchases\(wallet_account_id\);/,
    );
    assert.match(
      perfMigration,
      /create index if not exists wallet_transactions_wallet_account_id_idx on wallet_transactions\(wallet_account_id\);/,
    );
  });

  it("scopes active API key names to one user instead of globally", () => {
    assert.match(apiKeyNamesMigration, /drop constraint if exists api_keys_caller_id_key;/);
    assert.match(
      apiKeyNamesMigration,
      /create unique index api_keys_user_caller_active_key[\s\S]*on api_keys\(user_id, caller_id\)[\s\S]*where disabled_at is null;/,
    );
  });

  it("adds async endpoint task constraints without browser grants", () => {
    assert.match(endpointTasksMigration, /provider_task_id text,/);
    assert.match(
      endpointTasksMigration,
      /create unique index if not exists endpoint_tasks_api_key_provider_task_key[\s\S]*on public\.endpoint_tasks\(api_key_id, endpoint_id, provider_task_id\)[\s\S]*where provider_task_id is not null;/,
    );
    assert.match(
      endpointTasksMigration,
      /create unique index if not exists endpoint_tasks_starting_dedupe_key[\s\S]*on public\.endpoint_tasks\(api_key_id, endpoint_id, dedupe_key\)[\s\S]*where provider_task_id is null and status <> 'error';/,
    );
    assert.match(
      endpointTasksNullableMigration,
      /alter table public\.endpoint_tasks[\s\S]*alter column provider_task_id drop not null;/,
    );
  });

  it("keeps AgentKit human id hashes out of browser-readable wallet grants", () => {
    const walletGrant = monitoringMigration.match(/grant select \([\s\S]*?\) on table wallet_accounts to authenticated;/)?.[0] || "";
    assert.match(walletGrant, /agentkit_verified/);
    assert.doesNotMatch(walletGrant, /agentkit_human_id_hash/);
    assert.match(monitoringMigration, /security_invoker = true/);
  });

  it("keeps wallet addresses and locators out of browser-readable wallet grants", () => {
    const walletGrant = purchasesMigration.match(/grant select \([\s\S]*?\) on table wallet_accounts to authenticated;/)?.[0] || "";
    assert.match(walletGrant, /agentkit_verified/);
    assert.doesNotMatch(walletGrant, /address/);
    assert.doesNotMatch(walletGrant, /wallet_locator/);
    assert.doesNotMatch(walletGrant, /metadata/);
  });
});
