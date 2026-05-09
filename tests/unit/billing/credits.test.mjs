import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertTopUpAmount,
  attachCheckoutToCreditPurchase,
  claimCreditPurchaseForFunding,
  createCreditPurchase,
  ensureCreditAccount,
  finalizeCreditReservation,
  markCreditPurchaseFailed,
  reserveCredits,
  settleFundedCreditPurchase,
} from "../../../apps/api/src/billing.ts";
import { LocalStore } from "../../../packages/db/src/index.ts";

function store() {
  return new LocalStore({ path: join(mkdtempSync(join(tmpdir(), "toolrouter-billing-")), "store.json") });
}

describe("credit ledger", () => {
  it("reserves, captures, and releases request credits", async () => {
    const db = store();
    await db.upsertCreditAccount({
      user_id: "user_1",
      available_usd: "1.00",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });

    const reservation = await reserveCredits({
      store: db,
      user_id: "user_1",
      api_key_id: "key_1",
      trace_id: "trace_1",
      endpoint_id: "exa.search",
      amountUsd: "0.05",
    });
    assert.equal((await db.getCreditAccount({ user_id: "user_1" })).available_usd, "0.95");
    assert.equal((await db.getCreditAccount({ user_id: "user_1" })).reserved_usd, "0.05");

    const finalized = await finalizeCreditReservation({
      store: db,
      reservation,
      amountUsd: "0.02",
      paymentReference: "0xpaid",
    });
    assert.equal(finalized.credit_captured_usd, "0.02");
    assert.equal(finalized.credit_released_usd, "0.03");
    assert.equal((await db.getCreditAccount({ user_id: "user_1" })).available_usd, "0.98");
    assert.equal((await db.getCreditAccount({ user_id: "user_1" })).reserved_usd, "0");
  });

  it("rejects reservations above available credits", async () => {
    const db = store();
    await ensureCreditAccount(db, "user_2");
    await db.upsertCreditAccount({
      user_id: "user_2",
      available_usd: "0.01",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });

    await assert.rejects(
      () =>
        reserveCredits({
          store: db,
          user_id: "user_2",
          amountUsd: "0.02",
        }),
      /insufficient ToolRouter credits/,
    );
  });

  it("caps Stripe top-ups at 5 USD by default", () => {
    const previous = process.env.TOOLROUTER_MAX_TOP_UP_USD;
    delete process.env.TOOLROUTER_MAX_TOP_UP_USD;
    try {
      assert.equal(assertTopUpAmount("5"), "5");
      assert.throws(
        () => assertTopUpAmount("5.01"),
        /Top-ups are capped at \$5 for now\. Enter \$5 or less\./,
      );
    } finally {
      if (previous === undefined) delete process.env.TOOLROUTER_MAX_TOP_UP_USD;
      else process.env.TOOLROUTER_MAX_TOP_UP_USD = previous;
    }
  });

  it("settles Stripe-funded credit purchases idempotently", async () => {
    const db = store();
    await db.upsertCreditAccount({
      user_id: "user_3",
      available_usd: "0",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });
    const purchase = await createCreditPurchase({
      store: db,
      user_id: "user_3",
      amountUsd: "10",
    });
    const checkout = await attachCheckoutToCreditPurchase({
      store: db,
      purchase,
      checkout: {
        provider_reference: "cs_test_1",
        checkout_url: "https://checkout.stripe.test/cs_test_1",
      },
    });
    assert.equal((await db.getCreditAccount({ user_id: "user_3" })).available_usd, "0");

    const claim = await claimCreditPurchaseForFunding({
      store: db,
      purchaseId: checkout.id,
      providerSessionId: "cs_test_1",
    });
    assert.equal(claim.claimed, true);

    const first = await settleFundedCreditPurchase({
      store: db,
      purchase: claim.purchase,
      wallet_account_id: "wa_1",
      fundingReference: "cm_fund_1",
    });
    const second = await settleFundedCreditPurchase({
      store: db,
      purchase: first.purchase,
      wallet_account_id: "wa_1",
      fundingReference: "cm_fund_1",
    });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    const account = await db.getCreditAccount({ user_id: "user_3" });
    assert.equal(account.available_usd, "10");
    assert.equal(account.pending_usd, "0");
  });

  it("can reclaim failed funding purchases for retry", async () => {
    const db = store();
    const purchase = await createCreditPurchase({
      store: db,
      user_id: "user_retry",
      amountUsd: "5",
    });
    const checkout = await attachCheckoutToCreditPurchase({
      store: db,
      purchase,
      checkout: {
        provider_reference: "cs_retry_1",
      },
    });
    const firstClaim = await claimCreditPurchaseForFunding({
      store: db,
      purchaseId: checkout.id,
      providerSessionId: "cs_retry_1",
    });
    assert.equal(firstClaim.claimed, true);

    const failed = await markCreditPurchaseFailed({
      store: db,
      purchase: firstClaim.purchase,
      reason: "treasury empty",
    });
    assert.equal(failed.purchase.status, "funding_failed");

    const retryClaim = await claimCreditPurchaseForFunding({
      store: db,
      purchaseId: checkout.id,
      providerSessionId: "cs_retry_1",
    });
    assert.equal(retryClaim.claimed, true);
    assert.equal(retryClaim.purchase.status, "funding_pending");
  });
});
