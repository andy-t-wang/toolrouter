// /v1/ledger, /v1/balance, /v1/top-ups — credit account routes.
//
// All routes require a Supabase user. `POST /v1/top-ups` creates a Stripe
// checkout session via `app.stripe`.

import { authenticateSupabaseUser } from "@toolrouter/auth";

import {
  assertTopUpAmount,
  attachCheckoutToCreditPurchase,
  createCreditPurchase,
  ensureCreditAccount,
} from "../services/billing.ts";
import { getOrBootstrapVisibleAccount } from "../services/agentkit-account.ts";
import {
  dashboardBalanceDto,
  publicLedgerEntry,
  publicTopUp,
} from "../services/monitoring.ts";

function requireObject(value: any, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object`), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return value;
}

function topUpLimitUsd() {
  return assertTopUpAmount(process.env.TOOLROUTER_MAX_TOP_UP_USD || "5");
}

function recordStripeSessionMetric(datadog: any, status: string) {
  datadog?.increment?.("toolrouter.stripe.sessions.count", {
    status,
  }).catch(() => undefined);
}

export async function ledgerRoutes(app: any) {
  const { store, crossmint, stripe, datadog } = app;

  app.get("/v1/balance", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const [account, wallet] = await Promise.all([
      ensureCreditAccount(store, user.user_id),
      getOrBootstrapVisibleAccount(store, crossmint, user),
    ]);
    return {
      balance: dashboardBalanceDto(account, wallet, topUpLimitUsd()),
    };
  });

  app.get("/v1/ledger", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const limit = Math.max(
      1,
      Math.min(Number(request.query?.limit || 100), 500),
    );
    return {
      entries: (
        await store.listCreditLedgerEntries({
          user_id: user.user_id,
          limit,
          source_not: request.query?.activity_only === "true" ? "request" : undefined,
        })
      ).map(publicLedgerEntry),
    };
  });

  app.get("/v1/top-ups", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const limit = Math.max(
      1,
      Math.min(Number(request.query?.limit || 20), 100),
    );
    const purchases = await store.listCreditPurchases({
      user_id: user.user_id,
      limit,
    });
    return {
      top_ups: purchases.map(publicTopUp),
    };
  });

  app.post("/v1/top-ups", async (request: any, reply: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const body = requireObject(request.body || {}, "request body");
    const amountUsd = assertTopUpAmount(body.amountUsd || body.amount_usd);
    stripe.assertCheckoutAllowed?.();
    await ensureCreditAccount(store, user.user_id);
    const purchase = await createCreditPurchase({
      store,
      user_id: user.user_id,
      amountUsd,
      metadata: {
        source: "dashboard",
      },
    });
    const checkout = await stripe.createCheckoutSession({
      user,
      amountUsd,
      purchaseId: purchase.id,
    });
    const updated = await attachCheckoutToCreditPurchase({
      store,
      purchase,
      checkout,
    });
    recordStripeSessionMetric(datadog, "created");
    reply.status(201);
    return {
      top_up: {
        id: updated.id,
        provider: "stripe",
        amount_usd: amountUsd,
        checkout_url: updated.checkout_url,
        status: updated.status,
      },
    };
  });
}
