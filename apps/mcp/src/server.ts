import { stdin, stdout } from "node:process";

import { listEndpoints } from "@toolrouter/router-core";

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = Object.freeze({ name: "toolrouter-mcp", version: "0.1.0" });

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

function apiConfig(env: any) {
  return {
    apiBase: envValue(env, ["TOOLROUTER_API_URL", "NEXT_PUBLIC_TOOLROUTER_API_URL"]) || "https://toolrouter.world",
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
      description: "Call any named ToolRouter endpoint through POST /v1/requests.",
      inputSchema: jsonSchema({
        endpoint_id: { type: "string", description: "Endpoint id, such as exa.search or browserbase.search." },
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
        estimated_minutes: { type: "integer", minimum: 1, maximum: 120 },
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
      name: "browserbase_search",
      title: "Browserbase search",
      description: "Run Browserbase x402 search through ToolRouter.",
      inputSchema: jsonSchema({
        query: { type: "string" },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }, ["query"]),
    },
    {
      name: "browserbase_fetch",
      title: "Browserbase fetch",
      description: "Fetch a page through Browserbase x402 via ToolRouter.",
      inputSchema: jsonSchema({
        url: { type: "string" },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }, ["url"]),
    },
    {
      name: "browserbase_session_create",
      title: "Browserbase session",
      description: "Create a paid Browserbase browser session through ToolRouter.",
      inputSchema: jsonSchema({
        estimated_minutes: { type: "integer", minimum: 1, maximum: 120 },
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
  if (name === "browserbase_search") {
    return {
      endpoint_id: "browserbase.search",
      input: { query: args.query },
      maxUsd: args.maxUsd || "0.02",
      ...(paymentMode ? { payment_mode: paymentMode } : {}),
    };
  }
  if (name === "browserbase_fetch") {
    return {
      endpoint_id: "browserbase.fetch",
      input: { url: args.url },
      maxUsd: args.maxUsd || "0.02",
      ...(paymentMode ? { payment_mode: paymentMode } : {}),
    };
  }
  if (name === "toolrouter_browser_use" || name === "browserbase_session_create") {
    const minutes = args.estimated_minutes || args.estimatedMinutes || 1;
    return {
      endpoint_id: "browserbase.session",
      input: { estimated_minutes: minutes },
      maxUsd: args.maxUsd || "0.01",
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
    const payload = name === "toolrouter_call_endpoint" ? args : endpointPayload(name, args);
    if (!payload) throw new Error(`unknown tool: ${name}`);
    const data = await routerFetch("/v1/requests", { env, fetchImpl, method: "POST", body: payload });
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

export function startStdioServer({ input = stdin, output = stdout, env = process.env, fetchImpl = fetch }: any = {}) {
  let buffer = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      Promise.resolve()
        .then(async () => handleJsonRpcMessage(JSON.parse(trimmed), { env, fetchImpl }))
        .then((payload) => {
          if (payload) output.write(`${JSON.stringify(payload)}\n`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          output.write(`${JSON.stringify(errorResponse(null, -32603, message))}\n`);
        });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const registered = listEndpoints().map((endpoint) => endpoint.id);
  if (process.env.TOOLROUTER_MCP_LOG === "true") {
    process.stderr.write(`ToolRouter MCP ready: ${registered.join(", ")}\n`);
  }
  startStdioServer();
}
