import { randomUUID } from "node:crypto";

import { endpointRegistry } from "../endpoints/registry.ts";

export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

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

function pick(result, snakeName, camelName) {
  return result?.[snakeName] ?? result?.[camelName] ?? null;
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
    payment_error: maybeString(pick(result, "payment_error", "paymentError") ?? payment.error),
    error: maybeString(result?.error),
  };
}

function statusFromResult(result) {
  if (result.payment_error) return "degraded";
  if (result.ok) return result.latency_ms > 10_000 ? "degraded" : "healthy";
  if (result.status_code === null) return "failing";
  if (result.status_code >= 500) return "failing";
  return "degraded";
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
    error: error instanceof Error ? error.message : String(error),
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

async function persistRows(db, healthCheckRow) {
  const statusRow = endpointStatusRow(healthCheckRow);
  await insertHealthCheck(db, healthCheckRow);
  await upsertEndpointStatus(db, statusRow);
  return statusRow;
}

export async function runEndpointHealthCheck({ endpoint, executor, db, now = () => new Date() }) {
  if (!endpoint) throw new TypeError("endpoint is required");
  const checkedAt = now();
  const started = Date.now();

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
      const request = endpoint.buildRequest(endpoint.healthProbe.input);
      const traceId = `health_${randomUUID()}`;
      const result = await executeThroughExecutor(executor, {
        kind: "health_probe",
        endpoint,
        endpointId: endpoint.id,
        input: endpoint.healthProbe.input,
        request,
        maxUsd: endpoint.healthProbe.maxUsd,
        paymentMode: endpoint.healthProbe.paymentMode || endpoint.defaultPaymentMode || "agentkit_first",
        traceId,
      });
      const normalized = normalizeExecutionResult(result, Date.now() - started);
      healthCheckRow = {
        id: `hc_${randomUUID()}`,
        endpoint_id: endpoint.id,
        checked_at: checkedAt.toISOString(),
        status: statusFromResult(normalized),
        status_code: normalized.status_code,
        latency_ms: normalized.latency_ms,
        path: normalized.path,
        charged: normalized.charged,
        estimated_usd: normalized.estimated_usd ?? request.estimatedUsd,
        amount_usd: normalized.amount_usd,
        currency: normalized.currency,
        payment_reference: normalized.payment_reference,
        payment_network: normalized.payment_network,
        payment_error: normalized.payment_error,
        error: normalized.error,
      };
    } catch (error) {
      healthCheckRow = rowFromError(endpoint, checkedAt, error, Date.now() - started);
    }
  }

  const statusRow = await persistRows(db, healthCheckRow);
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
  logger,
}: any = {}) {
  const results = [];
  for (const endpoint of endpoints) {
    const result = await runEndpointHealthCheck({ endpoint, executor, db, now });
    results.push(result);
    logger?.info?.("endpoint health check completed", {
      endpoint_id: result.endpoint_id,
      status: result.status,
    });
  }
  return results;
}

export function createHealthWorker(options) {
  let timer = null;
  return {
    runOnce: () => runEndpointHealthChecks(options),
    start() {
      if (timer) return timer;
      timer = setInterval(() => {
        runEndpointHealthChecks(options).catch((error) => {
          options?.logger?.error?.("endpoint health check failed", { error });
        });
      }, options?.intervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS);
      timer.unref?.();
      return timer;
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
