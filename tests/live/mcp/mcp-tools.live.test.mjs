import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { callTool, handleJsonRpcMessage, tools } from "../../../apps/mcp/src/server.ts";
import { getEndpoint } from "../../../packages/router-core/src/index.ts";

const apiKey =
  process.env.TOOLROUTER_API_KEY ||
  process.env.AGENTKIT_ROUTER_API_KEY ||
  process.env.AGENTKIT_ROUTER_DEV_API_KEY;
const apiUrl = process.env.TOOLROUTER_API_URL || "https://toolrouter.world";
const runLive = process.env.RUN_LIVE_MCP_TESTS === "true" && Boolean(apiKey);
const runPaid = runLive && process.env.RUN_LIVE_MCP_PAID_SMOKE === "true";

function liveOptions() {
  return {
    env: {
      TOOLROUTER_API_URL: apiUrl,
      TOOLROUTER_API_KEY: apiKey,
    },
  };
}

function assertToolOk(result, label) {
  assert.equal(result.isError, false, `${label}: ${result.content?.[0]?.text || "MCP tool returned an error"}`);
  assert.ok(result.structuredContent, `${label}: missing structured content`);
  return result.structuredContent;
}

function assertPaidPath(body, label) {
  assert.ok(["x402", "agentkit_to_x402"].includes(body.path), `${label} should use a paid x402 path`);
  assert.equal(body.charged, true, `${label} should report a paid charge`);
}

function paidArgsFor(endpointId) {
  const endpoint = getEndpoint(endpointId);
  const smoke = endpoint.liveSmoke.paid_path;
  const base = {
    maxUsd: smoke.max_usd,
    payment_mode: smoke.payment_mode,
  };
  if (endpointId === "exa.search") {
    return {
      ...base,
      query: smoke.input.query,
      search_type: smoke.input.search_type,
      num_results: smoke.input.num_results,
    };
  }
  if (endpointId === "browserbase.search") {
    return { ...base, query: smoke.input.query };
  }
  if (endpointId === "browserbase.fetch") {
    return { ...base, url: smoke.input.url };
  }
  if (endpointId === "browserbase.session") {
    return { ...base, estimated_minutes: smoke.input.estimated_minutes };
  }
  throw new Error(`unsupported endpoint for MCP paid args: ${endpointId}`);
}

describe("ToolRouter MCP live e2e", () => {
  it("lists all live launch tools and endpoint categories", { skip: runLive ? false : "live MCP smoke disabled" }, async () => {
    const initialized = await handleJsonRpcMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "live-test", version: "1" } },
    });
    assert.equal(initialized.result.serverInfo.name, "toolrouter-mcp");

    const listed = await handleJsonRpcMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      tools().map((tool) => tool.name),
    );

    const endpointList = assertToolOk(
      await callTool("toolrouter_list_endpoints", {}, liveOptions()),
      "toolrouter_list_endpoints",
    );
    assert.deepEqual(
      endpointList.endpoints.map((endpoint) => endpoint.id).sort(),
      ["browserbase.fetch", "browserbase.search", "browserbase.session", "exa.search"].sort(),
    );

    const categories = assertToolOk(
      await callTool("toolrouter_list_categories", {}, liveOptions()),
      "toolrouter_list_categories",
    );
    assert.ok(categories.categories.some((category) => category.id === "search"));

    const recommendation = assertToolOk(
      await callTool("toolrouter_recommend_endpoint", { category: "search" }, liveOptions()),
      "toolrouter_recommend_endpoint",
    );
    assert.equal(recommendation.recommended_endpoint.id, "exa.search");
  });

  it("executes paid endpoint tools through MCP and can read the resulting trace", { skip: runPaid ? false : "live paid MCP smoke disabled" }, async () => {
    const calls = [
      ["exa_search", paidArgsFor("exa.search")],
      ["browserbase_search", paidArgsFor("browserbase.search")],
      ["browserbase_fetch", paidArgsFor("browserbase.fetch")],
      ["browserbase_session_create", paidArgsFor("browserbase.session")],
    ];
    let lastRequestId = null;

    for (const [name, args] of calls) {
      const body = assertToolOk(await callTool(name, args, liveOptions()), name);
      assertPaidPath(body, name);
      assert.equal(body.status_code, 200, `${name} should succeed`);
      assert.match(body.id, /^req_/);
      lastRequestId = body.id;
    }

    const genericEndpoint = getEndpoint("exa.search");
    const genericSmoke = genericEndpoint.liveSmoke.paid_path;
    const generic = assertToolOk(
      await callTool("toolrouter_call_endpoint", {
        endpoint_id: "exa.search",
        input: genericSmoke.input,
        maxUsd: genericSmoke.max_usd,
        payment_mode: genericSmoke.payment_mode,
      }, liveOptions()),
      "toolrouter_call_endpoint",
    );
    assertPaidPath(generic, "toolrouter_call_endpoint");
    lastRequestId = generic.id;

    const trace = assertToolOk(
      await callTool("toolrouter_get_request", { id: lastRequestId }, liveOptions()),
      "toolrouter_get_request",
    );
    assert.equal(trace.request.id, lastRequestId);
    assertPaidPath(trace.request, "toolrouter_get_request");
  });
});
