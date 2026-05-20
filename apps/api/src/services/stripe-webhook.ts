// Stripe checkout webhook processing. Pure functions plus async handlers that
// take `store` / `crossmint` / `alerts` as plain arguments — no Fastify
// awareness. The route plugin reads `request.rawBody` and calls these.

import { randomUUID } from "node:crypto";

import {
  attachCheckoutToCreditPurchase,
  claimCreditPurchaseForFunding,
  markCreditPurchaseFailed,
  parseUsd,
  settleFundedCreditPurchase,
} from "./billing.ts";
import { ensureAgentWalletAccount } from "./agentkit-account.ts";

export function checkoutSessionFromEvent(event: any) {
  return event?.data?.object || event?.object || {};
}

function purchaseIdFromCheckoutSession(session: any) {
  return (
    session?.client_reference_id ||
    session?.metadata?.toolrouter_purchase_id ||
    null
  );
}

function usdToCents(value: any, label: string) {
  const atomic = parseUsd(value, label);
  if (atomic % 10_000n !== 0n) {
    throw Object.assign(new Error(`${label} must be in whole cents`), {
      statusCode: 400,
      code: "invalid_webhook",
    });
  }
  return atomic / 10_000n;
}

export function assertPaidCheckoutSession(session: any, purchase: any) {
  const metadata = session?.metadata || {};
  const expectedCents = usdToCents(purchase.amount_usd, "stored purchase amount");
  const actualCents =
    session?.amount_total === undefined || session?.amount_total === null
      ? null
      : BigInt(session.amount_total);
  const metadataCents = metadata.amount_usd
    ? usdToCents(metadata.amount_usd, "checkout metadata amount_usd")
    : null;

  const invalid = (message: string) =>
    Object.assign(new Error(message), {
      statusCode: 400,
      code: "invalid_webhook",
    });

  if (session?.payment_status !== "paid") {
    throw invalid("Stripe checkout session is not paid");
  }
  if (String(session?.currency || "").toLowerCase() !== "usd") {
    throw invalid("Stripe checkout session currency must be USD");
  }
  if (actualCents === null || actualCents !== expectedCents) {
    throw invalid("Stripe checkout session amount does not match purchase");
  }
  if (!session?.id || session.id !== purchase.provider_checkout_session_id) {
    throw invalid("Stripe checkout session id does not match purchase");
  }
  if (metadata.toolrouter_purchase_id !== purchase.id) {
    throw invalid("Stripe checkout session purchase metadata does not match");
  }
  if (metadata.toolrouter_user_id !== purchase.user_id) {
    throw invalid("Stripe checkout session user metadata does not match");
  }
  if (metadataCents === null || metadataCents !== expectedCents) {
    throw invalid("Stripe checkout session amount metadata does not match");
  }
}

export { attachCheckoutToCreditPurchase };

export async function processStripeCheckoutCompleted({
  store,
  crossmint,
  alerts,
  session,
  event,
}: any) {
  const providerSessionId = session?.id || null;
  const purchaseId = purchaseIdFromCheckoutSession(session);
  const existingPurchase =
    (purchaseId ? await store.getCreditPurchase(purchaseId) : null) ||
    (providerSessionId ? await store.findCreditPurchaseByProviderSession(providerSessionId) : null);
  if (!existingPurchase) {
    throw Object.assign(new Error("credit purchase not found"), {
      statusCode: 404,
      code: "not_found",
    });
  }
  assertPaidCheckoutSession(session, existingPurchase);
  const { purchase, claimed, duplicate } = await claimCreditPurchaseForFunding({
    store,
    purchaseId,
    providerSessionId,
  });
  if (!claimed) {
    return {
      ok: true,
      duplicate,
      purchase_id: purchase.id,
      status: purchase.status,
    };
  }

  let wallet: any = null;
  try {
    wallet = await ensureAgentWalletAccount(store, crossmint, {
      user_id: purchase.user_id,
    });
    if (!wallet?.address) {
      throw Object.assign(new Error("agent account address is required for funding"), {
        code: "agent_wallet_missing",
      });
    }
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
        stripe_event_id: event?.id || null,
        stripe_checkout_session_id: providerSessionId,
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
        stripe_event_id: event?.id || null,
        stripe_checkout_session_id: providerSessionId,
      },
    });
    return {
      ok: true,
      duplicate: settled.duplicate,
      purchase_id: settled.purchase.id,
      status: settled.purchase.status,
    };
  } catch (error) {
    const alreadyAlerted = Boolean(purchase?.metadata?.funding_alert_sent_at);
    const failed = await markCreditPurchaseFailed({
      store,
      purchase,
      status: "funding_failed",
      reason: error instanceof Error ? error.message : String(error),
      metadata: {
        stripe_event_id: event?.id || null,
        stripe_checkout_session_id: providerSessionId,
        wallet_account_id: wallet?.id || null,
      },
    });
    if (!failed.duplicate && !alreadyAlerted) {
      const alertSubject = `ToolRouter credit funding failed: ${purchase.id}`;
      const alertText = [
        "ToolRouter could not settle a paid Stripe credit purchase.",
        "",
        `Purchase: ${purchase.id}`,
        `Stripe session: ${providerSessionId || "unknown"}`,
        `User: ${purchase.user_id}`,
        `Amount: $${purchase.amount_usd}`,
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        "",
        "Credits were not made available. Top up the treasury and run npm run billing:retry-funding, or wait for Stripe webhook retry if it is still active.",
      ].join("\n");
      let alertResult: any = null;
      try {
        alertResult = await alerts?.sendOperationalAlert?.({
          subject: alertSubject,
          text: alertText,
          metadata: {
            purchase_id: purchase.id,
            stripe_checkout_session_id: providerSessionId,
          },
        });
      } catch (alertError) {
        alertResult = {
          sent: false,
          error: alertError instanceof Error ? alertError.message : String(alertError),
        };
      }
      await store.updateCreditPurchase({
        ...failed.purchase,
        metadata: {
          ...(failed.purchase.metadata || {}),
          funding_alert_sent_at: new Date().toISOString(),
          funding_alert_sent: Boolean(alertResult?.sent),
          funding_alert_error: alertResult?.error || null,
        },
      });
    }
    return {
      ok: false,
      duplicate: failed.duplicate,
      purchase_id: failed.purchase.id,
      status: failed.purchase.status,
      error: failed.purchase.error,
    };
  }
}

export async function processStripeCheckoutFailed({ store, session, event }: any) {
  const providerSessionId = session?.id || null;
  const purchaseId = purchaseIdFromCheckoutSession(session);
  const purchase =
    (purchaseId ? await store.getCreditPurchase(purchaseId) : null) ||
    (providerSessionId ? await store.findCreditPurchaseByProviderSession(providerSessionId) : null);
  if (!purchase) return { ok: true, ignored: true };
  const failed = await markCreditPurchaseFailed({
    store,
    purchase,
    status: "checkout_failed",
    reason: String(event?.type || "checkout_failed"),
    metadata: {
      stripe_event_id: event?.id || null,
      stripe_checkout_session_id: providerSessionId,
    },
  });
  return {
    ok: true,
    duplicate: failed.duplicate,
    purchase_id: failed.purchase.id,
    status: failed.purchase.status,
  };
}
