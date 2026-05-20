// `POST /v1/requests` orchestrator.
//
// This module is intentionally Fastify-free. Route plugins call
// `runExecution(deps, ctx)` with a dependency bag and a request context — no
// Fastify instance required. The unit test in `tests/unit/api/orchestrator.test.mjs`
// exercises this directly with fake deps; the integration suite covers the
// Fastify wiring path.

import { randomUUID } from "node:crypto";

import {
  getEndpoint,
  realizedAgentKitValue,
} from "@toolrouter/router-core";

import { enforceRequestPolicy } from "@toolrouter/cache";

import {
  finalizeCreditReservation,
  releaseCreditReservation,
  reserveCredits,
} from "../billing.ts";
import {
  abandonManusAsyncTask,
  finalizeManusAsyncTask,
  prepareManusAsyncTask,
} from "./async-task.ts";
import {
  agentKitPreflightTimeoutMs,
  logAgentKitPreflight,
  realizedFreeTrial,
  shouldPreflightAgentKitFreeTrial,
} from "./preflight.ts";
import { MANUS_RESEARCH_ENDPOINT_ID } from "../manus-tasks.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

function envMs(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function timedOut(result: any) {
  return String(result?.error || "").includes("timed out after");
}

function logEndpointRequest(logger: any, endpoint: any, result: any) {
  logger?.info?.(
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

function isInsufficientCreditsError(error: any) {
  return error?.code === "insufficient_credits";
}

function requestMetricStatus(row: any) {
  if (Number(row.status_code) === 402) return "payment_required";
  return isErrorRequest(row) ? "fail" : "success";
}

function isErrorRequest(row: any) {
  return (
    Boolean(row.error) || row.ok === false || Number(row.status_code) >= 400
  );
}

function isAgentKitUse(row: any) {
  return row?.path === "agentkit" || row?.path === "agentkit_to_x402";
}

function requestMetricTags(row: any) {
  return {
    status: requestMetricStatus(row),
    endpoint: row.endpoint_id,
    path: row.path || "unknown",
    status_code: row.status_code || "unknown",
  };
}

export function recordRequestMetrics(datadog: any, row: any) {
  const tags = requestMetricTags(row);
  datadog?.increment?.("toolrouter.requests.count", tags).catch(() => undefined);
  if (!isErrorRequest(row) && isAgentKitUse(row)) {
    datadog?.increment?.("toolrouter.agentkit.uses.count", {
      endpoint: row.endpoint_id,
      path: row.path || "unknown",
    }).catch(() => undefined);
  }
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

function requireObject(value: any, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object`), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return value;
}

export function endpointInputFromRequestBody(body: any) {
  if (body.input !== undefined) return requireObject(body.input, "input");
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !REQUEST_CONTROL_FIELDS.has(key)),
  );
}

export interface ExecutionDeps {
  store: any;
  executor: any;
  cache: any;
  datadog?: any;
  /** Resolves the optional payment signer for this auth (Crossmint-backed). */
  resolvePaymentSigner: (auth: any) => Promise<any>;
}

export interface ExecutionContext {
  auth: any;
  body: any;
  ip?: string;
  traceId?: string;
  logger?: any;
}

/**
 * Core `POST /v1/requests` orchestration. Returns the response body for the
 * route handler to send. Throws decorated errors (statusCode + code) for the
 * Fastify error handler to convert to HTTP. Designed to be called from any
 * server framework — see `tests/unit/api/orchestrator.test.mjs` for a
 * Fastify-free smoke test.
 */
export async function runExecution(
  deps: ExecutionDeps,
  ctx: ExecutionContext,
): Promise<any> {
  const { store, executor, cache, datadog, resolvePaymentSigner } = deps;
  const { auth, body: rawBody, ip, logger } = ctx;
  const body = requireObject(rawBody || {}, "request body");
  const traceId = ctx.traceId || `trace_${randomUUID()}`;
  let reservation: any = null;
  let reservedManusTask: any = null;
  let dedupeKey: string | null = null;
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

    const manusPrep = await prepareManusAsyncTask({
      store,
      endpoint,
      endpointInput,
      body,
      auth,
      traceId,
    });
    if (manusPrep.type === "deduped") {
      return manusPrep.response;
    }
    if (manusPrep.type === "reserved") {
      reservedManusTask = manusPrep.reservedTask;
      dedupeKey = manusPrep.dedupeKey;
    } else if (manusPrep.type === "passthrough") {
      // Even on force_new the dedupe key flows through so a future
      // non-force_new request can match against it.
      dedupeKey = manusPrep.dedupeKey;
    }

    await enforceRequestPolicy({
      cache,
      auth,
      ip,
      estimatedUsd: providerRequest.estimatedUsd,
      maxUsd,
    });
    const paymentSigner = await resolvePaymentSigner(auth);
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
      logAgentKitPreflight({ log: logger }, endpoint, result, {
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

    logEndpointRequest(logger, endpoint, result);
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

    const manusStart = await finalizeManusAsyncTask({
      store,
      endpoint,
      auth,
      result,
      reservedTask: reservedManusTask,
      dedupeKey,
      requestId: row.id,
      traceId,
      createdAt: row.ts || new Date().toISOString(),
    });
    // finalizeManusAsyncTask already cleaned up the reserved row if the run
    // produced no task — clear our local handle either way.
    reservedManusTask = null;

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
    await abandonManusAsyncTask(store, reservedManusTask);
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
}
