#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = Object.freeze({ name: "toolrouter-mcp", version: "0.1.1" });
const CANONICAL_API_BASE = "https://toolrouter.world";
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

function apiConfig(env: any) {
  return {
    apiBase: normalizeApiBase(envValue(env, ["TOOLROUTER_API_URL", "NEXT_PUBLIC_TOOLROUTER_API_URL"])),
    apiKey: envValue(env, ["TOOLROUTER_API_KEY", "AGENTKIT_ROUTER_API_KEY", "AGENTKIT_ROUTER_DEV_API_KEY"]),
  };
}

function jsonSchema(properties: Record<string, any>, required: string[] = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

const MANUS_DEFAULT_MAX_USD: Record<string, string> = Object.freeze({
  quick: "0.03",
  standard: "0.05",
  deep: "0.10",
});

function defaultManusMaxUsd(depth: any, env: any) {
  const normalized = ["quick", "standard", "deep"].includes(depth) ? depth : "standard";
  const envKey = `TOOLROUTER_MANUS_RESEARCH_PRICE_${normalized.toUpperCase()}_USD`;
  const raw = String(env[envKey] || MANUS_DEFAULT_MAX_USD[normalized]).trim();
  return /^\d+(\.\d+)?$/u.test(raw) ? raw : MANUS_DEFAULT_MAX_USD[normalized];
}

export function tools(): McpTool[] {
  return [
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
      description: "Call any named ToolRouter endpoint through POST /v1/requests. For async task endpoints such as manus.research, one call creates one task; do not call again for the same user request unless the user explicitly asks to start another task.",
      inputSchema: jsonSchema({
        endpoint_id: { type: "string", description: "Endpoint id, such as exa.search, browserbase.session, or manus.research." },
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
      name: "toolrouter_research",
      title: "Research",
      description: "Create one long-running Manus research task through ToolRouter's recommended research endpoint. This returns a task handle/status, not the final research result; do not retry the same query unless the user asks to start another task.",
      inputSchema: jsonSchema({
        query: { type: "string" },
        task_type: { type: "string", description: "Optional category such as visual_lookup, tool_discovery, vendor_research, or docs_investigation." },
        depth: { type: "string", enum: ["quick", "standard", "deep"] },
        urls: { type: "array", items: { type: "string" }, maxItems: 10 },
        images: { type: "array", items: { type: "string" }, maxItems: 5 },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }, ["query"]),
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
    {
      name: "manus_research",
      title: "Manus research",
      description: "Create one long-running Manus research task through ToolRouter's x402 wrapper. This returns a task handle/status, not the final research result; do not retry the same query unless the user asks to start another task.",
      inputSchema: jsonSchema({
        query: { type: "string" },
        task_type: { type: "string" },
        depth: { type: "string", enum: ["quick", "standard", "deep"] },
        urls: { type: "array", items: { type: "string" }, maxItems: 10 },
        images: { type: "array", items: { type: "string" }, maxItems: 5 },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }, ["query"]),
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

function isManusResearchPayload(payload: any) {
  return payload?.endpoint_id === "manus.research";
}

function extractManusTaskId(data: any) {
  const candidates = [
    data?.body?.task?.id,
    data?.body?.task?.task_id,
    data?.body?.task?.taskId,
    data?.body?.id,
    data?.task?.id,
    data?.task?.task_id,
    data?.task?.taskId,
  ];
  return candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0) || null;
}

function manusResearchResult(data: any) {
  const taskId = extractManusTaskId(data);
  const hint = {
    async_task: true,
    final_answer: false,
    repeat_for_same_query: false,
    message: "Manus research task created. Do not call this ToolRouter endpoint again for the same research request unless the user explicitly asks to start another Manus task.",
    ...(taskId ? { task_id: taskId } : {}),
  };
  const structuredContent = data && typeof data === "object"
    ? { ...data, toolrouter_hint: hint }
    : { response: data, toolrouter_hint: hint };
  const text = [
    hint.message,
    taskId ? `Task id: ${taskId}` : null,
    "Return the task status/handle to the user instead of polling by creating more tasks.",
    "",
    "ToolRouter response:",
    JSON.stringify(data, null, 2),
  ].filter(Boolean).join("\n");
  return textResult(text, structuredContent);
}

function endpointPayload(name: string, args: any, env: any) {
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
  if (name === "toolrouter_research" || name === "manus_research") {
    return {
      endpoint_id: "manus.research",
      input: {
        query: args.query,
        task_type: args.task_type || args.taskType || "general_research",
        depth: args.depth || "standard",
        urls: args.urls || [],
        images: args.images || args.image_urls || [],
      },
      maxUsd: args.maxUsd || defaultManusMaxUsd(args.depth || "standard", env),
      ...(paymentMode ? { payment_mode: paymentMode } : {}),
    };
  }
  return null;
}

async function routerFetch(path: string, { env, fetchImpl, method = "GET", body }: any) {
  const { apiBase, apiKey } = apiConfig(env);
  if (!apiKey) {
    throw new Error("TOOLROUTER_API_KEY is required for MCP tool calls");
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

export async function callTool(name: string, args: any = {}, options: any = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  try {
    if (name === "toolrouter_list_endpoints") {
      const category = args.category ? `?category=${encodeURIComponent(args.category)}` : "";
      const data = await routerFetch(`/v1/endpoints${category}`, { env, fetchImpl });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_list_categories") {
      const includeEmpty = args.include_empty || args.includeEmpty ? "?include_empty=true" : "";
      const data = await routerFetch(`/v1/categories${includeEmpty}`, { env, fetchImpl });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_recommend_endpoint") {
      const data = await routerFetch("/v1/categories?include_empty=true", { env, fetchImpl });
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
      const data = await routerFetch(`/v1/requests/${encodeURIComponent(args.id)}`, { env, fetchImpl });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    const payload = name === "toolrouter_call_endpoint" ? args : endpointPayload(name, args, env);
    if (!payload) throw new Error(`unknown tool: ${name}`);
    const data = await routerFetch("/v1/requests", { env, fetchImpl, method: "POST", body: payload });
    if (isManusResearchPayload(payload)) {
      return manusResearchResult(data);
    }
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
      instructions: "Use ToolRouter tools with TOOLROUTER_API_KEY and TOOLROUTER_API_URL set in the MCP server environment.",
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

  const writePayload = (payload: any, format: "frame" | "line") => {
    if (!payload) return;
    output.write(format === "frame" ? encodeFramedMessage(payload) : encodeLineMessage(payload));
  };

  const handleBody = (body: string, format: "frame" | "line") => {
    Promise.resolve()
      .then(async () => handleJsonRpcMessage(JSON.parse(body), { env, fetchImpl }))
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
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isCliEntrypoint()) {
  if (process.env.TOOLROUTER_MCP_LOG === "true") {
    process.stderr.write("ToolRouter MCP ready\n");
  }
  startStdioServer();
}
