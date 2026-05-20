import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Guards against the @worldcoin/toolrouter@0.1.1 failure mode: src/ had the
// Manus tools but the published dist/server.js was a stale pre-Manus build.
// This test runs against the built artifact (dist/server.js) — the file that
// ships in the npm tarball — not the TypeScript source.

const here = dirname(fileURLToPath(import.meta.url));
const mcpPkgDir = resolve(here, "../../../apps/mcp");
const distPath = resolve(mcpPkgDir, "dist/server.js");
const pkgPath = resolve(mcpPkgDir, "package.json");

describe("ToolRouter MCP built dist", () => {
  before(() => {
    if (!existsSync(distPath)) {
      execFileSync("npm", ["run", "build"], { cwd: mcpPkgDir, stdio: "inherit" });
    }
  });

  it("exposes every advertised tool", async () => {
    const built = await import(distPath);
    const names = built.tools().map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "browserbase_session_create",
      "exa_search",
      "manus_research_result",
      "manus_research_start",
      "manus_research_status",
      "parallel_extract",
      "parallel_search",
      "parallel_task_result",
      "parallel_task_start",
      "parallel_task_status",
      "toolrouter_browser_use",
      "toolrouter_call_endpoint",
      "toolrouter_get_request",
      "toolrouter_list_categories",
      "toolrouter_list_endpoints",
      "toolrouter_recommend_endpoint",
      "toolrouter_search",
    ]);
  });

  it("keeps SERVER_INFO.version in sync with package.json", () => {
    const dist = readFileSync(distPath, "utf8");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const match = dist.match(/SERVER_INFO\s*=\s*Object\.freeze\(\{\s*name:\s*"toolrouter-mcp",\s*version:\s*"([^"]+)"/u);
    assert.ok(match, "SERVER_INFO literal not found in dist/server.js");
    assert.equal(match[1], pkg.version);
  });
});
