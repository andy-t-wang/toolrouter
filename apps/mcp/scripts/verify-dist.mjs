#!/usr/bin/env node
// Verifies that the freshly-built dist/server.js contains every MCP tool the
// adapter promises and that SERVER_INFO.version matches package.json. Runs
// after `tsc` builds dist/ so a stale build can never be published.
//
// Why: @worldcoin/toolrouter@0.1.1 shipped a pre-Manus dist/server.js because
// the publish was done from a stale build. This gate makes that impossible.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_TOOL_NAMES = [
  "toolrouter_list_endpoints",
  "toolrouter_list_categories",
  "toolrouter_recommend_endpoint",
  "toolrouter_call_endpoint",
  "toolrouter_get_request",
  "toolrouter_create_top_up",
  "toolrouter_search",
  "toolrouter_send_email",
  "toolrouter_browser_use",
  "exa_search",
  "browserbase_session_create",
  "manus_research_start",
  "manus_research_status",
  "manus_research_result",
];

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const dist = readFileSync(join(pkgDir, "dist/server.js"), "utf8");

const versionMatch = dist.match(/SERVER_INFO\s*=\s*Object\.freeze\(\{\s*name:\s*"toolrouter-mcp",\s*version:\s*"([^"]+)"/u);
if (!versionMatch) {
  throw new Error("verify-dist: SERVER_INFO not found in dist/server.js");
}
if (versionMatch[1] !== pkg.version) {
  throw new Error(`verify-dist: SERVER_INFO.version is "${versionMatch[1]}" but package.json is "${pkg.version}". Bump SERVER_INFO in src/server.ts before publishing.`);
}

// Per-endpoint tool names now live in dist/endpoints.json (the sibling
// manifest the MCP server reads at startup), not in dist/server.js. The
// always-static tool surface (the toolrouter_* helpers and manus_research_*
// helpers) remains string-embedded in dist/server.js.
const endpointsPath = join(pkgDir, "dist/endpoints.json");
const endpointsManifest = JSON.parse(readFileSync(endpointsPath, "utf8"));
if (!endpointsManifest?.endpoints?.length) {
  throw new Error("verify-dist: dist/endpoints.json is empty or malformed. Did codegen run?");
}

const manifestToolNames = new Set([
  ...endpointsManifest.category_tools.map((tool) => tool.tool_name),
  ...endpointsManifest.endpoints.map((endpoint) => endpoint.mcp.tool_name),
]);

const missing = REQUIRED_TOOL_NAMES.filter((name) => {
  if (manifestToolNames.has(name)) return false;
  return !dist.includes(`"${name}"`);
});
if (missing.length) {
  throw new Error(`verify-dist: tool missing from both dist/server.js and dist/endpoints.json: ${missing.join(", ")}. Did you forget to rebuild?`);
}

process.stdout.write(`verify-dist: dist OK — ${REQUIRED_TOOL_NAMES.length} tools present (${manifestToolNames.size} from endpoints.json), SERVER_INFO.version=${pkg.version}\n`);
