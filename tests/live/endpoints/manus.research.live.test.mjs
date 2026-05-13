import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCrossmintClient } from "../../../apps/api/src/crossmint.ts";
import { createApiApp } from "../../../apps/api/src/app.ts";
import { MemoryCache } from "../../../packages/cache/src/index.ts";
import { LocalStore } from "../../../packages/db/src/index.ts";
import { executeEndpoint, getEndpoint } from "../../../packages/router-core/src/index.ts";

const hasCrossmintSigner = Boolean(
  process.env.CROSSMINT_SERVER_SIDE_API_KEY &&
    process.env.CROSSMINT_SIGNER_SECRET &&
    process.env.CROSSMINT_LIVE_WALLET_LOCATOR &&
    process.env.CROSSMINT_LIVE_WALLET_ADDRESS,
);
const runLive = process.env.RUN_LIVE_MANUS_TESTS === "true" && (Boolean(process.env.AGENT_WALLET_PRIVATE_KEY) || hasCrossmintSigner);
const runPaid = runLive && process.env.RUN_LIVE_MANUS_PAID_SMOKE === "true";
const runApiProxy =
  process.env.RUN_LIVE_MANUS_API_PROXY_TESTS === "true" &&
  Boolean(process.env.AGENT_WALLET_PRIVATE_KEY);

function configureLiveDefaults() {
  process.env.ROUTER_DEV_MODE = "false";
  const allowedHosts = new Set(
    String(process.env.X402_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  );
  allowedHosts.add("toolrouter.world");
  process.env.X402_ALLOWED_HOSTS = [...allowedHosts].join(",");
  process.env.X402_ALLOWED_CHAINS ||= "eip155:8453,eip155:480";
  process.env.X402_MAX_USD_PER_REQUEST = "0.05";
  process.env.AGENTKIT_CHAIN_ID ||= "eip155:480";
}

function livePaymentSigner() {
  if (!hasCrossmintSigner) return null;
  const crossmint = createCrossmintClient();
  return {
    address: process.env.CROSSMINT_LIVE_WALLET_ADDRESS,
    signMessage: async (payload) => {
      const message = payload && typeof payload === "object" && "message" in payload ? payload.message : payload;
      return crossmint.signMessage({
        walletLocator: process.env.CROSSMINT_LIVE_WALLET_LOCATOR,
        message,
      });
    },
    signTypedData: async (payload) =>
      crossmint.signTypedData({
        walletLocator: process.env.CROSSMINT_LIVE_WALLET_LOCATOR,
        domain: payload.domain,
        types: payload.types,
        primaryType: payload.primaryType,
        message: payload.message,
      }),
  };
}

async function runSmoke({ endpoint, smoke, traceId }) {
  configureLiveDefaults();
  const request = endpoint.buildRequest(smoke.input);
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers["x-api-key"], undefined);
  assert.ok(Number(request.estimatedUsd) <= Number(smoke.max_usd));

  return executeEndpoint({
    endpoint,
    request,
    maxUsd: smoke.max_usd,
    paymentMode: smoke.payment_mode,
    traceId,
    paymentSigner: livePaymentSigner(),
  });
}

describe("manus.research live AgentKit/x402 smoke", () => {
  it("uses the two-per-month AgentKit free-trial path when available", { skip: runLive ? false : "live Manus smoke disabled" }, async () => {
    const endpoint = getEndpoint("manus.research");
    const result = await runSmoke({
      endpoint,
      smoke: endpoint.liveSmoke.default_path,
      traceId: `live_manus_agentkit_${Date.now()}`,
    });

    assert.equal(result.ok, true);
    assert.equal(result.path, "agentkit");
    assert.equal(result.charged, false);
    assert.equal(result.status_code, 200);
    assert.ok(result.body);
  });

  it("can force a capped x402 payment for the wrapper", { skip: runPaid ? false : "paid Manus smoke disabled" }, async () => {
    const endpoint = getEndpoint("manus.research");
    const result = await runSmoke({
      endpoint,
      smoke: endpoint.liveSmoke.paid_path,
      traceId: `live_manus_x402_${Date.now()}`,
    });

    assert.equal(result.ok, true);
    assert.equal(result.path, "x402");
    assert.equal(result.charged, true);
    assert.equal(result.status_code, 200);
    assert.ok(result.body);
  });

  it("can proxy a paid Manus request through /v1/requests", { skip: runApiProxy ? false : "live Manus API proxy smoke disabled" }, async () => {
    const envKeys = [
      "ROUTER_DEV_MODE",
      "CROSSMINT_SERVER_SIDE_API_KEY",
      "CROSSMINT_API_KEY",
      "CROSSMINT_SIGNER_SECRET",
      "CROSSMINT_LIVE_WALLET_LOCATOR",
      "CROSSMINT_LIVE_WALLET_ADDRESS",
      "X402_ALLOWED_HOSTS",
      "X402_ALLOWED_CHAINS",
      "X402_MAX_USD_PER_REQUEST",
      "TOOLROUTER_X402_PROVIDER_URL",
    ];
    const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.ROUTER_DEV_MODE = "false";
    process.env.CROSSMINT_SERVER_SIDE_API_KEY = "";
    process.env.CROSSMINT_API_KEY = "";
    process.env.CROSSMINT_SIGNER_SECRET = "";
    process.env.CROSSMINT_LIVE_WALLET_LOCATOR = "";
    process.env.CROSSMINT_LIVE_WALLET_ADDRESS = "";
    process.env.X402_ALLOWED_CHAINS = "eip155:8453,eip155:480";
    process.env.X402_MAX_USD_PER_REQUEST = "0.05";
    process.env.TOOLROUTER_X402_PROVIDER_URL = "https://toolrouter.world";
    process.env.X402_ALLOWED_HOSTS = Array.from(
      new Set(
        String(process.env.X402_ALLOWED_HOSTS || "")
          .split(",")
          .filter(Boolean)
          .concat("toolrouter.world"),
      ),
    ).join(",");

    const store = new LocalStore({
      path: join(mkdtempSync(join(tmpdir(), "toolrouter-live-manus-api-proxy-")), "store.json"),
    });
    const userId = "00000000-0000-4000-8000-000000000101";
    const key = await store.createApiKey({ user_id: userId, caller_id: "live-manus-proxy" });
    await store.upsertCreditAccount({
      user_id: userId,
      available_usd: "1",
      pending_usd: "0",
      reserved_usd: "0",
      currency: "USD",
    });
    const app = createApiApp({ logger: false, cache: new MemoryCache(), store });
    await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const endpoint = getEndpoint("manus.research");
      const smoke = endpoint.liveSmoke.paid_path;
      const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
      const response = await fetch(`${baseUrl}/v1/requests`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.api_key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          endpoint_id: "manus.research",
          input: smoke.input,
          maxUsd: smoke.max_usd,
          payment_mode: smoke.payment_mode,
        }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.endpoint_id, "manus.research");
      assert.equal(body.path, "x402");
      assert.equal(body.charged, true);
      assert.equal(body.status_code, 200);
      assert.equal(body.credit_captured_usd, smoke.max_usd);
      assert.ok(body.body);
    } finally {
      await app.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
