import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ROUTER_DEV_MODE = "true";
process.env.AGENTKIT_ROUTER_DEV_API_KEY = "test_dev_key";
process.env.AGENTKIT_ROUTER_LOCAL_STORE = join(mkdtempSync(join(tmpdir(), "toolrouter-")), "store.json");
process.env.X402_MAX_USD_PER_REQUEST = "0.05";
process.env.TOOLROUTER_RATE_LIMIT_PER_MINUTE = "100";
process.env.TOOLROUTER_IP_RATE_LIMIT_PER_MINUTE = "100";
process.env.TOOLROUTER_DEV_CREDIT_BALANCE_USD = "100";
process.env.TOOLROUTER_MAX_TOP_UP_USD = "5";
process.env.TOOLROUTER_DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

const { createApiApp } = await import("../../../apps/api/src/app.ts");
const { MemoryCache } = await import("../../../packages/cache/src/index.ts");
const { LocalStore, createStore } = await import("../../../packages/db/src/index.ts");

function authHeaders() {
  return {
    authorization: "Bearer test_dev_key",
    "content-type": "application/json",
  };
}

function sessionHeaders() {
  return {
    authorization: "Bearer dev_supabase_session",
    "content-type": "application/json",
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}

describe("router API", () => {
  let app;
  let baseUrl;
  let store;
  let agentBookLookups;
  let agentBookNonces;
  let agentBookRegistrations;
  let manusWrapperCalls;
  let datadogMetrics;

  before(async () => {
    agentBookLookups = [];
    agentBookNonces = [];
    agentBookRegistrations = [];
    manusWrapperCalls = [];
    datadogMetrics = [];
    store = createStore();
    app = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store,
      agentBookVerifier: {
        lookupHuman: async (address) => {
          agentBookLookups.push(address);
          return "human_dev";
        },
      },
      agentBookRegistration: {
        nextNonce: async (address) => {
          agentBookNonces.push(address);
          return 7n;
        },
        submit: async (registration) => {
          agentBookRegistrations.push(registration);
          return { txHash: "0xagentkittx" };
        },
      },
      manusWrapper: {
        handle: async (request) => {
          manusWrapperCalls.push(request.body);
          return {
            ok: true,
            provider: "manus",
            task: { id: "task_test" },
          };
        },
      },
      datadog: {
        increment: async (metric, tags) => {
          datadogMetrics.push({ metric, tags });
          return { sent: true };
        },
      },
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  });

  after(async () => {
    await app.close();
  });

  it("exposes minimal public health", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: "toolrouter-api",
      version: "0.1.0",
    });
  });

  it("exposes the ToolRouter x402 Manus wrapper route", async () => {
    const response = await fetch(`${baseUrl}/x402/manus/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "Find tools for visual lookup",
        task_type: "tool_discovery",
        depth: "quick",
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      provider: "manus",
      task: { id: "task_test" },
    });
    assert.deepEqual(manusWrapperCalls.at(-1), {
      query: "Find tools for visual lookup",
      task_type: "tool_discovery",
      depth: "quick",
    });
  });

  it("retries Manus wrapper initialization after a transient failure", async () => {
    let attempts = 0;
    const retryApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: new LocalStore(join(mkdtempSync(join(tmpdir(), "toolrouter-manus-retry-")), "store.json")),
      agentBookVerifier: {
        lookupHuman: async () => "human_retry",
      },
      createManusWrapper: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("temporary Manus wrapper init failure"), {
            statusCode: 503,
            code: "manus_wrapper_init_failed",
          });
        }
        return {
          handle: async () => ({
            ok: true,
            provider: "manus",
            task: { id: "task_retry" },
          }),
        };
      },
    });

    try {
      const first = await retryApp.inject({
        method: "POST",
        url: "/x402/manus/research",
        payload: { query: "first attempt" },
      });
      assert.equal(first.statusCode, 503);

      const second = await retryApp.inject({
        method: "POST",
        url: "/x402/manus/research",
        payload: { query: "second attempt" },
      });
      assert.equal(second.statusCode, 200);
      assert.deepEqual(second.json(), {
        ok: true,
        provider: "manus",
        task: { id: "task_retry" },
      });
      assert.equal(attempts, 2);
    } finally {
      await retryApp.close();
    }
  });

  it("requires auth for endpoint listing", async () => {
    const response = await fetch(`${baseUrl}/v1/endpoints`);
    assert.equal(response.status, 401);

    const categoryResponse = await fetch(`${baseUrl}/v1/categories`);
    assert.equal(categoryResponse.status, 401);
  });

  it("lists endpoints with API-key auth and dashboard session auth", async () => {
    const response = await fetch(`${baseUrl}/v1/endpoints?category=search`, { headers: authHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(
      body.endpoints.map((endpoint) => endpoint.id),
      ["exa.search"],
    );
    assert.ok(body.endpoints.every((endpoint) => endpoint.status));

    const dashboardResponse = await fetch(`${baseUrl}/v1/dashboard/endpoints`, { headers: sessionHeaders() });
    assert.equal(dashboardResponse.status, 200);
    assert.deepEqual(
      (await dashboardResponse.json()).endpoints.map((endpoint) => endpoint.id),
      ["browserbase.session", "exa.search", "manus.research"],
    );
  });

  it("lists generic categories with recommended endpoints", async () => {
    const response = await fetch(`${baseUrl}/v1/categories`, { headers: authHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.categories.map((category) => category.id), ["search", "research", "browser_usage"]);
    const search = body.categories.find((category) => category.id === "search");
    assert.equal(search.recommended_endpoint_id, "exa.search");
    assert.equal(search.recommended_endpoint.id, "exa.search");
    assert.equal(search.recommended_mcp_tool, "toolrouter_search");
    const research = body.categories.find((category) => category.id === "research");
    assert.equal(research.recommended_endpoint_id, "manus.research");
    assert.equal(research.recommended_endpoint.id, "manus.research");
    assert.equal(research.recommended_mcp_tool, "manus_research_start");
    assert.ok(search.endpoints.every((endpoint) => endpoint.status));

    const dashboardResponse = await fetch(`${baseUrl}/v1/dashboard/categories?include_empty=true`, { headers: sessionHeaders() });
    assert.equal(dashboardResponse.status, 200);
    const dashboardBody = await dashboardResponse.json();
    assert.ok(dashboardBody.categories.some((category) => category.id === "maps"));
    assert.equal(
      dashboardBody.categories.find((category) => category.id === "maps").recommended_endpoint,
      null,
    );
  });

  it("exposes public endpoint status from real health rows", async () => {
    const checkedAt = new Date().toISOString();
    await store.insertHealthCheck({
      id: "hc_test_exa_search",
      endpoint_id: "exa.search",
      checked_at: checkedAt,
      status: "healthy",
      status_code: 200,
      latency_ms: 123,
      path: "agentkit",
      charged: false,
      estimated_usd: "0.007",
      amount_usd: "0",
      currency: "USD",
      payment_reference: null,
      payment_network: null,
      payment_error: null,
      error: null,
    });
    await store.upsertEndpointStatus({
      endpoint_id: "exa.search",
      status: "healthy",
      last_checked_at: checkedAt,
      status_code: 200,
      latency_ms: 123,
      path: "agentkit",
      charged: false,
      estimated_usd: "0.007",
      amount_usd: "0",
      currency: "USD",
      payment_reference: null,
      payment_network: null,
      payment_error: null,
      last_error: null,
    });

    const response = await fetch(`${baseUrl}/v1/status`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "unverified");
    assert.equal(body.summary.endpoint_count, 3);
    assert.equal(body.summary.operational_count, 1);
    assert.deepEqual(
      body.endpoints.map((endpoint) => endpoint.id).sort(),
      ["browserbase.session", "exa.search", "manus.research"].sort(),
    );
    const exa = body.endpoints.find((endpoint) => endpoint.id === "exa.search");
    assert.equal(exa.status, "healthy");
    assert.equal(exa.latency_ms, 123);
    assert.equal(exa.p50_latency_ms, 123);
    assert.equal(exa.sparkline_30d.length, 30);
    assert.ok(exa.uptime_30d > 0);
    assert.equal(exa.agentkit_value_label, "AgentKit-Free Trial");
    assert.equal(exa.agentkit_status, "healthy");
    assert.equal(exa.agentkit_operational, true);
    assert.equal(exa.agentkit_path, "agentkit");
    assert.equal(exa.last_error, null);
  });

  it("redacts raw health errors from public status", async () => {
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-public-status-redaction-")), "store.json"),
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const checkedAt = new Date().toISOString();
      await isolatedStore.insertHealthCheck({
        id: "hc_raw_error",
        endpoint_id: "exa.search",
        checked_at: checkedAt,
        status: "failing",
        status_code: 504,
        latency_ms: 8000,
        path: "x402",
        charged: false,
        error: "provider timed out after 8000ms with payment header secret_value",
      });
      await isolatedStore.upsertEndpointStatus({
        endpoint_id: "exa.search",
        status: "failing",
        last_checked_at: checkedAt,
        status_code: 504,
        latency_ms: 8000,
        path: "x402",
        charged: false,
        last_error: "provider timed out after 8000ms with payment header secret_value",
      });

      const response = await fetch(`${isolatedBaseUrl}/v1/status`);
      assert.equal(response.status, 200);
      const body = await response.json();
      const exa = body.endpoints.find((endpoint) => endpoint.id === "exa.search");
      assert.equal(exa.last_error, "Provider timed out");
      assert.doesNotMatch(JSON.stringify(body), /secret_value/);
    } finally {
      await isolatedApp.close();
    }
  });

  it("creates dashboard-owned API keys without an admin token", async () => {
    const response = await fetch(`${baseUrl}/v1/api-keys`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({ caller_id: "test-dashboard" }),
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.match(created.api_key, /^tr_/);
    assert.equal(created.record.user_id, process.env.TOOLROUTER_DEV_USER_ID);

    const listResponse = await fetch(`${baseUrl}/v1/api-keys`, { headers: sessionHeaders() });
    const listed = await listResponse.json();
    assert.ok(listed.api_keys.some((key) => key.caller_id === "test-dashboard"));
    assert.ok(listed.api_keys.every((key) => key.key_hash === undefined));
  });

  it("scopes API key names to active keys owned by one user", async () => {
    const userId = process.env.TOOLROUTER_DEV_USER_ID;
    const first = await store.createApiKey({ user_id: userId, caller_id: "scoped-default" });
    const otherUser = await store.createApiKey({
      user_id: "00000000-0000-4000-8000-000000000002",
      caller_id: "scoped-default",
    });

    assert.equal(first.record.caller_id, "scoped-default");
    assert.equal(otherUser.record.caller_id, "scoped-default");

    const duplicateResponse = await fetch(`${baseUrl}/v1/api-keys`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({ caller_id: "scoped-default" }),
    });
    assert.equal(duplicateResponse.status, 409);
    assert.equal((await duplicateResponse.json()).error.code, "api_key_name_conflict");

    await store.disableApiKey({ id: first.record.id, user_id: userId });
    const replacementResponse = await fetch(`${baseUrl}/v1/api-keys`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({ caller_id: "scoped-default" }),
    });
    assert.equal(replacementResponse.status, 201);
  });

  it("exposes balance, creates Stripe top-ups, and settles funded webhooks idempotently", async () => {
    const balanceResponse = await fetch(`${baseUrl}/v1/balance`, { headers: sessionHeaders() });
    assert.equal(balanceResponse.status, 200);
    assert.equal((await balanceResponse.json()).balance.available_usd, "100");

    const topUpResponse = await fetch(`${baseUrl}/v1/top-ups`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({ amountUsd: "5" }),
    });
    assert.equal(topUpResponse.status, 201);
    const topUp = (await topUpResponse.json()).top_up;
    assert.equal(topUp.provider, "stripe");
    assert.match(topUp.id, /^cp_/);
    assert.equal(topUp.provider_reference, undefined);
    assert.equal(topUp.wallet_address, undefined);
    const createdPurchase = (await store.listCreditPurchases({
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      limit: 1,
    }))[0];
    assert.match(createdPurchase.provider_checkout_session_id, /^cs_dev_/);

    const topUpsResponse = await fetch(`${baseUrl}/v1/top-ups`, { headers: sessionHeaders() });
    assert.equal(topUpsResponse.status, 200);
    const topUps = await topUpsResponse.json();
    assert.equal(topUps.top_ups[0].id, topUp.id);
    assert.equal(topUps.top_ups[0].status, "checkout_pending");
    assert.equal(topUps.top_ups[0].checkout_url, undefined);

    const pendingResponse = await fetch(`${baseUrl}/v1/balance`, { headers: sessionHeaders() });
    const pending = await pendingResponse.json();
    assert.equal(pending.balance.available_usd, "100");
    assert.equal(pending.balance.pending_usd, undefined);
    assert.equal(pending.balance.reserved_usd, undefined);
    assert.equal(pending.balance.limits.max_top_up_usd, "5");

    const webhookBody = {
      id: "evt_dev_completed_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: createdPurchase.provider_checkout_session_id,
          client_reference_id: topUp.id,
          payment_status: "paid",
          currency: "usd",
          amount_total: 500,
          metadata: {
            toolrouter_purchase_id: topUp.id,
            toolrouter_user_id: process.env.TOOLROUTER_DEV_USER_ID,
            amount_usd: "5",
          },
        },
      },
    };
    const webhookResponse = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookBody),
    });
    assert.equal(webhookResponse.status, 200);
    assert.equal((await webhookResponse.json()).duplicate, false);

    const duplicateResponse = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookBody),
    });
    assert.equal((await duplicateResponse.json()).duplicate, true);

    const settledResponse = await fetch(`${baseUrl}/v1/balance`, { headers: sessionHeaders() });
    const settled = await settledResponse.json();
    assert.equal(settled.balance.available_usd, "105");
    assert.equal(settled.balance.pending_usd, undefined);

    const ledgerResponse = await fetch(`${baseUrl}/v1/ledger`, { headers: sessionHeaders() });
    const ledger = await ledgerResponse.json();
    assert.ok(ledger.entries.some((entry) => entry.type === "top_up_settled"));

    for (let index = 0; index < 60; index += 1) {
      await store.insertCreditLedgerEntry({
        id: `cle_request_noise_${index}`,
        user_id: process.env.TOOLROUTER_DEV_USER_ID,
        ts: new Date(Date.parse("2026-05-11T00:00:00.000Z") + index).toISOString(),
        type: "reserve",
        amount_usd: "0.01",
        source: "request",
        reference_id: `crr_noise_${index}`,
        metadata: {},
      });
    }
    const activityResponse = await fetch(`${baseUrl}/v1/ledger?limit=50&activity_only=true`, {
      headers: sessionHeaders(),
    });
    const activity = await activityResponse.json();
    assert.ok(activity.entries.some((entry) => entry.type === "top_up_settled"));
    assert.ok(activity.entries.every((entry) => !["reserve", "capture", "release"].includes(entry.type)));

    const settledTopUpsResponse = await fetch(`${baseUrl}/v1/top-ups`, { headers: sessionHeaders() });
    const settledTopUps = await settledTopUpsResponse.json();
    assert.equal(settledTopUps.top_ups[0].id, topUp.id);
    assert.equal(settledTopUps.top_ups[0].status, "funded");
  });

  it("rejects top-ups above the configured cap before checkout", async () => {
    const topUpResponse = await fetch(`${baseUrl}/v1/top-ups`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({ amountUsd: "5.01" }),
    });
    assert.equal(topUpResponse.status, 400);
    const body = await topUpResponse.json();
    assert.equal(body.error.code, "invalid_amount");
    assert.match(body.error.message, /Top-ups are capped at \$5 for now\. Enter \$5 or less\./);
  });

  it("rejects unpaid or mismatched Stripe completion webhooks before funding", async () => {
    const topUpResponse = await fetch(`${baseUrl}/v1/top-ups`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({ amountUsd: "5" }),
    });
    assert.equal(topUpResponse.status, 201);
    const topUp = (await topUpResponse.json()).top_up;
    const purchase = await store.getCreditPurchase(topUp.id);

    const validSession = {
      id: purchase.provider_checkout_session_id,
      client_reference_id: topUp.id,
      payment_status: "paid",
      currency: "usd",
      amount_total: 500,
      metadata: {
        toolrouter_purchase_id: topUp.id,
        toolrouter_user_id: process.env.TOOLROUTER_DEV_USER_ID,
        amount_usd: "5",
      },
    };
    const invalidSessions = [
      { ...validSession, payment_status: "unpaid" },
      { ...validSession, id: "cs_wrong_session" },
      Object.fromEntries(Object.entries(validSession).filter(([key]) => key !== "id")),
      { ...validSession, amount_total: 499 },
      {
        ...validSession,
        metadata: {
          ...validSession.metadata,
          toolrouter_user_id: "00000000-0000-4000-8000-000000000099",
        },
      },
    ];

    for (const [index, session] of invalidSessions.entries()) {
      const invalidWebhook = await fetch(`${baseUrl}/webhooks/stripe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: `evt_dev_invalid_${index}`,
          type: "checkout.session.completed",
          data: { object: session },
        }),
      });
      assert.equal(invalidWebhook.status, 400);
      assert.equal((await invalidWebhook.json()).error.code, "invalid_webhook");

      const unchanged = await store.getCreditPurchase(topUp.id);
      assert.equal(unchanged.status, "checkout_pending");
      assert.equal(unchanged.funding_provider_reference ?? null, null);
    }
  });

  it("alerts and retries Stripe settlement when funding fails", async () => {
    const retryStore = new LocalStore({ path: join(mkdtempSync(join(tmpdir(), "toolrouter-retry-")), "store.json") });
    const alerts = [];
    let shouldFailFunding = true;
    const retryApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: retryStore,
      alerts: {
        sendOperationalAlert: async (payload) => {
          alerts.push(payload);
          return { sent: true };
        },
      },
      crossmint: {
        ensureWallet: async (user) => ({
          provider: "crossmint",
          wallet_locator: `evm:alias:test-${user.user_id}`,
          address: "0x00000000000000000000000000000000000000ff",
          chain_id: "eip155:8453",
          asset: "USDC",
          status: "active",
          metadata: {},
        }),
        fundAgentWallet: async () => {
          if (shouldFailFunding) throw new Error("treasury empty");
          return { provider_reference: "fund_retry_1", transaction_id: "tx_retry_1" };
        },
      },
    });

    const topUpResponse = await retryApp.inject({
      method: "POST",
      url: "/v1/top-ups",
      headers: sessionHeaders(),
      payload: { amountUsd: "5" },
    });
    assert.equal(topUpResponse.statusCode, 201);
    const topUp = topUpResponse.json().top_up;
    const createdPurchase = (await retryStore.listCreditPurchases({
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      limit: 1,
    }))[0];
    const webhookBody = {
      id: "evt_retry_completed_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: createdPurchase.provider_checkout_session_id,
          client_reference_id: topUp.id,
          payment_status: "paid",
          currency: "usd",
          amount_total: 500,
          metadata: {
            toolrouter_purchase_id: topUp.id,
            toolrouter_user_id: process.env.TOOLROUTER_DEV_USER_ID,
            amount_usd: "5",
          },
        },
      },
    };

    const failedWebhook = await retryApp.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: webhookBody,
    });
    assert.equal(failedWebhook.statusCode, 500);
    assert.equal(failedWebhook.json().status, "funding_failed");
    assert.equal(alerts.length, 1);

    shouldFailFunding = false;
    const retriedWebhook = await retryApp.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: webhookBody,
    });
    assert.equal(retriedWebhook.statusCode, 200);
    assert.equal(retriedWebhook.json().status, "funded");

    const balance = await retryApp.inject({
      method: "GET",
      url: "/v1/balance",
      headers: sessionHeaders(),
    });
    assert.equal(balance.json().balance.available_usd, "105");
    await retryApp.close();
  });

  it("verifies the account with AgentKit and returns badge-safe state", async () => {
    const response = await fetch(`${baseUrl}/v1/agentkit/account-verification`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.agentkit_verification.verified, true);
    assert.equal(body.agentkit_human_id_hash, undefined);
    assert.ok(agentBookLookups.includes("0x0000000000000000000000000000000000000000"));

    const balanceResponse = await fetch(`${baseUrl}/v1/balance`, { headers: sessionHeaders() });
    const balance = await balanceResponse.json();
    assert.equal(balance.balance.agentkit_verification.verified, true);
    assert.equal(balance.balance.agentkit_verification.error, null);

    const compatibilityResponse = await fetch(`${baseUrl}/v1/wallet/agentkit-verification`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({}),
    });
    assert.equal(compatibilityResponse.status, 200);
    assert.equal(compatibilityResponse.headers.get("deprecation"), "true");
    assert.match(
      compatibilityResponse.headers.get("link") || "",
      /\/v1\/agentkit\/account-verification/u,
    );
    assert.ok(
      datadogMetrics.some(
        (entry) =>
          entry.metric === "toolrouter.deprecated_routes.count" &&
          entry.tags.route === "wallet_agentkit_verification",
      ),
    );
  });

  it("prepares and completes AgentKit account registration", async () => {
    const prepareResponse = await fetch(`${baseUrl}/v1/agentkit/registration`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({}),
    });
    assert.equal(prepareResponse.status, 200);
    const prepared = await prepareResponse.json();
    assert.equal(prepared.registration.app_id, "app_a7c3e2b6b83927251a0db5345bd7146a");
    assert.equal(prepared.registration.action, "agentbook-registration");
    assert.equal(prepared.registration.verification_level, "orb");
    assert.equal(prepared.registration.nonce, "7");
    assert.deepEqual(prepared.registration.signal, {
      types: ["address", "uint256"],
      values: ["0x0000000000000000000000000000000000000000", "7"],
    });
    assert.equal(prepared.registration.agent, undefined);
    assert.ok(agentBookNonces.includes("0x0000000000000000000000000000000000000000"));

    const completeResponse = await fetch(`${baseUrl}/v1/agentkit/registration/complete`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({
        nonce: prepared.registration.nonce,
        result: {
          merkle_root: "0x01",
          nullifier_hash: "0x02",
          proof: Array.from({ length: 8 }, (_unused, index) => `0x${String(index + 1).padStart(64, "0")}`),
        },
      }),
    });
    assert.equal(completeResponse.status, 200);
    const completed = await completeResponse.json();
    assert.equal(completed.registration.tx_hash, "0xagentkittx");
    assert.equal(completed.agentkit_verification.verified, true);
    assert.equal(agentBookRegistrations.at(-1).agent, "0x0000000000000000000000000000000000000000");
    assert.equal(agentBookRegistrations.at(-1).nonce, "7");
    assert.equal(agentBookRegistrations.at(-1).contract, "0xA23aB2712eA7BBa896930544C7d6636a96b944dA");
    assert.equal(agentBookRegistrations.at(-1).proof.length, 8);
  });

  it("treats already-registered AgentKit relay responses as a completed verification check", async () => {
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-agentkit-already-registered-")), "store.json"),
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      agentBookVerifier: {
        lookupHuman: async () => "human_already_registered",
      },
      agentBookRegistration: {
        nextNonce: async () => 7n,
        submit: async () => ({
          already_registered: true,
          message: "This agent address is already registered on World Chain.",
        }),
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/agentkit/registration/complete`, {
        method: "POST",
        headers: sessionHeaders(),
        body: JSON.stringify({
          nonce: "7",
          result: {
            merkle_root: "0x01",
            nullifier_hash: "0x02",
            proof: Array.from({ length: 8 }, (_unused, index) => `0x${String(index + 1).padStart(64, "0")}`),
          },
        }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.registration.tx_hash, null);
      assert.equal(body.registration.already_registered, true);
      assert.equal(body.agentkit_verification.verified, true);
    } finally {
      await isolatedApp.close();
    }
  });

  it("creates and reads request traces", async () => {
    const createResponse = await fetch(`${baseUrl}/v1/requests`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        endpoint_id: "exa.search",
        input: { query: "AgentKit", search_type: "fast", num_results: 1 },
        maxUsd: "0.02",
      }),
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json();
    assert.match(created.id, /^req_/);
    assert.equal(created.path, "dev_stub");
    assert.equal(created.credit_reserved_usd, "0.02");
    assert.equal(created.credit_captured_usd, "0");
    assert.equal(created.credit_released_usd, "0.02");

    const listResponse = await fetch(`${baseUrl}/v1/requests`, { headers: authHeaders() });
    const listed = await listResponse.json();
    assert.equal(listed.requests[0].id, created.id);
    assert.equal(listed.requests[0].payment_reference, undefined);
    assert.equal(listed.requests[0].payment_network, undefined);
    assert.equal(listed.requests[0].credit_reservation_id.startsWith("crr_"), true);
    assert.equal(listed.requests[0].agentkit_value_label, null);
    assert.equal(listed.requests[0].body, undefined);

    const getResponse = await fetch(`${baseUrl}/v1/requests/${created.id}`, { headers: authHeaders() });
    const detail = await getResponse.json();
    assert.equal(detail.request.id, created.id);
    assert.equal(detail.request.endpoint_id, "exa.search");
    assert.equal(detail.request.body, undefined);
    const stored = await store.getRequest(created.id);
    assert.equal(stored.body, null);
  });

  it("ignores caller-supplied api_key_id when listing API-key request traces", async () => {
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-request-scope-")), "store.json"),
    });
    await isolatedStore.insertRequest({
      id: "req_own",
      trace_id: "trace_own",
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      api_key_id: "key_dev",
      endpoint_id: "exa.search",
      ts: "2026-05-09T10:00:00.000Z",
      status_code: 200,
      path: "agentkit",
      charged: false,
    });
    await isolatedStore.insertRequest({
      id: "req_other",
      trace_id: "trace_other",
      user_id: "00000000-0000-4000-8000-000000000002",
      api_key_id: "key_other",
      endpoint_id: "exa.search",
      ts: "2026-05-09T10:00:01.000Z",
      status_code: 200,
      path: "agentkit",
      charged: false,
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(
        `${isolatedBaseUrl}/v1/requests?api_key_id=key_other`,
        { headers: authHeaders() },
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.requests.map((row) => row.id), ["req_own"]);
    } finally {
      await isolatedApp.close();
    }
  });

  it("paginates dashboard request rows with a cursor", async () => {
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-request-pages-")), "store.json"),
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      for (const index of [0, 1, 2]) {
        await isolatedStore.insertRequest({
          id: `req_page_${index}`,
          trace_id: `trace_page_${index}`,
          user_id: process.env.TOOLROUTER_DEV_USER_ID,
          api_key_id: "key_dev",
          endpoint_id: "exa.search",
          ts: `2026-05-09T10:00:0${index}.000Z`,
          status_code: 200,
          path: "agentkit",
          charged: false,
          ...(index === 2
            ? {
                payment_reference: "pay_dashboard_hidden",
                payment_network: "eip155:8453",
                payment_error: "raw payment error",
                error: "raw provider error",
                body: { secret: "raw provider body" },
              }
            : {}),
        });
      }

      const firstResponse = await fetch(
        `${isolatedBaseUrl}/v1/dashboard/requests?limit=2`,
        { headers: sessionHeaders() },
      );
      assert.equal(firstResponse.status, 200);
      const firstPage = await firstResponse.json();
      assert.deepEqual(
        firstPage.requests.map((row) => row.id),
        ["req_page_2", "req_page_1"],
      );
      assert.equal(firstPage.requests[0].user_id, undefined);
      assert.equal(firstPage.requests[0].payment_reference, undefined);
      assert.equal(firstPage.requests[0].payment_network, undefined);
      assert.equal(firstPage.requests[0].payment_error, undefined);
      assert.equal(firstPage.requests[0].error, undefined);
      assert.equal(firstPage.requests[0].body, undefined);
      assert.equal(firstPage.has_more, true);
      assert.ok(firstPage.next_cursor);

      const secondResponse = await fetch(
        `${isolatedBaseUrl}/v1/dashboard/requests?limit=2&cursor=${encodeURIComponent(firstPage.next_cursor)}`,
        { headers: sessionHeaders() },
      );
      assert.equal(secondResponse.status, 200);
      const secondPage = await secondResponse.json();
      assert.deepEqual(
        secondPage.requests.map((row) => row.id),
        ["req_page_0"],
      );
      assert.equal(secondPage.has_more, false);
      assert.equal(secondPage.next_cursor, null);
    } finally {
      await isolatedApp.close();
    }
  });

  it("stores AgentKit value only when the request actually realized it", async () => {
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-agentkit-value-")), "store.json"),
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => ({
        trace_id: payload.traceId,
        endpoint_id: payload.endpoint.id,
        status_code: 200,
        ok: true,
        path: "agentkit_to_x402",
        charged: true,
        estimated_usd: payload.request.estimatedUsd,
        amount_usd: "0.007",
        currency: "USD",
        payment_reference: "pay_paid_fallback",
        payment_network: "eip155:8453",
        payment_error: null,
        latency_ms: 1,
        body: { ok: true },
      }),
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "exa.search",
          input: { query: "AgentKit", search_type: "fast", num_results: 1 },
          maxUsd: "0.02",
        }),
      });
      assert.equal(response.status, 200);

      const listResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, { headers: authHeaders() });
      const listed = await listResponse.json();
      assert.equal(listed.requests[0].path, "agentkit_to_x402");
      assert.equal(listed.requests[0].charged, true);
      assert.equal(listed.requests[0].agentkit_value_type, null);
      assert.equal(listed.requests[0].agentkit_value_label, null);
    } finally {
      await isolatedApp.close();
    }
  });

  it("allows Exa AgentKit free trial requests without available credits", async () => {
    const executorCalls = [];
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-free-trial-no-credits-")), "store.json"),
    });
    await isolatedStore.upsertCreditAccount({
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      available_usd: "0",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => {
        executorCalls.push(payload);
        return {
          trace_id: payload.traceId,
          endpoint_id: payload.endpoint.id,
          status_code: 200,
          ok: true,
          path: "agentkit",
          charged: false,
          estimated_usd: payload.request.estimatedUsd,
          amount_usd: "0",
          currency: null,
          payment_reference: null,
          payment_network: null,
          payment_error: null,
          latency_ms: 1,
          body: { results: [] },
        };
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "exa.search",
          input: { query: "AgentKit", search_type: "fast", num_results: 1 },
          maxUsd: "0.02",
        }),
      });
      assert.equal(response.status, 200);
      const created = await response.json();
      assert.equal(created.path, "agentkit");
      assert.equal(created.charged, false);
      assert.equal(created.credit_reserved_usd, null);
      assert.equal(created.credit_captured_usd, null);
      assert.equal(created.credit_released_usd, null);
      assert.equal(executorCalls[0].paymentMode, "agentkit_only");
      assert.equal(executorCalls[0].timeoutMs, 10_000);

      const listResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, { headers: authHeaders() });
      const listed = await listResponse.json();
      assert.equal(listed.requests[0].agentkit_value_type, "free_trial");
      assert.equal(listed.requests[0].agentkit_value_label, "AgentKit-Free Trial");
    } finally {
      await isolatedApp.close();
    }
  });

  it("falls back to paid x402 when Exa AgentKit preflight does not realize the free trial", async () => {
    const executorCalls = [];
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-free-trial-fallback-")), "store.json"),
    });
    await isolatedStore.upsertCreditAccount({
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      available_usd: "1",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => {
        executorCalls.push(payload);
        if (executorCalls.length === 1) {
          return {
            trace_id: payload.traceId,
            endpoint_id: payload.endpoint.id,
            status_code: 402,
            ok: false,
            path: "agentkit",
            charged: false,
            estimated_usd: payload.request.estimatedUsd,
            amount_usd: null,
            currency: null,
            payment_reference: null,
            payment_network: null,
            payment_error: null,
            latency_ms: payload.timeoutMs,
            body: { error: "Payment required" },
          };
        }
        return {
          trace_id: payload.traceId,
          endpoint_id: payload.endpoint.id,
          status_code: 200,
          ok: true,
          path: "x402",
          charged: true,
          estimated_usd: payload.request.estimatedUsd,
          amount_usd: "0.007",
          currency: "USD",
          payment_reference: "pay_x402_fallback",
          payment_network: "eip155:8453",
          payment_error: null,
          latency_ms: 12,
          body: { results: [] },
        };
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "exa.search",
          input: { query: "AgentKit", search_type: "fast", num_results: 1 },
          maxUsd: "0.02",
        }),
      });
      assert.equal(response.status, 200);
      const created = await response.json();
      assert.equal(created.path, "x402");
      assert.equal(created.charged, true);
      assert.equal(created.credit_reserved_usd, "0.02");
      assert.equal(created.credit_captured_usd, "0.007");
      assert.equal(created.credit_released_usd, "0.013");
      assert.equal(executorCalls.length, 2);
      assert.equal(executorCalls[0].paymentMode, "agentkit_only");
      assert.equal(executorCalls[0].timeoutMs, 10_000);
      assert.equal(executorCalls[1].paymentMode, "x402_only");
      assert.equal(executorCalls[1].timeoutMs, 8_000);

      const listResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, { headers: authHeaders() });
      const listed = await listResponse.json();
      assert.equal(listed.requests[0].agentkit_value_type, null);
      assert.equal(listed.requests[0].agentkit_value_label, null);
    } finally {
      await isolatedApp.close();
    }
  });

  it("proxies Manus through /v1/requests with AgentKit preflight and paid x402 fallback", async () => {
    const executorCalls = [];
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-manus-proxy-fallback-")), "store.json"),
    });
    await isolatedStore.upsertCreditAccount({
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      available_usd: "1",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => {
        executorCalls.push(payload);
        assert.equal(payload.endpoint.id, "manus.research");
        assert.match(payload.request.url, /\/x402\/manus\/research$/u);
        if (executorCalls.length === 1) {
          return {
            trace_id: payload.traceId,
            endpoint_id: payload.endpoint.id,
            status_code: 402,
            ok: false,
            path: "agentkit",
            charged: false,
            estimated_usd: payload.request.estimatedUsd,
            amount_usd: null,
            currency: null,
            payment_reference: null,
            payment_network: null,
            payment_error: null,
            latency_ms: payload.timeoutMs,
            body: { error: "Payment required" },
          };
        }
        const taskId = `task_proxy_${executorCalls.length}`;
        return {
          trace_id: payload.traceId,
          endpoint_id: payload.endpoint.id,
          status_code: 200,
          ok: true,
          path: "x402",
          charged: true,
          estimated_usd: payload.request.estimatedUsd,
          amount_usd: "0.03",
          currency: "USD",
          payment_reference: "pay_manus_x402",
          payment_network: "eip155:8453",
          payment_error: null,
          latency_ms: 20,
          body: { ok: true, provider: "manus", task: { id: taskId, task_url: `https://manus.im/app/${taskId}` } },
        };
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "manus.research",
          input: {
            query: "best pastries to eat in Korea",
            task_type: "food_research",
            depth: "quick",
          },
          maxUsd: "0.03",
        }),
      });
      const responseText = await response.text();
      assert.equal(response.status, 200, responseText);
      const created = JSON.parse(responseText);
      assert.equal(created.endpoint_id, "manus.research");
      assert.equal(created.path, "x402");
      assert.equal(created.charged, true);
      assert.equal(created.status_code, 200);
      assert.equal(created.credit_reserved_usd, "0.03");
      assert.equal(created.credit_captured_usd, "0.03");
      assert.equal(created.credit_released_usd, "0");
      assert.equal(created.body.provider, "manus");
      assert.equal(created.task_created, true);
      assert.equal(created.deduped, false);
      assert.equal(created.task_id, "task_proxy_2");
      assert.equal(created.body.task_id, "task_proxy_2");
      assert.equal(created.next_tools.status, "manus_research_status");
      assert.equal(created.repeat_for_same_query, false);
      assert.equal(executorCalls.length, 2);
      assert.equal(executorCalls[0].paymentMode, "agentkit_only");
      assert.equal(executorCalls[1].paymentMode, "x402_only");

      const duplicateResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "manus.research",
          input: {
            query: "best pastries to eat in Korea",
            task_type: "food_research",
            depth: "quick",
          },
          maxUsd: "0.03",
        }),
      });
      assert.equal(duplicateResponse.status, 200);
      const duplicate = await duplicateResponse.json();
      assert.equal(duplicate.deduped, true);
      assert.equal(duplicate.task_created, false);
      assert.equal(duplicate.task_id, "task_proxy_2");
      assert.equal(executorCalls.length, 2);

      const freshResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "manus.research",
          input: {
            query: "best pastries to eat in Korea",
            task_type: "food_research",
            depth: "quick",
          },
          maxUsd: "0.03",
          payment_mode: "x402_only",
          force_new: true,
        }),
      });
      assert.equal(freshResponse.status, 200);
      const fresh = await freshResponse.json();
      assert.equal(fresh.deduped, false);
      assert.equal(fresh.task_created, true);
      assert.equal(fresh.task_id, "task_proxy_3");
      assert.equal(executorCalls.length, 3);

      const listResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, { headers: authHeaders() });
      const listed = await listResponse.json();
      assert.equal(listed.requests[0].endpoint_id, "manus.research");
      assert.equal(listed.requests[0].agentkit_value_type, null);
      assert.equal(listed.requests[0].agentkit_value_label, null);
    } finally {
      await isolatedApp.close();
    }
  });

  it("dedupes concurrent Manus starts before a second upstream task is created", async () => {
    const executorCalls = [];
    let releaseExecutor;
    let enteredExecutor;
    const executorEntered = new Promise((resolve) => {
      enteredExecutor = resolve;
    });
    const executorHold = new Promise((resolve) => {
      releaseExecutor = resolve;
    });
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-manus-concurrent-dedupe-")), "store.json"),
    });
    await isolatedStore.upsertCreditAccount({
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      available_usd: "1",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => {
        executorCalls.push(payload);
        enteredExecutor();
        await executorHold;
        return {
          trace_id: payload.traceId,
          endpoint_id: payload.endpoint.id,
          status_code: 200,
          ok: true,
          path: "x402",
          charged: true,
          estimated_usd: payload.request.estimatedUsd,
          amount_usd: "0.03",
          currency: "USD",
          payment_reference: "pay_manus_concurrent",
          payment_network: "eip155:8453",
          payment_error: null,
          latency_ms: 20,
          body: { ok: true, provider: "manus", task: { id: "task_concurrent" } },
        };
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    const requestBody = {
      endpoint_id: "manus.research",
      input: {
        query: "best pastries to eat in Korea",
        task_type: "food_research",
        depth: "quick",
      },
      maxUsd: "0.03",
      payment_mode: "x402_only",
    };
    try {
      const firstPromise = fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(requestBody),
      });
      await executorEntered;

      const duplicateResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(requestBody),
      });
      assert.equal(duplicateResponse.status, 200);
      const duplicate = await duplicateResponse.json();
      assert.equal(duplicate.deduped, true);
      assert.equal(duplicate.task_created, false);
      assert.match(duplicate.task_id, /^task_/u);
      assert.equal(executorCalls.length, 1);

      releaseExecutor();
      const firstResponse = await firstPromise;
      assert.equal(firstResponse.status, 200);
      const created = await firstResponse.json();
      assert.equal(created.deduped, false);
      assert.equal(created.task_created, true);
      assert.equal(created.task_id, "task_concurrent");
      assert.equal(executorCalls.length, 1);
    } finally {
      releaseExecutor?.();
      await isolatedApp.close();
    }
  });

  it("records safe Manus wrapper auth failures on request traces", async () => {
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-manus-auth-failure-")), "store.json"),
    });
    await isolatedStore.upsertCreditAccount({
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      available_usd: "1",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => ({
        trace_id: payload.traceId,
        endpoint_id: payload.endpoint.id,
        status_code: 401,
        ok: false,
        path: "x402",
        charged: false,
        estimated_usd: payload.request.estimatedUsd,
        amount_usd: null,
        currency: null,
        payment_reference: null,
        payment_network: null,
        payment_error: null,
        latency_ms: 20,
        body: { ok: false, error: "Manus authentication failed" },
      }),
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "manus.research",
          input: {
            query: "research with expired Manus key",
            depth: "quick",
          },
          maxUsd: "0.03",
          payment_mode: "x402_only",
        }),
      });
      const created = await response.json();
      assert.equal(response.status, 200);
      assert.equal(created.status_code, 401);
      assert.equal(created.body.error, "Manus authentication failed");
      assert.equal(created.credit_captured_usd, "0");
      assert.equal(created.credit_released_usd, "0.03");

      const listResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, { headers: authHeaders() });
      const listed = await listResponse.json();
      assert.equal(listed.requests[0].error, "Manus authentication failed");
    } finally {
      await isolatedApp.close();
    }
  });

  it("serves Manus task status and result only to the owning API key", async () => {
    const previousManusApiKey = process.env.MANUS_API_KEY;
    process.env.MANUS_API_KEY = "test_manus_key";
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-manus-task-routes-")), "store.json"),
    });
    const otherKey = await isolatedStore.createApiKey({
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      caller_id: "other-agent",
    });
    const now = new Date().toISOString();
    const baseTask = {
      endpoint_id: "manus.research",
      provider: "manus",
      request_id: "req_seed",
      trace_id: "trace_seed",
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      api_key_id: "key_dev",
      caller_id: "hermes-dev",
      dedupe_key: "dedupe_seed",
      status: "running",
      task_url: "https://manus.im/app/task_owned",
      title: "Seed task",
      created_at: now,
      updated_at: now,
      last_checked_at: null,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    await isolatedStore.insertEndpointTask({ ...baseTask, id: "task_owned_row", provider_task_id: "task_owned" });
    await isolatedStore.insertEndpointTask({ ...baseTask, id: "task_done_row", provider_task_id: "task_done" });
    await isolatedStore.insertEndpointTask({ ...baseTask, id: "task_waiting_row", provider_task_id: "task_waiting" });
    await isolatedStore.insertEndpointTask({ ...baseTask, id: "task_error_row", provider_task_id: "task_error" });
    await isolatedStore.insertEndpointTask({
      ...baseTask,
      id: "task_other_row",
      provider_task_id: "task_other",
      api_key_id: otherKey.record.id,
    });
    const manusFetchCalls = [];
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      manusFetch: async (url) => {
        manusFetchCalls.push(String(url));
        const parsed = new URL(String(url));
        const taskId = parsed.searchParams.get("task_id");
        if (parsed.pathname.endsWith("/task.detail")) {
          if (taskId === "task_done") return jsonResponse({ data: { status: "stopped", title: "Done task" } });
          if (taskId === "task_waiting") return jsonResponse({ data: { status: "waiting", waiting_details: "Need account name" } });
          if (taskId === "task_error") return jsonResponse({ data: { status: "error", error: "Manus task failed" } });
          return jsonResponse({ data: { status: "running", title: "Running task", task_url: "https://manus.im/app/task_owned" } });
        }
        if (parsed.pathname.endsWith("/task.listMessages")) {
          if (taskId === "task_done") {
            return jsonResponse({
              messages: [
                {
                  id: "msg_1",
                  type: "assistant_message",
                  assistant_message: {
                    content: "Final answer with sources.",
                    attachments: [
                      {
                        type: "file",
                        filename: "report.pdf",
                        url: "https://example.com/report.pdf",
                        content_type: "application/pdf",
                      },
                    ],
                  },
                },
              ],
            });
          }
          return jsonResponse({ messages: [] });
        }
        return jsonResponse({ ok: false }, { status: 404 });
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const statusResponse = await fetch(`${isolatedBaseUrl}/v1/manus/tasks/task_owned/status`, {
        headers: authHeaders(),
      });
      const statusText = await statusResponse.text();
      assert.equal(statusResponse.status, 200, statusText);
      const status = JSON.parse(statusText);
      assert.equal(status.task_id, "task_owned");
      assert.equal(status.status, "running");
      assert.equal(status.poll_after_seconds, 30);

      const doneResponse = await fetch(`${isolatedBaseUrl}/v1/manus/tasks/task_done/result`, {
        headers: authHeaders(),
      });
      assert.equal(doneResponse.status, 200);
      const done = await doneResponse.json();
      assert.equal(done.status, "stopped");
      assert.equal(done.final_answer_available, true);
      assert.equal(done.answer, "Final answer with sources.");
      assert.equal(done.attachments[0].url, "https://example.com/report.pdf");

      const waitingResponse = await fetch(`${isolatedBaseUrl}/v1/manus/tasks/task_waiting/result`, {
        headers: authHeaders(),
      });
      assert.equal(waitingResponse.status, 200);
      const waiting = await waitingResponse.json();
      assert.equal(waiting.status, "waiting");
      assert.equal(waiting.final_answer_available, false);
      assert.equal(waiting.waiting_details, "Need account name");

      const errorResponse = await fetch(`${isolatedBaseUrl}/v1/manus/tasks/task_error/result`, {
        headers: authHeaders(),
      });
      assert.equal(errorResponse.status, 200);
      const error = await errorResponse.json();
      assert.equal(error.status, "error");
      assert.equal(error.isError, true);
      assert.equal(error.error, "Manus task failed");

      const rejected = await fetch(`${isolatedBaseUrl}/v1/manus/tasks/task_other/status`, {
        headers: authHeaders(),
      });
      assert.equal(rejected.status, 404);
      assert.equal(manusFetchCalls.some((url) => url.includes("task_other")), false);
    } finally {
      await isolatedApp.close();
      if (previousManusApiKey === undefined) delete process.env.MANUS_API_KEY;
      else process.env.MANUS_API_KEY = previousManusApiKey;
    }
  });

  it("accepts top-level endpoint input fields for agent-authored Manus requests", async () => {
    const executorCalls = [];
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-manus-top-level-")), "store.json"),
    });
    await isolatedStore.upsertCreditAccount({
      user_id: process.env.TOOLROUTER_DEV_USER_ID,
      available_usd: "1",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => {
        executorCalls.push(payload);
        return {
          trace_id: payload.traceId,
          endpoint_id: payload.endpoint.id,
          status_code: 200,
          ok: true,
          path: "x402",
          charged: true,
          estimated_usd: payload.request.estimatedUsd,
          amount_usd: "0.03",
          currency: "USD",
          payment_reference: "pay_manus_top_level",
          payment_network: "eip155:8453",
          payment_error: null,
          latency_ms: 20,
          body: { ok: true, provider: "manus", task: { id: "task_top_level" } },
        };
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "manus.research",
          prompt: "best pastries to eat in Korea",
          task_type: "food_research",
          depth: "quick",
          maxUsd: "0.03",
          payment_mode: "x402_only",
        }),
      });

      assert.equal(response.status, 200);
      const created = await response.json();
      assert.equal(created.endpoint_id, "manus.research");
      assert.equal(created.status_code, 200);
      assert.equal(executorCalls.length, 1);
      assert.deepEqual(executorCalls[0].request.json, {
        query: "best pastries to eat in Korea",
        depth: "quick",
        task_type: "food_research",
        urls: [],
        images: [],
      });
      assert.equal(executorCalls[0].paymentMode, "x402_only");
    } finally {
      await isolatedApp.close();
    }
  });

  it("keeps realized AgentKit value categories on request rows", async () => {
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-agentkit-realized-")), "store.json"),
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => {
        const isBrowserbase = payload.endpoint.id === "browserbase.session";
        return {
          trace_id: payload.traceId,
          endpoint_id: payload.endpoint.id,
          status_code: 200,
          ok: true,
          path: isBrowserbase ? "agentkit_to_x402" : "agentkit",
          charged: isBrowserbase,
          estimated_usd: payload.request.estimatedUsd,
          amount_usd: isBrowserbase ? "0.01" : "0",
          currency: isBrowserbase ? "USD" : null,
          payment_reference: isBrowserbase ? "pay_agentkit_access" : null,
          payment_network: isBrowserbase ? "eip155:8453" : null,
          payment_error: null,
          latency_ms: 1,
          body: { ok: true },
        };
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const exaResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "exa.search",
          input: { query: "AgentKit", search_type: "fast", num_results: 1 },
          maxUsd: "0.02",
        }),
      });
      assert.equal(exaResponse.status, 200);

      const browserbaseResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "browserbase.session",
          input: { estimated_minutes: 5 },
          maxUsd: "0.02",
        }),
      });
      assert.equal(browserbaseResponse.status, 200);

      const listResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, { headers: authHeaders() });
      const listed = await listResponse.json();
      const exa = listed.requests.find((row) => row.endpoint_id === "exa.search");
      const browserbase = listed.requests.find((row) => row.endpoint_id === "browserbase.session");
      assert.equal(exa.agentkit_value_type, "free_trial");
      assert.equal(exa.agentkit_value_label, "AgentKit-Free Trial");
      assert.equal(browserbase.agentkit_value_type, "access");
      assert.equal(browserbase.agentkit_value_label, "AgentKit-Access");
    } finally {
      await isolatedApp.close();
    }
  });

  it("passes explicit payment mode overrides to the request executor", async () => {
    const executorCalls = [];
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-payment-mode-")), "store.json"),
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => {
        executorCalls.push(payload);
        return {
          trace_id: payload.traceId,
          endpoint_id: payload.endpoint.id,
          status_code: 200,
          ok: true,
          path: "x402",
          charged: true,
          estimated_usd: payload.request.estimatedUsd,
          amount_usd: "0.001",
          currency: "USD",
          payment_reference: "pay_test",
          payment_network: "eip155:8453",
          payment_error: null,
          latency_ms: 1,
          body: { ok: true },
        };
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "exa.search",
          input: { query: "AgentKit", search_type: "fast", num_results: 1 },
          maxUsd: "0.02",
          payment_mode: "x402_only",
        }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).path, "x402");
      assert.equal(executorCalls[0].paymentMode, "x402_only");
    } finally {
      await isolatedApp.close();
    }
  });

  it("tags 402 Datadog request metrics as payment-required instead of failures", async () => {
    const metrics = [];
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-datadog-402-")), "store.json"),
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      datadog: {
        increment: async (metric, tags) => {
          metrics.push({ metric, tags });
          return { sent: true };
        },
        gauge: async (metric, value, tags) => {
          metrics.push({ metric, value, tags });
          return { sent: true };
        },
      },
      executor: async (payload) => ({
        trace_id: payload.traceId,
        endpoint_id: payload.endpoint.id,
        status_code: 402,
        ok: false,
        path: "x402",
        charged: false,
        estimated_usd: payload.request.estimatedUsd,
        amount_usd: null,
        currency: null,
        payment_reference: null,
        payment_network: null,
        payment_error: null,
        latency_ms: 1,
        body: { error: "Payment required" },
      }),
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "exa.search",
          input: { query: "AgentKit", search_type: "fast", num_results: 1 },
          maxUsd: "0.02",
          payment_mode: "x402_only",
        }),
      });
      assert.equal(response.status, 200);
      const requestMetric = metrics.find(
        (entry) => entry.metric === "toolrouter.requests.count",
      );
      assert.equal(requestMetric.tags.status, "payment_required");
    } finally {
      await isolatedApp.close();
    }
  });

  it("passes the default request timeout and records timed-out requests", async () => {
    const previousTimeout = process.env.TOOLROUTER_REQUEST_TIMEOUT_MS;
    delete process.env.TOOLROUTER_REQUEST_TIMEOUT_MS;
    const executorCalls = [];
    const isolatedStore = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-request-timeout-")), "store.json"),
    });
    const isolatedApp = createApiApp({
      logger: false,
      cache: new MemoryCache(),
      store: isolatedStore,
      executor: async (payload) => {
        executorCalls.push(payload);
        return {
          trace_id: payload.traceId,
          endpoint_id: payload.endpoint.id,
          status_code: 504,
          ok: false,
          path: "agentkit",
          charged: false,
          estimated_usd: payload.request.estimatedUsd,
          amount_usd: null,
          currency: null,
          payment_reference: null,
          payment_network: null,
          payment_error: null,
          latency_ms: payload.timeoutMs,
          error: `provider timed out after ${payload.timeoutMs}ms`,
          body: null,
        };
      },
    });
    await isolatedApp.listen({ port: 0, host: "127.0.0.1" });
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApp.server.address().port}`;
    try {
      const response = await fetch(`${isolatedBaseUrl}/v1/requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint_id: "exa.search",
          input: { query: "AgentKit", search_type: "fast", num_results: 1 },
          maxUsd: "0.02",
        }),
      });
      assert.equal(response.status, 200);
      const created = await response.json();
      assert.equal(created.status_code, 504);
      assert.equal(created.charged, false);
      assert.equal(created.credit_captured_usd, "0");
      assert.equal(created.credit_released_usd, "0.02");
      assert.equal(executorCalls.length, 2);
      assert.equal(executorCalls[0].paymentMode, "agentkit_only");
      assert.equal(executorCalls[0].timeoutMs, 10_000);
      assert.equal(executorCalls[1].paymentMode, "x402_only");
      assert.equal(executorCalls[1].timeoutMs, 8_000);

      const listResponse = await fetch(`${isolatedBaseUrl}/v1/requests`, { headers: authHeaders() });
      const listed = await listResponse.json();
      assert.equal(listed.requests[0].status_code, 504);
      assert.equal(listed.requests[0].latency_ms, 8_000);
      assert.equal(listed.requests[0].error, "provider timed out after 8000ms");
    } finally {
      await isolatedApp.close();
      if (previousTimeout === undefined) delete process.env.TOOLROUTER_REQUEST_TIMEOUT_MS;
      else process.env.TOOLROUTER_REQUEST_TIMEOUT_MS = previousTimeout;
    }
  });

  it("summarizes Supabase-backed monitoring data for dashboard health", async () => {
    const response = await fetch(`${baseUrl}/v1/dashboard/monitoring`, { headers: sessionHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.monitoring.requests_24h.total >= 1);
    assert.equal(body.monitoring.requests_24h.errors, 0);
    assert.equal(body.monitoring.endpoint_health.total, 3);
    assert.equal(body.monitoring.endpoint_health.unverified, 2);
    assert.ok("error_rate" in body.monitoring.requests_24h);
  });

  it("rejects requests before provider execution when maxUsd is too low", async () => {
    const response = await fetch(`${baseUrl}/v1/requests`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        endpoint_id: "exa.search",
        input: { query: "AgentKit", search_type: "fast", num_results: 1 },
        maxUsd: "0.001",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "budget_exceeded");
  });
});
