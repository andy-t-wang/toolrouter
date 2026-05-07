import Fastify from "fastify";
import { createHash, randomUUID } from "node:crypto";

import { authenticateApiKey, authenticateSupabaseUser } from "@toolrouter/auth";
import { createCache, enforceRequestPolicy } from "@toolrouter/cache";
import { createStore } from "@toolrouter/db";
import {
  executeEndpoint,
  getEndpoint,
  listCategories,
  listEndpoints,
  validateRegistry,
} from "@toolrouter/router-core";
import {
  assertTopUpAmount,
  attachCheckoutToCreditPurchase,
  claimCreditPurchaseForFunding,
  createCreditPurchase,
  ensureCreditAccount,
  finalizeCreditReservation,
  getCreditBalance,
  markCreditPurchaseFailed,
  releaseCreditReservation,
  reserveCredits,
  settleFundedCreditPurchase,
} from "./billing.ts";
import { createCrossmintClient } from "./crossmint.ts";
import { createStripeClient } from "./stripe.ts";
import { createAlertClient } from "./alerts.ts";

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
const STATUS_RANK: Record<string, number> = {
  healthy: 0,
  degraded: 1,
  unverified: 2,
  failing: 3,
};

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

const CONSTRAINT_ERROR_MESSAGES: Record<
  string,
  { code: string; message: string; statusCode?: number }
> = {
  api_keys_caller_id_key: {
    code: "api_key_name_conflict",
    message: "An API key with that name already exists. Choose a different name.",
    statusCode: 409,
  },
  api_keys_key_hash_key: {
    code: "api_key_generation_conflict",
    message: "We could not generate a unique API key. Please try again.",
    statusCode: 409,
  },
};

function constraintNameFrom(error: any) {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/unique constraint "([^"]+)"/)?.[1] || null;
}

export function normalizeApiError(error: any) {
  const constraint = constraintNameFrom(error);
  const knownConstraint = constraint
    ? CONSTRAINT_ERROR_MESSAGES[constraint]
    : null;
  const statusCode =
    knownConstraint?.statusCode ||
    (constraint ? 409 : error.statusCode || error.status || 500);
  const fallbackCode =
    statusCode >= 500
      ? "internal_error"
      : statusCode === 409
        ? "conflict"
        : "bad_request";
  return {
    statusCode,
    code:
      knownConstraint?.code ||
      (constraint ? "conflict" : error.code || fallbackCode),
    message:
      knownConstraint?.message ||
      (constraint ? "That value is already in use. Try a different value." : null) ||
      (error instanceof Error ? error.message : String(error)),
    details: constraint ? undefined : error.details || undefined,
    trace_id: error.trace_id || null,
  };
}

function latestIso(values: Array<string | null | undefined>) {
  return (
    values
      .filter(Boolean)
      .sort((a: any, b: any) => Date.parse(b) - Date.parse(a))[0] || null
  );
}

function isErrorRequest(row: any) {
  return (
    Boolean(row.error) || row.ok === false || Number(row.status_code) >= 400
  );
}

function sumPaid(rows: any[]) {
  return rows.reduce((sum, row) => {
    const value = row.credit_captured_usd ?? row.amount_usd ?? 0;
    const number = Number(value);
    return sum + (Number.isFinite(number) ? number : 0);
  }, 0);
}

async function monitoringPayload(store: any, user_id: string) {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const [requests24h, requests30d, statuses, checks24h] = await Promise.all([
    store.listRequests({ user_id, since: since24h, limit: 500 }),
    store.listRequests({ user_id, since: since30d, limit: 500 }),
    store.listEndpointStatus(),
    typeof store.listHealthChecks === "function"
      ? store.listHealthChecks({ since: since24h, limit: 5000 })
      : [],
  ]);
  const errorRows = requests24h.filter(isErrorRequest);
  const statusByEndpoint = new Map<string, any>(
    statuses.map((status: any) => [status.endpoint_id, status]),
  );
  const endpointStatuses = listEndpoints().map(
    (endpoint: any) =>
      statusByEndpoint.get(endpoint.id)?.status || "unverified",
  );
  const healthyEndpoints = endpointStatuses.filter(
    (status: string) => status === "healthy",
  ).length;
  const failingEndpoints = endpointStatuses.filter(
    (status: string) => status === "failing",
  ).length;
  const degradedEndpoints = endpointStatuses.filter(
    (status: string) => status === "degraded",
  ).length;
  const lastCheck = latestIso([
    ...statuses.map((row: any) => row.last_checked_at),
    ...checks24h.map((row: any) => row.checked_at),
  ]);
  return {
    window: {
      since_24h: since24h,
      since_30d: since30d,
    },
    requests_24h: {
      total: requests24h.length,
      errors: errorRows.length,
      error_rate: requests24h.length
        ? errorRows.length / requests24h.length
        : 0,
      agentkit: requests24h.filter((row: any) => row.path === "agentkit")
        .length,
      x402: requests24h.filter(
        (row: any) => row.path === "x402" || row.path === "agentkit_to_x402",
      ).length,
      paid_usd: sumPaid(requests24h),
      recent_errors: errorRows.slice(0, 5).map((row: any) => ({
        id: row.id,
        ts: row.ts,
        endpoint_id: row.endpoint_id,
        status_code: row.status_code,
        error: row.error,
      })),
    },
    requests_30d: {
      total: requests30d.length,
      errors: requests30d.filter(isErrorRequest).length,
      paid_usd: sumPaid(requests30d),
    },
    endpoint_health: {
      total: endpointStatuses.length,
      healthy: healthyEndpoints,
      degraded: degradedEndpoints,
      failing: failingEndpoints,
      unverified: endpointStatuses.filter(
        (status: string) => status === "unverified",
      ).length,
      checks_24h: checks24h.length,
      last_checked_at: lastCheck,
    },
  };
}

function healthSummaryForEndpoint(
  endpoint: any,
  status: any,
  checks: any[],
  now = new Date(),
) {
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
  const uptimeValues = sparkline_30d.filter(
    (value): value is number => value !== null,
  );
  const latencyValues = checks
    .map((check) => Number(check.latency_ms))
    .filter(Number.isFinite);
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
    typeof store.listHealthChecks === "function"
      ? store.listHealthChecks({ since, limit: 5000 })
      : [],
  ]);
  const statusByEndpoint = new Map<string, any>(
    statuses.map((status: any) => [status.endpoint_id, status]),
  );
  const checksByEndpoint = new Map<string, any[]>();
  for (const check of checks) {
    checksByEndpoint.set(check.endpoint_id, [
      ...(checksByEndpoint.get(check.endpoint_id) || []),
      check,
    ]);
  }
  return listEndpoints({ category })
    .map((endpoint: any) =>
      healthSummaryForEndpoint(
        endpoint,
        statusByEndpoint.get(endpoint.id),
        checksByEndpoint.get(endpoint.id) || [],
      ),
    )
    .sort((a: any, b: any) => {
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      return (b.uptime_30d ?? -1) - (a.uptime_30d ?? -1);
    });
}

function publicStatusPayload(endpoints: any[]) {
  const tracked = endpoints.filter((endpoint) => endpoint.uptime_30d !== null);
  const worst = endpoints.reduce(
    (current, endpoint) =>
      statusRank(endpoint.status) > statusRank(current)
        ? endpoint.status
        : current,
    endpoints.length ? "healthy" : "unverified",
  );
  return {
    status: worst,
    summary: {
      endpoint_count: endpoints.length,
      operational_count: endpoints.filter(
        (endpoint) => endpoint.status === "healthy",
      ).length,
      uptime_30d: average(tracked.map((endpoint) => endpoint.uptime_30d)),
      last_checked_at: latestIso(
        endpoints.map((endpoint) => endpoint.last_checked_at),
      ),
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

function createRequestRow({
  traceId,
  endpoint,
  request,
  auth,
  result,
  credit,
}: any) {
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
    estimated_usd:
      result.estimated_usd ||
      request.estimated_usd ||
      request.estimatedUsd ||
      null,
    agentkit_value_type: endpoint.agentkit_value_type,
    agentkit_value_label: endpoint.agentkit_value_label,
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
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  return forwarded || request.ip || undefined;
}

async function endpointRows(store: any, category?: string) {
  const statuses = await store.listEndpointStatus();
  const statusByEndpoint = new Map<string, any>(
    statuses.map((status: any) => [status.endpoint_id, status]),
  );
  return listEndpoints({ category }).map((endpoint: any) =>
    publicEndpoint(endpoint, statusByEndpoint),
  );
}

async function categoryRows(store: any, includeEmpty = false) {
  const statuses = await store.listEndpointStatus();
  const statusByEndpoint = new Map<string, any>(
    statuses.map((status: any) => [status.endpoint_id, status]),
  );
  return listCategories({ includeEmpty }).map((category: any) => ({
    ...category,
    recommended_endpoint: category.recommended_endpoint
      ? publicEndpoint(category.recommended_endpoint, statusByEndpoint)
      : null,
    endpoints: category.endpoints.map((endpoint: any) =>
      publicEndpoint(endpoint, statusByEndpoint),
    ),
  }));
}

function requireObject(value: any, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object`), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return value;
}

function rawBodyFrom(request: any) {
  if (typeof request.rawBody === "string") return request.rawBody;
  if (request.body === undefined) return "";
  return JSON.stringify(request.body);
}

async function ensureAgentWalletAccount(
  store: any,
  crossmint: any,
  user: { user_id: string; email?: string | null },
) {
  const existing = await store.getWalletAccount({ user_id: user.user_id });
  if (existing?.address && existing?.wallet_locator) return existing;
  const wallet = await crossmint.ensureWallet(user);
  return store.upsertWalletAccount({
    id: existing?.id || `wa_${randomUUID()}`,
    user_id: user.user_id,
    ...wallet,
  });
}

async function ensureAgentKitAccount(
  store: any,
  crossmint: any,
  user: { user_id: string; email?: string | null },
) {
  const existing = await store.getWalletAccount({ user_id: user.user_id });
  if (existing?.address && existing?.wallet_locator) return existing;
  return ensureAgentWalletAccount(store, crossmint, user);
}

async function getVisibleAccount(store: any, user: { user_id: string; email?: string | null }) {
  return store.getWalletAccount({ user_id: user.user_id });
}

function safeAgentKitVerification(wallet: any) {
  return {
    verified: Boolean(wallet?.agentkit_verified),
    verified_at: wallet?.agentkit_verified_at || null,
    last_checked_at: wallet?.agentkit_last_checked_at || null,
    error: wallet?.agentkit_verification_error || null,
  };
}

function hashHumanId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadAgentBookVerifier() {
  const { createAgentBookVerifier } = await import("@worldcoin/agentkit");
  return createAgentBookVerifier({
    rpcUrl: process.env.AGENTKIT_WORLDCHAIN_RPC_URL || undefined,
  });
}

async function verifyAgentKitAccount({
  store,
  crossmint,
  user,
  agentBookVerifier,
}: any) {
  const wallet = await ensureAgentKitAccount(store, crossmint, user);
  const checkedAt = new Date().toISOString();
  let verified = false;
  let humanIdHash = null;
  let error = null;

  if (!wallet.address) {
    error = "agent address is missing";
  } else {
    try {
      const verifier = agentBookVerifier || (await loadAgentBookVerifier());
      const humanId = await verifier.lookupHuman(wallet.address);
      verified = Boolean(humanId);
      humanIdHash = humanId ? hashHumanId(humanId) : null;
      if (!verified) error = "Not Verified";
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  const updated = await store.upsertWalletAccount({
    id: wallet.id,
    user_id: user.user_id,
    provider: wallet.provider || "crossmint",
    wallet_locator: wallet.wallet_locator,
    address: wallet.address,
    chain_id: wallet.chain_id || "eip155:8453",
    asset: wallet.asset || "USDC",
    status: wallet.status || "active",
    metadata: wallet.metadata || {},
    agentkit_verified: verified,
    agentkit_human_id_hash: humanIdHash,
    agentkit_verified_at: verified ? checkedAt : null,
    agentkit_last_checked_at: checkedAt,
    agentkit_verification_error: error,
  });
  return {
    agentkit_verification: safeAgentKitVerification(updated),
  };
}

function shouldUseCrossmintSigner() {
  return (
    process.env.ROUTER_DEV_MODE !== "true" &&
    Boolean(
      process.env.CROSSMINT_SERVER_SIDE_API_KEY ||
      process.env.CROSSMINT_API_KEY,
    )
  );
}

async function paymentSignerForRequest(store: any, crossmint: any, auth: any) {
  if (!shouldUseCrossmintSigner()) return null;
  const wallet = await ensureAgentWalletAccount(store, crossmint, {
    user_id: auth.user_id,
  });
  if (!wallet.address) {
    throw Object.assign(
      new Error("Crossmint wallet address is required for payment signing"),
      {
        statusCode: 500,
        code: "crossmint_wallet_missing",
      },
    );
  }
  return {
    address: wallet.address,
    signMessage: async (payload: any) => {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? payload.message
          : payload;
      return crossmint.signMessage({
        walletLocator: wallet.wallet_locator,
        message,
      });
    },
  };
}

function checkoutSessionFromEvent(event: any) {
  return event?.data?.object || event?.object || {};
}

function purchaseIdFromCheckoutSession(session: any) {
  return (
    session?.client_reference_id ||
    session?.metadata?.toolrouter_purchase_id ||
    null
  );
}

async function processStripeCheckoutCompleted({
  store,
  crossmint,
  alerts,
  session,
  event,
}: any) {
  const providerSessionId = session?.id || null;
  const purchaseId = purchaseIdFromCheckoutSession(session);
  const { purchase, claimed, duplicate } = await claimCreditPurchaseForFunding({
    store,
    purchaseId,
    providerSessionId,
  });
  if (!claimed) {
    return {
      ok: true,
      duplicate,
      purchase_id: purchase.id,
      status: purchase.status,
    };
  }

  let wallet: any = null;
  try {
    wallet = await ensureAgentWalletAccount(store, crossmint, {
      user_id: purchase.user_id,
    });
    if (!wallet?.address) {
      throw Object.assign(new Error("agent account address is required for funding"), {
        code: "agent_wallet_missing",
      });
    }
    const funding = await crossmint.fundAgentWallet({
      toAddress: wallet.address,
      amountUsd: String(purchase.amount_usd),
    });
    await store.insertWalletTransaction({
      id: `wtx_${randomUUID()}`,
      ts: new Date().toISOString(),
      user_id: purchase.user_id,
      wallet_account_id: wallet.id,
      provider: "crossmint",
      provider_reference: funding.provider_reference,
      kind: "top_up",
      status: "success",
      amount_usd: purchase.amount_usd,
      currency: "USD",
      chain_id: wallet.chain_id || "eip155:8453",
      asset: wallet.asset || "USDC",
      metadata: {
        stripe_event_id: event?.id || null,
        stripe_checkout_session_id: providerSessionId,
        funding_transaction_id: funding.transaction_id || null,
        funding_explorer_link_present: Boolean(funding.explorer_link),
      },
    });
    const settled = await settleFundedCreditPurchase({
      store,
      purchase,
      wallet_account_id: wallet.id,
      fundingReference: funding.provider_reference,
      fundingTransactionId: funding.transaction_id,
      metadata: {
        stripe_event_id: event?.id || null,
        stripe_checkout_session_id: providerSessionId,
      },
    });
    return {
      ok: true,
      duplicate: settled.duplicate,
      purchase_id: settled.purchase.id,
      status: settled.purchase.status,
    };
  } catch (error) {
    const alreadyAlerted = Boolean(purchase?.metadata?.funding_alert_sent_at);
    const failed = await markCreditPurchaseFailed({
      store,
      purchase,
      status: "funding_failed",
      reason: error instanceof Error ? error.message : String(error),
      metadata: {
        stripe_event_id: event?.id || null,
        stripe_checkout_session_id: providerSessionId,
        wallet_account_id: wallet?.id || null,
      },
    });
    if (!failed.duplicate && !alreadyAlerted) {
      const alertSubject = `ToolRouter credit funding failed: ${purchase.id}`;
      const alertText = [
        "ToolRouter could not settle a paid Stripe credit purchase.",
        "",
        `Purchase: ${purchase.id}`,
        `Stripe session: ${providerSessionId || "unknown"}`,
        `User: ${purchase.user_id}`,
        `Amount: $${purchase.amount_usd}`,
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        "",
        "Credits were not made available. Top up the treasury and run npm run billing:retry-funding, or wait for Stripe webhook retry if it is still active.",
      ].join("\n");
      let alertResult: any = null;
      try {
        alertResult = await alerts?.sendOperationalAlert?.({
          subject: alertSubject,
          text: alertText,
          metadata: {
            purchase_id: purchase.id,
            stripe_checkout_session_id: providerSessionId,
          },
        });
      } catch (alertError) {
        alertResult = {
          sent: false,
          error: alertError instanceof Error ? alertError.message : String(alertError),
        };
      }
      await store.updateCreditPurchase({
        ...failed.purchase,
        metadata: {
          ...(failed.purchase.metadata || {}),
          funding_alert_sent_at: new Date().toISOString(),
          funding_alert_sent: Boolean(alertResult?.sent),
          funding_alert_error: alertResult?.error || null,
        },
      });
    }
    return {
      ok: false,
      duplicate: failed.duplicate,
      purchase_id: failed.purchase.id,
      status: failed.purchase.status,
      error: failed.purchase.error,
    };
  }
}

async function processStripeCheckoutFailed({ store, session, event }: any) {
  const providerSessionId = session?.id || null;
  const purchaseId = purchaseIdFromCheckoutSession(session);
  const purchase =
    (purchaseId ? await store.getCreditPurchase(purchaseId) : null) ||
    (providerSessionId ? await store.findCreditPurchaseByProviderSession(providerSessionId) : null);
  if (!purchase) return { ok: true, ignored: true };
  const failed = await markCreditPurchaseFailed({
    store,
    purchase,
    status: "checkout_failed",
    reason: String(event?.type || "checkout_failed"),
    metadata: {
      stripe_event_id: event?.id || null,
      stripe_checkout_session_id: providerSessionId,
    },
  });
  return {
    ok: true,
    duplicate: failed.duplicate,
    purchase_id: failed.purchase.id,
    status: failed.purchase.status,
  };
}

export function createApiApp({
  store = createStore(),
  executor = executeEndpoint,
  cache = createCache(),
  crossmint = createCrossmintClient(),
  stripe = createStripeClient(),
  alerts = createAlertClient(),
  agentBookVerifier = null,
  logger = true,
}: any = {}) {
  validateRegistry();
  const app = Fastify({ logger });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request: any, body: string, done: any) => {
      try {
        (_request as any).rawBody = body;
        done(null, body ? JSON.parse(body) : {});
      } catch (error) {
        done(error);
      }
    },
  );

  app.addHook("onRequest", (request: any, reply: any, done: any) => {
    const origin = process.env.TOOLROUTER_CORS_ORIGIN || "*";
    reply.header("access-control-allow-origin", origin);
    reply.header(
      "access-control-allow-headers",
      "authorization,content-type,x-requested-with",
    );
    reply.header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    if (request.method === "OPTIONS") {
      reply.status(204).send();
      return;
    }
    done();
  });

  app.setErrorHandler((error: any, _request, reply) => {
    const normalized = normalizeApiError(error);
    reply.status(normalized.statusCode).send({
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
      },
      trace_id: normalized.trace_id,
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

  app.get("/v1/categories", async (request: any) => {
    await authenticateApiKey(request.headers, store);
    return {
      categories: await categoryRows(
        store,
        request.query?.include_empty === "true",
      ),
    };
  });

  app.get("/v1/dashboard/categories", async (request: any) => {
    await authenticateSupabaseUser(request.headers);
    return {
      categories: await categoryRows(
        store,
        request.query?.include_empty === "true",
      ),
    };
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

  app.get("/v1/dashboard/monitoring", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return { monitoring: await monitoringPayload(store, user.user_id) };
  });

  app.get("/v1/balance", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const [account, wallet] = await Promise.all([
      getCreditBalance(store, user.user_id),
      getVisibleAccount(store, user),
    ]);
    return {
      balance: {
        available_usd: account.available_usd,
        pending_usd: account.pending_usd,
        reserved_usd: account.reserved_usd,
        currency: account.currency || "USD",
        agentkit_verification: safeAgentKitVerification(wallet),
      },
    };
  });

  app.post("/v1/agentkit/account-verification", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return verifyAgentKitAccount({ store, crossmint, user, agentBookVerifier });
  });

  app.post("/v1/wallet/agentkit-verification", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return verifyAgentKitAccount({ store, crossmint, user, agentBookVerifier });
  });

  app.get("/v1/ledger", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const limit = Math.max(
      1,
      Math.min(Number(request.query?.limit || 100), 500),
    );
    return {
      entries: await store.listCreditLedgerEntries({
        user_id: user.user_id,
        limit,
      }),
    };
  });

  app.post("/v1/top-ups", async (request: any, reply: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const body = requireObject(request.body || {}, "request body");
    const amountUsd = assertTopUpAmount(body.amountUsd || body.amount_usd);
    stripe.assertCheckoutAllowed?.();
    await ensureCreditAccount(store, user.user_id);
    const purchase = await createCreditPurchase({
      store,
      user_id: user.user_id,
      amountUsd,
      metadata: {
        source: "dashboard",
      },
    });
    const checkout = await stripe.createCheckoutSession({
      user,
      amountUsd,
      purchaseId: purchase.id,
    });
    const updated = await attachCheckoutToCreditPurchase({
      store,
      purchase,
      checkout,
    });
    reply.status(201);
    return {
      top_up: {
        id: updated.id,
        provider: "stripe",
        provider_reference: updated.provider_checkout_session_id,
        amount_usd: amountUsd,
        checkout_url: updated.checkout_url,
        status: updated.status,
      },
    };
  });

  app.get("/v1/requests/:id", async (request: any) => {
    const auth = await authenticateApiKey(request.headers, store);
    const row = await store.getRequest(decodeURIComponent(request.params.id));
    if (!row || row.api_key_id !== auth.api_key_id) {
      throw Object.assign(new Error("request not found"), {
        statusCode: 404,
        code: "not_found",
      });
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
        throw Object.assign(new Error("endpoint_id is required"), {
          statusCode: 400,
          code: "invalid_request",
        });
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
        amountUsd: String(
          maxUsd ||
            providerRequest.estimatedUsd ||
            process.env.X402_MAX_USD_PER_REQUEST ||
            "0.05",
        ),
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
        amountUsd:
          result.amount_usd || (result.charged ? reservation.amount_usd : "0"),
        paymentReference: result.payment_reference,
        metadata: {
          path: result.path,
          status_code: result.status_code,
        },
      });
      const row = createRequestRow({
        traceId,
        endpoint,
        request: providerRequest,
        auth,
        result,
        credit,
      });
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

  app.post("/webhooks/stripe", async (request: any, reply: any) => {
    const rawBody = rawBodyFrom(request);
    const event = stripe.constructWebhookEvent(rawBody, request.headers);
    const session = checkoutSessionFromEvent(event);

    if (event?.type === "checkout.session.completed" || event?.type === "checkout.session.async_payment_succeeded") {
      const result = await processStripeCheckoutCompleted({
        store,
        crossmint,
        alerts,
        session,
        event,
      });
      if (result?.ok === false) reply.status(500);
      return result;
    }

    if (event?.type === "checkout.session.expired" || event?.type === "checkout.session.async_payment_failed") {
      return processStripeCheckoutFailed({
        store,
        session,
        event,
      });
    }

    return {
      ok: true,
      ignored: true,
      type: event?.type || null,
    };
  });

  app.get("/v1/api-keys", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return { api_keys: await store.listApiKeys({ user_id: user.user_id }) };
  });

  app.post("/v1/api-keys", async (request: any, reply: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const body = requireObject(request.body || {}, "request body");
    const callerId = String(body.caller_id || body.callerId || "").trim();
    if (!callerId)
      throw Object.assign(new Error("caller_id is required"), {
        statusCode: 400,
        code: "invalid_request",
      });
    const created = await store.createApiKey({
      user_id: user.user_id,
      caller_id: callerId,
    });
    reply.status(201);
    return created;
  });

  app.delete("/v1/api-keys/:id", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return {
      api_key: await store.disableApiKey({
        id: decodeURIComponent(request.params.id),
        user_id: user.user_id,
      }),
    };
  });

  return app;
}
