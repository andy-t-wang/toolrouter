import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCrossmintClient } from "../../../apps/api/src/crossmint.ts";
import { executeEndpoint, getEndpoint } from "../../../packages/router-core/src/index.ts";

const hasCrossmintSigner = Boolean(
  process.env.CROSSMINT_SERVER_SIDE_API_KEY &&
    process.env.CROSSMINT_SIGNER_SECRET &&
    process.env.CROSSMINT_LIVE_WALLET_LOCATOR &&
    process.env.CROSSMINT_LIVE_WALLET_ADDRESS,
);
const runLive = process.env.RUN_LIVE_MANUS_TESTS === "true" && (Boolean(process.env.AGENT_WALLET_PRIVATE_KEY) || hasCrossmintSigner);
const runPaid = runLive && process.env.RUN_LIVE_MANUS_PAID_SMOKE === "true";

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
});
