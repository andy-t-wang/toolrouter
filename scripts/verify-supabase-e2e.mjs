import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

if (process.env.RUN_SUPABASE_E2E !== "true") {
  console.log("Skipping Supabase E2E. Set RUN_SUPABASE_E2E=true to run the seed-and-cleanup walkthrough.");
  process.exit(0);
}

process.env.ROUTER_DEV_MODE = "true";
process.env.TOOLROUTER_DEV_CREDIT_BALANCE_USD ||= "100";
process.env.TOOLROUTER_RATE_LIMIT_PER_MINUTE ||= "100";
process.env.TOOLROUTER_IP_RATE_LIMIT_PER_MINUTE ||= "100";
process.env.X402_MAX_USD_PER_REQUEST ||= "0.05";

const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/u, "");
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

assert.ok(supabaseUrl, "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required");
assert.ok(anonKey, "SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
assert.ok(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required");

const runId = randomUUID();
const email = `toolrouter-e2e-${Date.now()}-${runId.slice(0, 8)}@example.com`;
const password = `Tr-e2e-${runId}!`;
const callerId = `toolrouter-e2e-${runId}`;
const keepArtifacts = process.env.SUPABASE_E2E_KEEP_ARTIFACTS === "true";
const browserSeedPath = process.env.SUPABASE_E2E_BROWSER_SEED_PATH || "/private/tmp/toolrouter-supabase-browser-seed.json";

let userId = null;
let apiKey = null;
let apiKeyId = null;
let app = null;
let baseUrl = null;
let cleanupRequired = true;

function adminHeaders(extra = {}) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...extra,
  };
}

function anonHeaders(extra = {}) {
  return {
    apikey: anonKey,
    "content-type": "application/json",
    ...extra,
  };
}

function bearer(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function assertResponse(response, label) {
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function adminAuth(path, { method = "GET", body } = {}) {
  return assertResponse(
    await fetch(`${supabaseUrl}/auth/v1${path}`, {
      method,
      headers: adminHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    `Supabase Auth ${method} ${path}`,
  );
}

async function supabaseRest(path, { method = "GET", body, prefer = "return=representation" } = {}) {
  return assertResponse(
    await fetch(`${supabaseUrl}/rest/v1${path}`, {
      method,
      headers: adminHeaders({ prefer }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    `Supabase REST ${method} ${path}`,
  );
}

async function cleanupUserArtifacts() {
  if (!userId) return;
  const filters = `user_id=eq.${encodeURIComponent(userId)}`;
  const deletes = [
    `/requests?${filters}`,
    `/credit_ledger_entries?${filters}`,
    `/wallet_transactions?${filters}`,
    `/wallet_accounts?${filters}`,
    `/credit_accounts?${filters}`,
    `/api_keys?${filters}`,
  ];
  for (const path of deletes) {
    await fetch(`${supabaseUrl}/rest/v1${path}`, {
      method: "DELETE",
      headers: adminHeaders({ prefer: "return=minimal" }),
    }).catch(() => undefined);
  }
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: adminHeaders(),
  }).catch(() => undefined);
}

if (process.env.SUPABASE_E2E_CLEANUP_USER_ID) {
  userId = process.env.SUPABASE_E2E_CLEANUP_USER_ID;
  await cleanupUserArtifacts();
  console.log("Supabase E2E cleanup completed.");
  process.exit(0);
}

async function api(path, { method = "GET", token, key, body } = {}) {
  const headers = key ? bearer(key) : bearer(token);
  return assertResponse(
    await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    `API ${method} ${path}`,
  );
}

async function expectStatus(path, expectedStatus, { key } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: key ? bearer(key) : undefined,
  });
  const body = await readJson(response);
  assert.equal(response.status, expectedStatus, `${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function assertNoKeySecrets(row) {
  assert.equal(row.key_hash, undefined, "API key hash must not be returned to the dashboard");
  assert.equal(row.api_key, undefined, "raw API key must not be returned by list endpoints");
}

try {
  const { createApiApp } = await import("../apps/api/src/app.ts");
  const { MemoryCache } = await import("../packages/cache/src/index.ts");
  const { computeDashboardMetrics } = await import("../apps/web/app/dashboard-metrics.ts");

  const createdUser = await adminAuth("/admin/users", {
    method: "POST",
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { toolrouter_e2e: true, run_id: runId },
    },
  });
  userId = createdUser.id;
  assert.match(userId, /^[0-9a-f-]{36}$/u);

  const tokenBody = await assertResponse(
    await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: anonHeaders(),
      body: JSON.stringify({ email, password }),
    }),
    "Supabase password sign-in",
  );
  const sessionToken = tokenBody.access_token;
  assert.ok(sessionToken, "Supabase sign-in must return an access token");

  app = createApiApp({ logger: false, cache: new MemoryCache() });
  await app.listen({ port: 0, host: "127.0.0.1" });
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  const health = await assertResponse(await fetch(`${baseUrl}/health`), "API health");
  assert.equal(health.ok, true);
  await expectStatus("/v1/endpoints", 401);

  const dashboardEndpoints = await api("/v1/dashboard/endpoints", { token: sessionToken });
  assert.deepEqual(
    dashboardEndpoints.endpoints.map((endpoint) => endpoint.id),
    ["browserbase.fetch", "browserbase.search", "browserbase.session", "exa.search"],
  );
  assert.ok(dashboardEndpoints.endpoints[0].status, "endpoint status should be present");

  const balanceBefore = await api("/v1/balance", { token: sessionToken });
  assert.equal(String(balanceBefore.balance.available_usd), "100");

  const createdKey = await api("/v1/api-keys", {
    method: "POST",
    token: sessionToken,
    body: { caller_id: callerId },
  });
  apiKey = createdKey.api_key;
  apiKeyId = createdKey.record.id;
  assert.match(apiKey, /^tr_/u);
  assert.match(apiKeyId, /^key_/u);
  assertNoKeySecrets(createdKey.record);

  const listedKeys = await api("/v1/api-keys", { token: sessionToken });
  const listedKey = listedKeys.api_keys.find((key) => key.id === apiKeyId);
  assert.ok(listedKey, "created key should be listed");
  assert.equal(listedKey.caller_id, callerId);
  assert.equal(listedKey.disabled_at, null);
  assertNoKeySecrets(listedKey);

  const endpointsWithApiKey = await api("/v1/endpoints", { key: apiKey });
  assert.ok(endpointsWithApiKey.endpoints.some((endpoint) => endpoint.id === "exa.search"));

  const createdRequest = await api("/v1/requests", {
    method: "POST",
    key: apiKey,
    body: {
      endpoint_id: "exa.search",
      input: { query: "ToolRouter Supabase verification", search_type: "fast", num_results: 1 },
      maxUsd: "0.02",
    },
  });
  assert.match(createdRequest.id, /^req_/u);
  assert.match(createdRequest.trace_id, /^trace_/u);
  assert.equal(createdRequest.endpoint_id, "exa.search");
  assert.equal(createdRequest.path, "dev_stub");
  assert.equal(createdRequest.status_code, 200);
  assert.equal(String(createdRequest.credit_reserved_usd), "0.02");
  assert.equal(String(createdRequest.credit_captured_usd), "0");
  assert.equal(String(createdRequest.credit_released_usd), "0.02");

  const detail = await api(`/v1/requests/${encodeURIComponent(createdRequest.id)}`, { key: apiKey });
  assert.equal(detail.request.id, createdRequest.id);
  assert.equal(detail.request.endpoint_id, "exa.search");
  assert.equal(detail.request.api_key_id, apiKeyId);
  assert.equal(detail.request.path, "dev_stub");
  assert.equal(detail.request.charged, false);
  assert.equal(detail.request.agentkit_value_label, "AgentKit-Free Trial");
  assert.ok(Number(detail.request.latency_ms) >= 0);

  const fallbackTraceId = `trace_e2e_${runId}`;
  const fallbackRequestId = `req_e2e_${runId}`;
  await supabaseRest("/requests", {
    method: "POST",
    body: {
      id: fallbackRequestId,
      ts: new Date().toISOString(),
      trace_id: fallbackTraceId,
      user_id: userId,
      api_key_id: apiKeyId,
      caller_id: callerId,
      endpoint_id: "exa.search",
      category: "search",
      url_host: "api.exa.ai",
      status_code: 200,
      ok: true,
      path: "agentkit_to_x402",
      charged: true,
      estimated_usd: "0.007",
      amount_usd: "0.01",
      currency: "USD",
      payment_reference: "e2e_redacted",
      payment_network: "eip155:8453",
      agentkit_value_type: "free_trial",
      agentkit_value_label: "AgentKit-Free Trial",
      credit_reserved_usd: "0.01",
      credit_captured_usd: "0.007",
      credit_released_usd: "0.003",
      latency_ms: 42,
      body: { e2e: true },
    },
  });

  const dashboardRequests = await api("/v1/dashboard/requests?limit=20", { token: sessionToken });
  const requestIds = new Set(dashboardRequests.requests.map((request) => request.id));
  assert.ok(requestIds.has(createdRequest.id), "dashboard request list should include API-created trace");
  assert.ok(requestIds.has(fallbackRequestId), "dashboard request list should include fallback trace");
  assert.ok(dashboardRequests.requests.every((request) => request.user_id === userId), "dashboard requests must be user scoped");

  const metrics = computeDashboardMetrics(dashboardRequests.requests);
  assert.equal(metrics.totalRequests, 2);
  assert.equal(metrics.x402Count, 1);
  assert.equal(metrics.totalPaid, 0.007);

  const monitoring = await api("/v1/dashboard/monitoring", { token: sessionToken });
  assert.ok(monitoring.monitoring.requests_24h.total >= 2, "monitoring should count recent requests");
  assert.ok("error_rate" in monitoring.monitoring.requests_24h, "monitoring should include error rate");

  const apiKeyRequests = await api("/v1/requests?limit=20", { key: apiKey });
  assert.ok(apiKeyRequests.requests.every((request) => request.api_key_id === apiKeyId), "API key request list must be scoped to the key");

  const ledger = await api("/v1/ledger?limit=20", { token: sessionToken });
  assert.ok(ledger.entries.some((entry) => entry.type === "reserve"), "request should write a credit reserve ledger entry");
  assert.ok(ledger.entries.some((entry) => entry.type === "release"), "dev-mode request should release reserved credits");

  const balanceAfter = await api("/v1/balance", { token: sessionToken });
  assert.equal(String(balanceAfter.balance.available_usd), "100");
  assert.equal(String(balanceAfter.balance.reserved_usd), "0");

  if (keepArtifacts) {
    const link = await adminAuth("/admin/generate_link", {
      method: "POST",
      body: {
        type: "magiclink",
        email,
        options: {
          redirect_to: process.env.SUPABASE_E2E_REDIRECT_TO || "http://127.0.0.1:3000/dashboard#dashboard",
        },
      },
    });
    assert.ok(link.action_link, "Supabase magic-link generation should return action_link");
    writeFileSync(
      browserSeedPath,
      JSON.stringify(
        {
          action_link: link.action_link,
          api_key_id: apiKeyId,
          email,
          session: tokenBody,
          user_id: userId,
        },
        null,
        2,
      ),
    );
    cleanupRequired = false;
    console.log(`Supabase E2E browser seed created: ${browserSeedPath}`);
  } else {
    const disabled = await api(`/v1/api-keys/${encodeURIComponent(apiKeyId)}`, {
      method: "DELETE",
      token: sessionToken,
    });
    assert.equal(disabled.api_key.id, apiKeyId);
    assert.ok(disabled.api_key.disabled_at);
    assertNoKeySecrets(disabled.api_key);

    await expectStatus("/v1/endpoints", 401, { key: apiKey });

    console.log("Supabase E2E passed: auth, API keys, dashboard data, request traces, credits, and cleanup path verified.");
  }
} finally {
  if (app) await app.close().catch(() => undefined);
  if (cleanupRequired) await cleanupUserArtifacts();
}
