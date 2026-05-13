#!/usr/bin/env node

import { randomBytes, webcrypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { encodeAction, generateSignal } from "@worldcoin/idkit-core/hashing";

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = Object.freeze({ name: "toolrouter-mcp", version: "0.1.1" });
const CANONICAL_API_BASE = "https://toolrouter.world";
const DEFAULT_WORLD_BRIDGE_URL = "https://bridge.worldcoin.org";
const API_BASE_ALIASES = new Map([
  ["https://api.toolrouter.com", CANONICAL_API_BASE],
]);

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: any;
};

type McpRuntime = {
  apiKey?: string;
  supabaseAccessToken?: string;
  configPersistence?: any;
  worldVerification?: WorldVerificationRuntime;
};

type WorldVerificationRuntime = {
  bridgeUrl: string;
  connectorURI: string;
  key: any;
  registration: any;
  requestId: string;
};

function envValue(env: any, names: string[]) {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return "";
}

function normalizeApiBase(value: string) {
  const raw = String(value || CANONICAL_API_BASE).trim();
  const withoutTrailingSlash = raw.replace(/\/+$/u, "");
  return API_BASE_ALIASES.get(withoutTrailingSlash) || withoutTrailingSlash;
}

function apiConfig(env: any, runtime?: McpRuntime) {
  return {
    apiBase: normalizeApiBase(envValue(env, ["TOOLROUTER_API_URL", "NEXT_PUBLIC_TOOLROUTER_API_URL"])),
    apiKey: envValue(env, ["TOOLROUTER_API_KEY", "AGENTKIT_ROUTER_API_KEY", "AGENTKIT_ROUTER_DEV_API_KEY"]) || runtime?.apiKey || "",
  };
}

function boolEnv(value: unknown) {
  return value === true || value === "true" || value === "1";
}

function base64Encode(value: ArrayBuffer | Uint8Array) {
  return Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString("base64");
}

function base64Decode(value: string) {
  return Buffer.from(value, "base64");
}

async function generateBridgeKey() {
  return {
    iv: randomBytes(12),
    key: await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]),
  };
}

async function exportBridgeKey(key: any) {
  return base64Encode(await webcrypto.subtle.exportKey("raw", key));
}

async function encryptBridgeRequest(key: any, iv: Uint8Array, request: string) {
  const encoded = new TextEncoder().encode(request);
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: iv as any }, key, encoded);
  return {
    iv: base64Encode(iv),
    payload: base64Encode(encrypted),
  };
}

async function decryptBridgeResponse(key: any, iv: string, payload: string) {
  const decrypted = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(iv) as any },
    key,
    base64Decode(payload),
  );
  return new TextDecoder().decode(decrypted);
}

function credentialTypesFor(verificationLevel = "orb") {
  if (verificationLevel === "device") return ["orb", "device"];
  if (verificationLevel === "document") return ["document", "secure_document", "orb"];
  if (verificationLevel === "secure_document") return ["secure_document", "orb"];
  return ["orb"];
}

function expandHomePath(value: unknown, env: any) {
  const path = String(value || "").trim();
  if (path === "~") return String(env.HOME || path);
  if (path.startsWith("~/") && env.HOME) return `${env.HOME}${path.slice(1)}`;
  return path;
}

function persistConfigPath(env: any) {
  if (!boolEnv(env.TOOLROUTER_MCP_PERSIST_API_KEY)) return "";
  return expandHomePath(env.TOOLROUTER_MCP_CONFIG_PATH, env);
}

function jsonFile(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonFile(path: string, value: any) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mcpConfigProjectKey(config: any, env: any) {
  const configured = String(env.TOOLROUTER_MCP_CONFIG_PROJECT || "").trim();
  if (configured) return configured;
  const projects = config?.projects || {};
  const serverName = String(env.TOOLROUTER_MCP_SERVER_NAME || "toolrouter");
  return Object.keys(projects).find((project) => projects[project]?.mcpServers?.[serverName]) || "";
}

function persistApiKeyToMcpConfig(apiKey: string, env: any) {
  const path = persistConfigPath(env);
  if (!path) {
    return {
      persisted: false,
      reason: boolEnv(env.TOOLROUTER_MCP_PERSIST_API_KEY) ? "config_path_required" : "persistence_disabled",
    };
  }
  if (!existsSync(path)) return { persisted: false, reason: "config_not_found", path };

  const config = jsonFile(path);
  const project = mcpConfigProjectKey(config, env);
  const serverName = String(env.TOOLROUTER_MCP_SERVER_NAME || "toolrouter");
  const server = project ? config?.projects?.[project]?.mcpServers?.[serverName] : null;
  if (!server) {
    return { persisted: false, reason: "server_not_found", path, project, server: serverName };
  }

  server.env ||= {};
  server.env.TOOLROUTER_API_KEY = apiKey;
  writeJsonFile(path, config);
  return { persisted: true, path, project, server: serverName };
}

function jsonSchema(properties: Record<string, any>, required: string[] = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function onboardingNextSteps(extra: any = {}) {
  return {
    api_key_ready: Boolean(extra.api_key_ready),
    world_verification_required: false,
    world_verification: {
      required: false,
      use_when: "Only start World verification if the user wants AgentKit benefits such as free trials, discounts, or access unlocks.",
      tools: [
        "toolrouter_start_world_verification",
        "toolrouter_poll_world_verification",
        "toolrouter_check_world_verification",
      ],
    },
    suggested_order: [
      "Use the API key immediately to list categories and discover tools.",
      "Create Stripe checkout/top-up if the user wants paid non-AgentKit usage.",
      "Offer World verification as an optional AgentKit upgrade, not as a blocker.",
    ],
    ...extra,
  };
}

export function tools(): McpTool[] {
  return [
    {
      name: "toolrouter_start_onboarding",
      title: "Start ToolRouter onboarding",
      description: "Create a ToolRouter onboarding session and return onboarding_session.auth_url plus claim_token. Agents must show or open the returned auth_url; do not tell the user to check email unless auth_url is missing. World verification is optional and not required for API key creation, discovery, checkout, or non-AgentKit usage. This bootstrap tool does not require TOOLROUTER_API_KEY.",
      inputSchema: jsonSchema({
        email: { type: "string", description: "Email address for the Supabase authentication link. In local dev the API returns a dev auth_url directly instead of sending email." },
        client: { type: "string", description: "Agent/client name, such as codex, claude-code, cursor, or hermes." },
        redirect_to: { type: "string", description: "Optional URL Supabase should redirect to after authentication." },
      }, ["email"]),
    },
    {
      name: "toolrouter_get_onboarding_session",
      title: "Get onboarding session",
      description: "Poll a ToolRouter onboarding session with its claim token. This bootstrap tool does not require TOOLROUTER_API_KEY.",
      inputSchema: jsonSchema({
        onboarding_session_id: { type: "string", description: "Onboarding session id returned by toolrouter_start_onboarding." },
        claim_token: { type: "string", description: "Claim token returned by toolrouter_start_onboarding." },
      }, ["onboarding_session_id", "claim_token"]),
    },
    {
      name: "toolrouter_attach_onboarding_user",
      title: "Attach authenticated user",
      description: "Attach the authenticated Supabase user to an onboarding session and mint a ToolRouter API key. In local dev, pass dev_supabase_session as the Supabase token.",
      inputSchema: jsonSchema({
        onboarding_session_id: { type: "string", description: "Onboarding session id returned by toolrouter_start_onboarding." },
        claim_token: { type: "string", description: "Claim token returned by toolrouter_start_onboarding." },
        supabase_access_token: { type: "string", description: "Supabase access token from the completed auth flow. Use dev_supabase_session only for local dev." },
        caller_id: { type: "string", description: "Optional caller id for the API key record, such as codex-local-cli." },
      }, ["onboarding_session_id", "claim_token", "supabase_access_token"]),
    },
    {
      name: "toolrouter_create_onboarding_checkout",
      title: "Create onboarding checkout",
      description: "Create a Stripe credit top-up Checkout Session for an authenticated onboarding session. This works without World verification for non-AgentKit paid usage. This bootstrap tool uses the claim token, not TOOLROUTER_API_KEY.",
      inputSchema: jsonSchema({
        onboarding_session_id: { type: "string", description: "Onboarding session id returned by toolrouter_start_onboarding." },
        claim_token: { type: "string", description: "Claim token returned by toolrouter_start_onboarding." },
        amount_usd: { type: "string", description: "Top-up amount in USD, for example 5." },
      }, ["onboarding_session_id", "claim_token", "amount_usd"]),
    },
    {
      name: "toolrouter_start_world_verification",
      title: "Start optional World verification",
      description: "Optional upgrade only: prepare AgentKit account registration, create a World App verification link through World Bridge, and keep the Supabase session in memory for completion. Do not block onboarding, discovery, checkout, or non-AgentKit endpoint usage on this tool.",
      inputSchema: jsonSchema({
        supabase_access_token: { type: "string", description: "Optional Supabase access token. If omitted, the token from toolrouter_attach_onboarding_user is used." },
        bridge_url: { type: "string", description: "Optional World Bridge URL override for tests or staging." },
      }),
    },
    {
      name: "toolrouter_poll_world_verification",
      title: "Poll optional World verification",
      description: "Poll World Bridge for the user's World App approval. When the proof is ready, submit it to ToolRouter and complete optional AgentKit verification.",
      inputSchema: jsonSchema({
        supabase_access_token: { type: "string", description: "Optional Supabase access token. If omitted, the token from toolrouter_attach_onboarding_user is used." },
      }),
    },
    {
      name: "toolrouter_complete_world_verification",
      title: "Complete optional World verification",
      description: "Complete optional AgentKit registration with a World ID result object if the agent already has one from another World Bridge client.",
      inputSchema: jsonSchema({
        supabase_access_token: { type: "string", description: "Optional Supabase access token. If omitted, the token from toolrouter_attach_onboarding_user is used." },
        nonce: { type: "string", description: "Registration nonce returned by toolrouter_start_world_verification. Omit if this MCP session started verification." },
        result: { type: "object", description: "World ID result object returned by World Bridge." },
        merkle_root: { type: "string", description: "World ID merkle root, for clients that pass flat fields instead of result." },
        nullifier_hash: { type: "string", description: "World ID nullifier hash, for clients that pass flat fields instead of result." },
        proof: { type: "string", description: "World ID proof, for clients that pass flat fields instead of result." },
      }),
    },
    {
      name: "toolrouter_check_world_verification",
      title: "Check optional World verification",
      description: "Check whether the authenticated ToolRouter account's AgentKit wallet is registered to a verified World ID human. Non-AgentKit usage can continue when this is false.",
      inputSchema: jsonSchema({
        supabase_access_token: { type: "string", description: "Optional Supabase access token. If omitted, the token from toolrouter_attach_onboarding_user is used." },
      }),
    },
    {
      name: "toolrouter_list_endpoints",
      title: "List ToolRouter endpoints",
      description: "List verified ToolRouter endpoints available to this API key.",
      inputSchema: jsonSchema({
        category: { type: "string", description: "Optional endpoint category filter, such as search or browser_usage." },
      }),
    },
    {
      name: "toolrouter_list_categories",
      title: "List ToolRouter categories",
      description: "List generic tool categories, recommended endpoints, and available provider tools.",
      inputSchema: jsonSchema({
        include_empty: { type: "boolean", description: "Include categories that do not have a listed endpoint yet." },
      }),
    },
    {
      name: "toolrouter_recommend_endpoint",
      title: "Recommend endpoint",
      description: "Pick the recommended concrete endpoint for a generic category such as search or browser_usage.",
      inputSchema: jsonSchema({
        category: { type: "string", description: "Tool category, such as search, data, or browser_usage." },
      }, ["category"]),
    },
    {
      name: "toolrouter_call_endpoint",
      title: "Call ToolRouter endpoint",
      description: "Call any named ToolRouter endpoint through POST /v1/requests.",
      inputSchema: jsonSchema({
        endpoint_id: { type: "string", description: "Endpoint id, such as exa.search or browserbase.session." },
        input: { type: "object", description: "Endpoint-specific input object." },
        maxUsd: { type: "string", description: "Optional caller spend cap in USD decimal form." },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"], description: "Optional execution path override for explicit smoke tests." },
      }, ["endpoint_id", "input"]),
    },
    {
      name: "toolrouter_search",
      title: "Search",
      description: "Run a search through ToolRouter's recommended search endpoint. Launch recommendation: exa.search.",
      inputSchema: jsonSchema({
        query: { type: "string" },
        search_type: { type: "string", enum: ["fast", "auto", "instant", "deep-lite", "deep", "deep-reasoning", "deep-max"] },
        num_results: { type: "integer", minimum: 1, maximum: 10 },
        include_summary: { type: "boolean" },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }, ["query"]),
    },
    {
      name: "toolrouter_browser_use",
      title: "Browser use",
      description: "Start a browser session through ToolRouter's recommended browser-use endpoint.",
      inputSchema: jsonSchema({
        estimated_minutes: { type: "integer", minimum: 5, maximum: 120 },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }),
    },
    {
      name: "toolrouter_get_request",
      title: "Get ToolRouter request",
      description: "Fetch one request trace created by this API key.",
      inputSchema: jsonSchema({
        id: { type: "string", description: "ToolRouter request id." },
      }, ["id"]),
    },
    {
      name: "exa_search",
      title: "Exa search",
      description: "Run Exa search through ToolRouter with AgentKit first and x402 fallback.",
      inputSchema: jsonSchema({
        query: { type: "string" },
        search_type: { type: "string", enum: ["fast", "auto", "instant", "deep-lite", "deep", "deep-reasoning", "deep-max"] },
        num_results: { type: "integer", minimum: 1, maximum: 10 },
        include_summary: { type: "boolean" },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }, ["query"]),
    },
    {
      name: "browserbase_session_create",
      title: "Browserbase session",
      description: "Create a paid Browserbase browser session through ToolRouter.",
      inputSchema: jsonSchema({
        estimated_minutes: { type: "integer", minimum: 5, maximum: 120 },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }),
    },
  ];
}

function textResult(text: string, structuredContent?: any, isError = false) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError,
  };
}

function endpointPayload(name: string, args: any) {
  const paymentMode = args.payment_mode || args.paymentMode;
  if (name === "toolrouter_search" || name === "exa_search") {
    return {
      endpoint_id: "exa.search",
      input: {
        query: args.query,
        search_type: args.search_type || "fast",
        num_results: args.num_results || 5,
        include_summary: Boolean(args.include_summary),
      },
      maxUsd: args.maxUsd || "0.01",
      ...(paymentMode ? { payment_mode: paymentMode } : {}),
    };
  }
  if (name === "toolrouter_browser_use" || name === "browserbase_session_create") {
    const minutes = args.estimated_minutes || args.estimatedMinutes || 5;
    return {
      endpoint_id: "browserbase.session",
      input: { estimated_minutes: minutes },
      maxUsd: args.maxUsd || "0.02",
      ...(paymentMode ? { payment_mode: paymentMode } : {}),
    };
  }
  return null;
}

async function routerFetch(path: string, { env, fetchImpl, runtime, method = "GET", body }: any) {
  const { apiBase, apiKey } = apiConfig(env, runtime);
  if (!apiKey) {
    throw new Error("TOOLROUTER_API_KEY is required for MCP tool calls. Run toolrouter_attach_onboarding_user first or restart MCP with TOOLROUTER_API_KEY set.");
  }
  const response = await fetchImpl(`${apiBase.replace(/\/$/u, "")}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `ToolRouter request failed with ${response.status}`);
  }
  return data;
}

async function bootstrapFetch(path: string, { env, fetchImpl, method = "GET", body, bearer }: any) {
  const { apiBase } = apiConfig(env);
  const response = await fetchImpl(`${apiBase.replace(/\/$/u, "")}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error?.message || `ToolRouter bootstrap request failed with ${response.status}`);
  }
  return data;
}

function onboardingSessionId(args: any) {
  return args.onboarding_session_id || args.onboardingSessionId || args.session_id || args.sessionId;
}

function supabaseAccessToken(args: any, env: any, runtime?: McpRuntime | null) {
  return String(
    args.supabase_access_token ||
    args.supabaseAccessToken ||
    args.supabase_session_token ||
    args.supabaseSessionToken ||
    env.TOOLROUTER_SUPABASE_ACCESS_TOKEN ||
    runtime?.supabaseAccessToken ||
    "",
  ).trim();
}

function requiredArg(value: any, name: string) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

async function createWorldVerificationBridge(registration: any, { bridgeUrl, fetchImpl }: any) {
  const resolvedBridgeUrl = String(bridgeUrl || DEFAULT_WORLD_BRIDGE_URL).replace(/\/+$/u, "");
  const { iv, key } = await generateBridgeKey();
  const verificationLevel = registration.verification_level || "orb";
  const encrypted = await encryptBridgeRequest(
    key,
    iv,
    JSON.stringify({
      app_id: registration.app_id,
      action_description: registration.action_description,
      action: encodeAction(registration.action),
      signal: generateSignal(registration.signal).digest,
      credential_types: credentialTypesFor(verificationLevel),
      verification_level: verificationLevel,
    }),
  );
  const response = await fetchImpl(`${resolvedBridgeUrl}/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(encrypted),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok || !data?.request_id) {
    throw new Error(data?.message || data?.error || `World Bridge request failed with ${response.status}`);
  }
  const exportedKey = await exportBridgeKey(key);
  const connectorURI =
    `https://world.org/verify?t=wld&i=${encodeURIComponent(data.request_id)}&k=${encodeURIComponent(exportedKey)}` +
    (resolvedBridgeUrl === DEFAULT_WORLD_BRIDGE_URL ? "" : `&b=${encodeURIComponent(resolvedBridgeUrl)}`);
  return {
    bridgeUrl: resolvedBridgeUrl,
    connectorURI,
    key,
    registration,
    requestId: data.request_id,
  };
}

async function pollWorldVerificationBridge(session: WorldVerificationRuntime, fetchImpl: any) {
  const response = await fetchImpl(`${session.bridgeUrl}/response/${encodeURIComponent(session.requestId)}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `World Bridge poll failed with ${response.status}`);
  }
  if (data?.status !== "completed") {
    return {
      status: data?.status || "pending",
      completed: false,
    };
  }
  const responsePayload = data?.response;
  if (!responsePayload?.iv || !responsePayload?.payload) {
    throw new Error("World Bridge completed without an encrypted response payload");
  }
  const decrypted = JSON.parse(await decryptBridgeResponse(session.key, responsePayload.iv, responsePayload.payload));
  if (decrypted?.error_code) {
    throw new Error(`World App verification failed: ${decrypted.error_code}`);
  }
  return {
    status: "completed",
    completed: true,
    result: decrypted,
  };
}

function worldVerificationCompletionBody(args: any, runtime?: McpRuntime | null) {
  const nonce = String(args.nonce || runtime?.worldVerification?.registration?.nonce || "").trim();
  if (!nonce) throw new Error("nonce is required. Run toolrouter_start_world_verification first or pass nonce.");
  if (args.result && typeof args.result === "object") {
    return { nonce, result: args.result };
  }
  return {
    nonce,
    ...(args.merkle_root || args.merkleRoot || args.root ? { merkle_root: args.merkle_root || args.merkleRoot || args.root } : {}),
    ...(args.nullifier_hash || args.nullifierHash ? { nullifier_hash: args.nullifier_hash || args.nullifierHash } : {}),
    ...(args.proof ? { proof: args.proof } : {}),
  };
}

export async function callTool(name: string, args: any = {}, options: any = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const runtime = options.runtime || options.state || null;
  try {
    if (name === "toolrouter_start_onboarding") {
      const body = {
        email: requiredArg(args.email, "email"),
        ...(args.client ? { client: args.client } : {}),
        ...(args.redirect_to || args.redirectTo ? { redirect_to: args.redirect_to || args.redirectTo } : {}),
      };
      const data = await bootstrapFetch("/v1/onboarding/sessions", { env, fetchImpl, method: "POST", body });
      data.next_steps = onboardingNextSteps({
        api_key_ready: false,
        current_step: "open_auth_url",
      });
      const authUrl = data?.onboarding_session?.auth_url;
      const guidance = authUrl
        ? `Open this authentication URL, then return with the Supabase access token from the handoff page. World verification is optional later and is not required for setup:\n${authUrl}\n\n${JSON.stringify(data, null, 2)}`
        : `No auth_url was returned. If this is production Supabase email mode, ask the user to check email.\n\n${JSON.stringify(data, null, 2)}`;
      return textResult(guidance, data);
    }
    if (name === "toolrouter_get_onboarding_session") {
      const sessionId = requiredArg(onboardingSessionId(args), "onboarding_session_id");
      const claimToken = requiredArg(args.claim_token || args.claimToken, "claim_token");
      const data = await bootstrapFetch(`/v1/onboarding/sessions/${encodeURIComponent(sessionId)}`, {
        env,
        fetchImpl,
        bearer: claimToken,
      });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_attach_onboarding_user") {
      const sessionId = requiredArg(onboardingSessionId(args), "onboarding_session_id");
      const claimToken = requiredArg(args.claim_token || args.claimToken, "claim_token");
      const supabaseToken = requiredArg(
        args.supabase_access_token || args.supabaseAccessToken || args.supabase_session_token || args.supabaseSessionToken,
        "supabase_access_token",
      );
      const body = {
        claim_token: claimToken,
        ...(args.caller_id || args.callerId ? { caller_id: args.caller_id || args.callerId } : {}),
      };
      const data = await bootstrapFetch(`/v1/onboarding/sessions/${encodeURIComponent(sessionId)}/attach-user`, {
        env,
        fetchImpl,
        method: "POST",
        bearer: supabaseToken,
        body,
      });
      if (data?.api_key && runtime) {
        runtime.apiKey = data.api_key;
        runtime.supabaseAccessToken = supabaseToken;
        runtime.configPersistence = persistApiKeyToMcpConfig(data.api_key, env);
      }
      if (data?.api_key && runtime?.configPersistence) {
        data.mcp_config = runtime.configPersistence;
      }
      data.next_steps = onboardingNextSteps({
        api_key_ready: Boolean(data?.api_key || runtime?.apiKey),
        current_step: "api_key_ready",
      });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_create_onboarding_checkout") {
      const sessionId = requiredArg(onboardingSessionId(args), "onboarding_session_id");
      const claimToken = requiredArg(args.claim_token || args.claimToken, "claim_token");
      const amountUsd = requiredArg(args.amount_usd || args.amountUsd, "amount_usd");
      const data = await bootstrapFetch(`/v1/onboarding/sessions/${encodeURIComponent(sessionId)}/checkout`, {
        env,
        fetchImpl,
        method: "POST",
        bearer: claimToken,
        body: { amount_usd: amountUsd },
      });
      data.next_steps = onboardingNextSteps({
        api_key_ready: Boolean(runtime?.apiKey),
        current_step: "checkout_created",
      });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_start_world_verification") {
      const token = requiredArg(supabaseAccessToken(args, env, runtime), "supabase_access_token");
      if (runtime) runtime.supabaseAccessToken = token;
      const prepared = await bootstrapFetch("/v1/agentkit/registration", {
        env,
        fetchImpl,
        method: "POST",
        bearer: token,
        body: {},
      });
      const bridge = await createWorldVerificationBridge(prepared.registration, {
        bridgeUrl: args.bridge_url || args.bridgeUrl,
        fetchImpl,
      });
      if (runtime) runtime.worldVerification = bridge;
      const data = {
        ...prepared,
        world_bridge: {
          bridge_url: bridge.bridgeUrl,
          request_id: bridge.requestId,
          verification_url: bridge.connectorURI,
          status: "awaiting_world_app",
        },
      };
      return textResult(
        `Open or scan this World App verification URL, then poll with toolrouter_poll_world_verification:\n${bridge.connectorURI}\n\n${JSON.stringify(data, null, 2)}`,
        data,
      );
    }
    if (name === "toolrouter_poll_world_verification") {
      const token = requiredArg(supabaseAccessToken(args, env, runtime), "supabase_access_token");
      if (!runtime?.worldVerification) {
        throw new Error("No active World verification session. Run toolrouter_start_world_verification first.");
      }
      runtime.supabaseAccessToken = token;
      const polled = await pollWorldVerificationBridge(runtime.worldVerification, fetchImpl);
      if (!polled.completed) {
        const data = {
          world_bridge: {
            bridge_url: runtime.worldVerification.bridgeUrl,
            request_id: runtime.worldVerification.requestId,
            status: polled.status,
            completed: false,
          },
        };
        return textResult(JSON.stringify(data, null, 2), data);
      }
      const completed = await bootstrapFetch("/v1/agentkit/registration/complete", {
        env,
        fetchImpl,
        method: "POST",
        bearer: token,
        body: {
          nonce: runtime.worldVerification.registration.nonce,
          result: polled.result,
        },
      });
      const data = {
        ...completed,
        world_bridge: {
          bridge_url: runtime.worldVerification.bridgeUrl,
          request_id: runtime.worldVerification.requestId,
          status: "completed",
          completed: true,
        },
      };
      runtime.worldVerification = undefined;
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_complete_world_verification") {
      const token = requiredArg(supabaseAccessToken(args, env, runtime), "supabase_access_token");
      if (runtime) runtime.supabaseAccessToken = token;
      const data = await bootstrapFetch("/v1/agentkit/registration/complete", {
        env,
        fetchImpl,
        method: "POST",
        bearer: token,
        body: worldVerificationCompletionBody(args, runtime),
      });
      if (runtime) runtime.worldVerification = undefined;
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_check_world_verification") {
      const token = requiredArg(supabaseAccessToken(args, env, runtime), "supabase_access_token");
      if (runtime) runtime.supabaseAccessToken = token;
      const data = await bootstrapFetch("/v1/agentkit/account-verification", {
        env,
        fetchImpl,
        method: "POST",
        bearer: token,
        body: {},
      });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_list_endpoints") {
      const category = args.category ? `?category=${encodeURIComponent(args.category)}` : "";
      const data = await routerFetch(`/v1/endpoints${category}`, { env, fetchImpl, runtime });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_list_categories") {
      const includeEmpty = args.include_empty || args.includeEmpty ? "?include_empty=true" : "";
      const data = await routerFetch(`/v1/categories${includeEmpty}`, { env, fetchImpl, runtime });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_recommend_endpoint") {
      const data = await routerFetch("/v1/categories?include_empty=true", { env, fetchImpl, runtime });
      const category = data.categories.find((candidate: any) => candidate.id === args.category);
      if (!category) throw new Error(`unknown category: ${args.category}`);
      if (!category.recommended_endpoint) throw new Error(`category has no recommended endpoint yet: ${args.category}`);
      return textResult(JSON.stringify(category.recommended_endpoint, null, 2), {
        category: {
          id: category.id,
          name: category.name,
          description: category.description,
        },
        recommended_endpoint: category.recommended_endpoint,
      });
    }
    if (name === "toolrouter_get_request") {
      const data = await routerFetch(`/v1/requests/${encodeURIComponent(args.id)}`, { env, fetchImpl, runtime });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    const payload = name === "toolrouter_call_endpoint" ? args : endpointPayload(name, args);
    if (!payload) throw new Error(`unknown tool: ${name}`);
    const data = await routerFetch("/v1/requests", { env, fetchImpl, runtime, method: "POST", body: payload });
    return textResult(JSON.stringify(data, null, 2), data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(message, { error: message }, true);
  }
}

function response(id: JsonRpcRequest["id"], result: any) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function handleJsonRpcMessage(message: JsonRpcRequest, options: any = {}) {
  if (!message || message.jsonrpc !== "2.0") {
    return errorResponse(message?.id ?? null, -32600, "Invalid JSON-RPC request");
  }
  if (message.id === undefined || message.id === null) return null;
  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    return response(message.id, {
      protocolVersion: requestedVersion === PROTOCOL_VERSION ? requestedVersion : PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: SERVER_INFO,
      instructions: "Use ToolRouter bootstrap tools to create an account and API key, then use ToolRouter endpoint tools with TOOLROUTER_API_KEY and TOOLROUTER_API_URL set in the MCP server environment. World verification is optional: offer it only as an AgentKit-benefits upgrade, never as a blocker for discovery, checkout, or non-AgentKit endpoint usage.",
    });
  }
  if (message.method === "ping") return response(message.id, {});
  if (message.method === "tools/list") return response(message.id, { tools: tools() });
  if (message.method === "tools/call") {
    const result = await callTool(message.params?.name, message.params?.arguments || {}, options);
    return response(message.id, result);
  }
  return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
}

function encodeLineMessage(payload: any) {
  return `${JSON.stringify(payload)}\n`;
}

function encodeFramedMessage(payload: any) {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function frameHeaderEnd(buffer: Buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, length: 4 };
  }
  return { index: lf, length: 2 };
}

function startsWithFrameHeader(buffer: Buffer) {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 32)).toString("utf8");
  return /^Content-Length:/iu.test(prefix);
}

export function startStdioServer({ input = stdin, output = stdout, env = process.env, fetchImpl = fetch }: any = {}) {
  let buffer = Buffer.alloc(0);
  let mode: "frame" | "line" | null = null;
  const runtime: McpRuntime = {};

  const writePayload = (payload: any, format: "frame" | "line") => {
    if (!payload) return;
    output.write(format === "frame" ? encodeFramedMessage(payload) : encodeLineMessage(payload));
  };

  const handleBody = (body: string, format: "frame" | "line") => {
    Promise.resolve()
      .then(async () => handleJsonRpcMessage(JSON.parse(body), { env, fetchImpl, runtime }))
      .then((payload) => writePayload(payload, format))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        writePayload(errorResponse(null, -32603, message), format);
      });
  };

  const drain = () => {
    while (buffer.length) {
      if (mode === "frame" || (mode === null && startsWithFrameHeader(buffer))) {
        const headerEnd = frameHeaderEnd(buffer);
        if (!headerEnd) return;
        const header = buffer.subarray(0, headerEnd.index).toString("utf8");
        const match = header.match(/^Content-Length:\s*(\d+)\s*$/imu);
        if (!match) {
          buffer = Buffer.alloc(0);
          writePayload(errorResponse(null, -32600, "Invalid MCP frame"), "frame");
          return;
        }
        const contentLength = Number(match[1]);
        const bodyStart = headerEnd.index + headerEnd.length;
        const bodyEnd = bodyStart + contentLength;
        if (buffer.length < bodyEnd) return;
        const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
        buffer = buffer.subarray(bodyEnd);
        mode = "frame";
        if (body.trim()) handleBody(body, "frame");
        continue;
      }

      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.subarray(0, newline).toString("utf8").replace(/\r$/u, "").trim();
      buffer = buffer.subarray(newline + 1);
      mode = "line";
      if (line) handleBody(line, "line");
    }
  };

  input.on("data", (chunk: Buffer | string) => {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    buffer = Buffer.concat([buffer, next]);
    drain();
  });
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  if (!existsSync(process.argv[1])) return false;
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isCliEntrypoint()) {
  if (process.env.TOOLROUTER_MCP_LOG === "true") {
    process.stderr.write("ToolRouter MCP ready\n");
  }
  startStdioServer();
}
