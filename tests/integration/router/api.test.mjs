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

describe("router API", () => {
  let app;
  let baseUrl;
  let store;
  let agentBookLookups;

  before(async () => {
    agentBookLookups = [];
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
      ["browserbase.search", "exa.search"],
    );
    assert.ok(body.endpoints.every((endpoint) => endpoint.status));

    const dashboardResponse = await fetch(`${baseUrl}/v1/dashboard/endpoints`, { headers: sessionHeaders() });
    assert.equal(dashboardResponse.status, 200);
    assert.deepEqual(
      (await dashboardResponse.json()).endpoints.map((endpoint) => endpoint.id),
      ["browserbase.fetch", "browserbase.search", "browserbase.session", "exa.search"],
    );
  });

  it("lists generic categories with recommended endpoints", async () => {
    const response = await fetch(`${baseUrl}/v1/categories`, { headers: authHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.categories.map((category) => category.id), ["search", "data", "browser_usage"]);
    const search = body.categories.find((category) => category.id === "search");
    assert.equal(search.recommended_endpoint_id, "exa.search");
    assert.equal(search.recommended_endpoint.id, "exa.search");
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
    assert.equal(body.summary.endpoint_count, 4);
    assert.equal(body.summary.operational_count, 1);
    const exa = body.endpoints.find((endpoint) => endpoint.id === "exa.search");
    assert.equal(exa.status, "healthy");
    assert.equal(exa.latency_ms, 123);
    assert.equal(exa.p50_latency_ms, 123);
    assert.equal(exa.sparkline_30d.length, 30);
    assert.ok(exa.uptime_30d > 0);
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
    assert.match(topUp.provider_reference, /^cs_dev_/);
    assert.equal(topUp.wallet_address, undefined);

    const pendingResponse = await fetch(`${baseUrl}/v1/balance`, { headers: sessionHeaders() });
    const pending = await pendingResponse.json();
    assert.equal(pending.balance.available_usd, "100");
    assert.equal(pending.balance.pending_usd, "0");

    const webhookBody = {
      id: "evt_dev_completed_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: topUp.provider_reference,
          client_reference_id: topUp.id,
          payment_status: "paid",
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
    assert.equal(settled.balance.pending_usd, "0");

    const ledgerResponse = await fetch(`${baseUrl}/v1/ledger`, { headers: sessionHeaders() });
    const ledger = await ledgerResponse.json();
    assert.ok(ledger.entries.some((entry) => entry.type === "top_up_settled"));
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
    assert.match(body.error.message, /top-up cap of 5/);
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
    const webhookBody = {
      id: "evt_retry_completed_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: topUp.provider_reference,
          client_reference_id: topUp.id,
          payment_status: "paid",
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
    assert.equal(listed.requests[0].payment_reference, null);
    assert.equal(listed.requests[0].credit_reservation_id.startsWith("crr_"), true);
    assert.equal(listed.requests[0].agentkit_value_label, "AgentKit-Free Trial");

    const getResponse = await fetch(`${baseUrl}/v1/requests/${created.id}`, { headers: authHeaders() });
    const detail = await getResponse.json();
    assert.equal(detail.request.id, created.id);
    assert.equal(detail.request.endpoint_id, "exa.search");
  });

  it("summarizes Supabase-backed monitoring data for dashboard health", async () => {
    const response = await fetch(`${baseUrl}/v1/dashboard/monitoring`, { headers: sessionHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.monitoring.requests_24h.total >= 1);
    assert.equal(body.monitoring.requests_24h.errors, 0);
    assert.equal(body.monitoring.endpoint_health.total, 4);
    assert.equal(body.monitoring.endpoint_health.unverified, 3);
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
