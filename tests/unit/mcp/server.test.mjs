import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, webcrypto } from "node:crypto";

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

async function encryptedBridgeResponse(keyBase64, payload) {
  const iv = randomBytes(12);
  const key = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(keyBase64, "base64"),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const encrypted = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return {
    iv: Buffer.from(iv).toString("base64"),
    payload: Buffer.from(encrypted).toString("base64"),
  };
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
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_start_onboarding"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_attach_onboarding_user"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_create_onboarding_checkout"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_start_world_verification"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_poll_world_verification"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_check_world_verification"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_search"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_list_categories"));
    assert.ok(listed.result.tools.some((tool) => tool.name === "toolrouter_recommend_endpoint"));
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

  it("runs onboarding bootstrap tools without a ToolRouter API key", async () => {
    const calls = [];
    const configPath = join(mkdtempSync(join(tmpdir(), "toolrouter-mcp-config-")), "mcp-client-config.json");
    const projectKey = "/workspace/toolrouter-test-project";
    writeFileSync(configPath, JSON.stringify({
      projects: {
        [projectKey]: {
          mcpServers: {
            toolrouter: {
              type: "stdio",
              command: "node",
              args: ["/repo/apps/mcp/src/server.ts"],
              env: {
                TOOLROUTER_API_URL: "http://router.test",
                TOOLROUTER_MCP_PERSIST_API_KEY: "true",
                TOOLROUTER_MCP_CONFIG_PATH: configPath,
                TOOLROUTER_MCP_CONFIG_PROJECT: projectKey,
                TOOLROUTER_MCP_SERVER_NAME: "toolrouter",
              },
            },
          },
        },
      },
    }, null, 2));
    const env = {
      TOOLROUTER_API_URL: "http://router.test",
      TOOLROUTER_MCP_PERSIST_API_KEY: "true",
      TOOLROUTER_MCP_CONFIG_PATH: configPath,
      TOOLROUTER_MCP_CONFIG_PROJECT: projectKey,
      TOOLROUTER_MCP_SERVER_NAME: "toolrouter",
    };
    const runtime = {};
    let bridgeKeyBase64 = "";
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const body = init.body ? JSON.parse(init.body) : null;
      if (url === "http://router.test/v1/onboarding/sessions") {
        assert.equal(init.headers.authorization, undefined);
        assert.equal(body.email, "agent.user@example.com");
        return response({
          onboarding_session: {
            id: "obs_1",
            status: "auth_link_sent",
            auth_url: "https://supabase.test/magic",
          },
          claim_token: "otr_claim",
        }, { status: 201 });
      }
      if (url === "http://router.test/v1/onboarding/sessions/obs_1") {
        assert.equal(init.headers.authorization, "Bearer otr_claim");
        return response({ onboarding_session: { id: "obs_1", status: "auth_link_sent" } });
      }
      if (url === "http://router.test/v1/onboarding/sessions/obs_1/attach-user") {
        assert.equal(init.headers.authorization, "Bearer dev_supabase_session");
        assert.equal(body.claim_token, "otr_claim");
        assert.equal(body.caller_id, "codex-local-cli");
        return response({
          onboarding_session: { id: "obs_1", status: "api_key_created" },
          api_key: "tr_created",
        }, { status: 201 });
      }
      if (url === "http://router.test/v1/categories") {
        assert.equal(init.headers.authorization, "Bearer tr_created");
        return response({
          categories: [
            {
              id: "search",
              name: "Search",
              recommended_endpoint: { id: "exa.search" },
            },
          ],
        });
      }
      if (url === "http://router.test/v1/onboarding/sessions/obs_1/checkout") {
        assert.equal(init.headers.authorization, "Bearer otr_claim");
        assert.equal(body.amount_usd, "5");
        return response({
          onboarding_session: { id: "obs_1", status: "checkout_pending" },
          top_up: {
            id: "cp_1",
            provider: "stripe",
            provider_reference: "cs_test_1",
            amount_usd: "5",
            checkout_url: "https://checkout.stripe.test/cs_test_1",
            status: "checkout_pending",
          },
        }, { status: 201 });
      }
      if (url === "http://router.test/v1/agentkit/registration") {
        assert.equal(init.headers.authorization, "Bearer dev_supabase_session");
        return response({
          registration: {
            app_id: "app_test",
            action: "agentbook-registration",
            signal: {
              types: ["address", "uint256"],
              values: ["0x00000000000000000000000000000000000000c1", "7"],
            },
            verification_level: "orb",
            nonce: "7",
            expires_in_seconds: 300,
          },
          agentkit_verification: { verified: false },
        });
      }
      if (url === "https://bridge.test/request") {
        assert.equal(init.method, "POST");
        assert.ok(body.iv);
        assert.ok(body.payload);
        return response({ request_id: "wid_req_1" }, { status: 201 });
      }
      if (url === "https://bridge.test/response/wid_req_1") {
        assert.ok(bridgeKeyBase64);
        return response({
          status: "completed",
          response: await encryptedBridgeResponse(bridgeKeyBase64, {
            merkle_root: "0xroot",
            nullifier_hash: "0xnullifier",
            proof: ["0xproof"],
            verification_level: "orb",
          }),
        });
      }
      if (url === "http://router.test/v1/agentkit/registration/complete") {
        assert.equal(init.headers.authorization, "Bearer dev_supabase_session");
        assert.equal(body.nonce, "7");
        assert.equal(body.result.nullifier_hash, "0xnullifier");
        return response({
          registration: { tx_hash: "0xtx", already_registered: false },
          agentkit_verification: { verified: true },
        });
      }
      if (url === "http://router.test/v1/agentkit/account-verification") {
        assert.equal(init.headers.authorization, "Bearer dev_supabase_session");
        return response({ agentkit_verification: { verified: true } });
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const started = await callTool("toolrouter_start_onboarding", {
      email: "agent.user@example.com",
      client: "codex",
    }, { env, fetchImpl, runtime });
    assert.equal(started.isError, false);
    assert.equal(started.structuredContent.claim_token, "otr_claim");
    assert.equal(started.structuredContent.next_steps.world_verification_required, false);

    const polled = await callTool("toolrouter_get_onboarding_session", {
      onboarding_session_id: "obs_1",
      claim_token: "otr_claim",
    }, { env, fetchImpl, runtime });
    assert.equal(polled.isError, false);
    assert.equal(polled.structuredContent.onboarding_session.status, "auth_link_sent");

    const attached = await callTool("toolrouter_attach_onboarding_user", {
      onboarding_session_id: "obs_1",
      claim_token: "otr_claim",
      supabase_access_token: "dev_supabase_session",
      caller_id: "codex-local-cli",
    }, { env, fetchImpl, runtime });
    assert.equal(attached.isError, false);
    assert.equal(attached.structuredContent.api_key, "tr_created");
    assert.equal(attached.structuredContent.mcp_config.persisted, true);
    assert.equal(attached.structuredContent.next_steps.world_verification_required, false);
    assert.equal(runtime.apiKey, "tr_created");
    assert.equal(runtime.supabaseAccessToken, "dev_supabase_session");
    const persistedConfig = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(
      persistedConfig.projects[projectKey].mcpServers.toolrouter.env.TOOLROUTER_API_KEY,
      "tr_created",
    );

    const categories = await callTool("toolrouter_list_categories", {}, { env, fetchImpl, runtime });
    assert.equal(categories.isError, false);
    assert.equal(categories.structuredContent.categories[0].id, "search");

    const checkout = await callTool("toolrouter_create_onboarding_checkout", {
      onboarding_session_id: "obs_1",
      claim_token: "otr_claim",
      amount_usd: "5",
    }, { env, fetchImpl, runtime });
    assert.equal(checkout.isError, false);
    assert.equal(checkout.structuredContent.top_up.provider_reference, "cs_test_1");
    assert.equal(checkout.structuredContent.next_steps.world_verification_required, false);

    const startedWorld = await callTool("toolrouter_start_world_verification", {
      bridge_url: "https://bridge.test",
    }, { env, fetchImpl, runtime });
    assert.equal(startedWorld.isError, false);
    const verificationUrl = startedWorld.structuredContent.world_bridge.verification_url;
    assert.match(verificationUrl, /^https:\/\/world\.org\/verify/);
    bridgeKeyBase64 = new URL(verificationUrl).searchParams.get("k");
    assert.ok(bridgeKeyBase64);

    const completedWorld = await callTool("toolrouter_poll_world_verification", {}, { env, fetchImpl, runtime });
    assert.equal(completedWorld.isError, false);
    assert.equal(completedWorld.structuredContent.agentkit_verification.verified, true);
    assert.equal(completedWorld.structuredContent.world_bridge.completed, true);

    const checkedWorld = await callTool("toolrouter_check_world_verification", {}, { env, fetchImpl, runtime });
    assert.equal(checkedWorld.isError, false);
    assert.equal(checkedWorld.structuredContent.agentkit_verification.verified, true);
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        "http://router.test/v1/onboarding/sessions",
        "http://router.test/v1/onboarding/sessions/obs_1",
        "http://router.test/v1/onboarding/sessions/obs_1/attach-user",
        "http://router.test/v1/categories",
        "http://router.test/v1/onboarding/sessions/obs_1/checkout",
        "http://router.test/v1/agentkit/registration",
        "https://bridge.test/request",
        "https://bridge.test/response/wid_req_1",
        "http://router.test/v1/agentkit/registration/complete",
        "http://router.test/v1/agentkit/account-verification",
      ],
    );
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
