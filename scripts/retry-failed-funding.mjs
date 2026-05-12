#!/usr/bin/env node
import { randomUUID } from "node:crypto";

import { createStore } from "../packages/db/src/index.ts";
import { CrossmintClient } from "../apps/api/src/crossmint.ts";
import { settleFundedCreditPurchase } from "../apps/api/src/billing.ts";

const dryRun = process.argv.includes("--dry-run");
const limit = Number(process.env.TOOLROUTER_FUNDING_RETRY_LIMIT || "50");
const store = createStore();
const crossmint = new CrossmintClient();

async function ensureWalletForPurchase(purchase) {
  const existing = await store.getWalletAccount({ user_id: purchase.user_id });
  if (existing?.address && existing?.wallet_locator) return existing;
  const wallet = await crossmint.ensureWallet({ user_id: purchase.user_id });
  return store.upsertWalletAccount({
    id: existing?.id || `wa_${randomUUID()}`,
    user_id: purchase.user_id,
    ...wallet,
  });
}

const purchases = await store.listCreditPurchases({ status: "funding_failed", limit });
const results = [];

for (const purchase of purchases) {
  if (dryRun) {
    results.push({
      id: purchase.id,
      user_id: purchase.user_id,
      amount_usd: purchase.amount_usd,
      action: "would_retry",
    });
    continue;
  }

  try {
    const wallet = await ensureWalletForPurchase(purchase);
    const funding = await crossmint.fundAgentWallet({
      toAddress: wallet.address,
      amountUsd: String(purchase.amount_usd),
    });
    await store.insertWalletTransaction({
      id: `wtx_${randomUUID()}`,
      ts: new Date().toISOString(),
      user_id: purchase.user_id,
      wallet_account_id: wallet.id,
      provider: "crossmint",
      provider_reference: funding.provider_reference,
      kind: "top_up",
      status: "success",
      amount_usd: purchase.amount_usd,
      currency: "USD",
      chain_id: wallet.chain_id || "eip155:8453",
      asset: wallet.asset || "USDC",
      metadata: {
        retry_script: true,
        funding_transaction_id: funding.transaction_id || null,
        funding_explorer_link_present: Boolean(funding.explorer_link),
      },
    });
    const settled = await settleFundedCreditPurchase({
      store,
      purchase,
      wallet_account_id: wallet.id,
      fundingReference: funding.provider_reference,
      fundingTransactionId: funding.transaction_id,
      metadata: {
        retry_script: true,
      },
    });
    results.push({
      id: purchase.id,
      ok: true,
      status: settled.purchase.status,
      amount_usd: purchase.amount_usd,
    });
  } catch (error) {
    results.push({
      id: purchase.id,
      ok: false,
      amount_usd: purchase.amount_usd,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify({ ok: results.every((result) => result.ok !== false), checked: purchases.length, dry_run: dryRun, results }, null, 2));
if (results.some((result) => result.ok === false)) process.exitCode = 1;
