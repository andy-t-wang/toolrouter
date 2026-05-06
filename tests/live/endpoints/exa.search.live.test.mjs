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
const runLive = process.env.RUN_LIVE_EXA_TESTS === "true" && (Boolean(process.env.AGENT_WALLET_PRIVATE_KEY) || hasCrossmintSigner);
const runPaid = runLive && process.env.RUN_LIVE_EXA_PAID_SMOKE === "true";

function configureLiveDefaults() {
  process.env.ROUTER_DEV_MODE = "false";
  process.env.X402_ALLOWED_HOSTS ||= "api.exa.ai";
  process.env.X402_ALLOWED_CHAINS ||= "eip155:8453,eip155:480";
  process.env.X402_MAX_USD_PER_REQUEST ||= "0.01";
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

describe("exa.search live AgentKit/x402 smoke", () => {
  it("uses AgentKit first with paid fallback capped at one cent", { skip: runLive ? false : "live Exa smoke disabled" }, async () => {
    const endpoint = getEndpoint("exa.search");
    const result = await runSmoke({
      endpoint,
      smoke: endpoint.liveSmoke.default_path,
      traceId: `live_agentkit_${Date.now()}`,
    });

    assert.equal(result.ok, true);
    assert.ok(["agentkit", "agentkit_to_x402"].includes(result.path));
    assert.equal(result.status_code, 200);
    assert.ok(result.body);
  });

  it("can force a capped x402 payment for wallet plumbing", { skip: runPaid ? false : "paid Exa smoke disabled" }, async () => {
    const endpoint = getEndpoint("exa.search");
    const result = await runSmoke({
      endpoint,
      smoke: endpoint.liveSmoke.paid_path,
      traceId: `live_x402_${Date.now()}`,
    });

    assert.equal(result.ok, true);
    assert.equal(result.path, "x402");
    assert.equal(result.charged, true);
    assert.equal(result.status_code, 200);
    assert.ok(result.body);
  });
});
