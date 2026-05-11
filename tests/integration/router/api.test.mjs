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
  let agentBookNonces;
  let agentBookRegistrations;

  before(async () => {
    agentBookLookups = [];
    agentBookNonces = [];
    agentBookRegistrations = [];
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
      ["exa.search"],
    );
    assert.ok(body.endpoints.every((endpoint) => endpoint.status));

    const dashboardResponse = await fetch(`${baseUrl}/v1/dashboard/endpoints`, { headers: sessionHeaders() });
    assert.equal(dashboardResponse.status, 200);
    assert.deepEqual(
      (await dashboardResponse.json()).endpoints.map((endpoint) => endpoint.id),
      ["browserbase.session", "exa.search"],
    );
  });

  it("lists generic categories with recommended endpoints", async () => {
    const response = await fetch(`${baseUrl}/v1/categories`, { headers: authHeaders() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.categories.map((category) => category.id), ["search", "browser_usage"]);
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
    assert.equal(body.summary.endpoint_count, 2);
    assert.equal(body.summary.operational_count, 1);
    assert.deepEqual(
      body.endpoints.map((endpoint) => endpoint.id).sort(),
      ["browserbase.session", "exa.search"].sort(),
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
    assert.match(topUp.provider_reference, /^cs_dev_/);
    assert.equal(topUp.wallet_address, undefined);

    const topUpsResponse = await fetch(`${baseUrl}/v1/top-ups`, { headers: sessionHeaders() });
    assert.equal(topUpsResponse.status, 200);
    const topUps = await topUpsResponse.json();
    assert.equal(topUps.top_ups[0].id, topUp.id);
    assert.equal(topUps.top_ups[0].status, "checkout_pending");
    assert.equal(topUps.top_ups[0].checkout_url, undefined);

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
    assert.ok(activity.entries.every((entry) => entry.source !== "request"));

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
    assert.equal(listed.requests[0].agentkit_value_label, null);

    const getResponse = await fetch(`${baseUrl}/v1/requests/${created.id}`, { headers: authHeaders() });
    const detail = await getResponse.json();
    assert.equal(detail.request.id, created.id);
    assert.equal(detail.request.endpoint_id, "exa.search");
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
      assert.equal(executorCalls[0].timeoutMs, 6_000);

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
      assert.equal(executorCalls[0].timeoutMs, 6_000);
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
      assert.equal(executorCalls[0].timeoutMs, 6_000);
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
    assert.equal(body.monitoring.endpoint_health.total, 2);
    assert.equal(body.monitoring.endpoint_health.unverified, 1);
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
