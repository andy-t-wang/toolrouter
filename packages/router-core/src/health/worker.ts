import { randomUUID } from "node:crypto";

import { countsAsAgentKitEvidence } from "../agentkitValue.ts";
import { attributeFailure } from "../attribution.ts";
import { endpointRegistry } from "../endpoints/registry.ts";

export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 5_000;
export const DEFAULT_HEALTH_RETRY_INTERVAL_MS = 15 * 60 * 1000;

export const HEALTH_STATUSES = Object.freeze(["healthy", "degraded", "failing", "unverified"]);

function maybeNumber(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function maybeString(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function envMs(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function healthProbeTimeoutMs(value) {
  const timeoutMs = maybeNumber(value);
  return timeoutMs && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : envMs("TOOLROUTER_HEALTH_PROBE_TIMEOUT_MS", DEFAULT_HEALTH_PROBE_TIMEOUT_MS);
}

function checkIntervalMs(value) {
  const intervalMs = maybeNumber(value);
  return intervalMs && intervalMs > 0 ? Math.floor(intervalMs) : DEFAULT_HEALTH_CHECK_INTERVAL_MS;
}

function retryIntervalMs(value) {
  const intervalMs = maybeNumber(value);
  return intervalMs && intervalMs > 0
    ? Math.floor(intervalMs)
    : envMs("TOOLROUTER_HEALTH_RETRY_INTERVAL_MS", DEFAULT_HEALTH_RETRY_INTERVAL_MS);
}

function workerTickMs(value, fallback) {
  const intervalMs = maybeNumber(value);
  return intervalMs && intervalMs > 0 ? Math.floor(intervalMs) : fallback;
}

function latencyBudgetMs(endpoint) {
  const budgetMs = maybeNumber(
    endpoint?.healthProbe?.latencyBudgetMs ?? endpoint?.healthProbe?.latency_budget_ms,
  );
  return budgetMs && budgetMs > 0 ? budgetMs : 10_000;
}

function pick(result, snakeName, camelName) {
  return result?.[snakeName] ?? result?.[camelName] ?? null;
}

function attributionFor(result) {
  return attributeFailure({
    status_code: pick(result, "status_code", "statusCode"),
    error: result?.error ?? null,
    payment_error: pick(result, "payment_error", "paymentError"),
    body: result?.body,
    ok: result?.ok,
  });
}

function safeHealthError(result) {
  return attributionFor(result)?.label ?? null;
}

function paymentErrorLabel(attribution) {
  if (!attribution) return null;
  if (attribution.layer === "facilitator" || attribution.layer === "router_payment") {
    return attribution.label;
  }
  return null;
}

function normalizeExecutionResult(result, fallbackLatencyMs) {
  const statusCode = maybeNumber(pick(result, "status_code", "statusCode"));
  const payment = result?.payment || result?.paymentReceipt || {};
  const ok = result?.ok ?? (statusCode !== null ? statusCode >= 200 && statusCode < 300 : false);
  const attribution = attributionFor(result);

  return {
    status_code: statusCode,
    ok: Boolean(ok),
    latency_ms: maybeNumber(pick(result, "latency_ms", "latencyMs")) ?? fallbackLatencyMs,
    path: maybeString(result?.path) ?? "agentkit",
    charged: Boolean(result?.charged),
    estimated_usd: maybeString(pick(result, "estimated_usd", "estimatedUsd")),
    amount_usd: maybeString(pick(result, "amount_usd", "amountUsd") ?? payment.amount_usd ?? payment.amountUsd),
    currency: maybeString(result?.currency ?? payment.currency),
    payment_reference: maybeString(
      pick(result, "payment_reference", "paymentReference") ?? payment.reference ?? payment.paymentReference,
    ),
    payment_network: maybeString(pick(result, "payment_network", "paymentNetwork") ?? payment.network),
    payment_error: paymentErrorLabel(attribution),
    error: attribution?.label ?? null,
    attribution,
  };
}

function statusFromResult(result, endpoint, { requireAgentKitValue = false } = {}) {
  // A clean unresolved x402 challenge envelope is the protocol working — never
  // a failure to attribute. attributeFailure returns null in that case so we
  // fall through to the success-shape check.
  const attribution = result.attribution ?? null;
  if (attribution) {
    // A failure was attributed. 5xx-style upstream/transport failures with no
    // status code are `failing`; everything else is `degraded`.
    if (result.status_code === null || (Number.isFinite(result.status_code) && result.status_code >= 500)) {
      return "failing";
    }
    return "degraded";
  }
  if (result.ok || (result.status_code !== null && result.status_code >= 200 && result.status_code < 300)) {
    if (result.latency_ms > latencyBudgetMs(endpoint)) return "degraded";
    if (requireAgentKitValue && !countsAsAgentKitEvidence(endpoint, result)) return "degraded";
    return "healthy";
  }
  if (result.status_code === null) return "failing";
  if (result.status_code >= 500) return "failing";
  return "degraded";
}

function isSuccessfulAgentKitRequest(endpoint, row) {
  if (!countsAsAgentKitEvidence(endpoint, row)) return false;
  if (row?.error) return false;
  if (row?.ok === false) return false;
  const statusCode = maybeNumber(row?.status_code);
  if (statusCode !== null && (statusCode < 200 || statusCode >= 400)) return false;
  return true;
}

async function recentAgentKitRequest({ db, endpoint, since }) {
  if (!db || typeof db.listRequests !== "function") return null;
  try {
    const rows = await db.listRequests({
      endpoint_id: endpoint.id,
      since: since.toISOString(),
      limit: 25,
    });
    return (rows || []).find((row) => isSuccessfulAgentKitRequest(endpoint, row)) || null;
  } catch {
    return null;
  }
}

async function currentEndpointStatus(db, endpointId) {
  if (!db || typeof db.listEndpointStatus !== "function") return null;
  try {
    const rows = await db.listEndpointStatus();
    return (rows || []).find((row) => row?.endpoint_id === endpointId) || null;
  } catch {
    return null;
  }
}

function isRecoveryStatus(status) {
  return status === "failing" || status === "degraded";
}

// Healthy endpoints probe on the standard cadence. A degraded/failing endpoint
// retries on a fixed shorter interval (never longer than the standard cadence)
// so recovery is detected quickly — no exponential backoff, which used to delay
// recovery detection for exactly the endpoints that needed probing most.
function endpointProbeCadence({ statusRow, now, intervalMs, failureRetryIntervalMs }) {
  const checkedAt = statusRow?.last_checked_at || statusRow?.checked_at;
  if (!checkedAt) return { due: true, intervalMs: 0, reason: null };
  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) return { due: true, intervalMs: 0, reason: null };

  const healthyMs = checkIntervalMs(intervalMs);
  const recovering = isRecoveryStatus(statusRow?.status);
  const cadenceMs = recovering
    ? Math.min(healthyMs, retryIntervalMs(failureRetryIntervalMs))
    : healthyMs;
  return {
    due: now.getTime() - checkedAtMs >= cadenceMs,
    intervalMs: cadenceMs,
    reason: recovering ? "failure_retry" : "recent_health_check",
  };
}

function healthProbeForEndpoint(endpoint, probeKind = "availability") {
  if (probeKind === "agentkit") return endpoint.agentkitHealthProbe || endpoint.healthProbe;
  return endpoint.healthProbe;
}

function rowFromRequest(endpoint, requestRow, checkedAt, { probeKind = "availability" } = {}) {
  const attribution = attributionFor(requestRow);
  const normalized = {
    status_code: maybeNumber(requestRow.status_code),
    ok: requestRow.ok !== false,
    latency_ms: maybeNumber(requestRow.latency_ms) ?? 0,
    path: maybeString(requestRow.path),
    charged: Boolean(requestRow.charged),
    payment_error: paymentErrorLabel(attribution),
    attribution,
  };
  return {
    id: `hc_req_${requestRow.id || randomUUID()}_${randomUUID()}`,
    endpoint_id: endpoint.id,
    checked_at: checkedAt.toISOString(),
    status: statusFromResult(normalized, endpoint, {
      requireAgentKitValue: probeKind === "agentkit",
    }),
    status_code: normalized.status_code,
    latency_ms: normalized.latency_ms,
    path: maybeString(requestRow.path),
    charged: Boolean(requestRow.charged),
    estimated_usd: maybeString(requestRow.estimated_usd ?? endpoint.estimated_cost_usd),
    amount_usd: maybeString(requestRow.amount_usd),
    currency: maybeString(requestRow.currency),
    payment_reference: null,
    payment_network: maybeString(requestRow.payment_network),
    payment_error: normalized.payment_error,
    error: attribution?.label ?? null,
  };
}

function rowFromError(endpoint, checkedAt, error, latencyMs) {
  return {
    id: `hc_${randomUUID()}`,
    endpoint_id: endpoint.id,
    checked_at: checkedAt.toISOString(),
    status: "failing",
    status_code: null,
    latency_ms: latencyMs,
    path: null,
    charged: false,
    estimated_usd: maybeString(endpoint.estimated_cost_usd),
    amount_usd: null,
    currency: null,
    payment_reference: null,
    payment_network: null,
    payment_error: null,
    error: safeHealthError({ error }),
  };
}

// Layers we surface in the public DTO. Order matters only for documentation —
// each layer is independently updated by the worker based on what a given
// probe actually exercised.
export const HEALTH_LAYERS = Object.freeze(["facilitator", "agentkit", "upstream", "transport"]);

function layerStatusForSuccessfulProbe(probeKind, probePaymentMode, path) {
  // What a successful probe proves depends on the path it took.
  //  - x402_only / paid path that actually settled → facilitator + upstream + transport healthy
  //  - agentkit_first path that served from AgentKit → agentkit + transport healthy (we may
  //    not have hit the facilitator at all because AgentKit skipped settlement)
  //  - agentkit_first that fell through to x402 (agentkit_to_x402) → all of facilitator,
  //    agentkit (we tried), upstream, transport are healthy
  const layers: Record<string, string> = { transport: "healthy" };
  const paymentMode = probePaymentMode || "agentkit_first";
  const pathName = typeof path === "string" ? path.toLowerCase() : "";
  if (probeKind === "agentkit") {
    layers.agentkit = "healthy";
    if (pathName === "agentkit_to_x402") {
      layers.facilitator = "healthy";
      layers.upstream = "healthy";
    }
    return layers;
  }
  // Availability probe.
  if (paymentMode === "x402_only" || pathName === "x402" || pathName === "agentkit_to_x402") {
    layers.facilitator = "healthy";
    layers.upstream = "healthy";
  } else if (pathName === "agentkit") {
    // Paid probe served from AgentKit cache — facilitator not exercised.
    layers.agentkit = "healthy";
  } else {
    // Unknown path on a 2xx — assume the upstream answered. Be conservative
    // and only mark transport + upstream healthy; the facilitator is left
    // untouched (its last value will be preserved by merge in the store).
    layers.upstream = "healthy";
  }
  return layers;
}

function probeExercisedFacilitator(probeKind, probePaymentMode, path) {
  // Did this probe actually exercise the x402 facilitator? Only then can we
  // make any claim about the facilitator layer (healthy or otherwise) —
  // claiming healthy when the AgentKit path served the response would
  // overwrite a previously-degraded facilitator with a false recovery.
  //
  // Path takes precedence over probe config: a paid probe that returned
  // path:"agentkit" was served from the AgentKit cache and never hit the
  // facilitator, even though the probe was configured as x402_only.
  const pathName = typeof path === "string" ? path.toLowerCase() : "";
  if (pathName === "x402" || pathName === "agentkit_to_x402") return true;
  if (pathName === "agentkit") return false;
  // Path missing / unknown: fall back to probe config.
  if (probeKind === "availability" && probePaymentMode === "x402_only") return true;
  return false;
}

function layerStatusForAttributedFailure(
  attribution,
  statusCode,
  { probeKind = "availability", probePaymentMode = null, path = null } = {},
): Record<string, string> {
  // A failure was attributed. The attribution layer is downgraded; all other
  // layers are left untouched (the store merges with the previous row).
  const severity = statusCode === null || (Number.isFinite(statusCode) && statusCode >= 500)
    ? "failing"
    : "degraded";
  const layer = attribution.layer;
  if (layer === "facilitator") return { facilitator: severity, transport: "healthy" };
  if (layer === "router_payment") return { facilitator: severity, transport: "healthy" };
  if (layer === "agentkit") return { agentkit: severity, transport: "healthy" };
  if (layer === "upstream") {
    // Only mark facilitator healthy when the probe actually settled. An
    // `agentkit_first` probe that took the AgentKit path and saw an upstream
    // 4xx/5xx never exercised the facilitator — leaving it untouched preserves
    // the previously-known facilitator status instead of falsely recovering it.
    if (probeExercisedFacilitator(probeKind, probePaymentMode, path)) {
      return { upstream: severity, facilitator: "healthy", transport: "healthy" };
    }
    return { upstream: severity, transport: "healthy" };
  }
  if (layer === "rate_limit") return { upstream: severity, transport: "healthy" };
  if (layer === "timeout") return { transport: severity };
  if (layer === "transport") return { transport: severity };
  return {};
}

function endpointStatusRow(healthCheckRow, { attribution = null, probeKind = "availability", probePaymentMode = null } = {}) {
  const now = new Date().toISOString();
  const base = {
    endpoint_id: healthCheckRow.endpoint_id,
    status: healthCheckRow.status,
    last_checked_at: healthCheckRow.checked_at,
    status_code: healthCheckRow.status_code,
    latency_ms: healthCheckRow.latency_ms,
    path: healthCheckRow.path,
    charged: healthCheckRow.charged,
    estimated_usd: healthCheckRow.estimated_usd,
    amount_usd: healthCheckRow.amount_usd,
    currency: healthCheckRow.currency,
    payment_reference: healthCheckRow.payment_reference,
    payment_network: healthCheckRow.payment_network,
    payment_error: healthCheckRow.payment_error,
    last_error: healthCheckRow.error,
    updated_at: now,
  };

  // Disabled / unverified probes don't claim per-layer attribution.
  if (healthCheckRow.status === "unverified") return base;

  const layerUpdates = attribution
    ? layerStatusForAttributedFailure(attribution, healthCheckRow.status_code, {
        probeKind,
        probePaymentMode,
        path: healthCheckRow.path,
      })
    : layerStatusForSuccessfulProbe(probeKind, probePaymentMode, healthCheckRow.path);

  // Only include layer columns this probe actually touched in the upsert
  // payload. PostgREST's `resolution=merge-duplicates` updates only the
  // columns present in the INSERT, so omitted columns keep their previous
  // value — exactly what we want for the per-layer attribution history.
  // Sending an explicit null for an untouched layer (e.g. `layer_x: null`)
  // would clear the column, so we deliberately leave the key off the object
  // rather than assigning undefined.
  for (const layer of HEALTH_LAYERS) {
    const value = layerUpdates[layer];
    if (value) {
      base[`layer_${layer}_status`] = value;
      base[`layer_${layer}_updated_at`] = now;
    }
  }
  return base;
}

async function executeThroughExecutor(executor, payload) {
  if (typeof executor === "function") return executor(payload);
  if (executor && typeof executor.execute === "function") return executor.execute(payload);
  if (executor && typeof executor.executeEndpoint === "function") return executor.executeEndpoint(payload);
  if (executor && typeof executor.executeRequest === "function") return executor.executeRequest(payload);
  throw new TypeError("health worker requires an executor function or object with execute()");
}

async function insertHealthCheck(db, row) {
  if (!db) return;
  if (typeof db.insertHealthCheck === "function") {
    await db.insertHealthCheck(row);
    return;
  }
  if (typeof db.from === "function") {
    const result = await db.from("health_checks").insert(row);
    if (result?.error) throw result.error;
    return;
  }
  throw new TypeError("db must expose insertHealthCheck(row) or Supabase from(table)");
}

async function upsertEndpointStatus(db, row) {
  if (!db) return;
  if (typeof db.upsertEndpointStatus === "function") {
    await db.upsertEndpointStatus(row);
    return;
  }
  if (typeof db.from === "function") {
    const result = await db.from("endpoint_status").upsert(row, { onConflict: "endpoint_id" });
    if (result?.error) throw result.error;
    return;
  }
  throw new TypeError("db must expose upsertEndpointStatus(row) or Supabase from(table)");
}

async function persistRows(db, healthCheckRow, {
  updateEndpointStatus = true,
  attribution = null,
  probeKind = "availability",
  probePaymentMode = null,
} = {}) {
  const statusRow = endpointStatusRow(healthCheckRow, { attribution, probeKind, probePaymentMode });
  await insertHealthCheck(db, healthCheckRow);
  if (updateEndpointStatus) await upsertEndpointStatus(db, statusRow);
  return statusRow;
}

export async function runEndpointHealthCheck({
  endpoint,
  executor,
  db,
  now = () => new Date(),
  recentRequestWindowMs = DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  useRecentRequests = true,
  timeoutMs,
  minCheckIntervalMs = null,
  failureRetryIntervalMs = null,
  probeKind = "availability",
  updateEndpointStatus = true,
  force = false,
}) {
  if (!endpoint) throw new TypeError("endpoint is required");
  const checkedAt = now();
  const started = Date.now();

  if (!force && minCheckIntervalMs) {
    const currentStatus = await currentEndpointStatus(db, endpoint.id);
    const cadence = endpointProbeCadence({
      statusRow: currentStatus,
      now: checkedAt,
      intervalMs: minCheckIntervalMs,
      failureRetryIntervalMs,
    });
    if (currentStatus && !cadence.due) {
      return {
        endpoint_id: endpoint.id,
        status: currentStatus.status,
        skipped: true,
        skip_reason: cadence.reason,
        next_check_after_ms: cadence.intervalMs,
        healthCheck: null,
        endpointStatus: currentStatus,
      };
    }
  }

  let healthCheckRow;
  let attribution = null;
  let probePaymentMode = null;
  if (!endpoint.enabled) {
    healthCheckRow = {
      id: `hc_${randomUUID()}`,
      endpoint_id: endpoint.id,
      checked_at: checkedAt.toISOString(),
      status: "unverified",
      status_code: null,
      latency_ms: 0,
      path: null,
      charged: false,
      estimated_usd: maybeString(endpoint.estimated_cost_usd),
      amount_usd: null,
      currency: null,
      payment_reference: null,
      payment_network: null,
      payment_error: null,
      error: "endpoint disabled",
    };
  } else {
    try {
      const recentRequest = useRecentRequests
        ? await recentAgentKitRequest({
            db,
            endpoint,
            since: new Date(checkedAt.getTime() - recentRequestWindowMs),
          })
        : null;
      if (recentRequest) {
        healthCheckRow = rowFromRequest(endpoint, recentRequest, checkedAt, { probeKind });
        attribution = attributionFor(recentRequest);
      } else {
        const probe = healthProbeForEndpoint(endpoint, probeKind);
        const request = endpoint.buildRequest(probe.input);
        const traceId = `health_${randomUUID()}`;
        probePaymentMode = probe.paymentMode || endpoint.defaultPaymentMode || "agentkit_first";
        const result = await executeThroughExecutor(executor, {
          kind: "health_probe",
          probeKind,
          endpoint,
          endpointId: endpoint.id,
          input: probe.input,
          request,
          maxUsd: probe.maxUsd,
          paymentMode: probePaymentMode,
          traceId,
          timeoutMs: healthProbeTimeoutMs(timeoutMs ?? probe.timeoutMs ?? probe.timeout_ms),
        });
        const normalized = normalizeExecutionResult(result, Date.now() - started);
        attribution = normalized.attribution ?? null;
        healthCheckRow = {
          id: `hc_${randomUUID()}`,
          endpoint_id: endpoint.id,
          checked_at: checkedAt.toISOString(),
          status: statusFromResult(normalized, endpoint, {
            requireAgentKitValue: probeKind === "agentkit",
          }),
          status_code: normalized.status_code,
          latency_ms: normalized.latency_ms,
          path: normalized.path,
          charged: normalized.charged,
          estimated_usd: normalized.estimated_usd ?? request.estimatedUsd,
          amount_usd: normalized.amount_usd,
          currency: normalized.currency,
          payment_reference: null,
          payment_network: normalized.payment_network,
          payment_error: normalized.payment_error,
          error: normalized.error,
        };
      }
    } catch (error) {
      healthCheckRow = rowFromError(endpoint, checkedAt, error, Date.now() - started);
      attribution = attributionFor({ error: healthCheckRow.error });
    }
  }

  const statusRow = await persistRows(db, healthCheckRow, {
    updateEndpointStatus,
    attribution,
    probeKind,
    probePaymentMode,
  });
  return {
    endpoint_id: endpoint.id,
    status: healthCheckRow.status,
    healthCheck: healthCheckRow,
    endpointStatus: statusRow,
  };
}

export async function runEndpointHealthChecks({
  endpoints = endpointRegistry,
  executor,
  db,
  now = () => new Date(),
  recentRequestWindowMs = DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  useRecentRequests = true,
  timeoutMs,
  minCheckIntervalMs = null,
  failureRetryIntervalMs = null,
  probeKind = "availability",
  updateEndpointStatus = true,
  force = false,
  logger,
}: any = {}) {
  const results = [];
  for (const endpoint of endpoints) {
    const result = await runEndpointHealthCheck({
      endpoint,
      executor,
      db,
      now,
      recentRequestWindowMs,
      useRecentRequests,
      timeoutMs,
      minCheckIntervalMs,
      failureRetryIntervalMs,
      probeKind,
      updateEndpointStatus,
      force,
    });
    results.push(result);
    logger?.info?.(result.skipped ? "endpoint health check skipped" : "endpoint health check completed", {
      endpoint_id: result.endpoint_id,
      probe_kind: probeKind,
      status: result.status,
      status_code: result.healthCheck?.status_code ?? null,
      path: result.healthCheck?.path ?? null,
      charged: Boolean(result.healthCheck?.charged),
      latency_ms: result.healthCheck?.latency_ms ?? null,
      timeout: result.healthCheck?.error === "Provider timed out",
      skipped: Boolean(result.skipped),
      skip_reason: result.skip_reason ?? null,
      next_check_after_ms: result.next_check_after_ms ?? null,
      error: result.healthCheck?.error ?? null,
    });
  }
  return results;
}

export function createHealthWorker(options) {
  let timer = null;
  const intervalMs = options?.intervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS;
  const failureRetryIntervalMs = retryIntervalMs(options?.failureRetryIntervalMs);
  const tickMs = workerTickMs(
    options?.tickMs ?? process.env.TOOLROUTER_HEALTH_WORKER_TICK_MS,
    Math.min(intervalMs, failureRetryIntervalMs),
  );
  const runOptions = {
    ...options,
    minCheckIntervalMs: options?.minCheckIntervalMs ?? intervalMs,
    failureRetryIntervalMs,
  };
  return {
    runOnce: (overrides = {}) => runEndpointHealthChecks({ ...runOptions, ...overrides }),
    start() {
      if (timer) return timer;
      timer = setInterval(() => {
        runEndpointHealthChecks(runOptions).catch((error) => {
          options?.logger?.error?.("endpoint health check failed", { error });
        });
      }, tickMs);
      return timer;
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
