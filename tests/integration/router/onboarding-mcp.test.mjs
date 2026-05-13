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
process.env.TOOLROUTER_DEV_USER_ID = "00000000-0000-4000-8000-000000000202";
process.env.TOOLROUTER_DEV_CREDIT_BALANCE_USD = "0";
process.env.TOOLROUTER_MAX_TOP_UP_USD = "5";

const { createApiApp } = await import("../../../apps/api/src/app.ts");
const { callTool } = await import("../../../apps/mcp/src/server.ts");
const { MemoryCache } = await import("../../../packages/cache/src/index.ts");
const { LocalStore } = await import("../../../packages/db/src/index.ts");

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function assertToolOk(result, label) {
  assert.equal(result.isError, false, `${label}: ${result.content?.[0]?.text || "MCP tool returned an error"}`);
  assert.ok(result.structuredContent, `${label}: missing structured content`);
  return result.structuredContent;
}

describe("ToolRouter onboarding through MCP", () => {
  let app;
  let baseUrl;
  let store;
  let registrationSubmissions;

  before(async () => {
    registrationSubmissions = [];
    store = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-onboarding-mcp-")), "store.json"),
    });
    app = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store,
      onboardingAuth: {
        async createMagicLink(payload) {
          return {
            provider: "supabase-test",
            auth_url: `https://supabase.test/magic?session=${payload.onboardingSessionId}&email=${encodeURIComponent(payload.email)}`,
          };
        },
      },
      agentBookRegistration: {
        async nextNonce() {
          return 7n;
        },
        async submit(registration) {
          registrationSubmissions.push(registration);
          return { txHash: "0xagentkit" };
        },
      },
      agentBookVerifier: {
        async lookupHuman() {
          return "human_test";
        },
      },
      stripe: {
        assertCheckoutAllowed() {},
        constructWebhookEvent(rawBody) {
          return typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
        },
        async createCheckoutSession(payload) {
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

  it("lets an agent bootstrap auth, mint an API key, use MCP tools, and create checkout", async () => {
    const bootstrapEnv = { TOOLROUTER_API_URL: baseUrl };
    const runtime = {};
    const fetchImpl = async (url, init) => {
      const href = String(url);
      if (href === "https://bridge.test/request") {
        return new Response(JSON.stringify({ request_id: "wid_req_integration" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return fetch(url, init);
    };

    const started = assertToolOk(
      await callTool("toolrouter_start_onboarding", {
        email: "Agent.User@Example.com",
        client: "codex",
        redirect_to: "http://127.0.0.1:3000/onboarding/confirm",
      }, { env: bootstrapEnv, runtime }),
      "toolrouter_start_onboarding",
    );
    assert.match(started.claim_token, /^otr_/);
    assert.match(started.onboarding_session.id, /^obs_/);
    assert.equal(started.onboarding_session.status, "auth_link_sent");
    assert.match(started.onboarding_session.auth_url, /^https:\/\/supabase\.test\/magic/);

    const sessionId = started.onboarding_session.id;
    const claimToken = started.claim_token;

    const polled = assertToolOk(
      await callTool("toolrouter_get_onboarding_session", {
        onboarding_session_id: sessionId,
        claim_token: claimToken,
      }, { env: bootstrapEnv, runtime }),
      "toolrouter_get_onboarding_session",
    );
    assert.equal(polled.onboarding_session.status, "auth_link_sent");

    const attached = assertToolOk(
      await callTool("toolrouter_attach_onboarding_user", {
        onboarding_session_id: sessionId,
        claim_token: claimToken,
        supabase_access_token: "dev_supabase_session",
        caller_id: "codex-mcp-onboarding",
      }, { env: bootstrapEnv, runtime }),
      "toolrouter_attach_onboarding_user",
    );
    assert.match(attached.api_key, /^tr_/);
    assert.equal(attached.onboarding_session.status, "api_key_created");
    assert.equal(attached.next_steps.world_verification_required, false);
    assert.equal(runtime.apiKey, attached.api_key);
    assert.equal(runtime.supabaseAccessToken, "dev_supabase_session");

    const categories = assertToolOk(
      await callTool("toolrouter_list_categories", {}, {
        env: bootstrapEnv,
        runtime,
      }),
      "toolrouter_list_categories",
    );
    assert.ok(categories.categories.some((category) => category.id === "search"));

    const checkout = assertToolOk(
      await callTool("toolrouter_create_onboarding_checkout", {
        onboarding_session_id: sessionId,
        claim_token: claimToken,
        amount_usd: "5",
      }, { env: bootstrapEnv, runtime }),
      "toolrouter_create_onboarding_checkout",
    );
    assert.equal(checkout.onboarding_session.status, "checkout_pending");
    assert.match(checkout.top_up.provider_reference, /^cs_test_cp_/);
    assert.match(checkout.top_up.checkout_url, /^https:\/\/checkout\.stripe\.test\/pay\/cp_/);
    assert.equal(checkout.next_steps.world_verification_required, false);

    const purchase = await store.getCreditPurchase(checkout.top_up.id);
    assert.equal(purchase.user_id, process.env.TOOLROUTER_DEV_USER_ID);
    assert.equal(purchase.metadata.source, "onboarding");
    assert.equal(purchase.metadata.onboarding_session_id, sessionId);

    const stripeWebhookResponse = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        id: "evt_onboarding_mcp_checkout_completed",
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

    const funded = assertToolOk(
      await callTool("toolrouter_get_onboarding_session", {
        onboarding_session_id: sessionId,
        claim_token: claimToken,
      }, { env: bootstrapEnv, runtime }),
      "toolrouter_get_onboarding_session after checkout completion",
    );
    assert.equal(funded.onboarding_session.status, "funded");

    const worldStarted = assertToolOk(
      await callTool("toolrouter_start_world_verification", {
        bridge_url: "https://bridge.test",
      }, { env: bootstrapEnv, runtime, fetchImpl }),
      "toolrouter_start_world_verification",
    );
    assert.equal(worldStarted.registration.nonce, "7");
    assert.match(worldStarted.world_bridge.verification_url, /^https:\/\/world\.org\/verify/);

    const worldCompleted = assertToolOk(
      await callTool("toolrouter_complete_world_verification", {
        result: {
          merkle_root: "0xroot",
          nullifier_hash: "0xnullifier",
          proof: ["0xproof"],
          verification_level: "orb",
        },
      }, { env: bootstrapEnv, runtime, fetchImpl }),
      "toolrouter_complete_world_verification",
    );
    assert.equal(worldCompleted.agentkit_verification.verified, true);
    assert.equal(worldCompleted.registration.tx_hash, "0xagentkit");
    assert.equal(registrationSubmissions.length, 1);
    assert.equal(registrationSubmissions[0].nonce, "7");

    const worldChecked = assertToolOk(
      await callTool("toolrouter_check_world_verification", {}, { env: bootstrapEnv, runtime, fetchImpl }),
      "toolrouter_check_world_verification",
    );
    assert.equal(worldChecked.agentkit_verification.verified, true);
  });
});
