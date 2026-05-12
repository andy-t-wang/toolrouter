#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryCache } from "../packages/cache/src/index.ts";
import { LocalStore } from "../packages/db/src/index.ts";
import { createApiApp } from "../apps/api/src/app.ts";

process.env.ROUTER_DEV_MODE = "true";
process.env.TOOLROUTER_MAX_TOP_UP_USD ||= "5";
process.env.TOOLROUTER_DEV_CREDIT_BALANCE_USD = "0";
process.env.TOOLROUTER_DEV_USER_ID ||= "00000000-0000-4000-8000-000000000005";
process.env.AGENTKIT_ROUTER_DEV_API_KEY ||= "stripe_local_e2e_key";

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY. Add a Stripe test secret key to .env before running this script.");
  process.exit(1);
}
if (process.env.STRIPE_SECRET_KEY.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE_CHECKOUT !== "true") {
  console.error("Refusing to run local Stripe E2E with a live key. Use an sk_test_ key, or set STRIPE_ALLOW_LIVE_CHECKOUT=true intentionally.");
  process.exit(1);
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.error("Missing STRIPE_WEBHOOK_SECRET. Add the Stripe webhook signing secret to .env before running this script.");
  process.exit(1);
}

const store = new LocalStore({
  path: join(mkdtempSync(join(tmpdir(), "toolrouter-stripe-e2e-")), "store.json"),
});

const crossmint = {
  async ensureWallet(user) {
    return {
      user_id: user.user_id,
      provider: "test",
      wallet_locator: `test:${user.user_id}`,
      address: "0x0000000000000000000000000000000000000005",
      chain_id: "eip155:8453",
      asset: "USDC",
      metadata: { local_e2e: true },
    };
  },
  async fundAgentWallet({ amountUsd }) {
    return {
      provider_reference: `fund_local_${Date.now()}`,
      transaction_id: `tx_local_${amountUsd}`,
    };
  },
};

const app = createApiApp({
  logger: false,
  cache: new MemoryCache(),
  store,
  crossmint,
});

const sessionHeaders = {
  authorization: "Bearer dev_supabase_session",
  "content-type": "application/json",
};

try {
  const rejected = await app.inject({
    method: "POST",
    url: "/v1/top-ups",
    headers: sessionHeaders,
    payload: { amountUsd: "5.01" },
  });
  assert.equal(rejected.statusCode, 400);

  const created = await app.inject({
    method: "POST",
    url: "/v1/top-ups",
    headers: sessionHeaders,
    payload: { amountUsd: "5" },
  });
  assert.equal(created.statusCode, 201);
  const topUp = created.json().top_up;
  assert.match(topUp.provider_reference, /^cs_/);
  assert.match(topUp.checkout_url, /^https:\/\/checkout\.stripe\.com\//);

  const event = {
    id: `evt_local_${Date.now()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: topUp.provider_reference,
        client_reference_id: topUp.id,
        payment_status: "paid",
      },
    },
  };
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const webhook = await app.inject({
    method: "POST",
    url: "/webhooks/stripe",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    payload: rawBody,
  });
  assert.equal(webhook.statusCode, 200);
  assert.equal(webhook.json().status, "funded");

  const balance = await app.inject({
    method: "GET",
    url: "/v1/balance",
    headers: sessionHeaders,
  });
  assert.equal(balance.statusCode, 200);
  assert.equal(balance.json().balance.available_usd, "5");

  console.log(
    JSON.stringify(
      {
        ok: true,
        cap_rejected: true,
        checkout_session: topUp.provider_reference,
        checkout_url: topUp.checkout_url,
        webhook_status: webhook.json().status,
        available_usd: balance.json().balance.available_usd,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
