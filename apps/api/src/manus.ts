import { createHash } from "node:crypto";
import { createFacilitatorConfig } from "@coinbase/x402";
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import {
  agentkitResourceServerExtension,
  createAgentkitHooks,
  declareAgentkitExtension,
} from "@worldcoin/agentkit";

const MANUS_RESEARCH_PATH = "/x402/manus/research";
const DEFAULT_MANUS_PRICE_USD = "0.05";
const DEFAULT_MANUS_PRICE_BY_DEPTH: Record<string, string> = Object.freeze({
  quick: "0.03",
  standard: "0.05",
  deep: "0.10",
});
const DEFAULT_NETWORK = "eip155:8453";
const DEFAULT_AGENTKIT_NETWORK = "eip155:480";
type NetworkId = `${string}:${string}`;

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

function publicBaseUrl() {
  return (process.env.TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world").replace(/\/$/u, "");
}

function manusApiKey() {
  const key = process.env.MANUS_API_KEY;
  if (!key) {
    throw Object.assign(new Error("MANUS_API_KEY is required"), {
      statusCode: 503,
      code: "manus_not_configured",
    });
  }
  return key;
}

function payToAddress() {
  const address =
    process.env.X402_MANUS_PAY_TO_ADDRESS ||
    process.env.X402_PAY_TO_ADDRESS ||
    process.env.CROSSMINT_TREASURY_WALLET_ADDRESS ||
    process.env.CROSSMINT_HEALTH_WALLET_ADDRESS ||
    process.env.CROSSMINT_LIVE_WALLET_ADDRESS;
  if (!address) {
    throw Object.assign(new Error("X402_MANUS_PAY_TO_ADDRESS is required"), {
      statusCode: 503,
      code: "x402_pay_to_missing",
    });
  }
  return address;
}

function x402Network(): NetworkId {
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
      throw Object.assign(new Error("COINBASE_KEY_SECRET must be a CDP API key secret PEM or base64 Ed25519 key"), {
        statusCode: 503,
        code: "coinbase_facilitator_credentials_invalid",
      });
    }
    return createFacilitatorConfig(keyId, keySecret);
  }
  if (isBaseMainnetNetwork(x402Network())) {
    throw Object.assign(new Error("Coinbase/CDP facilitator credentials are required for Base mainnet Manus settlement"), {
      statusCode: 503,
      code: "coinbase_facilitator_credentials_required",
    });
  }
  return {
    url: process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator",
  };
}

function optionalUsd(value: string | undefined, fallback: string) {
  const raw = String(value || fallback).trim();
  if (!/^\d+(\.\d+)?$/u.test(raw)) return fallback;
  return raw;
}

function usdNumber(value: string | undefined, fallback = "0") {
  return Number(optionalUsd(value, fallback));
}

function priceByDepth(depth: string) {
  const normalized = ["quick", "standard", "deep"].includes(depth) ? depth : "standard";
  const envKey = `TOOLROUTER_MANUS_RESEARCH_PRICE_${normalized.toUpperCase()}_USD`;
  return usdNumber(process.env[envKey], process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_USD || DEFAULT_MANUS_PRICE_BY_DEPTH[normalized] || DEFAULT_MANUS_PRICE_USD);
}

function formatUsd(value: number) {
  return value.toFixed(6).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

function readStringArray(value: any, max: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, max)
    .map((item) => item.trim());
}

function readRequiredResearchQuery(input: any) {
  const value = input?.query ?? input?.prompt;
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error("query is required"), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return value.trim();
}

function normalizeResearchInput(input: any = {}) {
  return {
    ...input,
    query: readRequiredResearchQuery(input),
  };
}

export function manusResearchPriceUsd(input: any = {}) {
  const depth = String(input.depth || "standard");
  const urls = readStringArray(input.urls, 10);
  const images = readStringArray(input.images || input.image_urls, 5);
  const total =
    priceByDepth(depth) +
    urls.length * usdNumber(process.env.TOOLROUTER_MANUS_RESEARCH_URL_PRICE_USD, "0") +
    images.length * usdNumber(process.env.TOOLROUTER_MANUS_RESEARCH_IMAGE_PRICE_USD, "0");
  return formatUsd(total);
}

function buildResearchPrompt(input: any) {
  const lines = [
    String(input.query || input.prompt || "").trim(),
    "",
    `Task type: ${String(input.task_type || input.taskType || "general_research")}`,
    `Depth: ${String(input.depth || "standard")}`,
  ];
  const urls = readStringArray(input.urls, 10);
  const images = readStringArray(input.images || input.image_urls, 5);
  if (urls.length) lines.push("", "URLs to inspect:", ...urls.map((url) => `- ${url}`));
  if (images.length) lines.push("", "Images to identify or use as evidence:", ...images.map((url) => `- ${url}`));
  lines.push(
    "",
    "Return concise findings with sources when possible. If the answer is uncertain, say what remains unverified.",
  );
  return lines.filter((line, index) => index === 0 || line !== undefined).join("\n");
}

export function buildManusTaskBody(input: any) {
  const normalizedInput = normalizeResearchInput(input);
  const prompt = buildResearchPrompt(normalizedInput);
  const images = readStringArray(normalizedInput.images || normalizedInput.image_urls, 5);
  return {
    title: normalizedInput.title || `ToolRouter research: ${String(normalizedInput.query).slice(0, 80)}`,
    message: {
      content: [
        { type: "text", text: prompt },
        ...images.map((image) => ({ type: "file", file_url: image })),
      ],
    },
  };
}

function safeUpstreamError(status: number) {
  if (status === 401 || status === 403) return "Manus authentication failed";
  if (status === 429) return "Manus rate limited";
  if (status >= 500) return "Manus provider error";
  return "Manus request failed";
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function fetchManusJson({
  path,
  taskId,
  params = {},
  fetchImpl = fetch,
}: {
  path: string;
  taskId: string;
  params?: Record<string, string>;
  fetchImpl?: typeof fetch;
}) {
  const id = String(taskId || "").trim();
  if (!id) {
    throw Object.assign(new Error("task_id is required"), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  const url = new URL(`https://api.manus.ai/v2/${path}`);
  url.searchParams.set("task_id", id);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const upstream = await fetchImpl(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-manus-api-key": manusApiKey(),
    },
  });
  const body = await readJsonResponse(upstream);
  if (!upstream.ok) {
    throw Object.assign(new Error(safeUpstreamError(upstream.status)), {
      statusCode: upstream.status >= 500 ? 502 : upstream.status,
      code: "manus_upstream_error",
      details: body,
    });
  }
  return body;
}

export async function getManusTaskDetail(taskId: string, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  return fetchManusJson({ path: "task.detail", taskId, fetchImpl });
}

export async function listManusTaskMessages(taskId: string, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  return fetchManusJson({
    path: "task.listMessages",
    taskId,
    params: { order: "asc", limit: "200" },
    fetchImpl,
  });
}

export class MonthlyAgentKitStorage {
  cache: any;

  constructor(cache: any) {
    this.cache = cache;
  }

  async tryIncrementUsage(endpoint: string, humanId: string, limit: number) {
    const key = `agentkit:manus:${endpoint}:${monthKey()}:${hashHumanId(humanId)}`;
    const result = await this.cache.increment({
      key,
      limit,
      windowSeconds: secondsUntilNextMonth(),
    });
    return result.value <= limit;
  }

  async hasUsedNonce(nonce: string) {
    if (typeof this.cache.has !== "function") return false;
    return this.cache.has({ key: `agentkit:manus:nonce:${hashHumanId(nonce)}` });
  }

  async recordNonce(nonce: string) {
    if (typeof this.cache.set !== "function") return;
    await this.cache.set({
      key: `agentkit:manus:nonce:${hashHumanId(nonce)}`,
      windowSeconds: Number(process.env.AGENTKIT_NONCE_TTL_SECONDS || 10 * 60),
    });
  }
}

class FastifyX402Adapter {
  request: any;

  constructor(request: any) {
    this.request = request;
  }

  getHeader(name: string) {
    return this.request.headers[String(name).toLowerCase()];
  }

  getMethod() {
    return this.request.method;
  }

  getPath() {
    return new URL(this.getUrl()).pathname;
  }

  getUrl() {
    const host = this.request.headers.host || "toolrouter.world";
    const base = process.env.TOOLROUTER_X402_PROVIDER_URL || `https://${host}`;
    return `${base.replace(/\/$/u, "")}${this.request.url}`;
  }

  getAcceptHeader() {
    return String(this.request.headers.accept || "application/json");
  }

  getUserAgent() {
    return String(this.request.headers["user-agent"] || "");
  }

  getBody() {
    return this.request.body || {};
  }
}

function sendX402Instructions(reply: any, instructions: any) {
  for (const [key, value] of Object.entries(instructions.headers || {})) {
    reply.header(key, value as any);
  }
  reply.status(instructions.status);
  return reply.send(instructions.body ?? null);
}

export async function createManusX402Wrapper({
  cache,
  agentBook,
  fetchImpl = fetch,
}: {
  cache: any;
  agentBook: any;
  fetchImpl?: typeof fetch;
}) {
  const resourceServer = new x402ResourceServer(
    new HTTPFacilitatorClient(createManusFacilitatorConfig()),
  );
  registerExactEvmScheme(resourceServer, {
    networks: [x402Network()],
  });
  resourceServer.registerExtension(agentkitResourceServerExtension);

  const hooks = createAgentkitHooks({
    agentBook,
    mode: { type: "free-trial", uses: 2 },
    storage: new MonthlyAgentKitStorage(cache),
    rpcUrl: process.env.AGENTKIT_WORLDCHAIN_RPC_URL || undefined,
  });
  if (hooks.verifyFailureHook) {
    resourceServer.onVerifyFailure(hooks.verifyFailureHook as any);
  }

  const routeUrl = `${publicBaseUrl()}${MANUS_RESEARCH_PATH}`;
  const server = new x402HTTPResourceServer(resourceServer, {
    [`POST ${MANUS_RESEARCH_PATH}`]: {
      accepts: {
        scheme: "exact",
        network: x402Network(),
        payTo: payToAddress(),
        price: (context: any) => `$${manusResearchPriceUsd(context.adapter.getBody?.() || {})}`,
      },
      description: "Manus research task creation",
      mimeType: "application/json",
      extensions: declareAgentkitExtension({
        domain: new URL(routeUrl).host,
        resourceUri: routeUrl,
        statement: "Verify your agent for two free Manus research tasks per month.",
        network: (process.env.AGENTKIT_CHAIN_ID || DEFAULT_AGENTKIT_NETWORK) as NetworkId,
        mode: { type: "free-trial", uses: 2 },
      }),
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: { error: "x402 payment or AgentKit verification required" },
      }),
    },
  });
  server.onProtectedRequest(hooks.requestHook);
  await server.initialize();

  return {
    async handle(request: any, reply: any) {
      const taskBody = buildManusTaskBody(request.body || {});
      const adapter = new FastifyX402Adapter(request);
      const processResult = await server.processHTTPRequest({
        adapter,
        path: adapter.getPath(),
        method: adapter.getMethod(),
      });
      if (processResult.type === "payment-error") {
        return sendX402Instructions(reply, processResult.response);
      }

      const upstream = await fetchImpl("https://api.manus.ai/v2/task.create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-manus-api-key": manusApiKey(),
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

      const body = {
        ok: true,
        provider: "manus",
        task: upstreamBody,
      };
      if (processResult.type === "payment-verified") {
        const settleResult = await server.processSettlement(
          processResult.paymentPayload,
          processResult.paymentRequirements,
          processResult.declaredExtensions,
          {
            request: {
              adapter,
              path: adapter.getPath(),
              method: adapter.getMethod(),
            },
            responseBody: Buffer.from(JSON.stringify(body)),
            responseHeaders: { "content-type": "application/json" },
          },
        );
        if (settleResult.success === false) {
          return sendX402Instructions(reply, settleResult.response);
        }
        for (const [key, value] of Object.entries(settleResult.headers || {})) {
          reply.header(key, value as any);
        }
      }
      return body;
    },
  };
}
