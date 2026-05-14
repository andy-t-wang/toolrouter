import Fastify from "fastify";
import { createHash, randomUUID } from "node:crypto";

import { authenticateApiKey, authenticateSupabaseUser } from "@toolrouter/auth";
import { createCache, enforceRequestPolicy } from "@toolrouter/cache";
import { createStore } from "@toolrouter/db";
import {
  executeEndpoint,
  countsAsAgentKitEvidence,
  getEndpoint,
  listCategories,
  listEndpoints,
  realizedAgentKitValue,
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
  parseUsd,
  releaseCreditReservation,
  reserveCredits,
  settleFundedCreditPurchase,
} from "./billing.ts";
import { createCrossmintClient } from "./crossmint.ts";
import { createStripeClient } from "./stripe.ts";
import { createAlertClient } from "./alerts.ts";
import { createDatadogClient } from "./datadog.ts";
import {
  agentBookRegistrationService,
  buildAgentKitVerificationRequest,
  registrationPayloadFromBody,
} from "./agentkitRegistration.ts";
import {
  createManusX402Wrapper,
  getManusTaskDetail,
  listManusTaskMessages,
} from "./manus.ts";

function requestFilters(query: any) {
  const cursor = decodeRequestCursor(query.cursor);
  return {
    endpoint_id: query.endpoint_id || undefined,
    api_key_id: query.api_key_id || undefined,
    status: query.status || undefined,
    charged: query.charged || undefined,
    since: query.since || undefined,
    limit: query.limit || undefined,
    before_ts: cursor?.ts,
    before_id: cursor?.id,
  } as any;
}

function requestPageLimit(value: any) {
  const limit = Number(value || 100);
  return Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 500)) : 100;
}

function encodeRequestCursor(row: any) {
  if (!row?.ts || !row?.id) return null;
  return Buffer.from(JSON.stringify({ ts: row.ts, id: row.id }), "utf8").toString("base64url");
}

function decodeRequestCursor(value: any) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed?.ts || !parsed?.id) return null;
    return { ts: String(parsed.ts), id: String(parsed.id) };
  } catch {
    return null;
  }
}

async function requestPage(store: any, filters: any, rowMapper = apiTraceDto) {
  const limit = requestPageLimit(filters.limit);
  const rows = await store.listRequests({ ...filters, limit: limit + 1 });
  const requests = rows.slice(0, limit).map(rowMapper);
  return {
    requests,
    next_cursor: rows.length > limit ? encodeRequestCursor(requests[requests.length - 1]) : null,
    has_more: rows.length > limit,
  };
}

function apiTraceDto(row: any) {
  return {
    id: row.id,
    ts: row.ts || null,
    trace_id: row.trace_id,
    user_id: row.user_id,
    api_key_id: row.api_key_id,
    caller_id: row.caller_id,
    endpoint_id: row.endpoint_id,
    category: row.category || null,
    url_host: row.url_host || null,
    status_code: row.status_code ?? null,
    ok: Boolean(row.ok),
    path: row.path || null,
    charged: Boolean(row.charged),
    estimated_usd: row.estimated_usd ?? null,
    amount_usd: row.amount_usd ?? null,
    currency: row.currency ?? null,
    credit_reservation_id: row.credit_reservation_id || null,
    credit_reserved_usd: row.credit_reserved_usd ?? null,
    credit_captured_usd: row.credit_captured_usd ?? null,
    credit_released_usd: row.credit_released_usd ?? null,
    agentkit_value_type: row.agentkit_value_type || null,
    agentkit_value_label: row.agentkit_value_label || null,
    latency_ms: row.latency_ms ?? null,
    error: row.error || null,
  };
}

function dashboardRequestDto(row: any) {
  const safe = apiTraceDto(row);
  const {
    user_id: _user_id,
    error: _error,
    payment_reference: _payment_reference,
    payment_network: _payment_network,
    payment_error: _payment_error,
    ...dashboard
  } = safe as any;
  return dashboard;
}

function endpointDto(endpoint: any) {
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    category: endpoint.category,
    name: endpoint.name,
    description: endpoint.description,
    url_host: endpoint.url_host,
    method: endpoint.method,
    agentkit: Boolean(endpoint.agentkit),
    x402: Boolean(endpoint.x402),
    agentkit_proof_header: Boolean(endpoint.agentkit_proof_header),
    estimated_cost_usd: endpoint.estimated_cost_usd,
    agentkit_value_type: endpoint.agentkit_value_type,
    agentkit_value_label: endpoint.agentkit_value_label,
    default_payment_mode: endpoint.default_payment_mode,
    enabled: Boolean(endpoint.enabled),
    ui: endpoint.ui
      ? {
          displayName: endpoint.ui.displayName,
          icon: endpoint.ui.icon,
          primaryField: endpoint.ui.primaryField,
          fieldOrder: endpoint.ui.fieldOrder || [],
          badge: endpoint.ui.badge,
          fixture_label: endpoint.ui.fixture_label,
        }
      : null,
  };
}

function publicStatusError(row: any) {
  const error = String(row?.last_error || row?.error || "");
  const statusCode = Number(row?.status_code);
  if (!error && (!Number.isFinite(statusCode) || statusCode < 400)) return null;
  if (statusCode === 402) return "Provider payment required";
  if (statusCode === 429) return "Provider rate limited";
  if (statusCode === 504 || /timed out|timeout/iu.test(error)) return "Provider timed out";
  if (Number.isFinite(statusCode) && statusCode >= 500) return "Provider error";
  if (/payment|stripe|x402/iu.test(error)) return "Provider payment error";
  return "Latest check failed";
}

function publicRequestError(row: any) {
  const statusCode = Number(row?.status_code);
  const raw = String(row?.error || "");
  if (!raw && (!Number.isFinite(statusCode) || statusCode < 400)) return null;
  if (statusCode === 402) return "Payment required";
  if (statusCode === 429) return "Rate limited";
  if (statusCode === 504 || /timed out|timeout/iu.test(raw)) return "Request timed out";
  if (Number.isFinite(statusCode) && statusCode >= 500) return "Provider error";
  return "Request failed";
}

function publicEndpoint(endpoint: any, statusByEndpoint: Map<string, any>) {
  const status = statusByEndpoint.get(endpoint.id);
  return {
    ...endpointDto(endpoint),
    status: status?.status || "unverified",
    last_checked_at: status?.last_checked_at || null,
    latency_ms: status?.latency_ms || null,
    last_error: publicStatusError(status),
  };
}

function publicTopUp(purchase: any) {
  return {
    id: purchase.id,
    provider: purchase.provider || "stripe",
    amount_usd: purchase.amount_usd,
    status: purchase.status,
    created_at: purchase.created_at || null,
    updated_at: purchase.updated_at || null,
    error: publicTopUpError(purchase),
  };
}

function topUpLimitUsd() {
  return assertTopUpAmount(process.env.TOOLROUTER_MAX_TOP_UP_USD || "5");
}

function dashboardBalanceDto(account: any, wallet: any) {
  return {
    available_usd: account.available_usd,
    currency: account.currency || "USD",
    agentkit_verification: safeAgentKitVerification(wallet),
    limits: {
      max_top_up_usd: topUpLimitUsd(),
    },
  };
}

function publicTopUpError(purchase: any) {
  const status = String(purchase?.status || "");
  if (!purchase?.error) return null;
  if (status === "funding_failed") return "Credits could not be funded yet. We will retry automatically.";
  if (status === "checkout_failed") return "Checkout failed.";
  return "Top-up failed.";
}

function publicLedgerEntry(entry: any) {
  return {
    id: entry.id,
    ts: entry.ts || entry.created_at || null,
    type: entry.type,
    amount_usd: entry.amount_usd ?? null,
  };
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_AGENTKIT_PREFLIGHT_TIMEOUT_MS = 10_000;
const MANUS_RESEARCH_ENDPOINT_ID = "manus.research";
const MANUS_TASK_TTL_MS = 24 * 60 * 60 * 1000;
const MANUS_POLL_AFTER_SECONDS = 30;
const STATUS_RANK: Record<string, number> = {
  healthy: 0,
  degraded: 1,
  unverified: 2,
  failing: 3,
};

function envMs(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function agentKitPreflightTimeoutMs() {
  const configured = envMs(
    "TOOLROUTER_AGENTKIT_PREFLIGHT_TIMEOUT_MS",
    DEFAULT_AGENTKIT_PREFLIGHT_TIMEOUT_MS,
  );
  return Math.max(1, configured);
}

function timedOut(result: any) {
  return String(result?.error || "").includes("timed out after");
}

function logEndpointRequest(request: any, endpoint: any, result: any) {
  request.log?.info?.(
    {
      endpoint_id: endpoint.id,
      status_code: result.status_code ?? null,
      path: result.path ?? null,
      charged: Boolean(result.charged),
      latency_ms: result.latency_ms ?? null,
      timeout: timedOut(result),
      error: result.error || null,
    },
    "endpoint request completed",
  );
}

function logAgentKitPreflight(
  request: any,
  endpoint: any,
  result: any,
  options: { realized_free_trial: boolean; will_fallback: boolean },
) {
  request.log?.info?.(
    {
      endpoint_id: endpoint.id,
      preflight_status_code: result?.status_code ?? null,
      preflight_ok: Boolean(result?.ok),
      preflight_path: result?.path ?? null,
      preflight_charged: Boolean(result?.charged),
      preflight_latency_ms: result?.latency_ms ?? null,
      preflight_timeout: timedOut(result),
      preflight_error: result?.error || null,
      realized_free_trial: options.realized_free_trial,
      will_fallback: options.will_fallback,
    },
    "agentkit preflight completed",
  );
}

function requestMetricStatus(row: any) {
  if (Number(row.status_code) === 402) return "payment_required";
  return isErrorRequest(row) ? "fail" : "success";
}

function requestMetricTags(row: any) {
  return {
    status: requestMetricStatus(row),
    endpoint: row.endpoint_id,
    path: row.path || "unknown",
    status_code: row.status_code || "unknown",
  };
}

function recordRequestMetrics(datadog: any, row: any) {
  const tags = requestMetricTags(row);
  datadog?.increment?.("toolrouter.requests.count", tags).catch(() => undefined);
  if (!isErrorRequest(row) && isAgentKitUse(row)) {
    datadog?.increment?.("toolrouter.agentkit.uses.count", {
      endpoint: row.endpoint_id,
      path: row.path || "unknown",
    }).catch(() => undefined);
  }
}

function recordStripeSessionMetric(datadog: any, status: string) {
  datadog?.increment?.("toolrouter.stripe.sessions.count", {
    status,
  }).catch(() => undefined);
}

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

function checkedAt(row: any) {
  return row?.checked_at || row?.last_checked_at || null;
}

function latestByCheckedAt(rows: any[]) {
  return (
    rows
      .filter((row) => checkedAt(row))
      .sort((a, b) => Date.parse(checkedAt(b)) - Date.parse(checkedAt(a)))[0] ||
    null
  );
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
  api_keys_user_caller_active_key: {
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

function isEndpointTaskProviderTaskNotNullError(error: any) {
  const message = error instanceof Error ? error.message : String(error);
  return /null value in column "provider_task_id" of relation "endpoint_tasks" violates not-null constraint/u.test(
    message,
  );
}

function constraintNameFrom(error: any) {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/unique constraint "([^"]+)"/)?.[1] || null;
}

export function normalizeApiError(error: any) {
  const constraint = constraintNameFrom(error);
  const knownConstraint = constraint
    ? CONSTRAINT_ERROR_MESSAGES[constraint]
    : null;
  const endpointTaskProviderTaskNotNull =
    isEndpointTaskProviderTaskNotNullError(error);
  const statusCode =
    (endpointTaskProviderTaskNotNull ? 500 : null) ||
    knownConstraint?.statusCode ||
    (constraint ? 409 : error.statusCode || error.status || 500);
  const fallbackCode =
    statusCode >= 500
      ? "internal_error"
      : statusCode === 409
        ? "conflict"
        : "bad_request";
  const publicCode =
    (endpointTaskProviderTaskNotNull ? "database_schema_mismatch" : null) ||
    knownConstraint?.code ||
    (constraint ? "conflict" : statusCode >= 500 ? fallbackCode : error.code || fallbackCode);
  const publicMessage =
    (endpointTaskProviderTaskNotNull
      ? "Database schema is missing nullable Manus task reservations. Apply Supabase migrations."
      : null) ||
    knownConstraint?.message ||
    (constraint ? "That value is already in use. Try a different value." : null) ||
    (statusCode >= 500
      ? "Internal server error"
      : error instanceof Error
        ? error.message
        : String(error));
  return {
    statusCode,
    code: publicCode,
    message: publicMessage,
    details:
      statusCode < 500 && !constraint && error.exposeDetails === true
        ? error.details || undefined
        : undefined,
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

function isAgentKitUse(row: any) {
  return row?.path === "agentkit" || row?.path === "agentkit_to_x402";
}

function isCompletedStripeSession(purchase: any) {
  return ["funding_pending", "funded", "funding_failed"].includes(
    String(purchase?.status || ""),
  );
}

function sumPaid(rows: any[]) {
  return rows.reduce((sum, row) => {
    const value = row.credit_captured_usd ?? row.amount_usd ?? 0;
    const number = Number(value);
    return sum + (Number.isFinite(number) ? number : 0);
  }, 0);
}

function dailyMonitoringRows({
  requests,
  topUps,
  wallet,
  now = new Date(),
}: {
  requests: any[];
  topUps: any[];
  wallet: any;
  now?: Date;
}) {
  const rows = new Map(
    lastThirtyDayKeys(now).map((day) => [
      day,
      {
        day,
        requests: { success: 0, failed: 0, total: 0 },
        agentkit: { uses: 0, registrations: 0 },
        stripe_sessions: { completed: 0, all: 0 },
      },
    ]),
  );

  for (const request of requests) {
    const day = request?.ts ? dayKey(new Date(request.ts)) : "";
    const row = rows.get(day);
    if (!row) continue;
    row.requests.total += 1;
    if (isErrorRequest(request)) row.requests.failed += 1;
    else row.requests.success += 1;
    if (isAgentKitUse(request) && !isErrorRequest(request)) {
      row.agentkit.uses += 1;
    }
  }

  for (const topUp of topUps) {
    const day = topUp?.created_at ? dayKey(new Date(topUp.created_at)) : "";
    const row = rows.get(day);
    if (!row) continue;
    row.stripe_sessions.all += 1;
    if (isCompletedStripeSession(topUp)) row.stripe_sessions.completed += 1;
  }

  const verifiedAt = wallet?.agentkit_verified
    ? wallet?.agentkit_verified_at
    : null;
  const registrationDay = verifiedAt ? dayKey(new Date(verifiedAt)) : "";
  const registrationRow = rows.get(registrationDay);
  if (registrationRow) registrationRow.agentkit.registrations += 1;

  return [...rows.values()];
}

async function monitoringPayload(store: any, user_id: string) {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const [requests24h, requests30d, statuses, checks24h, topUps30d, wallet] =
    await Promise.all([
      store.listRequests({ user_id, since: since24h, limit: 500 }),
      store.listRequests({ user_id, since: since30d, limit: 500 }),
      store.listEndpointStatus(),
      typeof store.listHealthChecks === "function"
        ? store.listHealthChecks({ since: since24h, limit: 5000 })
        : [],
      typeof store.listCreditPurchases === "function"
        ? store.listCreditPurchases({ user_id, since: since30d, limit: 500 })
        : [],
      typeof store.getWalletAccount === "function"
        ? store.getWalletAccount({ user_id })
        : null,
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
        error: publicRequestError(row),
      })),
    },
    requests_30d: {
      total: requests30d.length,
      errors: requests30d.filter(isErrorRequest).length,
      paid_usd: sumPaid(requests30d),
    },
    daily_activity: dailyMonitoringRows({
      requests: requests30d,
      topUps: topUps30d,
      wallet,
    }),
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

function publicStatusDto(
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
  const latestAgentKitEvidence = latestByCheckedAt([
    ...(status && countsAsAgentKitEvidence(endpoint, status) ? [status] : []),
    ...checks.filter((check) => countsAsAgentKitEvidence(endpoint, check)),
  ]);
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
    agentkit_value_type: endpoint.agentkit_value_type,
    agentkit_value_label: endpoint.agentkit_value_label,
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
    agentkit_status: latestAgentKitEvidence?.status || "unverified",
    agentkit_operational: latestAgentKitEvidence
      ? checkCountsAsUp(latestAgentKitEvidence)
      : false,
    agentkit_last_checked_at: checkedAt(latestAgentKitEvidence),
    agentkit_path: latestAgentKitEvidence?.path || null,
    agentkit_charged: Boolean(latestAgentKitEvidence?.charged || false),
    last_error: publicStatusError(status || latestCheck),
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
      publicStatusDto(
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

function shouldPreflightAgentKitFreeTrial(endpoint: any, paymentMode: any) {
  return endpoint?.agentkit_value_type === "free_trial" && paymentMode !== "x402_only";
}

function isInsufficientCreditsError(error: any) {
  return error?.code === "insufficient_credits";
}

function realizedFreeTrial(endpoint: any, result: any) {
  return (
    result?.ok === true &&
    realizedAgentKitValue(endpoint, result).agentkit_value_type === "free_trial"
  );
}

function safeResultBodyError(endpoint: any, result: any) {
  if (result?.ok !== false) return null;
  if (endpoint?.id !== MANUS_RESEARCH_ENDPOINT_ID) return null;
  return typeof result.body?.error === "string" ? result.body.error : null;
}

function createRequestRow({
  traceId,
  endpoint,
  request,
  auth,
  result,
  credit,
}: any) {
  const agentKitValue = realizedAgentKitValue(endpoint, result);
  const resultError = result.error || safeResultBodyError(endpoint, result);
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
    agentkit_value_type: agentKitValue.agentkit_value_type,
    agentkit_value_label: agentKitValue.agentkit_value_label,
    ...normalizePayment(result),
    credit_reservation_id: credit?.credit_reservation_id || null,
    credit_reserved_usd: credit?.credit_reserved_usd || null,
    credit_captured_usd: credit?.credit_captured_usd || null,
    credit_released_usd: credit?.credit_released_usd || null,
    latency_ms: result.latency_ms ?? null,
    error: resultError,
    body: null,
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

function recommendedMcpToolForCategory(categoryId: string) {
  if (categoryId === "research") return "manus_research_start";
  if (categoryId === "search") return "toolrouter_search";
  if (categoryId === "browser_usage") return "toolrouter_browser_use";
  return null;
}

async function categoryRows(store: any, includeEmpty = false) {
  const statuses = await store.listEndpointStatus();
  const statusByEndpoint = new Map<string, any>(
    statuses.map((status: any) => [status.endpoint_id, status]),
  );
  return listCategories({ includeEmpty }).map((category: any) => ({
    ...category,
    recommended_mcp_tool: recommendedMcpToolForCategory(category.id),
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

const REQUEST_CONTROL_FIELDS = new Set([
  "endpoint_id",
  "endpointId",
  "input",
  "maxUsd",
  "max_usd",
  "paymentMode",
  "payment_mode",
  "force_new",
  "forceNew",
]);

function endpointInputFromRequestBody(body: any) {
  if (body.input !== undefined) return requireObject(body.input, "input");
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !REQUEST_CONTROL_FIELDS.has(key)),
  );
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value === undefined) return "null";
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function stringArray(value: any, max: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, max)
    .map((item) => item.trim());
}

function normalizedManusTaskInput(input: any = {}) {
  const query = String(input.query ?? input.prompt ?? "").trim().replace(/\s+/gu, " ");
  if (!query) {
    throw Object.assign(new Error("query is required"), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return {
    query,
    task_type: String(input.task_type || input.taskType || "general_research").trim(),
    depth: String(input.depth || "standard").trim(),
    urls: stringArray(input.urls, 10),
    images: stringArray(input.images || input.image_urls, 5),
  };
}

function manusDedupeKey(auth: any, endpointId: string, input: any) {
  const normalized = normalizedManusTaskInput(input);
  return createHash("sha256")
    .update(stableJson({
      user_id: auth.user_id,
      endpoint_id: endpointId,
      ...normalized,
    }))
    .digest("hex");
}

function forceNewTask(body: any, input: any = {}) {
  return body.force_new === true || body.forceNew === true || input.force_new === true || input.forceNew === true;
}

function firstString(...values: any[]) {
  return values.find((value) => typeof value === "string" && value.trim()) || null;
}

function manusCreatedTaskFromBody(body: any) {
  const task = body?.task && typeof body.task === "object" ? body.task : body;
  const nested = task?.data && typeof task.data === "object" ? task.data : {};
  const providerTaskId = firstString(
    task?.task_id,
    task?.id,
    task?.taskId,
    nested?.task_id,
    nested?.id,
    nested?.taskId,
    task?.task?.task_id,
    task?.task?.id,
  );
  if (!providerTaskId) return null;
  return {
    provider_task_id: providerTaskId,
    status: firstString(
      task?.status,
      task?.state,
      nested?.status,
      nested?.state,
      task?.task?.status,
    ) || "running",
    task_url: firstString(
      task?.task_url,
      task?.taskUrl,
      task?.url,
      nested?.task_url,
      nested?.taskUrl,
      nested?.url,
      task?.task?.task_url,
    ),
    title: firstString(
      task?.task_title,
      task?.title,
      task?.name,
      nested?.task_title,
      nested?.title,
      nested?.name,
      task?.task?.title,
    ),
  };
}

function taskPublicFields(task: any) {
  return {
    task_id: task.provider_task_id || task.id,
    task_url: task.task_url || null,
    status: normalizeManusStatus(task.status, "running"),
    title: task.title || null,
    created_at: task.created_at || null,
    updated_at: task.updated_at || null,
    last_checked_at: task.last_checked_at || null,
  };
}

function nextManusTools() {
  return {
    status: "manus_research_status",
    result: "manus_research_result",
  };
}

function manusTaskStartPayload(task: any, { taskCreated, deduped, requestId, traceId }: any) {
  return {
    task_created: Boolean(taskCreated),
    deduped: Boolean(deduped),
    request_id: requestId || task.request_id || null,
    trace_id: traceId || task.trace_id || null,
    ...taskPublicFields(task),
    poll_after_seconds: MANUS_POLL_AFTER_SECONDS,
    next_tools: nextManusTools(),
    repeat_for_same_query: false,
  };
}

function dedupedManusStartResponse(endpoint: any, task: any, traceId: string) {
  const start = manusTaskStartPayload(task, {
    taskCreated: false,
    deduped: true,
    requestId: task.request_id,
    traceId: task.trace_id || traceId,
  });
  return {
    id: task.request_id,
    trace_id: task.trace_id || traceId,
    endpoint_id: endpoint.id,
    path: "deduped",
    charged: false,
    status_code: 200,
    credit_reserved_usd: null,
    credit_captured_usd: null,
    credit_released_usd: null,
    ...start,
    body: start,
  };
}

function normalizeManusStatus(value: any, fallback = "running") {
  const raw = String(value || fallback || "running").toLowerCase();
  if (["done", "complete", "completed", "finished", "success", "succeeded", "stopped"].includes(raw)) return "stopped";
  if (["failed", "failure", "errored", "error", "cancelled", "canceled"].includes(raw)) return "error";
  if (["waiting", "input_required", "requires_action", "paused", "blocked"].includes(raw)) return "waiting";
  if (["queued", "pending", "created", "starting", "in_progress", "processing", "running"].includes(raw)) return "running";
  return raw || fallback;
}

function manusTaskDetail(detail: any, task: any) {
  const data =
    (detail?.data && typeof detail.data === "object" && detail.data) ||
    (detail?.task && typeof detail.task === "object" && detail.task) ||
    (detail?.result && typeof detail.result === "object" && detail.result) ||
    (detail && typeof detail === "object" ? detail : {});
  const status = normalizeManusStatus(
    firstString(data.status, data.state, detail?.status, detail?.state),
    task.status || "running",
  );
  return {
    task_id: task.provider_task_id || task.id,
    status,
    title: firstString(data.title, data.task_title, data.name, task.title),
    task_url: firstString(data.task_url, data.taskUrl, data.url, task.task_url),
    waiting_details: data.waiting_details || data.waitingDetails || data.input_request || null,
    error: data.error || data.error_message || null,
  };
}

function messageArray(payload: any) {
  const candidates = [
    payload?.messages,
    payload?.data?.messages,
    payload?.data,
    payload?.items,
    payload?.result?.messages,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function messageContent(content: any) {
  const attachments: any[] = [];
  if (typeof content === "string") return { text: content, attachments };
  if (!Array.isArray(content)) {
    const text = firstString(content?.text, content?.value, content?.content) || "";
    const url = firstString(content?.file_url, content?.url, content?.source_url);
    if (url) attachments.push({ url, type: content?.type || "file", name: content?.name || null });
    return { text, attachments };
  }
  const textParts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      textParts.push(part);
      continue;
    }
    const text = firstString(part?.text, part?.value, part?.content);
    if (text) textParts.push(text);
    const url = firstString(part?.file_url, part?.url, part?.source_url);
    if (url) attachments.push({ url, type: part?.type || "file", name: part?.name || null });
  }
  return { text: textParts.join("\n").trim(), attachments };
}

function manusAttachmentArray(value: any) {
  if (!Array.isArray(value)) return [];
  return value
    .map((attachment) => ({
      url: firstString(attachment?.url, attachment?.file_url, attachment?.source_url),
      type: attachment?.type || "file",
      name: firstString(attachment?.filename, attachment?.name),
      content_type: attachment?.content_type || attachment?.contentType || null,
    }))
    .filter((attachment) => attachment.url);
}

function manusMessagePayload(message: any) {
  const type = String(message?.type || "").toLowerCase();
  if (message?.assistant_message) {
    const content = messageContent(message.assistant_message.content || "");
    return {
      role: "assistant",
      type: type || "assistant_message",
      text: content.text,
      attachments: [...content.attachments, ...manusAttachmentArray(message.assistant_message.attachments)],
    };
  }
  if (message?.user_message) {
    const content = messageContent(message.user_message.content || "");
    return {
      role: "user",
      type: type || "user_message",
      text: content.text,
      attachments: [...content.attachments, ...manusAttachmentArray(message.user_message.attachments)],
    };
  }
  if (message?.error_message) {
    return {
      role: "error",
      type: type || "error_message",
      text: firstString(message.error_message.content, message.error_message.error_type),
      attachments: [],
    };
  }
  if (message?.status_update) {
    const detail = message.status_update.status_detail || {};
    return {
      role: "status",
      type: type || "status_update",
      text: firstString(
        detail.waiting_description,
        message.status_update.brief,
        message.status_update.description,
        message.status_update.agent_status,
      ),
      attachments: [],
    };
  }
  if (message?.tool_used) {
    return {
      role: "tool",
      type: type || "tool_used",
      text: firstString(message.tool_used.brief, message.tool_used.description, message.tool_used.tool),
      attachments: [],
    };
  }
  const content = messageContent(message?.content ?? message?.message ?? message?.text ?? "");
  return {
    role: firstString(message?.role, message?.sender, message?.sender_type, message?.author),
    type: firstString(message?.type, message?.kind),
    text: content.text,
    attachments: content.attachments,
  };
}

function publicManusMessages(payload: any) {
  return messageArray(payload).map((message: any, index: number) => {
    const parsed = manusMessagePayload(message);
    return {
      id: firstString(message?.id, message?.message_id, message?.messageId) || `message_${index}`,
      role: parsed.role || null,
      type: parsed.type || null,
      text: parsed.text || null,
      attachments: parsed.attachments,
      created_at: firstString(message?.created_at, message?.createdAt, message?.timestamp) || null,
    };
  });
}

function messageRole(message: any) {
  return String(message?.role || message?.sender || message?.type || "").toLowerCase();
}

function latestText(messages: any[], predicate: (message: any) => boolean) {
  return [...messages].reverse().find((message) => predicate(message) && message.text)?.text || null;
}

function manusResultPayload({ task, detail, messagesBody }: any) {
  const detailPayload = manusTaskDetail(detail, task);
  const messages = publicManusMessages(messagesBody);
  const status = detailPayload.status;
  const answer = status === "stopped"
    ? latestText(messages, (message) => /assistant|agent|message/u.test(messageRole(message))) || latestText(messages, () => true)
    : null;
  const latestStatusMessage =
    latestText(messages, (message) => /status|system|progress/u.test(messageRole(message))) ||
    (typeof detailPayload.waiting_details === "string" ? detailPayload.waiting_details : null);
  const attachments = messages.flatMap((message) => message.attachments || []);
  return {
    task_id: task.provider_task_id || task.id,
    status,
    final_answer_available: Boolean(answer),
    answer,
    attachments,
    latest_status_message: latestStatusMessage,
    waiting_details: status === "waiting" ? detailPayload.waiting_details || latestStatusMessage : null,
    error: status === "error" ? detailPayload.error || "Manus task failed" : null,
    messages,
    poll_after_seconds: status === "running" || status === "waiting" ? MANUS_POLL_AFTER_SECONDS : null,
    isError: status === "error",
  };
}

async function updateEndpointTaskFromDetail(store: any, task: any, detail: any, now = new Date().toISOString()) {
  const parsed = manusTaskDetail(detail, task);
  return store.updateEndpointTask({
    ...task,
    status: parsed.status,
    title: parsed.title || task.title || null,
    task_url: parsed.task_url || task.task_url || null,
    last_checked_at: now,
    updated_at: now,
  });
}

function isConflictError(error: any) {
  return error?.statusCode === 409 || /duplicate key value|unique constraint/u.test(String(error?.message || ""));
}

function endpointTaskBase({
  endpoint,
  auth,
  dedupeKey,
  createdAt = new Date().toISOString(),
  providerTaskId = null,
  requestId = null,
  traceId = null,
  status = "running",
  taskUrl = null,
  title = null,
}: any) {
  return {
    id: `task_${randomUUID()}`,
    endpoint_id: endpoint.id,
    provider: "manus",
    provider_task_id: providerTaskId,
    request_id: requestId,
    trace_id: traceId,
    user_id: auth.user_id,
    api_key_id: auth.api_key_id,
    caller_id: auth.caller_id,
    dedupe_key: dedupeKey,
    status,
    task_url: taskUrl,
    title,
    created_at: createdAt,
    updated_at: createdAt,
    last_checked_at: null,
    expires_at: new Date(Date.parse(createdAt) + MANUS_TASK_TTL_MS).toISOString(),
  };
}

async function reserveManusDedupeTask(store: any, taskRow: any) {
  try {
    return { reserved: true, task: await store.insertEndpointTask(taskRow) };
  } catch (error) {
    if (!isConflictError(error)) throw error;
    const existing = await store.findEndpointTaskByDedupeKey({
      api_key_id: taskRow.api_key_id,
      endpoint_id: taskRow.endpoint_id,
      dedupe_key: taskRow.dedupe_key,
    });
    if (existing) return { reserved: false, task: existing };
    const stale = await store.findStartingEndpointTaskByDedupeKey({
      api_key_id: taskRow.api_key_id,
      endpoint_id: taskRow.endpoint_id,
      dedupe_key: taskRow.dedupe_key,
    });
    if (stale && !stale.provider_task_id) {
      await expireManusDedupeTask(store, stale);
      try {
        return { reserved: true, task: await store.insertEndpointTask(taskRow) };
      } catch (retryError) {
        if (!isConflictError(retryError)) throw retryError;
        const retryExisting = await store.findEndpointTaskByDedupeKey({
          api_key_id: taskRow.api_key_id,
          endpoint_id: taskRow.endpoint_id,
          dedupe_key: taskRow.dedupe_key,
        });
        if (retryExisting) return { reserved: false, task: retryExisting };
        throw retryError;
      }
    }
    throw error;
  }
}

async function expireManusDedupeTask(store: any, task: any, status = "error") {
  if (!task) return null;
  const now = new Date().toISOString();
  return store.updateEndpointTask({
    ...task,
    status,
    updated_at: now,
    expires_at: now,
  });
}

function pendingManusResultPayload(task: any) {
  return {
    task_id: task.provider_task_id || task.id,
    status: normalizeManusStatus(task.status, "running"),
    final_answer_available: false,
    answer: null,
    attachments: [],
    latest_status_message: "Manus task is being created.",
    waiting_details: null,
    error: null,
    messages: [],
    poll_after_seconds: MANUS_POLL_AFTER_SECONDS,
    isError: false,
  };
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

async function getOrBootstrapVisibleAccount(
  store: any,
  crossmint: any,
  user: { user_id: string; email?: string | null },
) {
  const existing = await getVisibleAccount(store, user);
  if (existing?.address && existing?.wallet_locator) return existing;
  if (!shouldUseCrossmintSigner()) return existing;
  try {
    return await ensureAgentWalletAccount(store, crossmint, user);
  } catch {
    return existing;
  }
}

function safeAgentKitVerification(wallet: any) {
  return {
    verified: Boolean(wallet?.agentkit_verified),
    verified_at: wallet?.agentkit_verified_at || null,
    last_checked_at: wallet?.agentkit_last_checked_at || null,
    error: safeAgentKitVerificationError(wallet?.agentkit_verification_error),
  };
}

function safeAgentKitVerificationError(error: any) {
  if (!error) return null;
  if (String(error) === "Not Verified") return "Not Verified";
  return "Verification unavailable.";
}

function hashHumanId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function prepareAgentKitRegistration({
  store,
  crossmint,
  user,
  agentBookRegistration,
}: any) {
  const wallet = await ensureAgentKitAccount(store, crossmint, user);
  if (!wallet.address) {
    throw Object.assign(new Error("AgentKit account address is missing"), {
      statusCode: 500,
      code: "agentkit_wallet_missing",
    });
  }
  const registration = agentBookRegistration || agentBookRegistrationService();
  const nonce = await registration.nextNonce(wallet.address);
  return {
    registration: buildAgentKitVerificationRequest({
      agentAddress: wallet.address,
      nonce,
    }),
    agentkit_verification: safeAgentKitVerification(wallet),
  };
}

async function completeAgentKitRegistration({
  store,
  crossmint,
  user,
  body,
  agentBookVerifier,
  agentBookRegistration,
}: any) {
  const wallet = await ensureAgentKitAccount(store, crossmint, user);
  if (!wallet.address) {
    throw Object.assign(new Error("AgentKit account address is missing"), {
      statusCode: 500,
      code: "agentkit_wallet_missing",
    });
  }
  const registration = registrationPayloadFromBody(wallet.address, body);
  const service = agentBookRegistration || agentBookRegistrationService();
  const result = await service.submit(registration);
  const verification = await verifyAgentKitAccount({
    store,
    crossmint,
    user,
    agentBookVerifier,
  });
  return {
    registration: {
      tx_hash: result?.txHash || result?.transactionHash || null,
      already_registered: Boolean(result?.already_registered),
    },
    ...verification,
  };
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
    signTypedData: async (payload: any) => {
      return crossmint.signTypedData({
        walletLocator: wallet.wallet_locator,
        domain: payload.domain,
        types: payload.types,
        primaryType: payload.primaryType,
        message: payload.message,
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

function usdToCents(value: any, label: string) {
  const atomic = parseUsd(value, label);
  if (atomic % 10_000n !== 0n) {
    throw Object.assign(new Error(`${label} must be in whole cents`), {
      statusCode: 400,
      code: "invalid_webhook",
    });
  }
  return atomic / 10_000n;
}

function assertPaidCheckoutSession(session: any, purchase: any) {
  const metadata = session?.metadata || {};
  const expectedCents = usdToCents(purchase.amount_usd, "stored purchase amount");
  const actualCents =
    session?.amount_total === undefined || session?.amount_total === null
      ? null
      : BigInt(session.amount_total);
  const metadataCents = metadata.amount_usd
    ? usdToCents(metadata.amount_usd, "checkout metadata amount_usd")
    : null;

  const invalid = (message: string) =>
    Object.assign(new Error(message), {
      statusCode: 400,
      code: "invalid_webhook",
    });

  if (session?.payment_status !== "paid") {
    throw invalid("Stripe checkout session is not paid");
  }
  if (String(session?.currency || "").toLowerCase() !== "usd") {
    throw invalid("Stripe checkout session currency must be USD");
  }
  if (actualCents === null || actualCents !== expectedCents) {
    throw invalid("Stripe checkout session amount does not match purchase");
  }
  if (!session?.id || session.id !== purchase.provider_checkout_session_id) {
    throw invalid("Stripe checkout session id does not match purchase");
  }
  if (metadata.toolrouter_purchase_id !== purchase.id) {
    throw invalid("Stripe checkout session purchase metadata does not match");
  }
  if (metadata.toolrouter_user_id !== purchase.user_id) {
    throw invalid("Stripe checkout session user metadata does not match");
  }
  if (metadataCents === null || metadataCents !== expectedCents) {
    throw invalid("Stripe checkout session amount metadata does not match");
  }
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
  const existingPurchase =
    (purchaseId ? await store.getCreditPurchase(purchaseId) : null) ||
    (providerSessionId ? await store.findCreditPurchaseByProviderSession(providerSessionId) : null);
  if (!existingPurchase) {
    throw Object.assign(new Error("credit purchase not found"), {
      statusCode: 404,
      code: "not_found",
    });
  }
  assertPaidCheckoutSession(session, existingPurchase);
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
  datadog = createDatadogClient(),
  agentBookVerifier = null,
  agentBookRegistration = null,
  manusWrapper = null,
  createManusWrapper = createManusX402Wrapper,
  manusFetch = fetch,
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
      "authorization,content-type,x-requested-with,payment-signature,agentkit,settlement-overrides",
    );
    reply.header(
      "access-control-expose-headers",
      "payment-required,payment-response,x-payment-response",
    );
    reply.header("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    if (request.method === "OPTIONS") {
      reply.status(204).send();
      return;
    }
    done();
  });

  app.setErrorHandler((error: any, request, reply) => {
    const normalized = normalizeApiError(error);
    if (normalized.statusCode >= 500) {
      request.log.error(
        { code: normalized.code, trace_id: normalized.trace_id },
        normalized.message,
      );
    }
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

  let defaultManusWrapperPromise: Promise<any> | null = null;
  async function getManusWrapper() {
    if (manusWrapper) return manusWrapper;
    if (!defaultManusWrapperPromise) {
      defaultManusWrapperPromise = createManusWrapper({
        cache,
        agentBook: agentBookVerifier || (await loadAgentBookVerifier()),
      }).catch((error: unknown) => {
        defaultManusWrapperPromise = null;
        throw error;
      });
    }
    return defaultManusWrapperPromise;
  }

  app.post("/x402/manus/research", async (request: any, reply: any) => {
    const wrapper = await getManusWrapper();
    return wrapper.handle(request, reply);
  });

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
    filters.api_key_id = auth.api_key_id;
    return requestPage(store, filters, apiTraceDto);
  });

  app.get("/v1/dashboard/requests", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const filters = requestFilters(request.query || {});
    filters.user_id = user.user_id;
    return requestPage(store, filters, dashboardRequestDto);
  });

  app.get("/v1/dashboard/monitoring", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return { monitoring: await monitoringPayload(store, user.user_id) };
  });

  app.get("/v1/balance", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const [account, wallet] = await Promise.all([
      getCreditBalance(store, user.user_id),
      getOrBootstrapVisibleAccount(store, crossmint, user),
    ]);
    return {
      balance: dashboardBalanceDto(account, wallet),
    };
  });

  app.post("/v1/agentkit/account-verification", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return verifyAgentKitAccount({ store, crossmint, user, agentBookVerifier });
  });

  app.post("/v1/agentkit/registration", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    return prepareAgentKitRegistration({
      store,
      crossmint,
      user,
      agentBookRegistration,
    });
  });

  app.post("/v1/agentkit/registration/complete", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const result = await completeAgentKitRegistration({
      store,
      crossmint,
      user,
      body: request.body || {},
      agentBookVerifier,
      agentBookRegistration,
    });
    if (result?.registration?.tx_hash) {
      datadog?.increment?.("toolrouter.agentkit.registrations.count", {
        status: "completed",
      }).catch(() => undefined);
    }
    return result;
  });

  app.post("/v1/wallet/agentkit-verification", async (request: any, reply: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    request.log?.warn?.(
      { route: "/v1/wallet/agentkit-verification" },
      "deprecated wallet AgentKit verification route used",
    );
    datadog?.increment?.("toolrouter.deprecated_routes.count", {
      route: "wallet_agentkit_verification",
    }).catch(() => undefined);
    reply.header("deprecation", "true");
    reply.header("link", '</v1/agentkit/account-verification>; rel="successor-version"');
    return verifyAgentKitAccount({ store, crossmint, user, agentBookVerifier });
  });

  app.get("/v1/ledger", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const limit = Math.max(
      1,
      Math.min(Number(request.query?.limit || 100), 500),
    );
    return {
      entries: (
        await store.listCreditLedgerEntries({
          user_id: user.user_id,
          limit,
          source_not: request.query?.activity_only === "true" ? "request" : undefined,
        })
      ).map(publicLedgerEntry),
    };
  });

  app.get("/v1/top-ups", async (request: any) => {
    const user = await authenticateSupabaseUser(request.headers);
    const limit = Math.max(
      1,
      Math.min(Number(request.query?.limit || 20), 100),
    );
    const purchases = await store.listCreditPurchases({
      user_id: user.user_id,
      limit,
    });
    return {
      top_ups: purchases.map(publicTopUp),
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
    recordStripeSessionMetric(datadog, "created");
    reply.status(201);
    return {
      top_up: {
        id: updated.id,
        provider: "stripe",
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
    return { request: apiTraceDto(row) };
  });

  async function requireOwnedManusTask(request: any) {
    const auth = await authenticateApiKey(request.headers, store);
    const taskId = decodeURIComponent(request.params.task_id || "");
    const task = await store.findEndpointTaskByTaskId({
      api_key_id: auth.api_key_id,
      endpoint_id: MANUS_RESEARCH_ENDPOINT_ID,
      task_id: taskId,
    });
    if (!task) {
      throw Object.assign(new Error("task not found"), {
        statusCode: 404,
        code: "not_found",
      });
    }
    return task;
  }

  app.get("/v1/manus/tasks/:task_id/status", async (request: any) => {
    const task = await requireOwnedManusTask(request);
    if (!task.provider_task_id) {
      return {
        ...taskPublicFields(task),
        poll_after_seconds: MANUS_POLL_AFTER_SECONDS,
      };
    }
    const detail = await getManusTaskDetail(task.provider_task_id, { fetchImpl: manusFetch });
    const updated = await updateEndpointTaskFromDetail(store, task, detail);
    return {
      ...taskPublicFields(updated),
      poll_after_seconds: ["running", "waiting"].includes(String(updated.status))
        ? MANUS_POLL_AFTER_SECONDS
        : null,
    };
  });

  app.get("/v1/manus/tasks/:task_id/result", async (request: any) => {
    const task = await requireOwnedManusTask(request);
    if (!task.provider_task_id) return pendingManusResultPayload(task);
    const detail = await getManusTaskDetail(task.provider_task_id, { fetchImpl: manusFetch });
    const updated = await updateEndpointTaskFromDetail(store, task, detail);
    const messagesBody = await listManusTaskMessages(task.provider_task_id, { fetchImpl: manusFetch });
    return manusResultPayload({ task: updated, detail, messagesBody });
  });

  app.post("/v1/requests", async (request: any) => {
    const auth = await authenticateApiKey(request.headers, store);
    const body = requireObject(request.body || {}, "request body");
    const traceId = `trace_${randomUUID()}`;
    let reservation: any = null;
    let reservedManusTask: any = null;
    try {
      const endpointId = body.endpoint_id || body.endpointId;
      if (!endpointId) {
        throw Object.assign(new Error("endpoint_id is required"), {
          statusCode: 400,
          code: "invalid_request",
        });
      }
      const endpoint = getEndpoint(endpointId);
      const endpointInput = endpointInputFromRequestBody(body);
      const providerRequest = endpoint.buildRequest(endpointInput);
      const maxUsd = body.maxUsd || body.max_usd;
      const paymentMode = body.paymentMode || body.payment_mode;
      const isManusResearch = endpoint.id === MANUS_RESEARCH_ENDPOINT_ID;
      const dedupeKey = isManusResearch
        ? manusDedupeKey(auth, endpoint.id, endpointInput)
        : null;
      if (isManusResearch && dedupeKey && !forceNewTask(body, endpointInput)) {
        const existingTask = await store.findEndpointTaskByDedupeKey({
          api_key_id: auth.api_key_id,
          endpoint_id: endpoint.id,
          dedupe_key: dedupeKey,
        });
        if (existingTask) {
          return dedupedManusStartResponse(endpoint, existingTask, traceId);
        }
        const reserved = await reserveManusDedupeTask(
          store,
          endpointTaskBase({
            endpoint,
            auth,
            dedupeKey,
            traceId,
          }),
        );
        if (!reserved.reserved) {
          return dedupedManusStartResponse(endpoint, reserved.task, traceId);
        }
        reservedManusTask = reserved.task;
      }
      await enforceRequestPolicy({
        cache,
        auth,
        ip: clientIp(request),
        estimatedUsd: providerRequest.estimatedUsd,
        maxUsd,
      });
      const paymentSigner = await paymentSignerForRequest(store, crossmint, auth);
      const timeoutMs = envMs("TOOLROUTER_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS);
      let result: any = null;
      const preflightFreeTrial = shouldPreflightAgentKitFreeTrial(endpoint, paymentMode);
      if (preflightFreeTrial) {
        result = await executor({
          endpoint,
          request: providerRequest,
          maxUsd,
          paymentMode: "agentkit_only",
          traceId,
          paymentSigner,
          timeoutMs: agentKitPreflightTimeoutMs(),
        });
        const freeTrialRealized = realizedFreeTrial(endpoint, result);
        logAgentKitPreflight(request, endpoint, result, {
          realized_free_trial: freeTrialRealized,
          will_fallback: !freeTrialRealized && paymentMode !== "agentkit_only",
        });
      }

      if (!result || !realizedFreeTrial(endpoint, result)) {
        let fallbackPaymentMode = paymentMode;
        if (preflightFreeTrial && paymentMode !== "agentkit_only") {
          fallbackPaymentMode = "x402_only";
        }
        if (fallbackPaymentMode !== "agentkit_only") {
          try {
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
          } catch (error: any) {
            if (!isInsufficientCreditsError(error) || !preflightFreeTrial || !result) {
              throw error;
            }
            fallbackPaymentMode = "agentkit_only";
          }
        }

        if (reservation || !preflightFreeTrial) {
          result = await executor({
            endpoint,
            request: providerRequest,
            maxUsd,
            paymentMode: fallbackPaymentMode,
            traceId,
            paymentSigner,
            timeoutMs,
          });
        }
      }

      logEndpointRequest(request, endpoint, result);
      const createdManusTask =
        isManusResearch && result?.ok === true
          ? manusCreatedTaskFromBody(result.body)
          : null;
      const credit = reservation
        ? await finalizeCreditReservation({
            store,
            reservation,
            amountUsd: String(
              result.amount_usd || (result.charged ? reservation.amount_usd : "0"),
            ),
            paymentReference: result.payment_reference,
            metadata: {
              path: result.path,
              status_code: result.status_code,
            },
          })
        : null;
      const row = createRequestRow({
        traceId,
        endpoint,
        request: providerRequest,
        auth,
        result,
        credit,
      });
      await store.insertRequest(row);
      let manusStart: any = null;
      if (createdManusTask && dedupeKey) {
        const createdAt = row.ts || new Date().toISOString();
        const taskRow = {
          ...(reservedManusTask || endpointTaskBase({ endpoint, auth, dedupeKey, createdAt })),
          provider_task_id: createdManusTask.provider_task_id,
          request_id: row.id,
          trace_id: traceId,
          status: normalizeManusStatus(createdManusTask.status, "running"),
          task_url: createdManusTask.task_url || null,
          title: createdManusTask.title || null,
          updated_at: createdAt,
          expires_at: new Date(Date.parse(createdAt) + MANUS_TASK_TTL_MS).toISOString(),
        };
        const task = reservedManusTask
          ? await store.updateEndpointTask(taskRow)
          : await store.insertEndpointTask(taskRow);
        reservedManusTask = null;
        manusStart = manusTaskStartPayload(task, {
          taskCreated: true,
          deduped: false,
          requestId: row.id,
          traceId,
        });
      } else if (reservedManusTask) {
        await expireManusDedupeTask(store, reservedManusTask);
        reservedManusTask = null;
      }
      recordRequestMetrics(datadog, row);
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
        ...(manusStart || {}),
        body: manusStart ? { ...(result.body || {}), ...manusStart } : result.body ?? null,
      };
    } catch (error: any) {
      if (reservedManusTask) {
        await expireManusDedupeTask(store, reservedManusTask).catch(() => undefined);
      }
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
      recordStripeSessionMetric(
        datadog,
        result?.ok === false ? "failed" : "completed",
      );
      if (result?.ok === false) reply.status(500);
      return result;
    }

    if (event?.type === "checkout.session.expired" || event?.type === "checkout.session.async_payment_failed") {
      const result = await processStripeCheckoutFailed({
        store,
        session,
        event,
      });
      recordStripeSessionMetric(
        datadog,
        event?.type === "checkout.session.expired" ? "expired" : "failed",
      );
      return result;
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
