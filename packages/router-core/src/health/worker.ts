import { randomUUID } from "node:crypto";

import { endpointRegistry } from "../endpoints/registry.ts";

export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 5_000;
export const DEFAULT_HEALTH_FAILURE_RETRY_BASE_MS = 15 * 60 * 1000;
export const DEFAULT_HEALTH_FAILURE_RETRY_MAX_MS = DEFAULT_HEALTH_CHECK_INTERVAL_MS;

export const HEALTH_STATUSES = Object.freeze(["healthy", "degraded", "failing", "unverified"]);
const AGENTKIT_HEALTH_PATHS = new Set(["agentkit", "agentkit_to_x402"]);
const FREE_TRIAL_VALUE_TYPE = "free_trial";

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

function failureRetryBaseMs(value) {
  const intervalMs = maybeNumber(value);
  return intervalMs && intervalMs > 0
    ? Math.floor(intervalMs)
    : envMs("TOOLROUTER_HEALTH_FAILURE_RETRY_BASE_MS", DEFAULT_HEALTH_FAILURE_RETRY_BASE_MS);
}

function failureRetryMaxMs(value) {
  const intervalMs = maybeNumber(value);
  return intervalMs && intervalMs > 0
    ? Math.floor(intervalMs)
    : envMs("TOOLROUTER_HEALTH_FAILURE_RETRY_MAX_MS", DEFAULT_HEALTH_FAILURE_RETRY_MAX_MS);
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

function providerBodyMessage(result) {
  const body = result?.body;
  if (!body) return null;
  if (typeof body === "string") return body;
  if (typeof body !== "object") return null;
  const message = body.error || body.message;
  const details = body.details;
  if (message && details) return `${message}: ${details}`;
  return message || details || null;
}

function safePaymentError(value) {
  if (!value) return null;
  return "Provider payment error";
}

function safeHealthError(result) {
  const statusCode = maybeNumber(pick(result, "status_code", "statusCode"));
  const error = String(result?.error ?? providerBodyMessage(result) ?? result?.payment_error ?? "");
  if (!error && (!Number.isFinite(statusCode) || statusCode < 400)) return null;
  if (statusCode === 402) return "Provider payment required";
  if (statusCode === 429) return "Provider rate limited";
  if (statusCode === 504 || /timed out|timeout/iu.test(error)) return "Provider timed out";
  if (/payment|stripe|x402/iu.test(error)) return "Provider payment error";
  if (Number.isFinite(statusCode) && statusCode >= 500) return "Provider error";
  return "Provider check failed";
}

function normalizeExecutionResult(result, fallbackLatencyMs) {
  const statusCode = maybeNumber(pick(result, "status_code", "statusCode"));
  const payment = result?.payment || result?.paymentReceipt || {};
  const ok = result?.ok ?? (statusCode !== null ? statusCode >= 200 && statusCode < 300 : false);

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
    payment_error: safePaymentError(pick(result, "payment_error", "paymentError") ?? payment.error),
    error: safeHealthError(result),
  };
}

function freeTrialValueRealized(endpoint, row) {
  return endpoint?.agentkit_value_type !== FREE_TRIAL_VALUE_TYPE || (row?.path === "agentkit" && !row?.charged);
}

function agentKitValueRealized(endpoint, row) {
  if (endpoint?.agentkit_value_type === FREE_TRIAL_VALUE_TYPE) return freeTrialValueRealized(endpoint, row);
  return AGENTKIT_HEALTH_PATHS.has(row?.path);
}

function statusFromResult(result, endpoint, { requireAgentKitValue = false } = {}) {
  if (result.payment_error) return "degraded";
  if (result.ok) {
    if (result.latency_ms > latencyBudgetMs(endpoint)) return "degraded";
    if (requireAgentKitValue && !freeTrialValueRealized(endpoint, result)) return "degraded";
    return "healthy";
  }
  if (result.status_code === null) return "failing";
  if (result.status_code >= 500) return "failing";
  return "degraded";
}

function isSuccessfulAgentKitRequest(endpoint, row) {
  if (!agentKitValueRealized(endpoint, row)) return false;
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

async function recentHealthChecks(db, endpointId, limit = 25) {
  if (!db || typeof db.listHealthChecks !== "function") return [];
  try {
    const rows = await db.listHealthChecks({ endpoint_id: endpointId, limit });
    return (rows || []).slice().sort((a, b) => {
      const aTime = Date.parse(a?.checked_at || a?.last_checked_at || "");
      const bTime = Date.parse(b?.checked_at || b?.last_checked_at || "");
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  } catch {
    return [];
  }
}

function isRecoveryStatus(status) {
  return status === "failing" || status === "degraded";
}

function consecutiveRecoveryChecks(rows) {
  let count = 0;
  for (const row of rows || []) {
    if (!isRecoveryStatus(row?.status)) break;
    count += 1;
  }
  return Math.max(1, count);
}

function recoveryBackoffMs(attemptCount, baseMs, maxMs) {
  const base = failureRetryBaseMs(baseMs);
  const max = failureRetryMaxMs(maxMs);
  const multiplier = 2 ** Math.max(0, Number(attemptCount || 1) - 1);
  return Math.min(max, base * multiplier);
}

async function endpointProbeCadence({ db, endpointId, statusRow, now, healthyIntervalMs, retryBaseMs, retryMaxMs }) {
  const status = statusRow?.status;
  const checkedAt = statusRow?.last_checked_at || statusRow?.checked_at;
  if (!checkedAt) return { due: true, intervalMs: 0, reason: null };
  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) return { due: true, intervalMs: 0, reason: null };

  if (!isRecoveryStatus(status)) {
    const intervalMs = checkIntervalMs(healthyIntervalMs);
    return {
      due: now.getTime() - checkedAtMs >= intervalMs,
      intervalMs,
      reason: "recent_health_check",
    };
  }

  const checks = await recentHealthChecks(db, endpointId);
  const failures = consecutiveRecoveryChecks(checks);
  const intervalMs = recoveryBackoffMs(failures, retryBaseMs, retryMaxMs);
  return {
    due: now.getTime() - checkedAtMs >= intervalMs,
    intervalMs,
    reason: "failure_backoff",
    consecutive_failures: failures,
  };
}

function healthProbeForEndpoint(endpoint, probeKind = "availability") {
  if (probeKind === "agentkit") return endpoint.agentkitHealthProbe || endpoint.healthProbe;
  return endpoint.healthProbe;
}

function rowFromRequest(endpoint, requestRow, checkedAt, { probeKind = "availability" } = {}) {
  const normalized = {
    status_code: maybeNumber(requestRow.status_code),
    ok: requestRow.ok !== false,
    latency_ms: maybeNumber(requestRow.latency_ms) ?? 0,
    path: maybeString(requestRow.path),
    charged: Boolean(requestRow.charged),
    payment_error: maybeString(requestRow.payment_error),
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
    payment_error: safePaymentError(normalized.payment_error),
    error: safeHealthError(requestRow),
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

function endpointStatusRow(healthCheckRow) {
  return {
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
    updated_at: new Date().toISOString(),
  };
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

async function persistRows(db, healthCheckRow, { updateEndpointStatus = true } = {}) {
  const statusRow = endpointStatusRow(healthCheckRow);
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
  failureRetryBaseMs = null,
  failureRetryMaxMs = null,
  probeKind = "availability",
  updateEndpointStatus = true,
  force = false,
}) {
  if (!endpoint) throw new TypeError("endpoint is required");
  if (probeKind === "agentkit" && endpoint.agentkit !== true) {
    return {
      endpoint_id: endpoint.id,
      status: "unverified",
      skipped: true,
      skip_reason: "agentkit_not_supported",
      healthCheck: null,
      endpointStatus: null,
    };
  }
  const checkedAt = now();
  const started = Date.now();

  if (!force && minCheckIntervalMs) {
    const currentStatus = await currentEndpointStatus(db, endpoint.id);
    const cadence = await endpointProbeCadence({
      db,
      endpointId: endpoint.id,
      statusRow: currentStatus,
      now: checkedAt,
      healthyIntervalMs: minCheckIntervalMs,
      retryBaseMs: failureRetryBaseMs,
      retryMaxMs: failureRetryMaxMs,
    });
    if (currentStatus && !cadence.due) {
      return {
        endpoint_id: endpoint.id,
        status: currentStatus.status,
        skipped: true,
        skip_reason: cadence.reason,
        next_check_after_ms: cadence.intervalMs,
        consecutive_failures: cadence.consecutive_failures ?? null,
        healthCheck: null,
        endpointStatus: currentStatus,
      };
    }
  }

  let healthCheckRow;
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
      } else {
        const probe = healthProbeForEndpoint(endpoint, probeKind);
        const request = endpoint.buildRequest(probe.input);
        const traceId = `health_${randomUUID()}`;
        const result = await executeThroughExecutor(executor, {
          kind: "health_probe",
          probeKind,
          endpoint,
          endpointId: endpoint.id,
          input: probe.input,
          request,
          maxUsd: probe.maxUsd,
          paymentMode: probe.paymentMode || endpoint.defaultPaymentMode || "agentkit_first",
          traceId,
          timeoutMs: healthProbeTimeoutMs(timeoutMs ?? probe.timeoutMs ?? probe.timeout_ms),
        });
        const normalized = normalizeExecutionResult(result, Date.now() - started);
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
    }
  }

  const statusRow = await persistRows(db, healthCheckRow, { updateEndpointStatus });
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
  failureRetryBaseMs = null,
  failureRetryMaxMs = null,
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
      failureRetryBaseMs,
      failureRetryMaxMs,
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
      consecutive_failures: result.consecutive_failures ?? null,
      error: result.healthCheck?.error ?? null,
    });
  }
  return results;
}

export function createHealthWorker(options) {
  let timer = null;
  const intervalMs = options?.intervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS;
  const retryBaseMs = failureRetryBaseMs(options?.failureRetryBaseMs);
  const retryMaxMs = failureRetryMaxMs(options?.failureRetryMaxMs);
  const tickMs = workerTickMs(
    options?.tickMs ?? process.env.TOOLROUTER_HEALTH_WORKER_TICK_MS,
    Math.min(intervalMs, retryBaseMs),
  );
  const runOptions = {
    ...options,
    minCheckIntervalMs: options?.minCheckIntervalMs ?? intervalMs,
    failureRetryBaseMs: retryBaseMs,
    failureRetryMaxMs: retryMaxMs,
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
