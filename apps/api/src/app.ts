import Fastify from "fastify";
import { randomUUID } from "node:crypto";

import { authenticateApiKey, authenticateSupabaseUser } from "@toolrouter/auth";
import { createCache, enforceRequestPolicy } from "@toolrouter/cache";
import { createStore } from "@toolrouter/db";
import { executeEndpoint, getEndpoint, listEndpoints, validateRegistry } from "@toolrouter/router-core";
import {
  assertTopUpAmount,
  ensureCreditAccount,
  finalizeCreditReservation,
  getCreditBalance,
  markTopUpPending,
  releaseCreditReservation,
  reserveCredits,
  settleTopUp,
} from "./billing.ts";
import { createCrossmintClient } from "./crossmint.ts";

function requestFilters(query: any) {
  return {
    endpoint_id: query.endpoint_id || undefined,
    api_key_id: query.api_key_id || undefined,
    status: query.status || undefined,
    charged: query.charged || undefined,
    since: query.since || undefined,
    limit: query.limit || undefined,
  } as any;
}

function publicEndpoint(endpoint: any, statusByEndpoint: Map<string, any>) {
  const status = statusByEndpoint.get(endpoint.id);
  return {
    ...endpoint,
    status: status?.status || "unverified",
    last_checked_at: status?.last_checked_at || null,
    latency_ms: status?.latency_ms || null,
    last_error: status?.last_error || null,
  };
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const STATUS_RANK: Record<string, number> = { healthy: 0, degraded: 1, unverified: 2, failing: 3 };

function statusRank(status: string) {
  return STATUS_RANK[status] ?? STATUS_RANK.unverified;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function lastThirtyDayKeys(now = new Date()) {
  return Array.from({ length: 30 }, (_unused, index) => {
    const date = new Date(now.getTime() - (29 - index) * 24 * 60 * 60 * 1000);
    return dayKey(date);
  });
}

function checkCountsAsUp(check: any) {
  return check.status === "healthy" || check.status === "degraded";
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function latestIso(values: Array<string | null | undefined>) {
  return values
    .filter(Boolean)
    .sort((a: any, b: any) => Date.parse(b) - Date.parse(a))[0] || null;
}

function healthSummaryForEndpoint(endpoint: any, status: any, checks: any[], now = new Date()) {
  const latestCheck = checks[0] || null;
  const daily = new Map<string, any[]>();
  for (const check of checks) {
    const key = dayKey(new Date(check.checked_at));
    daily.set(key, [...(daily.get(key) || []), check]);
  }
  const sparkline_30d = lastThirtyDayKeys(now).map((key) => {
    const rows = daily.get(key) || [];
    if (!rows.length) return null;
    const up = rows.filter(checkCountsAsUp).length;
    return (up / rows.length) * 100;
  });
  const uptimeValues = sparkline_30d.filter((value): value is number => value !== null);
  const latencyValues = checks.map((check) => Number(check.latency_ms)).filter(Number.isFinite);
  const currentStatus = status?.status || latestCheck?.status || "unverified";
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    category: endpoint.category,
    name: endpoint.name,
    description: endpoint.description,
    url_host: endpoint.url_host,
    agentkit: endpoint.agentkit,
    x402: endpoint.x402,
    estimated_cost_usd: endpoint.estimated_cost_usd,
    status: currentStatus,
    last_checked_at: status?.last_checked_at || latestCheck?.checked_at || null,
    status_code: status?.status_code ?? latestCheck?.status_code ?? null,
    latency_ms: status?.latency_ms ?? latestCheck?.latency_ms ?? null,
    p50_latency_ms: median(latencyValues),
    uptime_30d: average(uptimeValues),
    sparkline_30d,
    health_check_count_30d: checks.length,
    path: status?.path || latestCheck?.path || null,
    charged: Boolean(status?.charged ?? latestCheck?.charged ?? false),
    amount_usd: status?.amount_usd ?? latestCheck?.amount_usd ?? null,
    last_error: status?.last_error || latestCheck?.error || null,
  };
}

async function publicStatusRows(store: any, category?: string) {
  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const [statuses, checks] = await Promise.all([
    store.listEndpointStatus(),
    typeof store.listHealthChecks === "function" ? store.listHealthChecks({ since, limit: 5000 }) : [],
  ]);
  const statusByEndpoint = new Map<string, any>(statuses.map((status: any) => [status.endpoint_id, status]));
  const checksByEndpoint = new Map<string, any[]>();
  for (const check of checks) {
    checksByEndpoint.set(check.endpoint_id, [...(checksByEndpoint.get(check.endpoint_id) || []), check]);
  }
  return listEndpoints({ category })
    .map((endpoint: any) => healthSummaryForEndpoint(endpoint, statusByEndpoint.get(endpoint.id), checksByEndpoint.get(endpoint.id) || []))
    .sort((a: any, b: any) => {
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      return (b.uptime_30d ?? -1) - (a.uptime_30d ?? -1);
    });
}

function publicStatusPayload(endpoints: any[]) {
  const tracked = endpoints.filter((endpoint) => endpoint.uptime_30d !== null);
  const worst = endpoints.reduce((current, endpoint) => (
    statusRank(endpoint.status) > statusRank(current) ? endpoint.status : current
  ), endpoints.length ? "healthy" : "unverified");
  return {
    status: worst,
    summary: {
      endpoint_count: endpoints.length,
      operational_count: endpoints.filter((endpoint) => endpoint.status === "healthy").length,
      uptime_30d: average(tracked.map((endpoint) => endpoint.uptime_30d)),
      last_checked_at: latestIso(endpoints.map((endpoint) => endpoint.last_checked_at)),
    },
    endpoints,
  };
}

function normalizePayment(result: any) {
  return {
    amount_usd: result.amount_usd ?? null,
    currency: result.currency ?? null,
    payment_reference: result.payment_reference ?? null,
    payment_network: result.payment_network ?? null,
    payment_error: result.payment_error ?? null,
  };
}

function createRequestRow({ traceId, endpoint, request, auth, result, credit }: any) {
  return {
    id: `req_${randomUUID()}`,
    ts: new Date().toISOString(),
    trace_id: traceId,
    user_id: auth.user_id,
    api_key_id: auth.api_key_id,
    caller_id: auth.caller_id,
    endpoint_id: endpoint.id,
    category: endpoint.category,
    url_host: new URL(endpoint.url).hostname,
    status_code: result.status_code,
    ok: Boolean(result.ok),
    path: result.path,
    charged: Boolean(result.charged),
    estimated_usd: result.estimated_usd || request.estimated_usd || request.estimatedUsd || null,
    ...normalizePayment(result),
    credit_reservation_id: credit?.credit_reservation_id || null,
    credit_reserved_usd: credit?.credit_reserved_usd || null,
    credit_captured_usd: credit?.credit_captured_usd || null,
    credit_released_usd: credit?.credit_released_usd || null,
    latency_ms: result.latency_ms ?? null,
    error: result.error || null,
    body: result.body ?? null,
  };
}

function clientIp(request: any) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0]?.trim();
  return forwarded || request.ip || undefined;
}

async function endpointRows(store: any, category?: string) {
  const statuses = await store.listEndpointStatus();
  const statusByEndpoint = new Map<string, any>(statuses.map((status: any) => [status.endpoint_id, status]));
  return listEndpoints({ category }).map((endpoint: any) => publicEndpoint(endpoint, statusByEndpoint));
}

function requireObject(value: any, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object`), { statusCode: 400, code: "invalid_request" });
  }
  return value;
}

function rawBodyFrom(request: any) {
  if (typeof request.rawBody === "string") return request.rawBody;
  if (request.body === undefined) return "";
  return JSON.stringify(request.body);
}

async function ensureWalletAccount(store: any, crossmint: any, user: { user_id: string; email?: string | null }) {
  const existing = await store.getWalletAccount({ user_id: user.user_id });
  if (existing?.address && existing?.wallet_locator) return existing;
  const wallet = await crossmint.ensureWallet(user);
  return store.upsertWalletAccount({
    id: existing?.id || `wa_${randomUUID()}`,
    user_id: user.user_id,
    ...wallet,
  });
}

function shouldUseCrossmintSigner() {
  return process.env.ROUTER_DEV_MODE !== "true" && Boolean(process.env.CROSSMINT_SERVER_SIDE_API_KEY || process.env.CROSSMINT_API_KEY);
}

async function paymentSignerForRequest(store: any, crossmint: any, auth: any) {
  if (!shouldUseCrossmintSigner()) return null;
  const wallet = await ensureWalletAccount(store, crossmint, { user_id: auth.user_id });
  if (!wallet.address) {
    throw Object.assign(new Error("Crossmint wallet address is required for payment signing"), {
      statusCode: 500,
      code: "crossmint_wallet_missing",
    });
  }
  return {
    address: wallet.address,
    signMessage: async (payload: any) => {
      const message = payload && typeof payload === "object" && "message" in payload ? payload.message : payload;
      return crossmint.signMessage({ walletLocator: wallet.wallet_locator, message });
    },
  };
}

export function createApiApp({
  store = createStore(),
  executor = executeEndpoint,
  cache = createCache(),
  crossmint = createCrossmintClient(),
  logger = true,
}: any = {}) {
  validateRegistry();
  const app = Fastify({ logger });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request: any, body: string, done: any) => {
    try {
      (_request as any).rawBody = body;
      done(null, body ? JSON.parse(body) : {});
    } catch (error) {
      done(error);
    }
  });

  app.addHook("onRequest", (request: any, reply: any, done: any) => {
    const origin = process.env.TOOLROUTER_CORS_ORIGIN || "*";
    reply.header("access-control-allow-origin", origin);
    reply.header("access-control-allow-headers", "authorization,content-type,x-requested-with");
    reply.header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    if (request.method === "OPTIONS") {
      reply.status(204).send();
      return;
    }
    done();
  });

  app.setErrorHandler((error: any, _request, reply) => {
    const statusCode = error.statusCode || 500;
    const code = error.code || (statusCode >= 500 ? "internal_error" : "bad_request");
    reply.status(statusCode).send({
      error: {
        code,
        message: error instanceof Error ? error.message : String(error),
        details: error.details || undefined,
      },
      trace_id: error.trace_id || null,
    });
  });

  app.get("/health", async () => ({
    ok: true,
    service: "toolrouter-api",
    version: "0.1.0",
  }));

  app.get("/v1/status", async (request: any) => {
    const endpoints = await publicStatusRows(store, request.query?.category);
    return publicStatusPayload(endpoints);
  });

  app.get("/v1/endpoints", async (request: any) => {
    await authenticateApiKey(request.headers, store);
    return { endpoints: await endpointRows(store, request.query?.category) };
  });

  app.get("/v1/dashboard/endpoints", async (request: any) => {
    await authenticateSupabaseUser(request.headers);
    return { endpoints: await endpointRows(store, request.query?.category) };
  });

  app.get("/v1/requests", async (request: any) => {
    const auth = await authenticateApiKey(request.headers, store);
    const filters = requestFilters(request.query || {});
    if (!filters.api_key_id) filters.api_key_id = auth.api_key_id;
    return { requests: await store.listRequests(filters) };
  });

  app.get("/v1/dashboard/requests", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const filters = requestFilters(request.query || {});
    filters.user_id = user.user_id;
    return { requests: await store.listRequests(filters) };
  });

  app.get("/v1/balance", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const [account, wallet] = await Promise.all([
      getCreditBalance(store, user.user_id),
      store.getWalletAccount({ user_id: user.user_id }),
    ]);
    return {
      balance: {
        available_usd: account.available_usd,
        pending_usd: account.pending_usd,
        reserved_usd: account.reserved_usd,
        currency: account.currency || "USD",
        chain_id: wallet?.chain_id || "eip155:8453",
        asset: wallet?.asset || "USDC",
        wallet_address: wallet?.address || null,
      },
    };
  });

  app.get("/v1/ledger", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const limit = Math.max(1, Math.min(Number(request.query?.limit || 100), 500));
    return { entries: await store.listCreditLedgerEntries({ user_id: user.user_id, limit }) };
  });

  app.post("/v1/top-ups", async (request: any, reply: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const body = requireObject(request.body || {}, "request body");
    const amountUsd = assertTopUpAmount(body.amountUsd || body.amount_usd);
    await ensureCreditAccount(store, user.user_id);
    const wallet = await ensureWalletAccount(store, crossmint, user);
    const order = await crossmint.createTopUpOrder({
      user,
      walletAddress: wallet.address,
      amountUsd,
    });
    await markTopUpPending({
      store,
      user_id: user.user_id,
      wallet_account_id: wallet.id,
      provider_reference: order.provider_reference,
      amountUsd,
      metadata: {
        checkout_url: order.checkout_url,
        client_secret_present: Boolean(order.client_secret),
      },
    });
    reply.status(201);
    return {
      top_up: {
        provider: "crossmint",
        provider_reference: order.provider_reference,
        amount_usd: amountUsd,
        checkout_url: order.checkout_url,
        client_secret: order.client_secret,
        wallet_address: wallet.address,
      },
    };
  });

  app.get("/v1/requests/:id", async (request: any) => {
    const auth = await authenticateApiKey(request.headers, store);
    const row = await store.getRequest(decodeURIComponent(request.params.id));
    if (!row || row.api_key_id !== auth.api_key_id) {
      throw Object.assign(new Error("request not found"), { statusCode: 404, code: "not_found" });
    }
    return { request: row };
  });

  app.post("/v1/requests", async (request: any) => {
    const auth = await authenticateApiKey(request.headers, store);
    const body = requireObject(request.body || {}, "request body");
    const traceId = `trace_${randomUUID()}`;
    let reservation: any = null;
    try {
      const endpointId = body.endpoint_id || body.endpointId;
      if (!endpointId) {
        throw Object.assign(new Error("endpoint_id is required"), { statusCode: 400, code: "invalid_request" });
      }
      const endpoint = getEndpoint(endpointId);
      const providerRequest = endpoint.buildRequest(body.input || {});
      const maxUsd = body.maxUsd || body.max_usd;
      await enforceRequestPolicy({
        cache,
        auth,
        ip: clientIp(request),
        estimatedUsd: providerRequest.estimatedUsd,
        maxUsd,
      });
      reservation = await reserveCredits({
        store,
        user_id: auth.user_id,
        api_key_id: auth.api_key_id,
        trace_id: traceId,
        endpoint_id: endpoint.id,
        amountUsd: String(maxUsd || providerRequest.estimatedUsd || process.env.X402_MAX_USD_PER_REQUEST || "0.05"),
      });
      const result = await executor({
        endpoint,
        request: providerRequest,
        maxUsd,
        traceId,
        paymentSigner: await paymentSignerForRequest(store, crossmint, auth),
      });
      const credit = await finalizeCreditReservation({
        store,
        reservation,
        amountUsd: result.amount_usd || (result.charged ? reservation.amount_usd : "0"),
        paymentReference: result.payment_reference,
        metadata: {
          path: result.path,
          status_code: result.status_code,
        },
      });
      const row = createRequestRow({ traceId, endpoint, request: providerRequest, auth, result, credit });
      await store.insertRequest(row);
      return {
        id: row.id,
        trace_id: traceId,
        endpoint_id: endpoint.id,
        path: row.path,
        charged: row.charged,
        status_code: row.status_code,
        credit_reserved_usd: row.credit_reserved_usd,
        credit_captured_usd: row.credit_captured_usd,
        credit_released_usd: row.credit_released_usd,
        body: result.body ?? null,
      };
    } catch (error: any) {
      if (reservation) {
        await releaseCreditReservation({
          store,
          reservation,
          reason: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
      error.trace_id = traceId;
      if (!error.statusCode) error.statusCode = 400;
      throw error;
    }
  });

  app.post("/webhooks/crossmint", async (request: any) => {
    const rawBody = rawBodyFrom(request);
    crossmint.verifyWebhook(rawBody, request.headers);
    const event = crossmint.normalizeWebhook(request.body || {});
    if (!event.provider_reference || event.status === "pending") {
      return { ok: true, ignored: true };
    }
    const settled = await settleTopUp({
      store,
      provider_reference: event.provider_reference,
      status: event.status,
      metadata: {
        event_id: event.event_id,
        raw_status: event.raw_status,
      },
    });
    return { ok: true, duplicate: settled.duplicate };
  });

  app.get("/v1/api-keys", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return { api_keys: await store.listApiKeys({ user_id: user.user_id }) };
  });

  app.post("/v1/api-keys", async (request: any, reply: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const body = requireObject(request.body || {}, "request body");
    const callerId = String(body.caller_id || body.callerId || "").trim();
    if (!callerId) throw Object.assign(new Error("caller_id is required"), { statusCode: 400, code: "invalid_request" });
    const created = await store.createApiKey({ user_id: user.user_id, caller_id: callerId });
    reply.status(201);
    return created;
  });

  app.delete("/v1/api-keys/:id", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return { api_key: await store.disableApiKey({ id: decodeURIComponent(request.params.id), user_id: user.user_id }) };
  });

  return app;
}
