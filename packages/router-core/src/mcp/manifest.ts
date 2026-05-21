import {
  AGENTMAIL_BASE_PRICES_USD,
  AGENTMAIL_MARKUP_USD,
  EXA_SEARCH_PRICES,
  MANUS_RESEARCH_DEPTHS,
  PARALLEL_MARKUP_USD,
  PARALLEL_TASK_PROCESSORS,
} from "../endpoints/builders.ts";
import {
  ENDPOINT_CATEGORY_DEFINITIONS,
} from "../endpoints/categories.ts";
import { endpointRegistry } from "../endpoints/registry.ts";
import { endpointSnapshot } from "../manifest/schema.ts";

type JsonSchema = Record<string, unknown>;

type McpToolDefinition = {
  tool_name: string;
  title: string;
  description: string;
  input_kind: string;
  default_max_usd: string | null;
};

type CategoryToolDefinition = {
  tool_name: string;
  title: string;
  description: string;
  input_kind: string;
  category: string;
};

type McpEnums = {
  search_type: string[];
  manus_depth: string[];
  parallel_processor: string[];
};

export const MANUS_MCP_TOOLS = Object.freeze({
  start: "manus_research_start",
  status: "manus_research_status",
  result: "manus_research_result",
});

export const PARALLEL_TASK_MCP_TOOLS = Object.freeze({
  start: "parallel_task_start",
  status: "parallel_task_status",
  result: "parallel_task_result",
});

export const PROVIDER_LOGO_PATHS = Object.freeze({
  exa: "/exa-logomark.svg",
  browserbase: "/browserbase-logomark.svg",
  manus: "/manus-logomark.svg",
  parallel: "/parallel-logomark.svg",
  agentmail: "/agentmail-logomark.svg",
});

export const MCP_TOOL_DEFINITIONS: Record<string, McpToolDefinition> = Object.freeze({
  "exa.search": Object.freeze({
    tool_name: "exa_search",
    title: "Exa search",
    description: "Run Exa search through ToolRouter with AgentKit first and x402 fallback.",
    input_kind: "search",
    default_max_usd: "0.01",
  }),
  "browserbase.session": Object.freeze({
    tool_name: "browserbase_session_create",
    title: "Browserbase session",
    description: "Create a paid Browserbase browser session through ToolRouter.",
    input_kind: "browser",
    default_max_usd: "0.02",
  }),
  "manus.research": Object.freeze({
    tool_name: MANUS_MCP_TOOLS.start,
    title: "Start Manus research",
    description:
      "Use this when the user asks for deep research, multi-source investigation, visual lookup, vendor research, or docs investigation. This starts one async Manus task through endpoint id manus.research and returns a task handle, not the final answer. Do not call start again for the same query; call the MCP tools manus_research_status or manus_research_result with the returned task_id unless the user explicitly asks for a new task.",
    input_kind: "research",
    default_max_usd: null,
  }),
  "parallel.search": Object.freeze({
    tool_name: "parallel_search",
    title: "Parallel search",
    description: "Run a keyword-driven web search through ToolRouter's x402 Parallel wrapper.",
    input_kind: "parallel_search",
    default_max_usd: "0.02",
  }),
  "parallel.extract": Object.freeze({
    tool_name: "parallel_extract",
    title: "Parallel extract",
    description: "Extract structured content and excerpts from one or more URLs through ToolRouter's x402 Parallel wrapper.",
    input_kind: "parallel_extract",
    default_max_usd: null,
  }),
  "parallel.task": Object.freeze({
    tool_name: PARALLEL_TASK_MCP_TOOLS.start,
    title: "Start Parallel task",
    description:
      "Use this when the user asks for deep, structured research with citations. This starts one async Parallel task through endpoint id parallel.task and returns a run handle, not the final answer. Do not call start again for the same query; call the MCP tools parallel_task_status or parallel_task_result with the returned task_id unless the user explicitly asks for a new task.",
    input_kind: "parallel_task",
    default_max_usd: null,
  }),
  "agentmail.create_inbox": Object.freeze({
    tool_name: "agentmail_create_inbox",
    title: "AgentMail create inbox",
    description:
      "Create an AgentMail inbox through ToolRouter's server-side x402 AgentMail wrapper. This is a paid endpoint; use client_id for idempotent retries.",
    input_kind: "agentmail_create_inbox",
    default_max_usd: "2.01",
  }),
  "agentmail.list_messages": Object.freeze({
    tool_name: "agentmail_list_messages",
    title: "AgentMail list messages",
    description: "List messages in an AgentMail inbox through ToolRouter; do not call AgentMail's x402 upstream directly.",
    input_kind: "agentmail_list_messages",
    default_max_usd: "0",
  }),
  "agentmail.get_message": Object.freeze({
    tool_name: "agentmail_get_message",
    title: "AgentMail get message",
    description: "Fetch a specific AgentMail message through ToolRouter; do not call AgentMail's x402 upstream directly.",
    input_kind: "agentmail_get_message",
    default_max_usd: "0",
  }),
  "agentmail.send_message": Object.freeze({
    tool_name: "agentmail_send_message",
    title: "AgentMail send message",
    description: "Send an email from an AgentMail inbox through ToolRouter's server-side x402 AgentMail wrapper.",
    input_kind: "agentmail_send_message",
    default_max_usd: "0.02",
  }),
  "agentmail.reply_to_message": Object.freeze({
    tool_name: "agentmail_reply_to_message",
    title: "AgentMail reply to message",
    description: "Reply to an AgentMail message through ToolRouter's server-side x402 AgentMail wrapper.",
    input_kind: "agentmail_reply_to_message",
    default_max_usd: "0.02",
  }),
});

export const CATEGORY_TOOL_DEFINITIONS: readonly CategoryToolDefinition[] = Object.freeze([
  {
    tool_name: "toolrouter_search",
    title: "Search",
    description: "Run a search through ToolRouter's recommended search endpoint.",
    input_kind: "search",
    category: "search",
  },
  {
    tool_name: "toolrouter_send_email",
    title: "Send email",
    description: "Send an email through ToolRouter's recommended email endpoint.",
    input_kind: "agentmail_send_message",
    category: "email",
  },
  {
    tool_name: "toolrouter_browser_use",
    title: "Browser use",
    description: "Start a browser session through ToolRouter's recommended browser-use endpoint.",
    input_kind: "browser",
    category: "browser_usage",
  },
]);

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

function jsonSchema(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function jsonSchemaAnyOf(properties: Record<string, unknown>, requiredAlternatives: string[][]): JsonSchema {
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

function inputPropertiesForKind(kind: string, enums: McpEnums) {
  if (kind === "search") {
    return {
      properties: {
        query: { type: "string" },
        search_type: { type: "string", enum: [...enums.search_type] },
        num_results: { type: "integer", minimum: 1, maximum: 10 },
        include_summary: { type: "boolean" },
        ...PAYMENT_PROPERTIES,
      },
      required: ["query"],
      requiredAlternatives: undefined,
    };
  }
  if (kind === "browser") {
    return {
      properties: {
        estimated_minutes: { type: "integer", minimum: 5, maximum: 120 },
        ...PAYMENT_PROPERTIES,
      },
      required: [],
      requiredAlternatives: undefined,
    };
  }
  if (kind === "research") {
    return {
      properties: {
        query: { type: "string" },
        prompt: { type: "string", description: "Alias for query." },
        task_type: { type: "string" },
        depth: { type: "string", enum: [...enums.manus_depth] },
        urls: { type: "array", items: { type: "string" }, maxItems: 10 },
        images: { type: "array", items: { type: "string" }, maxItems: 5 },
        force_new: {
          type: "boolean",
          description: "Set true only when the user explicitly wants a fresh Manus task for the same query.",
        },
        ...PAYMENT_PROPERTIES,
      },
      required: [],
      requiredAlternatives: [["query"], ["prompt"]],
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
      required: ["search_queries"],
      requiredAlternatives: undefined,
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
      required: ["urls"],
      requiredAlternatives: undefined,
    };
  }
  if (kind === "parallel_task") {
    return {
      properties: {
        input: {
          oneOf: [{ type: "string" }, { type: "object" }],
          description: "Task input -- string or structured object.",
        },
        query: { type: "string", description: "Alias for input (string form)." },
        prompt: { type: "string", description: "Alias for input (string form)." },
        processor: {
          type: "string",
          enum: [...enums.parallel_processor],
          description: "Processor tier. Default 'ultra'.",
        },
        force_new: {
          type: "boolean",
          description: "Set true only when the user explicitly wants a fresh Parallel task for the same input.",
        },
        ...PAYMENT_PROPERTIES,
      },
      required: [],
      requiredAlternatives: [["input"], ["query"], ["prompt"]],
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
      required: [],
      requiredAlternatives: undefined,
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
        includeSpam: { type: "boolean", description: "Compatibility alias for include_spam." },
        include_blocked: { type: "boolean" },
        includeBlocked: { type: "boolean", description: "Compatibility alias for include_blocked." },
        include_unauthenticated: { type: "boolean" },
        includeUnauthenticated: {
          type: "boolean",
          description: "Compatibility alias for include_unauthenticated.",
        },
        include_trash: { type: "boolean" },
        includeTrash: { type: "boolean", description: "Compatibility alias for include_trash." },
        ...PAYMENT_PROPERTIES,
      },
      required: [],
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
      required: [],
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
      required: [],
      requiredAlternatives: requiredCombinations(
        ["inbox_id", "inboxId"],
        ["to"],
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
        replyAll: { type: "boolean", description: "Compatibility alias for reply_all." },
        text: { type: "string" },
        html: { type: "string" },
        labels: { type: "array", items: { type: "string" }, maxItems: 20 },
        attachments: { type: "array", items: { type: "object" }, maxItems: 10 },
        headers: { type: "object", additionalProperties: { type: "string" } },
        ...PAYMENT_PROPERTIES,
      },
      required: [],
      requiredAlternatives: requiredCombinations(
        ["inbox_id", "inboxId"],
        ["message_id", "messageId"],
        ["text", "html"],
      ),
    };
  }
  throw new Error(`unknown MCP input_kind: ${kind}`);
}

export function inputSchemaForKind(kind: string, enums: McpEnums): JsonSchema {
  const spec = inputPropertiesForKind(kind, enums);
  return spec.requiredAlternatives
    ? jsonSchemaAnyOf(spec.properties, spec.requiredAlternatives)
    : jsonSchema(spec.properties, spec.required);
}

export function mcpEnums(): McpEnums {
  return {
    search_type: Object.keys(EXA_SEARCH_PRICES),
    manus_depth: Object.keys(MANUS_RESEARCH_DEPTHS),
    parallel_processor: Object.keys(PARALLEL_TASK_PROCESSORS),
  };
}

export function mcpToolNameForEndpoint(endpointId: string) {
  return MCP_TOOL_DEFINITIONS[endpointId]?.tool_name || null;
}

export function mcpCategoryToolName(categoryId: string) {
  return CATEGORY_TOOL_DEFINITIONS.find((tool) => tool.category === categoryId)?.tool_name || null;
}

export function mcpToolsForEndpointId(endpointId: string) {
  const call = mcpToolNameForEndpoint(endpointId);
  if (!call) return null;
  if (endpointId === "manus.research") return MANUS_MCP_TOOLS;
  if (endpointId === "parallel.task") return PARALLEL_TASK_MCP_TOOLS;
  const endpoint = endpointRegistry.find((candidate) => candidate.id === endpointId);
  const category = endpoint
    ? ENDPOINT_CATEGORY_DEFINITIONS.find((candidate) => candidate.id === endpoint.category)
    : null;
  const categoryTool =
    endpoint && category?.recommended_endpoint_id === endpoint.id
      ? mcpCategoryToolName(endpoint.category)
      : null;
  return {
    call,
    ...(categoryTool ? { category: categoryTool } : {}),
  };
}

export function buildMcpManifest() {
  const snapshots = endpointRegistry.map((endpoint) => endpointSnapshot(endpoint));
  const enums = mcpEnums();

  const wiredIds = new Set(Object.keys(MCP_TOOL_DEFINITIONS));
  for (const snapshot of snapshots) {
    if (!wiredIds.has(snapshot.id)) {
      throw new Error(
        `buildMcpManifest: endpoint ${snapshot.id} has no MCP tool wiring. ` +
          "Add an entry to MCP_TOOL_DEFINITIONS or remove it from the registry.",
      );
    }
  }
  for (const id of wiredIds) {
    if (!snapshots.some((snapshot) => snapshot.id === id)) {
      throw new Error(
        `buildMcpManifest: MCP wiring references unknown endpoint ${id}. ` +
          "Remove its entry from MCP_TOOL_DEFINITIONS.",
      );
    }
  }

  const endpoints = snapshots.map((snapshot) => {
    const mcp = MCP_TOOL_DEFINITIONS[snapshot.id];
    return {
      ...snapshot,
      provider_logo_path: PROVIDER_LOGO_PATHS[snapshot.provider as keyof typeof PROVIDER_LOGO_PATHS] || null,
      mcp: {
        tool_name: mcp.tool_name,
        title: mcp.title,
        description: mcp.description,
        input_kind: mcp.input_kind,
        default_max_usd: mcp.default_max_usd,
        input_schema: inputSchemaForKind(mcp.input_kind, enums),
      },
    };
  });

  return {
    schema_version: 2,
    endpoints,
    category_tools: CATEGORY_TOOL_DEFINITIONS.map((tool) => ({
      ...tool,
      input_schema: inputSchemaForKind(tool.input_kind, enums),
      recommended_endpoint_id:
        ENDPOINT_CATEGORY_DEFINITIONS.find((category) => category.id === tool.category)?.recommended_endpoint_id ||
        null,
    })),
    enums,
    manus_pricing: {
      default_usd_by_depth: { ...MANUS_RESEARCH_DEPTHS },
      env_var_template: "TOOLROUTER_MANUS_RESEARCH_PRICE_<DEPTH>_USD",
    },
    parallel_pricing: {
      default_usd_by_processor: { ...PARALLEL_TASK_PROCESSORS },
      markup_usd: PARALLEL_MARKUP_USD,
      env_var_template: "TOOLROUTER_PARALLEL_TASK_PRICE_<PROCESSOR>_USD",
    },
    agentmail_pricing: {
      default_usd_by_operation: { ...AGENTMAIL_BASE_PRICES_USD },
      markup_usd: AGENTMAIL_MARKUP_USD,
    },
  };
}
