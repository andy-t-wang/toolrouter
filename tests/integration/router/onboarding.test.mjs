import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalEnv = {
  ROUTER_DEV_MODE: process.env.ROUTER_DEV_MODE,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  TOOLROUTER_DEV_USER_ID: process.env.TOOLROUTER_DEV_USER_ID,
  TOOLROUTER_DEV_CREDIT_BALANCE_USD: process.env.TOOLROUTER_DEV_CREDIT_BALANCE_USD,
  TOOLROUTER_MAX_TOP_UP_USD: process.env.TOOLROUTER_MAX_TOP_UP_USD,
};

process.env.ROUTER_DEV_MODE = "true";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.TOOLROUTER_DEV_USER_ID = "00000000-0000-4000-8000-000000000101";
process.env.TOOLROUTER_DEV_CREDIT_BALANCE_USD = "0";
process.env.TOOLROUTER_MAX_TOP_UP_USD = "5";

const { createApiApp } = await import("../../../apps/api/src/app.ts");
const { MemoryCache } = await import("../../../packages/cache/src/index.ts");
const { LocalStore } = await import("../../../packages/db/src/index.ts");

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function jsonHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    ...extra,
  };
}

function sessionHeaders() {
  return jsonHeaders({
    authorization: "Bearer dev_supabase_session",
  });
}

describe("agent-focused onboarding wrapper", () => {
  let app;
  let baseUrl;
  let store;
  let authRequests;
  let stripeRequests;

  before(async () => {
    authRequests = [];
    stripeRequests = [];
    store = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-onboarding-")), "store.json"),
    });
    app = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store,
      onboardingAuth: {
        async createMagicLink(payload) {
          authRequests.push(payload);
          return {
            provider: "supabase-test",
            auth_url: `https://supabase.test/magic?session=${payload.onboardingSessionId}&email=${encodeURIComponent(payload.email)}`,
          };
        },
      },
      stripe: {
        assertCheckoutAllowed() {
          stripeRequests.push({ type: "assertCheckoutAllowed" });
        },
        constructWebhookEvent(rawBody) {
          return typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
        },
        async createCheckoutSession(payload) {
          stripeRequests.push({ type: "createCheckoutSession", payload });
          return {
            provider_reference: `cs_test_${payload.purchaseId}`,
            checkout_url: `https://checkout.stripe.test/pay/${payload.purchaseId}`,
            payment_intent: `pi_test_${payload.purchaseId}`,
          };
        },
      },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  });

  after(async () => {
    await app.close();
    restoreEnv();
  });

  it("creates a Supabase-auth onboarding session, attaches the verified user, mints a key, and creates Stripe checkout", async () => {
    const startResponse = await fetch(`${baseUrl}/v1/onboarding/sessions`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        email: "Agent.User@Example.com",
        client: "codex",
        redirect_to: "http://127.0.0.1:3000/onboarding/confirm",
      }),
    });
    assert.equal(startResponse.status, 201);
    const started = await startResponse.json();
    assert.match(started.claim_token, /^otr_/);
    assert.equal(started.onboarding_session.email, "agent.user@example.com");
    assert.equal(started.onboarding_session.status, "auth_link_sent");
    assert.match(started.onboarding_session.auth_url, /^https:\/\/supabase\.test\/magic/);
    assert.equal(authRequests.length, 1);
    assert.equal(authRequests[0].email, "agent.user@example.com");

    const sessionId = started.onboarding_session.id;
    const storedBeforeAttach = await store.getOnboardingSession(sessionId);
    assert.notEqual(storedBeforeAttach.claim_token_hash, started.claim_token);

    const pollResponse = await fetch(`${baseUrl}/v1/onboarding/sessions/${encodeURIComponent(sessionId)}`, {
      headers: {
        authorization: `Bearer ${started.claim_token}`,
      },
    });
    assert.equal(pollResponse.status, 200);
    assert.equal((await pollResponse.json()).onboarding_session.status, "auth_link_sent");

    const attachResponse = await fetch(`${baseUrl}/v1/onboarding/sessions/${encodeURIComponent(sessionId)}/attach-user`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({
        claim_token: started.claim_token,
        caller_id: "codex-local-onboarding",
      }),
    });
    assert.equal(attachResponse.status, 201);
    const attached = await attachResponse.json();
    assert.match(attached.api_key, /^tr_/);
    assert.equal(attached.api_key_record.caller_id, "codex-local-onboarding");
    assert.equal(attached.onboarding_session.status, "api_key_created");
    assert.equal(attached.onboarding_session.user_id, process.env.TOOLROUTER_DEV_USER_ID);
    assert.equal((await store.getCreditAccount({ user_id: process.env.TOOLROUTER_DEV_USER_ID })).available_usd, "0");

    const categoriesResponse = await fetch(`${baseUrl}/v1/categories`, {
      headers: {
        authorization: `Bearer ${attached.api_key}`,
      },
    });
    assert.equal(categoriesResponse.status, 200);
    assert.ok((await categoriesResponse.json()).categories.some((category) => category.id === "search"));

    const checkoutResponse = await fetch(`${baseUrl}/v1/onboarding/sessions/${encodeURIComponent(sessionId)}/checkout`, {
      method: "POST",
      headers: jsonHeaders({
        authorization: `Bearer ${started.claim_token}`,
      }),
      body: JSON.stringify({
        amountUsd: "5",
      }),
    });
    assert.equal(checkoutResponse.status, 201);
    const checkout = await checkoutResponse.json();
    assert.equal(checkout.onboarding_session.status, "checkout_pending");
    assert.match(checkout.top_up.id, /^cp_/);
    assert.match(checkout.top_up.provider_reference, /^cs_test_cp_/);
    assert.equal(checkout.top_up.amount_usd, "5");
    assert.match(checkout.top_up.checkout_url, /^https:\/\/checkout\.stripe\.test\/pay\/cp_/);
    assert.equal(stripeRequests.filter((request) => request.type === "createCheckoutSession").length, 1);
    assert.equal(stripeRequests.find((request) => request.type === "createCheckoutSession").payload.user.user_id, process.env.TOOLROUTER_DEV_USER_ID);

    const purchase = await store.getCreditPurchase(checkout.top_up.id);
    assert.equal(purchase.status, "checkout_pending");
    assert.equal(purchase.user_id, process.env.TOOLROUTER_DEV_USER_ID);
    assert.equal(purchase.metadata.source, "onboarding");
    assert.equal(purchase.metadata.onboarding_session_id, sessionId);

    const stripeWebhookResponse = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: jsonHeaders(),
      payload: JSON.stringify({
        id: "evt_onboarding_checkout_completed",
        type: "checkout.session.completed",
        data: {
          object: {
            id: checkout.top_up.provider_reference,
            client_reference_id: checkout.top_up.id,
            payment_status: "paid",
          },
        },
      }),
    });
    assert.equal(stripeWebhookResponse.statusCode, 200);
    assert.equal(stripeWebhookResponse.json().status, "funded");

    const fundedPollResponse = await fetch(`${baseUrl}/v1/onboarding/sessions/${encodeURIComponent(sessionId)}`, {
      headers: {
        authorization: `Bearer ${started.claim_token}`,
      },
    });
    assert.equal(fundedPollResponse.status, 200);
    const fundedPoll = await fundedPollResponse.json();
    assert.equal(fundedPoll.onboarding_session.status, "funded");
    assert.equal((await store.getCreditAccount({ user_id: process.env.TOOLROUTER_DEV_USER_ID })).available_usd, "5");
  });
});
