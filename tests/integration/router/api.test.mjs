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

const { createApiApp } = await import("../../../apps/api/src/app.ts");
const { MemoryCache } = await import("../../../packages/cache/src/index.ts");

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

  before(async () => {
    app = createApiApp({ logger: false, cache: new MemoryCache() });
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
      ["exa.search"],
    );
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
    assert.equal(created.record.user_id, "dev-user");

    const listResponse = await fetch(`${baseUrl}/v1/api-keys`, { headers: sessionHeaders() });
    const listed = await listResponse.json();
    assert.ok(listed.api_keys.some((key) => key.caller_id === "test-dashboard"));
    assert.ok(listed.api_keys.every((key) => key.key_hash === undefined));
  });

  it("exposes balance, creates Crossmint top-ups, and settles webhooks idempotently", async () => {
    const balanceResponse = await fetch(`${baseUrl}/v1/balance`, { headers: sessionHeaders() });
    assert.equal(balanceResponse.status, 200);
    assert.equal((await balanceResponse.json()).balance.available_usd, "100");

    const topUpResponse = await fetch(`${baseUrl}/v1/top-ups`, {
      method: "POST",
      headers: sessionHeaders(),
      body: JSON.stringify({ amountUsd: "10" }),
    });
    assert.equal(topUpResponse.status, 201);
    const topUp = (await topUpResponse.json()).top_up;
    assert.match(topUp.provider_reference, /^cm_dev_/);
    assert.equal(topUp.wallet_address, "0x0000000000000000000000000000000000000000");

    const pendingResponse = await fetch(`${baseUrl}/v1/balance`, { headers: sessionHeaders() });
    const pending = await pendingResponse.json();
    assert.equal(pending.balance.pending_usd, "10");

    const webhookResponse = await fetch(`${baseUrl}/webhooks/crossmint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: topUp.provider_reference, status: "completed" }),
    });
    assert.equal(webhookResponse.status, 200);
    assert.equal((await webhookResponse.json()).duplicate, false);

    const duplicateResponse = await fetch(`${baseUrl}/webhooks/crossmint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: topUp.provider_reference, status: "completed" }),
    });
    assert.equal((await duplicateResponse.json()).duplicate, true);

    const settledResponse = await fetch(`${baseUrl}/v1/balance`, { headers: sessionHeaders() });
    const settled = await settledResponse.json();
    assert.equal(settled.balance.available_usd, "110");
    assert.equal(settled.balance.pending_usd, "0");

    const ledgerResponse = await fetch(`${baseUrl}/v1/ledger`, { headers: sessionHeaders() });
    const ledger = await ledgerResponse.json();
    assert.ok(ledger.entries.some((entry) => entry.type === "top_up_settled"));
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

    const getResponse = await fetch(`${baseUrl}/v1/requests/${created.id}`, { headers: authHeaders() });
    const detail = await getResponse.json();
    assert.equal(detail.request.id, created.id);
    assert.equal(detail.request.endpoint_id, "exa.search");
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
