#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = Object.freeze({ name: "toolrouter-mcp", version: "0.1.2" });
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

type EndpointsManifest = {
  schema_version: number;
  endpoints: Array<{
    id: string;
    provider: string;
    category: string;
    name: string;
    description: string;
    fixture_input: Record<string, unknown>;
    mcp: {
      tool_name: string;
      title: string;
      description: string;
      input_kind: string;
      default_max_usd: string | null;
    };
  }>;
  category_tools: Array<{
    tool_name: string;
    title: string;
    description: string;
    input_kind: string;
    category: string;
  }>;
  enums: {
    search_type: string[];
    manus_depth: string[];
    parallel_processor?: string[];
  };
  manus_pricing: {
    default_usd_by_depth: Record<string, number>;
    env_var_template: string;
  };
  parallel_pricing?: {
    default_usd_by_processor: Record<string, number>;
    markup_usd: number;
    env_var_template: string;
  };
};

let cachedManifest: EndpointsManifest | null = null;

function resolveManifestPath() {
  // Walk up from this file's location to find dist/endpoints.json. The
  // published artifact ships both dist/server.js and dist/endpoints.json,
  // so the sibling lookup works the same in dev (compiled .ts) and prod.
  const here = fileURLToPath(import.meta.url);
  // dist/server.js → dist/endpoints.json
  // src/server.ts (tsx) → dist/endpoints.json (sibling of src/)
  const distSibling = join(dirname(here), "endpoints.json");
  if (existsSync(distSibling)) return distSibling;
  const distFromSrc = resolve(dirname(here), "..", "dist", "endpoints.json");
  if (existsSync(distFromSrc)) return distFromSrc;
  // Fall back to the canonical path even if missing — loader will regenerate.
  return distFromSrc;
}

function regenerateManifest(targetPath: string) {
  // Fresh-clone / pretest fallback. The codegen script lives next to dist/;
  // invoke it synchronously through a child process so the rest of the
  // module can stay sync (sync IO simplifies callers and matches the
  // file-shipped-with-the-package case for the published artifact).
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "build-endpoints.mjs");
  if (!existsSync(scriptPath)) {
    throw new Error(
      "ToolRouter MCP: dist/endpoints.json missing and the codegen script is not available. " +
        "Run `npm --workspace @worldcoin/toolrouter run build-endpoints` to regenerate.",
    );
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `ToolRouter MCP: failed to regenerate dist/endpoints.json (exit ${result.status}). ` +
        `${result.stderr || result.stdout || ""}`.trim(),
    );
  }
}

export function loadEndpointsManifest(): EndpointsManifest {
  if (cachedManifest) return cachedManifest;
  const manifestPath = resolveManifestPath();
  if (!existsSync(manifestPath)) {
    regenerateManifest(manifestPath);
  }
  const raw = readFileSync(manifestPath, "utf8");
  cachedManifest = JSON.parse(raw) as EndpointsManifest;
  return cachedManifest;
}

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
  const devAliasesAllowed = env.ROUTER_DEV_MODE === "true" || env.TOOLROUTER_MCP_DEV_ALIASES === "true";
  return {
    apiBase: normalizeApiBase(
      env.TOOLROUTER_API_URL ||
        (devAliasesAllowed ? env.NEXT_PUBLIC_TOOLROUTER_API_URL : ""),
    ),
    apiKey:
      env.TOOLROUTER_API_KEY ||
      (devAliasesAllowed
        ? envValue(env, ["AGENTKIT_ROUTER_API_KEY", "AGENTKIT_ROUTER_DEV_API_KEY"])
        : ""),
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

function requiredCombinations(...groups: string[][]) {
  return groups.reduce<string[][]>(
    (combinations, group) => combinations.flatMap((combination) => group.map((item) => [...combination, item])),
    [[]],
  );
}

const PAYMENT_PROPERTIES = Object.freeze({
  maxUsd: { type: "string", description: "Optional caller spend cap in USD decimal form." },
  max_usd: { type: "string", description: "Compatibility alias for maxUsd." },
  payment_mode: {
    type: "string",
    enum: ["agentkit_first", "x402_only"],
    description: "Optional execution path override for explicit smoke tests.",
  },
  paymentMode: {
    type: "string",
    enum: ["agentkit_first", "x402_only"],
    description: "Compatibility alias for payment_mode.",
  },
});

function inputPropertiesForKind(kind: string) {
  const manifest = loadEndpointsManifest();
  if (kind === "search") {
    return {
      properties: {
        query: { type: "string" },
        search_type: { type: "string", enum: [...manifest.enums.search_type] },
        num_results: { type: "integer", minimum: 1, maximum: 10 },
        include_summary: { type: "boolean" },
        ...PAYMENT_PROPERTIES,
      },
      required: ["query"] as string[],
      requiredAlternatives: undefined as string[][] | undefined,
    };
  }
  if (kind === "browser") {
    return {
      properties: {
        estimated_minutes: { type: "integer", minimum: 5, maximum: 120 },
        ...PAYMENT_PROPERTIES,
      },
      required: [] as string[],
      requiredAlternatives: undefined as string[][] | undefined,
    };
  }
  if (kind === "research") {
    return {
      properties: {
        query: { type: "string" },
        prompt: { type: "string", description: "Alias for query." },
        task_type: { type: "string" },
        depth: { type: "string", enum: [...manifest.enums.manus_depth] },
        urls: { type: "array", items: { type: "string" }, maxItems: 10 },
        images: { type: "array", items: { type: "string" }, maxItems: 5 },
        force_new: {
          type: "boolean",
          description: "Set true only when the user explicitly wants a fresh Manus task for the same query.",
        },
        ...PAYMENT_PROPERTIES,
      },
      required: [] as string[],
      requiredAlternatives: [["query"], ["prompt"]] as string[][],
    };
  }
  if (kind === "parallel_search") {
    return {
      properties: {
        search_queries: {
          type: "array",
          items: { type: "string", maxLength: 200 },
          minItems: 1,
          maxItems: 5,
          description: "Keyword queries (3-6 words each, max 5 queries, 200 chars each).",
        },
        objective: { type: "string", description: "Optional natural-language goal." },
        mode: { type: "string", enum: ["basic", "advanced"], description: "Default 'advanced'." },
        ...PAYMENT_PROPERTIES,
      },
      required: ["search_queries"] as string[],
      requiredAlternatives: undefined as string[][] | undefined,
    };
  }
  if (kind === "parallel_extract") {
    return {
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 20,
          description: "HTTPS URLs to extract content from.",
        },
        objective: { type: "string", description: "Optional natural-language goal." },
        search_queries: {
          type: "array",
          items: { type: "string", maxLength: 200 },
          maxItems: 5,
          description: "Optional keyword queries (max 5, 200 chars each).",
        },
        full_content: { type: "boolean", description: "Return full page content rather than excerpts." },
        ...PAYMENT_PROPERTIES,
      },
      required: ["urls"] as string[],
      requiredAlternatives: undefined as string[][] | undefined,
    };
  }
  if (kind === "parallel_task") {
    return {
      properties: {
        input: {
          oneOf: [{ type: "string" }, { type: "object" }],
          description: "Task input — string or structured object.",
        },
        query: { type: "string", description: "Alias for input (string form)." },
        prompt: { type: "string", description: "Alias for input (string form)." },
        processor: {
          type: "string",
          enum: [...(manifest.enums.parallel_processor || ["lite", "base", "core", "pro", "ultra"])],
          description: "Processor tier. Default 'ultra'.",
        },
        force_new: {
          type: "boolean",
          description: "Set true only when the user explicitly wants a fresh Parallel task for the same input.",
        },
        ...PAYMENT_PROPERTIES,
      },
      required: [] as string[],
      requiredAlternatives: [["input"], ["query"], ["prompt"]] as string[][],
    };
  }
  if (kind === "agentmail_create_inbox") {
    return {
      properties: {
        username: { type: "string", description: "Optional inbox username." },
        domain: { type: "string", description: "Optional verified domain. Defaults to agentmail.to." },
        display_name: { type: "string", description: "Display name for the inbox." },
        displayName: { type: "string", description: "Compatibility alias for display_name." },
        client_id: { type: "string", description: "Idempotency key for safe retries." },
        clientId: { type: "string", description: "Compatibility alias for client_id." },
        ...PAYMENT_PROPERTIES,
      },
      required: [] as string[],
      requiredAlternatives: undefined as string[][] | undefined,
    };
  }
  if (kind === "agentmail_list_messages") {
    return {
      properties: {
        inbox_id: { type: "string", description: "AgentMail inbox id or address." },
        inboxId: { type: "string", description: "Compatibility alias for inbox_id." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        page_token: { type: "string" },
        pageToken: { type: "string", description: "Compatibility alias for page_token." },
        labels: { type: "array", items: { type: "string" }, maxItems: 20 },
        before: { type: "string", description: "ISO timestamp upper bound." },
        after: { type: "string", description: "ISO timestamp lower bound." },
        ascending: { type: "boolean" },
        include_spam: { type: "boolean" },
        include_blocked: { type: "boolean" },
        include_unauthenticated: { type: "boolean" },
        include_trash: { type: "boolean" },
        ...PAYMENT_PROPERTIES,
      },
      required: [] as string[],
      requiredAlternatives: requiredCombinations(["inbox_id", "inboxId"]),
    };
  }
  if (kind === "agentmail_get_message") {
    return {
      properties: {
        inbox_id: { type: "string", description: "AgentMail inbox id or address." },
        inboxId: { type: "string", description: "Compatibility alias for inbox_id." },
        message_id: { type: "string", description: "AgentMail message id." },
        messageId: { type: "string", description: "Compatibility alias for message_id." },
        ...PAYMENT_PROPERTIES,
      },
      required: [] as string[],
      requiredAlternatives: requiredCombinations(["inbox_id", "inboxId"], ["message_id", "messageId"]),
    };
  }
  if (kind === "agentmail_send_message") {
    return {
      properties: {
        inbox_id: { type: "string", description: "AgentMail inbox id or address to send from." },
        inboxId: { type: "string", description: "Compatibility alias for inbox_id." },
        to: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 }] },
        cc: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 50 }] },
        bcc: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 50 }] },
        reply_to: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 50 }] },
        replyTo: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 50 }],
          description: "Compatibility alias for reply_to.",
        },
        subject: { type: "string" },
        text: { type: "string" },
        html: { type: "string" },
        labels: { type: "array", items: { type: "string" }, maxItems: 20 },
        attachments: { type: "array", items: { type: "object" }, maxItems: 10 },
        headers: { type: "object", additionalProperties: { type: "string" } },
        ...PAYMENT_PROPERTIES,
      },
      required: [] as string[],
      requiredAlternatives: requiredCombinations(
        ["inbox_id", "inboxId"],
        ["to"],
        ["subject"],
        ["text", "html"],
      ),
    };
  }
  if (kind === "agentmail_reply_to_message") {
    return {
      properties: {
        inbox_id: { type: "string", description: "AgentMail inbox id or address to reply from." },
        inboxId: { type: "string", description: "Compatibility alias for inbox_id." },
        message_id: { type: "string", description: "Message id being replied to." },
        messageId: { type: "string", description: "Compatibility alias for message_id." },
        to: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 50 }] },
        cc: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 50 }] },
        bcc: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 50 }] },
        reply_to: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 50 }] },
        replyTo: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 50 }],
          description: "Compatibility alias for reply_to.",
        },
        reply_all: { type: "boolean" },
        text: { type: "string" },
        html: { type: "string" },
        labels: { type: "array", items: { type: "string" }, maxItems: 20 },
        attachments: { type: "array", items: { type: "object" }, maxItems: 10 },
        headers: { type: "object", additionalProperties: { type: "string" } },
        ...PAYMENT_PROPERTIES,
      },
      required: [] as string[],
      requiredAlternatives: requiredCombinations(
        ["inbox_id", "inboxId"],
        ["message_id", "messageId"],
        ["text", "html"],
      ),
    };
  }
  throw new Error(`unknown MCP input_kind: ${kind}`);
}

function schemaForKind(kind: string) {
  const spec = inputPropertiesForKind(kind);
  return spec.requiredAlternatives
    ? jsonSchemaAnyOf(spec.properties, spec.requiredAlternatives)
    : jsonSchema(spec.properties, spec.required);
}

type EndpointToolSpec = {
  name: string;
  title: string;
  description: string;
  category?: string;
  endpointId?: string;
  inputKind: string;
  inputSchema: any;
};

function endpointToolSpecs(): EndpointToolSpec[] {
  const manifest = loadEndpointsManifest();
  const specs: EndpointToolSpec[] = [];
  for (const tool of manifest.category_tools) {
    specs.push({
      name: tool.tool_name,
      title: tool.title,
      description: tool.description,
      category: tool.category,
      inputKind: tool.input_kind,
      inputSchema: schemaForKind(tool.input_kind),
    });
  }
  for (const endpoint of manifest.endpoints) {
    specs.push({
      name: endpoint.mcp.tool_name,
      title: endpoint.mcp.title,
      description: endpoint.mcp.description,
      endpointId: endpoint.id,
      inputKind: endpoint.mcp.input_kind,
      inputSchema: schemaForKind(endpoint.mcp.input_kind),
    });
  }
  return specs;
}

function endpointToolByName() {
  const map = new Map<string, EndpointToolSpec>();
  for (const spec of endpointToolSpecs()) map.set(spec.name, spec);
  return map;
}

function defaultManusMaxUsd(depth: any, env: any) {
  const manifest = loadEndpointsManifest();
  const validDepths = manifest.enums.manus_depth;
  const fallbackDepth = validDepths.includes("standard") ? "standard" : validDepths[0];
  const normalized = validDepths.includes(depth) ? depth : fallbackDepth;
  const envKey = manifest.manus_pricing.env_var_template.replace("<DEPTH>", String(normalized).toUpperCase());
  const fallbackUsd = manifest.manus_pricing.default_usd_by_depth[normalized];
  const fallbackUsdStr = fallbackUsd === undefined ? "" : String(fallbackUsd);
  const raw = String(env[envKey] || fallbackUsdStr).trim();
  return /^\d+(\.\d+)?$/u.test(raw) ? raw : fallbackUsdStr;
}

function defaultParallelTaskMaxUsd(processor: any, env: any) {
  const manifest = loadEndpointsManifest();
  if (!manifest.parallel_pricing || !manifest.enums.parallel_processor) return "";
  const valid = manifest.enums.parallel_processor;
  const fallback = valid.includes("ultra") ? "ultra" : valid[0];
  const normalized = valid.includes(processor) ? processor : fallback;
  const envKey = manifest.parallel_pricing.env_var_template.replace(
    "<PROCESSOR>",
    String(normalized).toUpperCase(),
  );
  const baseFromEnv = String(env[envKey] || "").trim();
  const fallbackBase = manifest.parallel_pricing.default_usd_by_processor[normalized];
  const base = /^\d+(\.\d+)?$/u.test(baseFromEnv) ? Number(baseFromEnv) : Number(fallbackBase || 0);
  const total = base + Number(manifest.parallel_pricing.markup_usd || 0);
  return total > 0 ? total.toString() : "";
}

function defaultParallelExtractMaxUsd(args: any) {
  const urls = Array.isArray(args.urls) ? args.urls : Array.isArray(args.input?.urls) ? args.input.urls : [];
  const count = urls.length || 1;
  const total = 0.01 * count + 0.01;
  return total.toFixed(2).replace(/0$/u, "").replace(/\.$/u, "");
}

const MANUS_NEXT_MCP_TOOLS = Object.freeze({
  status: "manus_research_status",
  result: "manus_research_result",
});

const PARALLEL_NEXT_MCP_TOOLS = Object.freeze({
  status: "parallel_task_status",
  result: "parallel_task_result",
});

const GENERIC_ENDPOINT_CONTROL_FIELDS = new Set([
  "endpoint_id",
  "endpointId",
  "input",
  "maxUsd",
  "max_usd",
  "payment_mode",
  "paymentMode",
  "force_new",
  "forceNew",
]);

function topLevelEndpointInput(args: any) {
  return Object.fromEntries(
    Object.entries(args).filter(([key]) => !GENERIC_ENDPOINT_CONTROL_FIELDS.has(key)),
  );
}

function genericEndpointPayload(args: any) {
  const paymentMode = args.payment_mode ?? args.paymentMode;
  const maxUsd = args.maxUsd ?? args.max_usd;
  const forceNew = args.force_new ?? args.forceNew;
  return {
    endpoint_id: args.endpoint_id || args.endpointId,
    input: args.input !== undefined ? args.input : topLevelEndpointInput(args),
    ...(maxUsd !== undefined ? { maxUsd } : {}),
    ...(paymentMode !== undefined ? { payment_mode: paymentMode } : {}),
    ...(forceNew !== undefined ? { force_new: Boolean(forceNew) } : {}),
  };
}

export function tools(): McpTool[] {
  const manifest = loadEndpointsManifest();
  return [
    {
      name: "toolrouter_list_endpoints",
      title: "List ToolRouter endpoints",
      description: "List verified ToolRouter endpoint IDs available to this API key. Manus status/result helpers are MCP tools, not endpoint IDs; use the endpoint mcp_tools metadata or tools/list for those helper names.",
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
        depth: { type: "string", enum: [...manifest.enums.manus_depth], description: "Shortcut Manus research depth." },
        urls: { type: "array", items: { type: "string" }, maxItems: 10 },
        images: { type: "array", items: { type: "string" }, maxItems: 5 },
        search_type: { type: "string", enum: [...manifest.enums.search_type] },
        num_results: { type: "integer", minimum: 1, maximum: 10 },
        include_summary: { type: "boolean" },
        estimated_minutes: { type: "integer", minimum: 5, maximum: 120 },
        ...PAYMENT_PROPERTIES,
        force_new: { type: "boolean", description: "Set true only when calling Manus research and the user explicitly wants a fresh task." },
        forceNew: { type: "boolean", description: "Compatibility alias for force_new." },
      }, [["endpoint_id"], ["endpointId"]]),
    },
    {
      name: "toolrouter_get_request",
      title: "Get ToolRouter request",
      description: "Fetch one request trace created by this API key.",
      inputSchema: jsonSchema({
        id: { type: "string", description: "ToolRouter request id." },
      }, ["id"]),
    },
    ...endpointToolSpecs().map(({ name, title, description, inputSchema }) => {
      const tool: McpTool = { name, title, description, inputSchema };
      if (name === "manus_research_start" || name === "parallel_task_start") {
        tool.outputSchema = jsonSchema({
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
          next_mcp_tools: { type: "object" },
          next_endpoint_ids: { type: "array", items: { type: "string" } },
          next_api_routes: { type: "object" },
          next_tool_calls: { type: "object" },
          repeat_for_same_query: { type: "boolean" },
        }, ["task_created", "deduped", "task_id", "status", "poll_after_seconds", "next_tools", "next_mcp_tools", "next_endpoint_ids", "next_tool_calls", "repeat_for_same_query"]);
        tool.annotations = { readOnlyHint: false, idempotentHint: true, openWorldHint: true };
      }
      return tool;
    }),
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
      name: "parallel_task_status",
      title: "Check Parallel task status",
      description: "Use this when you have a Parallel task_id and need to check whether the async run is running, waiting, stopped, or errored. Do not call start again for the same input.",
      inputSchema: jsonSchema({
        task_id: { type: "string", description: "Parallel task id returned by parallel_task_start." },
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
      name: "parallel_task_result",
      title: "Get Parallel task result",
      description: "Use this when you have a Parallel task_id and need the final answer or latest async progress. If status is running, return the non-error progress response. Do not call start again for the same input.",
      inputSchema: jsonSchema({
        task_id: { type: "string", description: "Parallel task id returned by parallel_task_start." },
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

function agentmailPayload(data: any) {
  return data?.body?.result ?? data?.body ?? null;
}

function nestedValueFrom(data: any, keys: string[], containers = ["inbox", "message", "email", "result"]) {
  for (const key of keys) {
    const nestedValue = containers.map((container) => data?.[container]?.[key]).find((value) => value !== undefined);
    const value = data?.[key] ?? nestedValue;
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function agentmailToolResult(data: any) {
  const endpointId = data?.endpoint_id || null;
  const payload = agentmailPayload(data);
  const inboxIdKeys = endpointId === "agentmail.create_inbox" ? ["inbox_id", "inboxId", "id"] : ["inbox_id", "inboxId"];
  const messageIdKeys = ["agentmail.send_message", "agentmail.reply_to_message", "agentmail.get_message"].includes(endpointId)
    ? ["message_id", "messageId", "id"]
    : ["message_id", "messageId"];
  const structuredContent = {
    id: data?.id || null,
    endpoint_id: endpointId,
    path: data?.path || null,
    charged: data?.charged ?? null,
    status_code: data?.status_code ?? null,
    credit_reserved_usd: data?.credit_reserved_usd ?? null,
    credit_captured_usd: data?.credit_captured_usd ?? null,
    credit_released_usd: data?.credit_released_usd ?? null,
    inbox_id: nestedValueFrom(payload, inboxIdKeys, ["inbox", "email", "result"]),
    email: nestedValueFrom(payload, ["email", "email_address", "address"], ["inbox", "email", "result"]),
    message_id: nestedValueFrom(payload, messageIdKeys, ["message", "result"]),
    thread_id: nestedValueFrom(payload, ["thread_id", "threadId"], ["message", "result"]),
    body: data?.body ?? null,
  };
  const text = JSON.stringify(
    Object.fromEntries(
      Object.entries(structuredContent).filter(([, value]) => value !== null && value !== undefined),
    ),
    null,
    2,
  );
  return textResult(text, structuredContent);
}

function manusNextApiRoutes(taskId: string) {
  const encodedTaskId = encodeURIComponent(taskId);
  return {
    status: `/v1/manus/tasks/${encodedTaskId}/status`,
    result: `/v1/manus/tasks/${encodedTaskId}/result`,
  };
}

function manusNextToolCalls(taskId: string, nextMcpTools: any, nextApiRoutes: any) {
  return {
    status: {
      type: "mcp_tool",
      tool_name: nextMcpTools.status,
      arguments: { task_id: taskId },
      api_route: nextApiRoutes.status,
      note: "MCP tool name, not a ToolRouter endpoint_id.",
    },
    result: {
      type: "mcp_tool",
      tool_name: nextMcpTools.result,
      arguments: { task_id: taskId },
      api_route: nextApiRoutes.result,
      note: "MCP tool name, not a ToolRouter endpoint_id.",
    },
  };
}

function parallelNextApiRoutes(taskId: string) {
  const encoded = encodeURIComponent(taskId);
  return {
    status: `/v1/parallel/tasks/${encoded}/status`,
    result: `/v1/parallel/tasks/${encoded}/result`,
  };
}

function parallelNextToolCalls(taskId: string, nextMcpTools: any, nextApiRoutes: any) {
  return {
    status: {
      type: "mcp_tool",
      tool_name: nextMcpTools.status,
      arguments: { task_id: taskId },
      api_route: nextApiRoutes.status,
      note: "MCP tool name, not a ToolRouter endpoint_id.",
    },
    result: {
      type: "mcp_tool",
      tool_name: nextMcpTools.result,
      arguments: { task_id: taskId },
      api_route: nextApiRoutes.result,
      note: "MCP tool name, not a ToolRouter endpoint_id.",
    },
  };
}

function parallelTaskStartResult(data: any) {
  const taskId = valueFrom(data, "task_id");
  const nextMcpTools = valueFrom(data, "next_mcp_tools") || valueFrom(data, "next_tools") || PARALLEL_NEXT_MCP_TOOLS;
  const nextApiRoutes = valueFrom(data, "next_api_routes") || (taskId ? parallelNextApiRoutes(taskId) : null);
  const nextToolCalls =
    valueFrom(data, "next_tool_calls") ||
    (taskId && nextApiRoutes ? parallelNextToolCalls(taskId, nextMcpTools, nextApiRoutes) : null);
  const structuredContent = {
    id: data?.id || valueFrom(data, "request_id") || null,
    endpoint_id: data?.endpoint_id || "parallel.task",
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
    task_id: taskId,
    task_url: valueFrom(data, "task_url"),
    status: valueFrom(data, "status") || "running",
    poll_after_seconds: valueFrom(data, "poll_after_seconds") || 10,
    next_tools: nextMcpTools,
    next_mcp_tools: nextMcpTools,
    next_endpoint_ids: valueFrom(data, "next_endpoint_ids") || [],
    next_api_routes: nextApiRoutes,
    next_tool_calls: nextToolCalls,
    repeat_for_same_query: false,
  };
  const missingTask = !structuredContent.task_id;
  const text = missingTask
    ? [
        "Parallel task did not return a run handle. Do not treat this as a created task.",
        "",
        JSON.stringify(data, null, 2),
      ].join("\n")
    : [
        structuredContent.deduped ? "Existing Parallel task returned." : "Parallel task started.",
        `Task id: ${structuredContent.task_id}`,
        `Status: ${structuredContent.status}`,
        `Next MCP tools, not endpoint IDs: call ${structuredContent.next_mcp_tools.status} or ${structuredContent.next_mcp_tools.result} after ${structuredContent.poll_after_seconds} seconds.`,
        "Do not call start again for the same input unless the user explicitly asks for a new task.",
      ].join("\n");
  return textResult(text, structuredContent, missingTask);
}

function parallelTaskStatusResult(data: any) {
  const text = [
    `Parallel task ${data.task_id} is ${data.status}.`,
    data.poll_after_seconds ? `Poll again after ${data.poll_after_seconds} seconds.` : null,
  ].filter(Boolean).join("\n");
  return textResult(text, data);
}

function parallelTaskFinalResult(data: any) {
  const status = String(data?.status || "running");
  const isError = data?.isError === true || status === "error";
  let text: string;
  if (isError) {
    text = [
      `Parallel task ${data.task_id} failed.`,
      data.error ? `Error: ${data.error}` : null,
    ].filter(Boolean).join("\n");
  } else if (status === "waiting") {
    text = [
      `Parallel task ${data.task_id} is waiting.`,
      data.latest_status_message || "Ask the user for the missing input instead of starting a new task.",
    ].filter(Boolean).join("\n");
  } else if (!data.final_answer_available) {
    text = [
      `Parallel task ${data.task_id} is ${status}.`,
      data.latest_status_message || null,
      data.poll_after_seconds ? `Poll again after ${data.poll_after_seconds} seconds.` : null,
    ].filter(Boolean).join("\n");
  } else {
    text = data.answer || JSON.stringify(data, null, 2);
  }
  return textResult(text, data, isError);
}

function manusResearchStartResult(data: any) {
  const taskId = valueFrom(data, "task_id");
  const nextMcpTools = valueFrom(data, "next_mcp_tools") || valueFrom(data, "next_tools") || MANUS_NEXT_MCP_TOOLS;
  const nextApiRoutes = valueFrom(data, "next_api_routes") || (taskId ? manusNextApiRoutes(taskId) : null);
  const nextToolCalls =
    valueFrom(data, "next_tool_calls") ||
    (taskId && nextApiRoutes ? manusNextToolCalls(taskId, nextMcpTools, nextApiRoutes) : null);
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
    task_id: taskId,
    task_url: valueFrom(data, "task_url"),
    status: valueFrom(data, "status") || "running",
    poll_after_seconds: valueFrom(data, "poll_after_seconds") || 30,
    next_tools: nextMcpTools,
    next_mcp_tools: nextMcpTools,
    next_endpoint_ids: valueFrom(data, "next_endpoint_ids") || [],
    next_api_routes: nextApiRoutes,
    next_tool_calls: nextToolCalls,
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
        `Next MCP tools, not endpoint IDs: call ${structuredContent.next_mcp_tools.status} or ${structuredContent.next_mcp_tools.result} after ${structuredContent.poll_after_seconds} seconds.`,
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

async function recommendedEndpointId(categoryId: string, { env, fetchImpl }: any) {
  const data = await routerFetch("/v1/categories?include_empty=true", { env, fetchImpl });
  const category = data.categories.find((candidate: any) => candidate.id === categoryId);
  if (!category) throw new Error(`unknown category: ${categoryId}`);
  const endpointId = category.recommended_endpoint?.id || category.recommended_endpoint_id;
  if (!endpointId) throw new Error(`category has no recommended endpoint yet: ${categoryId}`);
  return endpointId;
}

function requestedManusDepth(args: any) {
  const input = args.input && typeof args.input === "object" && !Array.isArray(args.input)
    ? args.input
    : {};
  return args.depth || input.depth || "standard";
}

function requestedParallelProcessor(args: any) {
  const input = args.input && typeof args.input === "object" && !Array.isArray(args.input)
    ? args.input
    : {};
  return args.processor || input.processor || "ultra";
}

function defaultMaxUsd(endpointId: string, args: any, env: any) {
  const manifest = loadEndpointsManifest();
  if (endpointId === "manus.research") return defaultManusMaxUsd(requestedManusDepth(args), env);
  if (endpointId === "parallel.task") return defaultParallelTaskMaxUsd(requestedParallelProcessor(args), env);
  if (endpointId === "parallel.extract") return defaultParallelExtractMaxUsd(args);
  const endpoint = manifest.endpoints.find((candidate) => candidate.id === endpointId);
  if (endpoint && endpoint.mcp.default_max_usd) return endpoint.mcp.default_max_usd;
  return undefined;
}

function parallelTaskInputObject(args: any) {
  const wrapped: Record<string, any> = {};
  if (args.input !== undefined) wrapped.input = args.input;
  else if (args.query !== undefined) wrapped.query = args.query;
  else if (args.prompt !== undefined) wrapped.prompt = args.prompt;
  if (args.processor !== undefined) wrapped.processor = args.processor;
  return wrapped;
}

function endpointInputForName(name: string, args: any) {
  if (name === "parallel_task_start") return parallelTaskInputObject(args);
  return args.input !== undefined ? args.input : topLevelEndpointInput(args);
}

async function endpointPayload(name: string, args: any, { env, fetchImpl }: any) {
  const spec = endpointToolByName().get(name);
  if (!spec) return null;
  const endpointId = spec.endpointId || await recommendedEndpointId(spec.category as string, { env, fetchImpl });
  const paymentMode = args.payment_mode ?? args.paymentMode;
  const maxUsd = args.maxUsd ?? args.max_usd ?? defaultMaxUsd(endpointId, args, env);
  const forceNew = args.force_new ?? args.forceNew;
  return {
    endpoint_id: endpointId,
    input: endpointInputForName(name, args),
    ...(maxUsd !== undefined ? { maxUsd } : {}),
    ...(paymentMode !== undefined ? { payment_mode: paymentMode } : {}),
    ...((name === "manus_research_start" || name === "parallel_task_start") && forceNew !== undefined
      ? { force_new: Boolean(forceNew) }
      : {}),
  };
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
    if (name === "parallel_task_status") {
      const data = await routerFetch(`/v1/parallel/tasks/${encodeURIComponent(args.task_id)}/status`, { env, fetchImpl });
      return parallelTaskStatusResult(data);
    }
    if (name === "parallel_task_result") {
      const data = await routerFetch(`/v1/parallel/tasks/${encodeURIComponent(args.task_id)}/result`, { env, fetchImpl });
      return parallelTaskFinalResult(data);
    }
    const payload = name === "toolrouter_call_endpoint"
      ? genericEndpointPayload(args)
      : await endpointPayload(name, args, { env, fetchImpl });
    if (!payload) throw new Error(`unknown tool: ${name}`);
    const data = await routerFetch("/v1/requests", { env, fetchImpl, method: "POST", body: payload });
    if (name === "manus_research_start") {
      return manusResearchStartResult(data);
    }
    if (name === "parallel_task_start") {
      return parallelTaskStartResult(data);
    }
    if (name.startsWith("agentmail_")) {
      return agentmailToolResult(data);
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
