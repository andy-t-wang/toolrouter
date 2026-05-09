import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { executeEndpoint } from "../../../packages/router-core/src/executor/agentkitExecutor.ts";

const ENV_KEYS = [
  "ROUTER_DEV_MODE",
  "AGENT_WALLET_PRIVATE_KEY",
  "AGENTKIT_CHAIN_ID",
  "X402_ALLOWED_HOSTS",
  "X402_ALLOWED_CHAINS",
  "X402_DEFAULT_CHAIN_ID",
  "X402_MAX_USD_PER_REQUEST",
];

function saveEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function baseEndpoint() {
  return {
    id: "exa.search",
    defaultPaymentMode: "agentkit_first",
  };
}

function providerRequest(headers = {}) {
  return {
    method: "POST",
    url: "https://api.exa.ai/search",
    headers: { "content-type": "application/json", ...headers },
    json: { query: "AgentKit", type: "fast", numResults: 5 },
    estimatedUsd: "0.007",
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    status: init.status || 200,
  });
}

function paymentResponse(body = { results: [] }) {
  const receipt = Buffer.from(
    JSON.stringify({
      transaction: "0xsettled",
      network: "eip155:8453",
      amount_usd: "0.007",
      currency: "USD",
    }),
  ).toString("base64");
  return jsonResponse(body, { headers: { "payment-response": receipt } });
}

function fakePaymentDeps({ captures, agentkitResponse, x402Response, selectedRequirements }) {
  class FakeX402Client {
    register() {}
    registerV1(network) {
      captures.v1Networks.push(network);
    }
    registerPolicy(policy) {
      captures.policies.push(policy);
    }
    onBeforePaymentCreation(handler) {
      this.beforePayment = handler;
    }
  }

  class FakeExactEvmScheme {
    constructor(account) {
      captures.schemeAccount = account;
    }
  }

  return {
    createAgentkitClient(config) {
      captures.agentkitConfig = config;
      return {
        async fetch(url, init) {
          captures.agentkitCalls.push({ url, init });
          return agentkitResponse;
        },
      };
    },
    formatSIWEMessage(info, address) {
      captures.agentkitProofInfo = info;
      return `siwe:${info.domain}:${info.uri}:${info.chainId}:${address}`;
    },
    x402Client: FakeX402Client,
    ExactEvmScheme: FakeExactEvmScheme,
    registerExactEvmScheme(client, config) {
      captures.schemeAccount = config.signer;
      client.register("eip155:*", new FakeExactEvmScheme(config.signer));
      client.registerV1("base", new FakeExactEvmScheme(config.signer));
    },
    wrapFetchWithPayment(_baseFetch, client) {
      return async (url, init) => {
        captures.x402Calls.push({ url, init });
        client.beforePayment?.({
          selectedRequirements: selectedRequirements || {
            network: "eip155:8453",
            amount: "7000",
            scheme: "exact",
          },
        });
        return x402Response;
      };
    },
    privateKeyToAccount() {
      return {
        address: "0x0000000000000000000000000000000000000001",
        signMessage: async ({ message }) => `signed:${message}`,
      };
    },
  };
}

function captures() {
  return {
    agentkitCalls: [],
    x402Calls: [],
    policies: [],
    agentkitConfig: null,
    agentkitProofInfo: null,
    schemeAccount: null,
    v1Networks: [],
  };
}

describe("AgentKit/x402 executor", () => {
  let env;

  beforeEach(() => {
    env = saveEnv();
    process.env.ROUTER_DEV_MODE = "false";
    process.env.AGENT_WALLET_PRIVATE_KEY =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    process.env.X402_ALLOWED_HOSTS = "api.exa.ai";
    process.env.X402_ALLOWED_CHAINS = "eip155:8453,eip155:480";
    process.env.X402_MAX_USD_PER_REQUEST = "0.05";
    delete process.env.AGENTKIT_CHAIN_ID;
  });

  afterEach(() => {
    restoreEnv(env);
  });

  it("uses AgentKit first with World Chain signing by default", async () => {
    const seen = captures();
    const result = await executeEndpoint({
      endpoint: baseEndpoint(),
      request: providerRequest(),
      maxUsd: "0.01",
      traceId: "trace_agentkit",
      paymentDeps: fakePaymentDeps({
        captures: seen,
        agentkitResponse: jsonResponse({ results: [] }),
        x402Response: paymentResponse(),
      }),
    });

    assert.equal(result.path, "agentkit");
    assert.equal(result.charged, false);
    assert.equal(seen.x402Calls.length, 0);
    assert.equal(seen.agentkitCalls.length, 1);
    assert.equal(seen.agentkitConfig.signer.chainId, "eip155:480");
    assert.equal(seen.agentkitCalls[0].init.headers.get("authorization"), null);
    assert.equal(seen.agentkitCalls[0].init.headers.get("x-api-key"), null);
  });

  it("falls back from AgentKit to x402 and records the combined path", async () => {
    const seen = captures();
    const result = await executeEndpoint({
      endpoint: baseEndpoint(),
      request: providerRequest(),
      maxUsd: "0.01",
      traceId: "trace_fallback",
      paymentDeps: fakePaymentDeps({
        captures: seen,
        agentkitResponse: new Response("", { status: 402 }),
        x402Response: paymentResponse({ results: [{ url: "https://example.com" }] }),
      }),
    });

    assert.equal(result.path, "agentkit_to_x402");
    assert.equal(result.charged, true);
    assert.equal(result.payment_network, "eip155:8453");
    assert.equal(result.amount_usd, "0.007");
    assert.equal(seen.agentkitCalls.length, 1);
    assert.equal(seen.x402Calls.length, 1);
    assert.deepEqual(seen.v1Networks, ["base"]);
  });

  it("does not mark a failed x402 retry as charged", async () => {
    const seen = captures();
    const result = await executeEndpoint({
      endpoint: baseEndpoint(),
      request: providerRequest(),
      maxUsd: "0.01",
      traceId: "trace_failed_fallback",
      paymentDeps: fakePaymentDeps({
        captures: seen,
        agentkitResponse: new Response("", { status: 402 }),
        x402Response: jsonResponse(
          { error: "Payment required to access this resource" },
          { status: 402 },
        ),
      }),
    });

    assert.equal(result.path, "agentkit_to_x402");
    assert.equal(result.status_code, 402);
    assert.equal(result.ok, false);
    assert.equal(result.charged, false);
    assert.equal(result.amount_usd, null);
    assert.equal(result.payment_reference, null);
  });

  it("supports x402-only mode for paid live smoke tests", async () => {
    const seen = captures();
    const result = await executeEndpoint({
      endpoint: baseEndpoint(),
      request: providerRequest(),
      maxUsd: "0.01",
      traceId: "trace_x402",
      paymentMode: "x402_only",
      paymentDeps: fakePaymentDeps({
        captures: seen,
        agentkitResponse: jsonResponse({ shouldNotBeUsed: true }),
        x402Response: paymentResponse({ results: [] }),
      }),
    });

    assert.equal(result.path, "x402");
    assert.equal(result.charged, true);
    assert.equal(seen.agentkitCalls.length, 0);
    assert.equal(seen.x402Calls.length, 1);
  });

  it("sends Browserbase AgentKit proof headers through the x402 payment rail", async () => {
    process.env.X402_ALLOWED_HOSTS = "x402.browserbase.com";
    process.env.X402_ALLOWED_CHAINS = "eip155:8453";
    const seen = captures();
    const result = await executeEndpoint({
      endpoint: {
        id: "browserbase.session",
        defaultPaymentMode: "agentkit_first",
        agentkit_proof_header: true,
      },
      request: {
        method: "POST",
        url: "https://x402.browserbase.com/browser/session/create",
        headers: {},
        json: { estimatedMinutes: 5 },
        estimatedUsd: "0.01",
      },
      maxUsd: "0.02",
      traceId: "trace_browserbase_agentkit_header",
      paymentDeps: fakePaymentDeps({
        captures: seen,
        agentkitResponse: jsonResponse({ shouldNotBeUsed: true }),
        x402Response: paymentResponse({ connectUrl: "wss://connect.browserbase.com/session" }),
        selectedRequirements: {
          network: "base",
          maxAmountRequired: "10000",
          scheme: "exact",
        },
      }),
    });

    assert.equal(result.path, "agentkit_to_x402");
    assert.equal(result.charged, true);
    assert.equal(result.amount_usd, "0.007");
    assert.equal(seen.agentkitCalls.length, 0);
    assert.equal(seen.x402Calls.length, 1);
    const encoded = seen.x402Calls[0].init.headers.get("agentkit");
    assert.ok(encoded);
    const proof = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    assert.equal(proof.domain, "x402.browserbase.com");
    assert.equal(proof.uri, "https://x402.browserbase.com/browser/session/create");
    assert.equal(proof.chainId, "eip155:480");
    assert.equal(proof.address, "0x0000000000000000000000000000000000000001");
    assert.match(proof.signature, /^signed:siwe:x402\.browserbase\.com:/);
    assert.equal(seen.agentkitProofInfo.statement, "Verify your agent is backed by a real human");

    const networkPolicy = seen.policies[0];
    assert.deepEqual(
      networkPolicy(1, [
        { network: "base", scheme: "exact", maxAmountRequired: "10000" },
        { network: "eip155:137", scheme: "exact", amount: "10000" },
      ]).map((requirement) => requirement.network),
      ["base"],
    );
    const amountPolicy = seen.policies[1];
    assert.deepEqual(
      amountPolicy(1, [
        { network: "base", scheme: "exact", maxAmountRequired: "10000" },
        { network: "base", scheme: "exact", maxAmountRequired: "30000" },
      ]).map((requirement) => requirement.maxAmountRequired),
      ["10000"],
    );
  });

  it("can sign AgentKit requests through an injected hosted-wallet signer", async () => {
    const seen = captures();
    const signedMessages = [];
    const result = await executeEndpoint({
      endpoint: baseEndpoint(),
      request: providerRequest(),
      maxUsd: "0.01",
      traceId: "trace_crossmint",
      paymentSigner: {
        address: "0x00000000000000000000000000000000000000c1",
        signMessage: async ({ message }) => {
          signedMessages.push(message);
          return `crossmint:${message}`;
        },
      },
      paymentDeps: fakePaymentDeps({
        captures: seen,
        agentkitResponse: jsonResponse({ results: [] }),
        x402Response: paymentResponse(),
      }),
    });

    assert.equal(result.path, "agentkit");
    assert.equal(seen.agentkitConfig.signer.address, "0x00000000000000000000000000000000000000c1");
    assert.equal(seen.schemeAccount, null);
    assert.equal(seen.agentkitCalls.length, 1);
  });

  it("uses the server emergency payment ceiling when caller maxUsd is higher", async () => {
    const seen = captures();
    const result = await executeEndpoint({
      endpoint: baseEndpoint(),
      request: providerRequest(),
      maxUsd: "0.10",
      traceId: "trace_emergency_cap",
      paymentDeps: fakePaymentDeps({
        captures: seen,
        agentkitResponse: new Response("", { status: 402 }),
        x402Response: paymentResponse({ results: [] }),
      }),
    });

    assert.equal(result.path, "agentkit_to_x402");
    assert.equal(seen.agentkitCalls.length, 1);
    assert.equal(seen.x402Calls.length, 1);

    const amountPolicy = seen.policies[1];
    const filtered = amountPolicy("1", [
      { network: "eip155:8453", amount: "60000", scheme: "exact" },
      { network: "eip155:8453", amount: "50000", scheme: "exact" },
    ]);
    assert.deepEqual(filtered.map((requirement) => requirement.amount), ["50000"]);
  });
});
