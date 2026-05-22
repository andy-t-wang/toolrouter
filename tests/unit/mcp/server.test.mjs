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

function hasRequiredAlternative(schema, required) {
  return (schema.anyOf || []).some((alternative) => {
    const actual = new Set(alternative.required || []);
    return actual.size === required.length && required.every((key) => actual.has(key));
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
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_list_categories"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_recommend_endpoint"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_send_email"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "manus_research_start"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "manus_research_status"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "manus_research_result"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "agentmail_create_inbox"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "agentmail_list_messages"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "agentmail_get_message"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "agentmail_send_message"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "agentmail_reply_to_message"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "stabletravel_locations"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "stabletravel_google_flights_search"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "stabletravel_hotels_list"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "stabletravel_hotels_search"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "stabletravel_flightaware_flights"));
    assert.equal(listed.result.tools.some((tool) => tool.name === "toolrouter_research"), false);
    assert.equal(listed.result.tools.some((tool) => tool.name === "manus_research"), false);
    assert.ok(tools().some((tool) => tool.name === "browserbase_session_create"));
    const sessionTool = tools().find((tool) => tool.name === "browserbase_session_create");
    assert.equal(sessionTool.inputSchema.properties.estimated_minutes.minimum, 5);
    const startTool = tools().find((tool) => tool.name === "manus_research_start");
    assert.match(startTool.description, /Use this when/u);
    assert.match(startTool.description, /Do not call start again for the same query/u);
    assert.ok(startTool.outputSchema);
    assert.ok(startTool.outputSchema.properties.credit_reserved_usd);
    assert.ok(startTool.outputSchema.properties.next_mcp_tools);
    assert.ok(startTool.outputSchema.properties.next_endpoint_ids);
    assert.ok(startTool.outputSchema.properties.next_tool_calls);
    const listTool = tools().find((tool) => tool.name === "toolrouter_list_endpoints");
    assert.match(listTool.description, /endpoint IDs/u);
    assert.match(listTool.description, /MCP tools/u);
    const genericTool = tools().find((tool) => tool.name === "toolrouter_call_endpoint");
    assert.ok(genericTool.inputSchema.properties.endpointId);
    assert.ok(genericTool.inputSchema.properties.max_usd);
    assert.ok(genericTool.inputSchema.properties.paymentMode);
    const listMailTool = tools().find((tool) => tool.name === "agentmail_list_messages");
    assert.ok(hasRequiredAlternative(listMailTool.inputSchema, ["inboxId"]));
    assert.ok(listMailTool.inputSchema.properties.includeSpam);
    assert.ok(listMailTool.inputSchema.properties.includeBlocked);
    assert.ok(listMailTool.inputSchema.properties.includeUnauthenticated);
    assert.ok(listMailTool.inputSchema.properties.includeTrash);
    const getMailTool = tools().find((tool) => tool.name === "agentmail_get_message");
    assert.ok(hasRequiredAlternative(getMailTool.inputSchema, ["inboxId", "messageId"]));
    const sendMailTool = tools().find((tool) => tool.name === "agentmail_send_message");
    assert.equal(sendMailTool.inputSchema.properties.to.oneOf.length, 2);
    assert.equal(sendMailTool.inputSchema.properties.to.oneOf[1].minItems, 1);
    assert.ok(sendMailTool.inputSchema.properties.replyTo);
    assert.ok(hasRequiredAlternative(sendMailTool.inputSchema, ["inboxId", "to", "html"]));
    assert.ok(hasRequiredAlternative(sendMailTool.inputSchema, ["inbox_id", "to", "text"]));
    assert.equal(sendMailTool.inputSchema.properties.attachments.maxItems, 10);
    const genericEmailTool = tools().find((tool) => tool.name === "toolrouter_send_email");
    assert.equal(genericEmailTool.inputSchema.properties.to.oneOf.length, 2);
    assert.ok(hasRequiredAlternative(genericEmailTool.inputSchema, ["inboxId", "to", "html"]));
    assert.ok(hasRequiredAlternative(genericEmailTool.inputSchema, ["inbox_id", "to", "text"]));
    const replyMailTool = tools().find((tool) => tool.name === "agentmail_reply_to_message");
    assert.ok(replyMailTool.inputSchema.properties.replyTo);
    assert.ok(replyMailTool.inputSchema.properties.replyAll);
    assert.ok(hasRequiredAlternative(replyMailTool.inputSchema, ["inboxId", "messageId", "html"]));
    assert.ok(hasRequiredAlternative(replyMailTool.inputSchema, ["inbox_id", "message_id", "text"]));
    const stabletravelFlightsTool = tools().find((tool) => tool.name === "stabletravel_google_flights_search");
    assert.ok(hasRequiredAlternative(stabletravelFlightsTool.inputSchema, ["departure_id", "arrival_id", "outbound_date"]));
    assert.ok(hasRequiredAlternative(stabletravelFlightsTool.inputSchema, ["departureId", "arrivalId", "outboundDate"]));
    assert.equal(stabletravelFlightsTool.inputSchema.properties.type.enum.length, 3);
    assert.ok(stabletravelFlightsTool.inputSchema.properties.infants_in_seat);
    assert.ok(stabletravelFlightsTool.inputSchema.properties.infantsInSeat);
    assert.ok(stabletravelFlightsTool.inputSchema.properties.infants_on_lap);
    assert.ok(stabletravelFlightsTool.inputSchema.properties.infantsOnLap);
    assert.ok(stabletravelFlightsTool.inputSchema.properties.travelClass);
    assert.ok(stabletravelFlightsTool.inputSchema.properties.maxPrice);
    assert.ok(stabletravelFlightsTool.inputSchema.properties.includeAirlines);
    assert.ok(stabletravelFlightsTool.inputSchema.properties.excludeAirlines);
    assert.equal(stabletravelFlightsTool.inputSchema.properties.include_airlines.oneOf[1].maxItems, 20);
    assert.equal(stabletravelFlightsTool.inputSchema.properties.includeAirlines.oneOf[1].maxItems, 20);
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
      },
      maxUsd: "0.01",
    });
  });

  it("calls AgentMail endpoint tools with x402-only defaults", async () => {
    const calls = [];
    const result = await callTool("agentmail_send_message", {
      inbox_id: "agent@agentmail.to",
      to: "recipient@example.com",
      subject: "Hello",
      text: "Body",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_mail", endpoint_id: "agentmail.send_message", path: "x402", charged: true });
      },
    });

    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "agentmail.send_message",
      input: {
        inbox_id: "agent@agentmail.to",
        to: "recipient@example.com",
        subject: "Hello",
        text: "Body",
      },
      maxUsd: "0.02",
    });
  });

  it("calls StableTravel endpoint tools with direct x402 defaults", async () => {
    const calls = [];
    const result = await callTool("stabletravel_google_flights_search", {
      departure_id: "SFO",
      arrival_id: "JFK",
      outbound_date: "2026-06-15",
      type: "2",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ id: "req_travel", endpoint_id: "stabletravel.google_flights_search", path: "x402", charged: true });
      },
    });

    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "stabletravel.google_flights_search",
      input: {
        departure_id: "SFO",
        arrival_id: "JFK",
        outbound_date: "2026-06-15",
        type: "2",
      },
      maxUsd: "0.025",
    });
  });

  it("surfaces AgentMail IDs from named tool responses for chaining", async () => {
    const result = await callTool("agentmail_create_inbox", {
      client_id: "test-inbox",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async () => response({
        id: "req_mail_create",
        endpoint_id: "agentmail.create_inbox",
        path: "x402",
        charged: true,
        status_code: 200,
        body: {
          ok: true,
          provider: "agentmail",
          result: {
            id: "inbox_123",
            email: "health@agentmail.to",
          },
        },
      }),
    });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.id, "req_mail_create");
    assert.equal(result.structuredContent.endpoint_id, "agentmail.create_inbox");
    assert.equal(result.structuredContent.inbox_id, "inbox_123");
    assert.equal(result.structuredContent.email, "health@agentmail.to");
    assert.equal(result.structuredContent.message_id, null);
    assert.equal(result.structuredContent.charged, true);

    const sendResult = await callTool("agentmail_send_message", {
      inbox_id: "health@agentmail.to",
      to: "recipient@example.com",
      subject: "Hello",
      text: "Body",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async () => response({
        id: "req_mail_send",
        endpoint_id: "agentmail.send_message",
        path: "x402",
        charged: true,
        status_code: 200,
        body: {
          ok: true,
          provider: "agentmail",
          result: {
            id: "msg_123",
            thread_id: "thread_123",
          },
        },
      }),
    });

    assert.equal(sendResult.isError, false);
    assert.equal(sendResult.structuredContent.id, "req_mail_send");
    assert.equal(sendResult.structuredContent.inbox_id, null);
    assert.equal(sendResult.structuredContent.message_id, "msg_123");
    assert.equal(sendResult.structuredContent.thread_id, "thread_123");
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
          recommended_mcp_tool: "toolrouter_search",
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
    assert.equal(recommendResult.structuredContent.recommended_mcp_tool, "toolrouter_search");
    assert.equal(recommendResult.structuredContent.recommended_endpoint.id, "exa.search");
    assert.equal(calls[1].url, "http://router.test/v1/categories?include_empty=true");
  });

  it("calls category-level convenience tools through recommended endpoint payloads", async () => {
    const calls = [];
    const categories = {
      categories: [
        {
          id: "search",
          name: "Search",
          recommended_endpoint: { id: "exa.search", name: "Exa Search" },
        },
      ],
    };
    const result = await callTool("toolrouter_search", { query: "agent payment routers" }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url === "http://router.test/v1/categories?include_empty=true") return response(categories);
        return response({ id: "req_2", endpoint_id: "exa.search", path: "agentkit", charged: false });
      },
    });

    assert.equal(result.isError, false);
    assert.equal(calls[0].url, "http://router.test/v1/categories?include_empty=true");
    assert.equal(calls[1].url, "http://router.test/v1/requests");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      endpoint_id: "exa.search",
      input: {
        query: "agent payment routers",
      },
      maxUsd: "0.01",
    });
  });

  it("sends email through the generic email category wrapper", async () => {
    const calls = [];
    const categories = {
      categories: [
        {
          id: "email",
          name: "Email",
          recommended_endpoint: { id: "agentmail.send_message", name: "AgentMail Send Message" },
        },
      ],
    };
    const result = await callTool("toolrouter_send_email", {
      inbox_id: "agent@agentmail.to",
      to: "recipient@example.com",
      subject: "Hello",
      text: "Body",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url === "http://router.test/v1/categories?include_empty=true") return response(categories);
        return response({
          id: "req_email",
          endpoint_id: "agentmail.send_message",
          path: "x402",
          charged: true,
          body: { result: { id: "msg_123", thread_id: "thread_123" } },
        });
      },
    });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.message_id, "msg_123");
    assert.equal(calls[0].url, "http://router.test/v1/categories?include_empty=true");
    assert.equal(calls[1].url, "http://router.test/v1/requests");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      endpoint_id: "agentmail.send_message",
      input: {
        inbox_id: "agent@agentmail.to",
        to: "recipient@example.com",
        subject: "Hello",
        text: "Body",
      },
      maxUsd: "0.02",
    });
  });

  it("starts Manus research through the async MCP tool", async () => {
    const calls = [];
    const result = await callTool("manus_research_start", {
      query: "Find tools for image lookup",
      task_type: "tool_discovery",
      depth: "quick",
      urls: ["https://example.com"],
      images: ["https://example.com/image.png"],
      force_new: true,
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({
          id: "req_research",
          endpoint_id: "manus.research",
          path: "agentkit",
          charged: false,
          task_created: true,
          deduped: false,
          request_id: "req_research",
          task_id: "task_123",
          task_url: "https://manus.im/app/task_123",
          status: "running",
          poll_after_seconds: 30,
          next_tools: { status: "manus_research_status", result: "manus_research_result" },
          repeat_for_same_query: false,
        });
      },
    });

    assert.equal(result.isError, false);
    assert.match(result.content[0].text, /Do not call start again for the same query/u);
    assert.match(result.content[0].text, /Task id: task_123/u);
    assert.match(result.content[0].text, /Next MCP tools, not endpoint IDs/u);
    assert.equal(result.structuredContent.task_created, true);
    assert.equal(result.structuredContent.deduped, false);
    assert.equal(result.structuredContent.repeat_for_same_query, false);
    assert.equal(result.structuredContent.task_id, "task_123");
    assert.deepEqual(result.structuredContent.next_mcp_tools, {
      status: "manus_research_status",
      result: "manus_research_result",
    });
    assert.deepEqual(result.structuredContent.next_endpoint_ids, []);
    assert.deepEqual(result.structuredContent.next_api_routes, {
      status: "/v1/manus/tasks/task_123/status",
      result: "/v1/manus/tasks/task_123/result",
    });
    assert.deepEqual(result.structuredContent.next_tool_calls.result, {
      type: "mcp_tool",
      tool_name: "manus_research_result",
      arguments: { task_id: "task_123" },
      api_route: "/v1/manus/tasks/task_123/result",
      note: "MCP tool name, not a ToolRouter endpoint_id.",
    });
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "manus.research",
      input: {
        query: "Find tools for image lookup",
        task_type: "tool_discovery",
        depth: "quick",
        urls: ["https://example.com"],
        images: ["https://example.com/image.png"],
      },
      maxUsd: "0.03",
      force_new: true,
    });
  });

  it("accepts prompt as a Manus research query alias", async () => {
    const calls = [];
    const result = await callTool("manus_research_start", {
      prompt: "Find tools for image lookup",
      depth: "quick",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({
          id: "req_research_prompt",
          endpoint_id: "manus.research",
          path: "agentkit",
          charged: false,
          task_created: true,
          deduped: false,
          task_id: "task_prompt",
          status: "running",
          poll_after_seconds: 30,
          next_tools: { status: "manus_research_status", result: "manus_research_result" },
          repeat_for_same_query: false,
        });
      },
    });

    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "manus.research",
      input: {
        prompt: "Find tools for image lookup",
        depth: "quick",
      },
      maxUsd: "0.03",
    });
  });

  it("wraps a scalar parallel_task_start input as an object", async () => {
    const calls = [];
    const result = await callTool("parallel_task_start", {
      input: "research topic",
      processor: "core",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({
          id: "req_parallel",
          endpoint_id: "parallel.task",
          path: "x402",
          charged: true,
          task_created: true,
          deduped: false,
          task_id: "run_parallel",
          status: "running",
          poll_after_seconds: 10,
          next_tools: { status: "parallel_task_status", result: "parallel_task_result" },
          repeat_for_same_query: false,
        });
      },
    });

    assert.equal(result.isError, false);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.endpoint_id, "parallel.task");
    assert.deepEqual(body.input, {
      input: "research topic",
      processor: "core",
    });
  });

  it("nests an object parallel_task_start input under the input key", async () => {
    const calls = [];
    const result = await callTool("parallel_task_start", {
      input: { topic: "image search providers", region: "us" },
      processor: "pro",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({
          id: "req_parallel_obj",
          endpoint_id: "parallel.task",
          path: "x402",
          charged: true,
          task_created: true,
          deduped: false,
          task_id: "run_parallel_obj",
          status: "running",
          poll_after_seconds: 10,
          next_tools: { status: "parallel_task_status", result: "parallel_task_result" },
          repeat_for_same_query: false,
        });
      },
    });

    assert.equal(result.isError, false);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.endpoint_id, "parallel.task");
    assert.deepEqual(body.input, {
      input: { topic: "image search providers", region: "us" },
      processor: "pro",
    });
  });

  it("keeps generic endpoint calls as raw ToolRouter responses", async () => {
    const calls = [];
    const result = await callTool("toolrouter_call_endpoint", {
      endpoint_id: "manus.research",
      input: {
        query: "Find tools for image lookup",
        task_type: "tool_discovery",
        depth: "quick",
      },
      maxUsd: "0.03",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({
          id: "req_generic_research",
          endpoint_id: "manus.research",
          path: "x402",
          charged: true,
          body: { ok: true, status_code: 200, provider: "manus", task: { task_id: "task_generic" } },
        });
      },
    });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.id, "req_generic_research");
    assert.equal(result.structuredContent.body.task.task_id, "task_generic");
    assert.equal(calls[0].url, "http://router.test/v1/requests");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "manus.research",
      input: {
        query: "Find tools for image lookup",
        task_type: "tool_discovery",
        depth: "quick",
      },
      maxUsd: "0.03",
    });
  });

  it("canonicalizes generic top-level endpoint fields into input", async () => {
    const calls = [];
    const result = await callTool("toolrouter_call_endpoint", {
      endpoint_id: "manus.research",
      prompt: "Find tools for image lookup",
      task_type: "tool_discovery",
      depth: "quick",
      maxUsd: "0.03",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({
          id: "req_generic_top_level",
          endpoint_id: "manus.research",
          path: "agentkit",
          charged: false,
          body: { ok: true, status_code: 200, provider: "manus", task: { id: "task_top_level" } },
        });
      },
    });

    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      endpoint_id: "manus.research",
      input: {
        prompt: "Find tools for image lookup",
        task_type: "tool_discovery",
        depth: "quick",
      },
      maxUsd: "0.03",
    });
  });

  it("reports missing Manus task handles as start errors", async () => {
    const result = await callTool("manus_research_start", {
      query: "Find tools for image lookup",
      depth: "quick",
    }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async () => response({
        id: "req_research_failed",
        endpoint_id: "manus.research",
        path: "agentkit_to_x402",
        charged: true,
        body: { ok: false, status_code: 504, provider: "manus", error: "upstream timeout" },
      }),
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /did not return a task handle/u);
    assert.equal(result.structuredContent.task_id, null);
    assert.equal(result.structuredContent.task_created, false);
  });

  it("checks Manus research status through the read-only API route", async () => {
    const calls = [];
    const result = await callTool("manus_research_status", { task_id: "task_123" }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({
          task_id: "task_123",
          status: "running",
          title: "ToolRouter research",
          task_url: "https://manus.im/app/task_123",
          created_at: "2026-05-14T00:00:00.000Z",
          updated_at: "2026-05-14T00:00:00.000Z",
          last_checked_at: "2026-05-14T00:01:00.000Z",
          poll_after_seconds: 30,
        });
      },
    });

    assert.equal(result.isError, false);
    assert.equal(calls[0].url, "http://router.test/v1/manus/tasks/task_123/status");
    assert.equal(result.structuredContent.status, "running");
    assert.match(result.content[0].text, /task_123 is running/u);
  });

  it("returns non-error Manus result progress while running", async () => {
    const result = await callTool("manus_research_result", { task_id: "task_123" }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async () => response({
        task_id: "task_123",
        status: "running",
        final_answer_available: false,
        answer: null,
        attachments: [],
        latest_status_message: "Reading sources",
        messages: [],
        poll_after_seconds: 30,
      }),
    });

    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.final_answer_available, false);
    assert.match(result.content[0].text, /Reading sources/u);
  });

  it("returns Manus error results as MCP errors", async () => {
    const result = await callTool("manus_research_result", { task_id: "task_failed" }, {
      env: { TOOLROUTER_API_URL: "http://router.test", TOOLROUTER_API_KEY: "tr_test" },
      fetchImpl: async () => response({
        task_id: "task_failed",
        status: "error",
        final_answer_available: false,
        answer: null,
        attachments: [],
        latest_status_message: null,
        messages: [],
        error: "Manus task failed",
        isError: true,
      }),
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /failed/u);
  });

  it("uses configured Manus prices as default MCP spend caps", async () => {
    const calls = [];
    const result = await callTool("manus_research_start", {
      query: "Find tools for image lookup",
      depth: "quick",
    }, {
      env: {
        TOOLROUTER_API_URL: "http://router.test",
        TOOLROUTER_API_KEY: "tr_test",
        TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD: "0.04",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({
          id: "req_research_price",
          endpoint_id: "manus.research",
          path: "agentkit",
          charged: false,
          task_created: true,
          deduped: false,
          task_id: "task_price",
          status: "running",
          poll_after_seconds: 30,
          next_tools: { status: "manus_research_status", result: "manus_research_result" },
          repeat_for_same_query: false,
        });
      },
    });

    assert.equal(result.isError, false);
    assert.equal(JSON.parse(calls[0].init.body).maxUsd, "0.04");
  });

  it("allows x402 payment headers in browser preflight", async () => {
    const { createApiApp } = await import("../../../apps/api/src/app.ts");
    const { MemoryCache } = await import("../../../packages/cache/src/index.ts");
    const app = createApiApp({ logger: false, cache: new MemoryCache() });
    try {
      for (const url of [
        "/x402/manus/research",
        "/x402/agentmail/inboxes",
        "/x402/agentmail/messages/send",
        "/x402/agentmail/messages/reply",
      ]) {
        const response = await app.inject({
          method: "OPTIONS",
          url,
        });
        assert.equal(response.statusCode, 204, url);
        assert.match(response.headers["access-control-allow-origin"], /\*/u, url);
        assert.match(response.headers["access-control-allow-headers"], /payment-signature/u, url);
        assert.match(response.headers["access-control-allow-headers"], /agentkit/u, url);
        assert.match(response.headers["access-control-expose-headers"], /payment-required/u, url);
        assert.match(response.headers["access-control-expose-headers"], /payment-response/u, url);
      }
    } finally {
      await app.close();
    }
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

  it("delegates Browserbase session input defaults to the API", async () => {
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
      input: {},
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

  it("accepts legacy MCP environment aliases only in explicit dev mode", async () => {
    const prodAliasResult = await callTool("toolrouter_list_endpoints", {}, {
      env: {
        NEXT_PUBLIC_TOOLROUTER_API_URL: "http://router.test",
        AGENTKIT_ROUTER_DEV_API_KEY: "tr_legacy",
      },
      fetchImpl: async () => response({ endpoints: [] }),
    });
    assert.equal(prodAliasResult.isError, true);
    assert.match(prodAliasResult.content[0].text, /TOOLROUTER_API_KEY/u);

    const calls = [];
    const devAliasResult = await callTool("toolrouter_list_endpoints", {}, {
      env: {
        ROUTER_DEV_MODE: "true",
        NEXT_PUBLIC_TOOLROUTER_API_URL: "http://router.test",
        AGENTKIT_ROUTER_DEV_API_KEY: "tr_legacy",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ endpoints: [] });
      },
    });
    assert.equal(devAliasResult.isError, false);
    assert.equal(calls[0].url, "http://router.test/v1/endpoints");
    assert.equal(calls[0].init.headers.authorization, "Bearer tr_legacy");
  });
});
