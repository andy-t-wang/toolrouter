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
  outputSchema?: any;
  annotations?: any;
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

function jsonSchemaAnyOf(properties: Record<string, any>, requiredAlternatives: string[][]) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    anyOf: requiredAlternatives.map((required) => ({ required })),
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

const GENERIC_ENDPOINT_CONTROL_FIELDS = new Set([
  "endpoint_id",
  "endpointId",
  "input",
  "maxUsd",
  "max_usd",
  "payment_mode",
  "paymentMode",
]);

function topLevelEndpointInput(args: any) {
  return Object.fromEntries(
    Object.entries(args).filter(([key]) => !GENERIC_ENDPOINT_CONTROL_FIELDS.has(key)),
  );
}

function genericEndpointPayload(args: any) {
  const paymentMode = args.payment_mode ?? args.paymentMode;
  const maxUsd = args.maxUsd ?? args.max_usd;
  return {
    endpoint_id: args.endpoint_id || args.endpointId,
    input: args.input !== undefined ? args.input : topLevelEndpointInput(args),
    ...(maxUsd !== undefined ? { maxUsd } : {}),
    ...(paymentMode !== undefined ? { payment_mode: paymentMode } : {}),
  };
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
      description: "Pick the recommended concrete endpoint and MCP tool for a generic category such as search, research, or browser_usage.",
      inputSchema: jsonSchema({
        category: { type: "string", description: "Tool category, such as search, research, data, or browser_usage." },
      }, ["category"]),
    },
    {
      name: "toolrouter_call_endpoint",
      title: "Call ToolRouter endpoint",
      description: "Call any named ToolRouter endpoint through POST /v1/requests. Prefer endpoint-specific input inside input; top-level endpoint fields are accepted as compatibility shortcuts. For Manus async research, prefer manus_research_start, manus_research_status, and manus_research_result instead of this generic tool.",
      inputSchema: jsonSchemaAnyOf({
        endpoint_id: { type: "string", description: "Endpoint id, such as exa.search, browserbase.session, or manus.research." },
        endpointId: { type: "string", description: "Compatibility alias for endpoint_id." },
        input: { type: "object", description: "Endpoint-specific input object." },
        query: { type: "string", description: "Shortcut input field for endpoints that take a query." },
        prompt: { type: "string", description: "Alias for query on research endpoints." },
        task_type: { type: "string", description: "Shortcut Manus research task type." },
        depth: { type: "string", enum: ["quick", "standard", "deep"], description: "Shortcut Manus research depth." },
        urls: { type: "array", items: { type: "string" }, maxItems: 10 },
        images: { type: "array", items: { type: "string" }, maxItems: 5 },
        search_type: { type: "string", enum: ["fast", "auto", "instant", "deep-lite", "deep", "deep-reasoning", "deep-max"] },
        num_results: { type: "integer", minimum: 1, maximum: 10 },
        include_summary: { type: "boolean" },
        estimated_minutes: { type: "integer", minimum: 5, maximum: 120 },
        maxUsd: { type: "string", description: "Optional caller spend cap in USD decimal form." },
        max_usd: { type: "string", description: "Compatibility alias for maxUsd." },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"], description: "Optional execution path override for explicit smoke tests." },
        paymentMode: { type: "string", enum: ["agentkit_first", "x402_only"], description: "Compatibility alias for payment_mode." },
      }, [["endpoint_id"], ["endpointId"]]),
    },
    {
      name: "toolrouter_search",
      title: "Search",
      description: "Use this when the user needs a quick synchronous web lookup through ToolRouter's recommended search endpoint. Launch recommendation: exa.search. Do not use this for deep research; use manus_research_start for long-running research tasks.",
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
      name: "manus_research_start",
      title: "Start Manus research",
      description: "Use this when the user asks for deep research, multi-source investigation, visual lookup, vendor research, or docs investigation. This starts one async Manus task through endpoint id manus.research and returns a task handle, not the final answer. Do not call start again for the same query; use manus_research_status or manus_research_result with the returned task_id unless the user explicitly asks for a new task.",
      inputSchema: jsonSchemaAnyOf({
        query: { type: "string" },
        prompt: { type: "string", description: "Alias for query." },
        task_type: { type: "string", description: "Optional category such as visual_lookup, tool_discovery, vendor_research, or docs_investigation." },
        depth: { type: "string", enum: ["quick", "standard", "deep"] },
        urls: { type: "array", items: { type: "string" }, maxItems: 10 },
        images: { type: "array", items: { type: "string" }, maxItems: 5 },
        maxUsd: { type: "string" },
        force_new: { type: "boolean", description: "Set true only when the user explicitly wants a fresh Manus task for the same query." },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }, [["query"], ["prompt"]]),
      outputSchema: jsonSchema({
        id: { type: ["string", "null"] },
        endpoint_id: { type: "string" },
        path: { type: ["string", "null"] },
        charged: { type: ["boolean", "null"] },
        status_code: { type: ["integer", "null"] },
        credit_reserved_usd: { type: ["string", "number", "null"] },
        credit_captured_usd: { type: ["string", "number", "null"] },
        credit_released_usd: { type: ["string", "number", "null"] },
        task_created: { type: "boolean" },
        deduped: { type: "boolean" },
        request_id: { type: ["string", "null"] },
        trace_id: { type: ["string", "null"] },
        task_id: { type: "string" },
        task_url: { type: ["string", "null"] },
        status: { type: "string" },
        poll_after_seconds: { type: "integer" },
        next_tools: { type: "object" },
        repeat_for_same_query: { type: "boolean" },
      }, ["task_created", "deduped", "task_id", "status", "poll_after_seconds", "next_tools", "repeat_for_same_query"]),
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    {
      name: "manus_research_status",
      title: "Check Manus research status",
      description: "Use this when you have a Manus task_id and need to check whether the async research task is running, waiting, stopped, or errored. Do not call start again for the same query.",
      inputSchema: jsonSchema({
        task_id: { type: "string", description: "Manus task id returned by manus_research_start." },
      }, ["task_id"]),
      outputSchema: jsonSchema({
        task_id: { type: "string" },
        status: { type: "string" },
        title: { type: ["string", "null"] },
        task_url: { type: ["string", "null"] },
        created_at: { type: ["string", "null"] },
        updated_at: { type: ["string", "null"] },
        last_checked_at: { type: ["string", "null"] },
        poll_after_seconds: { type: ["integer", "null"] },
      }, ["task_id", "status", "poll_after_seconds"]),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    {
      name: "manus_research_result",
      title: "Get Manus research result",
      description: "Use this when you have a Manus task_id and need the final answer or latest async progress. If status is running, return the non-error progress response; if status is waiting, ask the user for the needed input. Do not call start again for the same query.",
      inputSchema: jsonSchema({
        task_id: { type: "string", description: "Manus task id returned by manus_research_start." },
      }, ["task_id"]),
      outputSchema: jsonSchema({
        task_id: { type: "string" },
        status: { type: "string" },
        final_answer_available: { type: "boolean" },
        answer: { type: ["string", "null"] },
        attachments: { type: "array" },
        latest_status_message: { type: ["string", "null"] },
        waiting_details: {},
        error: { type: ["string", "object", "null"] },
        messages: { type: "array" },
        poll_after_seconds: { type: ["integer", "null"] },
        isError: { type: "boolean" },
      }, ["task_id", "status", "final_answer_available", "messages"]),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
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
      description: "Use this when the user needs a quick synchronous Exa lookup through ToolRouter with AgentKit first and x402 fallback. Do not use this for deep research; use manus_research_start for long-running research tasks.",
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

function valueFrom(data: any, key: string) {
  return data?.[key] ?? data?.body?.[key] ?? null;
}

function manusResearchStartResult(data: any) {
  const structuredContent = {
    id: data?.id || valueFrom(data, "request_id") || null,
    endpoint_id: data?.endpoint_id || "manus.research",
    path: data?.path || null,
    charged: data?.charged ?? null,
    status_code: data?.status_code ?? null,
    credit_reserved_usd: data?.credit_reserved_usd ?? null,
    credit_captured_usd: data?.credit_captured_usd ?? null,
    credit_released_usd: data?.credit_released_usd ?? null,
    task_created: Boolean(valueFrom(data, "task_created")),
    deduped: Boolean(valueFrom(data, "deduped")),
    request_id: valueFrom(data, "request_id") || data?.id || null,
    trace_id: valueFrom(data, "trace_id") || data?.trace_id || null,
    task_id: valueFrom(data, "task_id"),
    task_url: valueFrom(data, "task_url"),
    status: valueFrom(data, "status") || "running",
    poll_after_seconds: valueFrom(data, "poll_after_seconds") || 30,
    next_tools: valueFrom(data, "next_tools") || {
      status: "manus_research_status",
      result: "manus_research_result",
    },
    repeat_for_same_query: false,
  };
  const missingTask = !structuredContent.task_id;
  const text = missingTask
    ? [
        "Manus research did not return a task handle. Do not treat this as a created task.",
        "",
        JSON.stringify(data, null, 2),
      ].join("\n")
    : [
        structuredContent.deduped ? "Existing Manus research task returned." : "Manus research task started.",
        `Task id: ${structuredContent.task_id}`,
        `Status: ${structuredContent.status}`,
        `Next: call ${structuredContent.next_tools.status} or ${structuredContent.next_tools.result} after ${structuredContent.poll_after_seconds} seconds.`,
        "Do not call start again for the same query unless the user explicitly asks for a new task.",
      ].join("\n");
  return textResult(text, structuredContent, missingTask);
}

function manusResearchStatusResult(data: any) {
  const text = [
    `Manus task ${data.task_id} is ${data.status}.`,
    data.poll_after_seconds ? `Poll again after ${data.poll_after_seconds} seconds.` : null,
  ].filter(Boolean).join("\n");
  return textResult(text, data);
}

function manusResearchFinalResult(data: any) {
  const status = String(data?.status || "running");
  const isError = data?.isError === true || status === "error";
  let text: string;
  if (isError) {
    text = [
      `Manus task ${data.task_id} failed.`,
      data.error ? `Error: ${data.error}` : null,
    ].filter(Boolean).join("\n");
  } else if (status === "waiting") {
    text = [
      `Manus task ${data.task_id} is waiting for input.`,
      data.waiting_details || data.latest_status_message || "Ask the user for the missing input instead of starting a new task.",
    ].filter(Boolean).join("\n");
  } else if (!data.final_answer_available) {
    text = [
      `Manus task ${data.task_id} is ${status}.`,
      data.latest_status_message || null,
      data.poll_after_seconds ? `Poll again after ${data.poll_after_seconds} seconds.` : null,
    ].filter(Boolean).join("\n");
  } else {
    text = data.answer || JSON.stringify(data, null, 2);
  }
  return textResult(text, data, isError);
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
  if (name === "manus_research_start") {
    const query = args.query || args.prompt;
    return {
      endpoint_id: "manus.research",
      input: {
        query,
        task_type: args.task_type || args.taskType || "general_research",
        depth: args.depth || "standard",
        urls: args.urls || [],
        images: args.images || args.image_urls || [],
      },
      maxUsd: args.maxUsd || defaultManusMaxUsd(args.depth || "standard", env),
      ...(args.force_new !== undefined || args.forceNew !== undefined ? { force_new: Boolean(args.force_new ?? args.forceNew) } : {}),
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
      const structuredContent = {
        category: {
          id: category.id,
          name: category.name,
          description: category.description,
        },
        recommended_mcp_tool: category.recommended_mcp_tool || null,
        recommended_endpoint: category.recommended_endpoint,
      };
      return textResult(JSON.stringify(structuredContent, null, 2), structuredContent);
    }
    if (name === "toolrouter_get_request") {
      const data = await routerFetch(`/v1/requests/${encodeURIComponent(args.id)}`, { env, fetchImpl });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "manus_research_status") {
      const data = await routerFetch(`/v1/manus/tasks/${encodeURIComponent(args.task_id)}/status`, { env, fetchImpl });
      return manusResearchStatusResult(data);
    }
    if (name === "manus_research_result") {
      const data = await routerFetch(`/v1/manus/tasks/${encodeURIComponent(args.task_id)}/result`, { env, fetchImpl });
      return manusResearchFinalResult(data);
    }
    const payload = name === "toolrouter_call_endpoint" ? genericEndpointPayload(args) : endpointPayload(name, args, env);
    if (!payload) throw new Error(`unknown tool: ${name}`);
    const data = await routerFetch("/v1/requests", { env, fetchImpl, method: "POST", body: payload });
    if (name === "manus_research_start") {
      return manusResearchStartResult(data);
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
