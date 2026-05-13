import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { StripeClient } from "../../../apps/api/src/stripe.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.STRIPE_API_BASE_URL;
  delete process.env.TOOLROUTER_CHECKOUT_SUCCESS_URL;
  delete process.env.TOOLROUTER_CHECKOUT_CANCEL_URL;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.ROUTER_DEV_MODE;
  delete process.env.STRIPE_ALLOW_LIVE_CHECKOUT;
});

describe("Stripe checkout", () => {
  it("creates a Checkout Session for ToolRouter credits", async () => {
    const calls = [];
    process.env.STRIPE_API_BASE_URL = "https://stripe.test";
    process.env.TOOLROUTER_CHECKOUT_SUCCESS_URL = "https://toolrouter.test/dashboard#billing";
    process.env.TOOLROUTER_CHECKOUT_CANCEL_URL = "https://toolrouter.test/dashboard#billing";
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        id: "cs_test_1",
        url: "https://checkout.stripe.test/cs_test_1",
        payment_intent: "pi_test_1",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = new StripeClient({ secretKey: "sk_test" });
    const session = await client.createCheckoutSession({
      user: {
        user_id: "00000000-0000-4000-8000-000000000001",
        email: "agent@example.com",
      },
      amountUsd: "12.50",
      purchaseId: "cp_1",
    });

    const body = new URLSearchParams(calls[0].init.body);
    assert.equal(calls[0].url, "https://stripe.test/v1/checkout/sessions");
    assert.equal(calls[0].init.headers.authorization, "Bearer sk_test");
    assert.equal(body.get("mode"), "payment");
    assert.equal(body.get("client_reference_id"), "cp_1");
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "1250");
    assert.equal(body.get("metadata[toolrouter_purchase_id]"), "cp_1");
    assert.equal(session.provider_reference, "cs_test_1");
  });

  it("refuses live Checkout Sessions in dev mode unless explicitly allowed", async () => {
    process.env.ROUTER_DEV_MODE = "true";
    const liveSecretPrefix = ["sk", "live"].join("_");
    const client = new StripeClient({ secretKey: `${liveSecretPrefix}_fixture` });

    await assert.rejects(
      () =>
        client.createCheckoutSession({
          user: { user_id: "00000000-0000-4000-8000-000000000001" },
          amountUsd: "5",
          purchaseId: "cp_1",
        }),
      /Refusing to create live Stripe Checkout Sessions/,
    );
  });

  it("verifies Stripe webhook signatures", () => {
    const client = new StripeClient({ webhookSecret: "whsec_test" });
    const rawBody = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_1" } },
    });
    const timestamp = "1700000000";
    const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.${rawBody}`).digest("hex");
    const event = client.constructWebhookEvent(rawBody, {
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    });

    assert.equal(event.id, "evt_1");
    assert.throws(
      () =>
        client.constructWebhookEvent(rawBody, {
          "stripe-signature": `t=${timestamp},v1=bad`,
        }),
      /invalid Stripe webhook signature/,
    );
  });
});
