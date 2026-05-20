// Manus-specific upstream client and shared primitives used by the Manus
// seller registration. Pulled from the original `apps/api/src/manus.ts`.
//
// `MonthlyAgentKitStorage` is currently parameterized by the storage_keyspace
// "manus" — when a second seller lands, this will be promoted into the shared
// `createSellerService` primitive (or its own shared module) using the
// manifest's `agentkit.storage_keyspace` field.

import { createHash } from "node:crypto";
import { createFacilitatorConfig } from "@coinbase/x402";

import { buildManusTaskBody } from "./pricing.ts";

const DEFAULT_NETWORK = "eip155:8453";
export type NetworkId = `${string}:${string}`;

function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

function secondsUntilNextMonth(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

function hashHumanId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function x402Network(): NetworkId {
  return (process.env.X402_DEFAULT_CHAIN_ID || DEFAULT_NETWORK) as NetworkId;
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

export function createManusFacilitatorConfig() {
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
      new Error("Coinbase/CDP facilitator credentials are required for Base mainnet Manus settlement"),
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

export class MonthlyAgentKitStorage {
  cache: any;
  keyspace: string;

  constructor(cache: any, keyspace = "manus") {
    this.cache = cache;
    this.keyspace = keyspace;
  }

  async tryIncrementUsage(endpoint: string, humanId: string, limit: number) {
    const key = `agentkit:${this.keyspace}:${endpoint}:${monthKey()}:${hashHumanId(humanId)}`;
    const result = await this.cache.increment({
      key,
      limit,
      windowSeconds: secondsUntilNextMonth(),
    });
    return result.value <= limit;
  }

  async hasUsedNonce(nonce: string) {
    if (typeof this.cache.has !== "function") return false;
    return this.cache.has({ key: `agentkit:${this.keyspace}:nonce:${hashHumanId(nonce)}` });
  }

  async recordNonce(nonce: string) {
    if (typeof this.cache.set !== "function") return;
    await this.cache.set({
      key: `agentkit:${this.keyspace}:nonce:${hashHumanId(nonce)}`,
      windowSeconds: Number(process.env.AGENTKIT_NONCE_TTL_SECONDS || 10 * 60),
    });
  }
}

/**
 * HTTP error → user-facing label. Shared with the buyer-side task-detail
 * helpers in `./tasks.ts` so the label stays consistent across the
 * settlement-side forwarder and the read-only task lookups.
 */
export function safeUpstreamError(status: number) {
  if (status === 401 || status === 403) return "Manus authentication failed";
  if (status === 429) return "Manus rate limited";
  if (status >= 500) return "Manus provider error";
  return "Manus request failed";
}

export async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/**
 * Manus upstream forwarder. Called by `createSellerService` after settlement
 * succeeds; produces the `{ ok, provider, task }` envelope the existing route
 * returned (response-shape equivalent with the pre-extraction wrapper).
 */
export async function forwardManusUpstream({
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
  const taskBody = buildManusTaskBody(request.body || {});
  const upstream = await fetchImpl("https://api.manus.ai/v2/task.create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-manus-api-key": secrets.MANUS_API_KEY,
    },
    body: JSON.stringify(taskBody),
  });
  const upstreamBody = await readJsonResponse(upstream);
  if (!upstream.ok) {
    reply.status(upstream.status >= 500 ? 502 : upstream.status);
    return {
      ok: false,
      error: safeUpstreamError(upstream.status),
    };
  }
  return {
    ok: true,
    provider: "manus",
    task: upstreamBody,
  };
}
