// Parallel-specific upstream forwarders and a small facilitator-config helper
// that mirrors the Manus one. Reuses the same Coinbase/CDP facilitator
// detection used elsewhere; Parallel only needs an `x-api-key` upstream
// header.

import { createFacilitatorConfig } from "@coinbase/x402";

import { readJsonResponse } from "../manus/upstream.ts";

const PARALLEL_API_BASE = "https://api.parallel.ai";
const DEFAULT_NETWORK = "eip155:8453";

function x402Network() {
  return process.env.X402_DEFAULT_CHAIN_ID || DEFAULT_NETWORK;
}

function isBaseMainnetNetwork(network: string) {
  return network === "eip155:8453" || network === "base";
}

function normalizeCoinbaseKeySecret(value: string) {
  return value.trim().replace(/\\n/gu, "\n");
}

function isPlausibleCoinbaseKeySecret(value: string) {
  const secret = normalizeCoinbaseKeySecret(value);
  return secret.includes("BEGIN") || /^[A-Za-z0-9+/=]{40,}$/u.test(secret);
}

export function createParallelFacilitatorConfig() {
  const keyId = process.env.COINBASE_KEY_ID || process.env.CDP_API_KEY_ID;
  const rawKeySecret = process.env.COINBASE_KEY_SECRET || process.env.CDP_API_KEY_SECRET;
  const keySecret = rawKeySecret ? normalizeCoinbaseKeySecret(rawKeySecret) : undefined;
  if (keyId && keySecret) {
    if (!isPlausibleCoinbaseKeySecret(keySecret)) {
      throw Object.assign(
        new Error("COINBASE_KEY_SECRET must be a CDP API key secret PEM or base64 Ed25519 key"),
        {
          statusCode: 503,
          code: "coinbase_facilitator_credentials_invalid",
        },
      );
    }
    return createFacilitatorConfig(keyId, keySecret);
  }
  if (isBaseMainnetNetwork(x402Network())) {
    throw Object.assign(
      new Error("Coinbase/CDP facilitator credentials are required for Base mainnet Parallel settlement"),
      {
        statusCode: 503,
        code: "coinbase_facilitator_credentials_required",
      },
    );
  }
  return {
    url: process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator",
  };
}

export function safeParallelError(status: number) {
  if (status === 401 || status === 403) return "Parallel authentication failed";
  if (status === 429) return "Parallel rate limited";
  if (status >= 500) return "Parallel provider error";
  return "Parallel request failed";
}

function stripControlFields(body: any) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const {
    maxUsd: _maxUsd,
    max_usd: _maxUsdAlt,
    payment_mode: _paymentMode,
    paymentMode: _paymentModeAlt,
    force_new: _forceNew,
    forceNew: _forceNewAlt,
    endpoint_id: _endpointId,
    endpointId: _endpointIdAlt,
    input: rawInput,
    ...rest
  } = body;
  // When `input` is an object, treat it as the wrapper-style envelope and
  // hoist its fields into the upstream body (matches how `/v1/requests`
  // accepts a nested input). When it's any other value (string, number,
  // array — Parallel Task uses `input: string|object`), pass it through
  // unchanged.
  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    return { ...rest, ...rawInput };
  }
  return rawInput === undefined ? rest : { ...rest, input: rawInput };
}

async function forwardJson({
  url,
  body,
  secrets,
  fetchImpl,
  reply,
}: {
  url: string;
  body: any;
  secrets: Record<string, string>;
  fetchImpl: typeof fetch;
  reply: any;
}) {
  const upstream = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": secrets.PARALLEL_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const upstreamBody = await readJsonResponse(upstream);
  if (!upstream.ok) {
    reply.status(upstream.status >= 500 ? 502 : upstream.status);
    return {
      ok: false,
      error: safeParallelError(upstream.status),
    };
  }
  return { ok: true, body: upstreamBody };
}

export async function forwardParallelSearchUpstream({
  request,
  reply,
  secrets,
  fetchImpl = fetch,
}: {
  request: any;
  reply: any;
  secrets: Record<string, string>;
  fetchImpl?: typeof fetch;
}) {
  const inputBody = stripControlFields(request.body || {});
  const upstream = await forwardJson({
    url: `${PARALLEL_API_BASE}/v1/search`,
    body: inputBody,
    secrets,
    fetchImpl,
    reply,
  });
  if (!upstream.ok) return upstream;
  return { ok: true, provider: "parallel", result: upstream.body };
}

export async function forwardParallelExtractUpstream({
  request,
  reply,
  secrets,
  fetchImpl = fetch,
}: {
  request: any;
  reply: any;
  secrets: Record<string, string>;
  fetchImpl?: typeof fetch;
}) {
  const inputBody = stripControlFields(request.body || {});
  const upstream = await forwardJson({
    url: `${PARALLEL_API_BASE}/v1/extract`,
    body: inputBody,
    secrets,
    fetchImpl,
    reply,
  });
  if (!upstream.ok) return upstream;
  return { ok: true, provider: "parallel", result: upstream.body };
}

export async function forwardParallelTaskUpstream({
  request,
  reply,
  secrets,
  fetchImpl = fetch,
}: {
  request: any;
  reply: any;
  secrets: Record<string, string>;
  fetchImpl?: typeof fetch;
}) {
  const inputBody = stripControlFields(request.body || {});
  const upstream = await forwardJson({
    url: `${PARALLEL_API_BASE}/v1/tasks/runs`,
    body: inputBody,
    secrets,
    fetchImpl,
    reply,
  });
  if (!upstream.ok) return upstream;
  return { ok: true, provider: "parallel", task: upstream.body };
}
