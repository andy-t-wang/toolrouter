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
const runLive = process.env.RUN_LIVE_BROWSERBASE_TESTS === "true" && (Boolean(process.env.AGENT_WALLET_PRIVATE_KEY) || hasCrossmintSigner);
const runPaid = runLive && process.env.RUN_LIVE_BROWSERBASE_PAID_SMOKE === "true";

function configureLiveDefaults() {
  process.env.ROUTER_DEV_MODE = "false";
  process.env.X402_ALLOWED_HOSTS ||= "api.exa.ai,x402.browserbase.com";
  process.env.X402_ALLOWED_CHAINS ||= "eip155:8453,eip155:480";
  process.env.X402_MAX_USD_PER_REQUEST ||= "0.02";
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

async function runSmoke({ endpointId, smoke, traceId }) {
  configureLiveDefaults();
  const endpoint = getEndpoint(endpointId);
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

describe("Browserbase live AgentKit/x402 smoke", () => {
  it("can call Browserbase session with AgentKit access and a strict cap", { skip: runLive ? false : "live Browserbase smoke disabled" }, async () => {
    const endpoint = getEndpoint("browserbase.session");
    const result = await runSmoke({
      endpointId: "browserbase.session",
      smoke: endpoint.liveSmoke.default_path,
      traceId: `live_browserbase_agentkit_${Date.now()}`,
    });

    assert.equal(result.ok, true);
    assert.ok(["agentkit", "agentkit_to_x402"].includes(result.path));
    assert.equal(result.status_code, 200);
    assert.ok(result.body);
  });

  it("can force capped Browserbase x402 payments for each paid access endpoint", { skip: runPaid ? false : "paid Browserbase smoke disabled" }, async () => {
    for (const endpointId of ["browserbase.session"]) {
      const endpoint = getEndpoint(endpointId);
      const result = await runSmoke({
        endpointId,
        smoke: endpoint.liveSmoke.paid_path,
        traceId: `live_${endpointId.replace(/\W/gu, "_")}_x402_${Date.now()}`,
      });

      assert.equal(result.ok, true, endpointId);
      assert.ok(["x402", "agentkit_to_x402"].includes(result.path), endpointId);
      assert.equal(result.charged, true, endpointId);
      assert.equal(result.status_code, 200, endpointId);
      assert.ok(result.body, endpointId);
    }
  });
});
