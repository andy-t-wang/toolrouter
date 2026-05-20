// AgentKit free-trial preflight helper. For endpoints whose `agentkit_value`
// is `free_trial`, the orchestrator first probes with `paymentMode:
// "agentkit_only"` to claim the trial use without charging. If the trial does
// not realize (out of uses, AgentKit not verified, etc.) the orchestrator
// falls back to the paid path.

import { realizedAgentKitValue } from "@toolrouter/router-core";

const DEFAULT_AGENTKIT_PREFLIGHT_TIMEOUT_MS = 10_000;

function envMs(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function agentKitPreflightTimeoutMs() {
  const configured = envMs(
    "TOOLROUTER_AGENTKIT_PREFLIGHT_TIMEOUT_MS",
    DEFAULT_AGENTKIT_PREFLIGHT_TIMEOUT_MS,
  );
  return Math.max(1, configured);
}

export function shouldPreflightAgentKitFreeTrial(endpoint: any, paymentMode: any) {
  return endpoint?.agentkit_value_type === "free_trial" && paymentMode !== "x402_only";
}

export function realizedFreeTrial(endpoint: any, result: any) {
  return (
    result?.ok === true &&
    realizedAgentKitValue(endpoint, result).agentkit_value_type === "free_trial"
  );
}

function timedOut(result: any) {
  return String(result?.error || "").includes("timed out after");
}

export function logAgentKitPreflight(
  request: any,
  endpoint: any,
  result: any,
  options: { realized_free_trial: boolean; will_fallback: boolean },
) {
  request?.log?.info?.(
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
