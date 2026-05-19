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
  "toolrouter_search",
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

const missing = REQUIRED_TOOL_NAMES.filter((name) => !dist.includes(`"${name}"`));
if (missing.length) {
  throw new Error(`verify-dist: dist/server.js is missing tools: ${missing.join(", ")}. Did you forget to rebuild?`);
}

process.stdout.write(`verify-dist: dist/server.js OK — ${REQUIRED_TOOL_NAMES.length} tools present, SERVER_INFO.version=${pkg.version}\n`);
