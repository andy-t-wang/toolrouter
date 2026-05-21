#!/usr/bin/env node
// Codegen for `dist/endpoints.json` — the snapshot the published MCP package
// reads at startup to derive the tool list, input schemas, and default
// `maxUsd` lookups from router-core's endpoint manifest.
//
// Runs at `prepack` (publish), `pretest` (CI), and as an in-process fallback
// when `dist/endpoints.json` is missing on a fresh clone. See U2 in
// `docs/plans/2026-05-19-001-refactor-modularity-and-reliability-plan.md`.
//
// Why a sibling JSON artifact: `apps/mcp` ships as a standalone npm package
// with no workspace dep on `@toolrouter/router-core`. Bundling the registry
// at build time keeps the runtime importless while preserving router-core as
// the single source of truth.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXA_SEARCH_PRICES,
  MANUS_RESEARCH_DEPTHS,
  PARALLEL_TASK_PROCESSORS,
  endpointRegistry,
} from "../../../packages/router-core/src/endpoints/index.ts";
import { endpointSnapshot } from "../../../packages/router-core/src/manifest/schema.ts";

const PROVIDER_LOGO_PATHS = Object.freeze({
  exa: "/exa-logomark.svg",
  browserbase: "/browserbase-logomark.svg",
  manus: "/manus-logomark.svg",
  parallel: "/parallel-logomark.svg",
  agentmail: "/agentmail-logomark.svg",
});

// Per-endpoint MCP tool wiring. The published package keeps the same tool
// names + input shapes as before; this table is the only U2-managed
// per-endpoint metadata that's not yet on the EndpointManifest (deferred to a
// future manifest extension). Keys here MUST match endpoint ids in the
// registry; the build fails if an endpoint is missing or extraneous.
const MCP_TOOL_DEFINITIONS = Object.freeze({
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
    tool_name: "manus_research_start",
    title: "Start Manus research",
    description:
      "Use this when the user asks for deep research, multi-source investigation, visual lookup, vendor research, or docs investigation. This starts one async Manus task through endpoint id manus.research and returns a task handle, not the final answer. Do not call start again for the same query; call the MCP tools manus_research_status or manus_research_result with the returned task_id unless the user explicitly asks for a new task.",
    input_kind: "research",
    // Manus uses depth-based pricing, resolved per-call.
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
    tool_name: "parallel_task_start",
    title: "Start Parallel task",
    description:
      "Use this when the user asks for deep, structured research with citations. This starts one async Parallel task through endpoint id parallel.task and returns a run handle, not the final answer. Do not call start again for the same query; call the MCP tools parallel_task_status or parallel_task_result with the returned task_id unless the user explicitly asks for a new task.",
    input_kind: "parallel_task",
    default_max_usd: null,
  }),
  "agentmail.create_inbox": Object.freeze({
    tool_name: "agentmail_create_inbox",
    title: "AgentMail create inbox",
    description: "Create an AgentMail inbox through ToolRouter's server-side x402 AgentMail wrapper. This is a paid endpoint; use client_id for idempotent retries.",
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

const CATEGORY_TOOL_DEFINITIONS = Object.freeze([
  {
    tool_name: "toolrouter_search",
    title: "Search",
    description: "Run a search through ToolRouter's recommended search endpoint.",
    input_kind: "search",
    category: "search",
  },
  {
    tool_name: "toolrouter_browser_use",
    title: "Browser use",
    description: "Start a browser session through ToolRouter's recommended browser-use endpoint.",
    input_kind: "browser",
    category: "browser_usage",
  },
]);

function buildManifest() {
  const snapshots = endpointRegistry.map((endpoint) => endpointSnapshot(endpoint));

  const wiredIds = new Set(Object.keys(MCP_TOOL_DEFINITIONS));
  for (const snapshot of snapshots) {
    if (!wiredIds.has(snapshot.id)) {
      throw new Error(
        `build-endpoints: endpoint ${snapshot.id} has no MCP tool wiring in MCP_TOOL_DEFINITIONS. ` +
          "Add an entry to apps/mcp/scripts/build-endpoints.mjs or remove it from the registry.",
      );
    }
  }
  for (const id of wiredIds) {
    if (!snapshots.some((snapshot) => snapshot.id === id)) {
      throw new Error(
        `build-endpoints: MCP wiring references unknown endpoint ${id}. ` +
          "Remove its entry from apps/mcp/scripts/build-endpoints.mjs.",
      );
    }
  }

  const endpoints = snapshots.map((snapshot) => {
    const mcp = MCP_TOOL_DEFINITIONS[snapshot.id];
    return {
      ...snapshot,
      provider_logo_path: PROVIDER_LOGO_PATHS[snapshot.provider] || null,
      mcp: {
        tool_name: mcp.tool_name,
        title: mcp.title,
        description: mcp.description,
        input_kind: mcp.input_kind,
        default_max_usd: mcp.default_max_usd,
      },
    };
  });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    endpoints,
    category_tools: CATEGORY_TOOL_DEFINITIONS.map((tool) => ({ ...tool })),
    enums: {
      search_type: Object.keys(EXA_SEARCH_PRICES),
      manus_depth: Object.keys(MANUS_RESEARCH_DEPTHS),
      parallel_processor: Object.keys(PARALLEL_TASK_PROCESSORS),
    },
    manus_pricing: {
      default_usd_by_depth: { ...MANUS_RESEARCH_DEPTHS },
      env_var_template: "TOOLROUTER_MANUS_RESEARCH_PRICE_<DEPTH>_USD",
    },
    parallel_pricing: {
      default_usd_by_processor: { ...PARALLEL_TASK_PROCESSORS },
      markup_usd: 0.01,
      env_var_template: "TOOLROUTER_PARALLEL_TASK_PRICE_<PROCESSOR>_USD",
    },
  };
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultOutPath = join(scriptDir, "..", "dist", "endpoints.json");

export function writeEndpointsManifest(outPath = defaultOutPath) {
  const manifest = buildManifest();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, (key, value) => (key === "generated_at" ? undefined : value), 2)}\n`);
  return manifest;
}

export function endpointsManifestSnapshot() {
  // Deterministic snapshot (no timestamps) for tests/in-process fallback.
  const manifest = buildManifest();
  delete manifest.generated_at;
  return manifest;
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  writeEndpointsManifest();
  process.stdout.write(`build-endpoints: wrote ${defaultOutPath}\n`);
}
