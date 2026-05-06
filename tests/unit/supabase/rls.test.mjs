import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../../supabase/migrations/0002_enable_rls.sql", import.meta.url), "utf8");

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
  });

  it("does not grant client roles access to API key hashes", () => {
    assert.match(migration, /revoke all on table api_keys from anon, authenticated;/);
    assert.match(migration, /grant select \([\s\S]*caller_id[\s\S]*disabled_at[\s\S]*\) on table api_keys to authenticated;/);
    assert.doesNotMatch(
      migration.match(/grant select \([\s\S]*?\) on table api_keys to authenticated;/)?.[0] || "",
      /key_hash/,
    );
  });

  it("scopes user-owned data by auth.uid", () => {
    assert.match(migration, /api_keys_select_own/);
    assert.match(migration, /requests_select_own/);
    assert.match(migration, /wallet_accounts_select_own/);
    assert.match(migration, /credit_accounts_select_own/);
    assert.match(migration, /credit_ledger_entries_select_own/);
    assert.match(migration, /wallet_transactions_select_own/);
    assert.match(migration, /using \(user_id = auth\.uid\(\)\);/);
  });
});
