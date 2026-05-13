import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

import { callTool, handleJsonRpcMessage, startStdioServer, tools } from "../../../apps/mcp/src/server.ts";

function response(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" },
  });
}

function framed(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function decodeFrame(raw) {
  const separator = raw.indexOf("\r\n\r\n");
  assert.notEqual(separator, -1);
  const header = raw.slice(0, separator);
  const body = raw.slice(separator + 4);
  const length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]);
  assert.equal(Buffer.byteLength(body, "utf8"), length);
  return JSON.parse(body);
}

function onceData(stream) {
  return new Promise((resolve) => {
    stream.once("data", (chunk) => resolve(chunk.toString("utf8")));
  });
}

describe("ToolRouter MCP server", () => {
  it("negotiates MCP initialization and lists tools", async () => {
    const initialized = await handleJsonRpcMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    assert.equal(initialized.result.protocolVersion, "2025-11-25");
    assert.deepEqual(initialized.result.capabilities, { tools: { listChanged: false } });

    const listed = await handleJsonRpcMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.ok(listed.result.tools.some((tool) => tool.name === "exa_search"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_search"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_image_generate"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_list_categories"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_recommend_endpoint"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_fetch_content"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_answer"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "flightaware_flight_track"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "agentmail_pods"));
    assert.ok(tools().some((tool) => tool.name === "fal_image_fast"));
    assert.ok(tools().some((tool) => tool.name === "browserbase_session_create"));
    const sessionTool = tools().find((tool) => tool.name === "browserbase_session_create");
    assert.equal(sessionTool.inputSchema.properties.estimated_minutes.minimum, 5);
  });

  it("supports Content-Length framed stdio used by MCP clients", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    startStdioServer({
      input,
      output,
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async () => response({}),
    });

    const received = onceData(output);
    input.write(framed({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "hermes", version: "1" } },
    }));

    const payload = decodeFrame(await received);
    assert.equal(payload.jsonrpc, "2.0");
    assert.equal(payload.id, 1);
    assert.equal(payload.result.serverInfo.name, "toolrouter-mcp");
  });

  it("calls named endpoint tools through POST /v1/requests", async () => {
    const calls = [];
    const result = await callTool("exa_search", { query: "top sushi places in San Francisco" }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_1", endpoint_id: "exa.search", path: "agentkit", charged: false });
      },
    });

    assert.equal(result.isError, false);
    assert.equal(calls[0].url, "http://router.test/v1/requests");
    assert.equal(calls[0].init.headers.authorization, "Bearer tr_test");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "exa.search",
      input: {
        query: "top sushi places in San Francisco",
        search_type: "fast",
        num_results: 5,
        include_summary: false,
      },
      maxUsd: "0.01",
    });
  });

  it("canonicalizes the stale api.toolrouter.com alias to the current API base", async () => {
    const calls = [];
    const result = await callTool("exa_search", { query: "top sushi places in San Francisco" }, {
      env: { TOOLROUTER_API_URL: "https://api.toolrouter.com/", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_alias", endpoint_id: "exa.search", path: "agentkit", charged: false });
      },
    });

    assert.equal(result.isError, false);
    assert.equal(calls[0].url, "https://toolrouter.world/v1/requests");
  });

  it("lists categories and recommends concrete endpoints", async () => {
    const calls = [];
    const categories = {
      categories: [
        {
          id: "search",
          name: "Search",
          description: "Find fresh web results.",
          recommended_endpoint: { id: "exa.search", name: "Exa Search" },
        },
      ],
    };

    const listResult = await callTool("toolrouter_list_categories", {}, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response(categories);
      },
    });
    assert.equal(listResult.isError, false);
    assert.equal(calls[0].url, "http://router.test/v1/categories");

    const recommendResult = await callTool("toolrouter_recommend_endpoint", { category: "search" }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response(categories);
      },
    });
    assert.equal(recommendResult.isError, false);
    assert.equal(recommendResult.structuredContent.recommended_endpoint.id, "exa.search");
    assert.equal(calls[1].url, "http://router.test/v1/categories?include_empty=true");
  });

  it("calls category-level convenience tools through recommended endpoint payloads", async () => {
    const calls = [];
    const result = await callTool("toolrouter_search", { query: "agent payment routers" }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_2", endpoint_id: "exa.search", path: "agentkit", charged: false });
      },
    });

    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "exa.search",
      input: {
        query: "agent payment routers",
        search_type: "fast",
        num_results: 5,
        include_summary: false,
      },
      maxUsd: "0.01",
    });

    const fetchResult = await callTool("toolrouter_fetch_content", { urls: ["https://example.com"], summary: true }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_5", endpoint_id: "exa.contents", path: "agentkit", charged: false });
      },
    });
    assert.equal(fetchResult.isError, false);
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      endpoint_id: "exa.contents",
      input: {
        urls: ["https://example.com"],
        text: true,
        summary: true,
      },
      maxUsd: "0.01",
    });
  });

  it("calls new named x402 endpoint tools through concrete endpoint ids", async () => {
    const calls = [];
    const result = await callTool("flightaware_flight_track", {
      callsign: "UAL123",
      payment_mode: "x402_only",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_flight", endpoint_id: "flightaware.flight_track", path: "x402", charged: true });
      },
    });

    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "flightaware.flight_track",
      input: {
        callsign: "UAL123",
        ident_type: "designator",
        max_pages: 1,
      },
      maxUsd: "0.02",
      payment_mode: "x402_only",
    });
  });

  it("calls Fal image tools through the x402-only endpoint", async () => {
    const calls = [];
    const result = await callTool("fal_image_fast", {
      prompt: "a small deterministic test image",
      width: 512,
      height: 768,
      seed: 123,
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_fal", endpoint_id: "fal.image_fast", path: "x402", charged: true });
      },
    });

    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "fal.image_fast",
      input: {
        prompt: "a small deterministic test image",
        width: 512,
        height: 768,
        seed: 123,
      },
      maxUsd: "0.02",
      payment_mode: "x402_only",
    });

    const categoryResult = await callTool("toolrouter_image_generate", {
      prompt: "a small deterministic category image",
      width: 512,
      height: 512,
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_image", endpoint_id: "fal.image_fast", path: "x402", charged: true });
      },
    });

    assert.equal(categoryResult.isError, false);
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      endpoint_id: "fal.image_fast",
      input: {
        prompt: "a small deterministic category image",
        width: 512,
        height: 512,
      },
      maxUsd: "0.02",
      payment_mode: "x402_only",
    });
  });

  it("passes explicit payment mode overrides for smoke tests", async () => {
    const calls = [];
    const result = await callTool("browserbase_session_create", {
      estimated_minutes: 5,
      maxUsd: "0.02",
      payment_mode: "x402_only",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_3", endpoint_id: "browserbase.session", path: "x402", charged: true });
      },
    });

    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "browserbase.session",
      input: { estimated_minutes: 5 },
      maxUsd: "0.02",
      payment_mode: "x402_only",
    });
  });

  it("defaults Browserbase session calls to the provider minimum", async () => {
    const calls = [];
    const result = await callTool("browserbase_session_create", {}, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_4", endpoint_id: "browserbase.session", path: "x402", charged: true });
      },
    });

    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "browserbase.session",
      input: { estimated_minutes: 5 },
      maxUsd: "0.02",
    });
  });

  it("reports missing API key as an MCP tool error", async () => {
    const result = await callTool("toolrouter_list_endpoints", {}, {
      env: { TOOLROUTER_API_URL: "http://router.test" },
      fetchImpl: async () => response({}),
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /TOOLROUTER_API_KEY/);
  });
});
