// Monitoring + status payload builders.
//
// Pure functions. No Fastify dependencies. Route plugins call these with a
// `store` and (optionally) request scope to produce DTOs for `/v1/status`,
// `/v1/dashboard/monitoring`, `/v1/endpoints`, `/v1/categories`,
// `/v1/requests`, `/v1/top-ups`, and the dashboard variants.

import { countsAsAgentKitEvidence, listCategories, listEndpoints } from "@toolrouter/router-core";

import { agentRequestLabel, attributeFailure } from "./attribution.ts";
import { MANUS_NEXT_MCP_TOOLS, MANUS_RESEARCH_ENDPOINT_ID } from "./manus-tasks.ts";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const MANUS_MCP_TOOLS = Object.freeze({
  start: "manus_research_start",
  ...MANUS_NEXT_MCP_TOOLS,
});

const STATUS_RANK: Record<string, number> = {
  healthy: 0,
  degraded: 1,
  unverified: 2,
  failing: 3,
};

// Layer staleness window (U6). 24h is a flat ceiling that covers the 1h paid
// probe and the 12h agentkit probe cadences with margin. Anything older than
// this surfaces as `unknown` in the public DTO rather than as a cached value.
const LAYER_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const HEALTH_LAYER_NAMES = ["facilitator", "agentkit", "upstream", "transport"] as const;

export function statusRank(status: string) {
  return STATUS_RANK[status] ?? STATUS_RANK.unverified;
}

export function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function lastThirtyDayKeys(now = new Date()) {
  return Array.from({ length: 30 }, (_unused, index) => {
    const date = new Date(now.getTime() - (29 - index) * 24 * 60 * 60 * 1000);
    return dayKey(date);
  });
}

export function checkCountsAsUp(check: any) {
  return check.status === "healthy" || check.status === "degraded";
}

export function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]) {
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

function manualOnlyHealthProbe(endpoint: any) {
  return (endpoint?.health_probe || endpoint?.healthProbe)?.mode === "manual_only";
}

function nonForcedManualProbe(row: any) {
  return row?.error === "manual health probe" || row?.last_error === "manual health probe";
}

function emptyManualStatus(row: any) {
  return Boolean(row) && row.status_code == null && !row.path && !row.last_checked_at;
}

export function latestIso(values: Array<string | null | undefined>) {
  return (
    values
      .filter(Boolean)
      .sort((a: any, b: any) => Date.parse(b) - Date.parse(a))[0] || null
  );
}

export function isErrorRequest(row: any) {
  return (
    Boolean(row.error) || row.ok === false || Number(row.status_code) >= 400
  );
}

export function isAgentKitUse(row: any) {
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

export function publicStatusError(row: any) {
  // Always re-attribute on read so the public DTO never leaks raw provider
  // error strings (which can contain payment headers, account ids, etc.).
  // Worker-written labels are safe but external/imported rows may not be.
  const attribution = attributeFailure({
    status_code: row?.status_code,
    error: row?.last_error ?? row?.error,
    payment_error: row?.payment_error,
    body: row?.body,
  });
  return attribution?.label ?? null;
}

export function publicRequestError(row: any) {
  const attribution = attributeFailure({
    status_code: row?.status_code,
    error: row?.error,
    payment_error: row?.payment_error,
    body: row?.body,
  });
  return agentRequestLabel(attribution);
}

export function recommendedMcpToolForCategory(categoryId: string) {
  if (categoryId === "research") return "manus_research_start";
  if (categoryId === "search") return "toolrouter_search";
  if (categoryId === "email") return "toolrouter_send_email";
  if (categoryId === "browser_usage") return "toolrouter_browser_use";
  return null;
}

export function recommendedMcpToolForEndpoint(endpointId: string) {
  if (endpointId === MANUS_RESEARCH_ENDPOINT_ID) return MANUS_MCP_TOOLS.start;
  if (endpointId === "exa.search") return "exa_search";
  if (endpointId === "browserbase.session") return "browserbase_session_create";
  if (endpointId === "agentmail.create_inbox") return "agentmail_create_inbox";
  if (endpointId === "agentmail.list_messages") return "agentmail_list_messages";
  if (endpointId === "agentmail.get_message") return "agentmail_get_message";
  if (endpointId === "agentmail.send_message") return "agentmail_send_message";
  if (endpointId === "agentmail.reply_to_message") return "agentmail_reply_to_message";
  return null;
}

export function mcpToolsForEndpoint(endpointId: string) {
  if (endpointId === MANUS_RESEARCH_ENDPOINT_ID) return MANUS_MCP_TOOLS;
  if (endpointId === "exa.search") {
    return {
      call: "exa_search",
      category: "toolrouter_search",
    };
  }
  if (endpointId === "browserbase.session") {
    return {
      call: "browserbase_session_create",
      category: "toolrouter_browser_use",
    };
  }
  const agentmailTool = recommendedMcpToolForEndpoint(endpointId);
  if (agentmailTool?.startsWith("agentmail_")) {
    return {
      call: agentmailTool,
      ...(endpointId === "agentmail.send_message" ? { category: "toolrouter_send_email" } : {}),
    };
  }
  return null;
}

export function endpointDto(endpoint: any) {
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

export function publicEndpoint(endpoint: any, statusByEndpoint: Map<string, any>) {
  const status = statusByEndpoint.get(endpoint.id);
  const manualHealth = isManualHealthEndpoint(endpoint);
  return {
    ...endpointDto(endpoint),
    recommended_mcp_tool: recommendedMcpToolForEndpoint(endpoint.id),
    mcp_tools: mcpToolsForEndpoint(endpoint.id),
    status: publicEndpointHealthStatus(endpoint, status),
    last_checked_at: manualHealth ? null : status?.last_checked_at || null,
    latency_ms: manualHealth ? null : status?.latency_ms || null,
    last_error: manualHealth ? null : publicStatusError(status),
  };
}

export function isManualHealthEndpoint(endpoint: any) {
  return endpoint?.health_probe?.mode === "manual_only";
}

export function publicEndpointHealthStatus(endpoint: any, status?: any) {
  if (isManualHealthEndpoint(endpoint)) return "healthy";
  return status?.status || "unverified";
}

function freshLayerStatus(value: any, updatedAt: any, now: Date) {
  if (!value) return "unknown";
  const updatedAtMs = typeof updatedAt === "string" ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(updatedAtMs)) return "unknown";
  // Bound staleness symmetrically so writer/reader clock skew in either
  // direction collapses to "unknown" instead of trusting a future timestamp
  // as fresh forever.
  if (Math.abs(now.getTime() - updatedAtMs) > LAYER_FRESHNESS_WINDOW_MS) return "unknown";
  return String(value);
}

function publicStatusLayers(status: any, now: Date) {
  const layers: Record<string, { status: string; updated_at: string | null }> = {};
  for (const layer of HEALTH_LAYER_NAMES) {
    const raw = status?.[`layer_${layer}_status`] ?? null;
    const updatedAt = status?.[`layer_${layer}_updated_at`] ?? null;
    layers[layer] = {
      status: freshLayerStatus(raw, updatedAt, now),
      updated_at: typeof updatedAt === "string" ? updatedAt : null,
    };
  }
  return layers;
}

export function publicStatusDto(
  endpoint: any,
  status: any,
  checks: any[],
  now = new Date(),
) {
  const manualOnly = manualOnlyHealthProbe(endpoint);
  const effectiveChecks = manualOnly
    ? checks.filter((check) => !nonForcedManualProbe(check))
    : checks;
  const effectiveStatus = manualOnly && (nonForcedManualProbe(status) || emptyManualStatus(status))
    ? null
    : status;
  const latestCheck = effectiveChecks[0] || null;
  const daily = new Map<string, any[]>();
  for (const check of effectiveChecks) {
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
  const latencyValues = effectiveChecks
    .map((check) => Number(check.latency_ms))
    .filter(Number.isFinite);
  const manualHealth = isManualHealthEndpoint(endpoint);
  const currentStatus = manualHealth
    ? "healthy"
    : effectiveStatus?.status || latestCheck?.status || "unverified";
  const latestAgentKitEvidence = latestByCheckedAt([
    ...(effectiveStatus && countsAsAgentKitEvidence(endpoint, effectiveStatus) ? [effectiveStatus] : []),
    ...effectiveChecks.filter((check) => countsAsAgentKitEvidence(endpoint, check)),
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
    last_checked_at: manualHealth ? null : effectiveStatus?.last_checked_at || latestCheck?.checked_at || null,
    status_code: manualHealth ? null : effectiveStatus?.status_code ?? latestCheck?.status_code ?? null,
    latency_ms: manualHealth ? null : effectiveStatus?.latency_ms ?? latestCheck?.latency_ms ?? null,
    p50_latency_ms: manualHealth ? null : median(latencyValues),
    uptime_30d: manualHealth ? null : average(uptimeValues),
    sparkline_30d: manualHealth ? lastThirtyDayKeys(now).map(() => null) : sparkline_30d,
    health_check_count_30d: effectiveChecks.length,
    path: manualHealth ? null : effectiveStatus?.path || latestCheck?.path || null,
    charged: manualHealth ? false : Boolean(effectiveStatus?.charged ?? latestCheck?.charged ?? false),
    amount_usd: manualHealth ? null : effectiveStatus?.amount_usd ?? latestCheck?.amount_usd ?? null,
    agentkit_status: latestAgentKitEvidence?.status || "unverified",
    agentkit_operational: latestAgentKitEvidence
      ? checkCountsAsUp(latestAgentKitEvidence)
      : false,
    agentkit_last_checked_at: checkedAt(latestAgentKitEvidence),
    agentkit_path: latestAgentKitEvidence?.path || null,
    agentkit_charged: Boolean(latestAgentKitEvidence?.charged || false),
    layers: publicStatusLayers(manualHealth ? null : effectiveStatus, now),
    last_error: manualHealth ? null : publicStatusError(effectiveStatus || latestCheck),
  };
}

export async function publicStatusRows(store: any, category?: string) {
  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const [statuses, checks] = await Promise.all([
    store.listEndpointStatus(),
    store.listHealthChecks({ since, limit: 5000 }),
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

export function publicStatusPayload(endpoints: any[]) {
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

export async function endpointRows(store: any, category?: string) {
  const statuses = await store.listEndpointStatus();
  const statusByEndpoint = new Map<string, any>(
    statuses.map((status: any) => [status.endpoint_id, status]),
  );
  return listEndpoints({ category }).map((endpoint: any) =>
    publicEndpoint(endpoint, statusByEndpoint),
  );
}

export async function categoryRows(store: any, includeEmpty = false) {
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

export async function monitoringPayload(store: any, user_id: string) {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const [requests24h, requests30d, statuses, checks24h, topUps30d, wallet] =
    await Promise.all([
      store.listRequests({ user_id, since: since24h, limit: 500 }),
      store.listRequests({ user_id, since: since30d, limit: 500 }),
      store.listEndpointStatus(),
      store.listHealthChecks({ since: since24h, limit: 5000 }),
      store.listCreditPurchases({ user_id, since: since30d, limit: 500 }),
      store.getWalletAccount({ user_id }),
    ]);
  const errorRows = requests24h.filter(isErrorRequest);
  const statusByEndpoint = new Map<string, any>(
    statuses.map((status: any) => [status.endpoint_id, status]),
  );
  const endpointStatuses = listEndpoints().map(
    (endpoint: any) =>
      publicEndpointHealthStatus(endpoint, statusByEndpoint.get(endpoint.id)),
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

export function apiTraceDto(row: any) {
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
    // NOTE: `error` is the raw column. Pre-existing behavior: surfaces
    // upstream body errors (e.g., "Manus authentication failed") to API
    // consumers because operators rely on them. Code review flagged that
    // raw executor errors (timeout strings, payment headers) could also
    // leak here — tracked as a known residual; the fix needs to distinguish
    // structured body errors (safe to surface) from raw executor errors
    // (need redaction), and the row column doesn't currently carry that
    // provenance. Defer until the orchestrator splits the columns.
    error: row.error || null,
  };
}

export function dashboardRequestDto(row: any) {
  const safe = apiTraceDto(row);
  const {
    user_id: _user_id,
    error: _error,
    ...dashboard
  } = safe as any;
  return dashboard;
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

function encodeRequestCursor(row: any) {
  if (!row?.ts || !row?.id) return null;
  return Buffer.from(JSON.stringify({ ts: row.ts, id: row.id }), "utf8").toString("base64url");
}

export function requestFilters(query: any) {
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

export async function requestPage(store: any, filters: any, rowMapper = apiTraceDto) {
  const limit = requestPageLimit(filters.limit);
  const rows = await store.listRequests({ ...filters, limit: limit + 1 });
  const requests = rows.slice(0, limit).map(rowMapper);
  return {
    requests,
    next_cursor: rows.length > limit ? encodeRequestCursor(requests[requests.length - 1]) : null,
    has_more: rows.length > limit,
  };
}

export function publicLedgerEntry(entry: any) {
  return {
    id: entry.id,
    ts: entry.ts || entry.created_at || null,
    type: entry.type,
    amount_usd: entry.amount_usd ?? null,
  };
}

function publicTopUpError(purchase: any) {
  const status = String(purchase?.status || "");
  if (!purchase?.error) return null;
  if (status === "funding_failed") return "Credits could not be funded yet. We will retry automatically.";
  if (status === "checkout_failed") return "Checkout failed.";
  return "Top-up failed.";
}

export function publicTopUp(purchase: any) {
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

export function safeAgentKitVerification(wallet: any) {
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

export function dashboardBalanceDto(account: any, wallet: any, maxTopUpUsd: string) {
  return {
    available_usd: account.available_usd,
    currency: account.currency || "USD",
    agentkit_verification: safeAgentKitVerification(wallet),
    limits: {
      max_top_up_usd: maxTopUpUsd,
    },
  };
}
