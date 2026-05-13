import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCrossmintClient } from "../../../apps/api/src/crossmint.ts";
import { executeEndpoint, getEndpoint } from "../../../packages/router-core/src/index.ts";

const providerEndpointIds = {
  fal: ["fal.image_fast"],
  run402: ["run402.prototype"],
  perplexity: ["perplexity.search"],
  parallel: ["parallel.search"],
  firecrawl: ["firecrawl.scrape_url", "firecrawl.extract_web_data"],
  wolframalpha: ["wolframalpha.result", "wolframalpha.query"],
  flightaware: [
    "flightaware.airports",
    "flightaware.airport_delays",
    "flightaware.airport_info",
    "flightaware.arrivals",
    "flightaware.departures",
    "flightaware.weather_observations",
    "flightaware.airport_delay_status",
    "flightaware.flights_between_airports",
    "flightaware.disruption_counts_airline",
    "flightaware.flight_track",
  ],
  amadeus: ["amadeus.activities_search", "amadeus.activities_by_square"],
  agentmail: ["agentmail.pods"],
};

const allHosts = [
  "api.exa.ai",
  "x402.browserbase.com",
  "api.run402.com",
  "pplx.x402.paysponge.com",
  "parallelmpp.dev",
  "mesh.heurist.xyz",
  "wolframalpha.x402.paysponge.com",
  "stabletravel.dev",
  "x402.api.agentmail.to",
  "x402-gateway-production.up.railway.app",
].join(",");

const hasCrossmintSigner = Boolean(
  process.env.CROSSMINT_SERVER_SIDE_API_KEY &&
    process.env.CROSSMINT_SIGNER_SECRET &&
    process.env.CROSSMINT_LIVE_WALLET_LOCATOR &&
    process.env.CROSSMINT_LIVE_WALLET_ADDRESS,
);

function providerEnabled(provider) {
  return (
    process.env[`RUN_LIVE_${provider.toUpperCase()}_TESTS`] === "true" &&
    (Boolean(process.env.AGENT_WALLET_PRIVATE_KEY) || hasCrossmintSigner)
  );
}

function configureLiveDefaults() {
  process.env.ROUTER_DEV_MODE = "false";
  process.env.X402_ALLOWED_HOSTS ||= allHosts;
  process.env.X402_ALLOWED_CHAINS ||= "eip155:8453,eip155:480,base";
  process.env.X402_MAX_USD_PER_REQUEST ||= "0.11";
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

async function runSmoke(endpointId) {
  configureLiveDefaults();
  const endpoint = getEndpoint(endpointId);
  const smoke = endpoint.liveSmoke.default_path;
  const request = endpoint.buildRequest(smoke.input);
  assert.equal(request.headers?.authorization, undefined);
  assert.equal(request.headers?.["x-api-key"], undefined);
  assert.ok(Number(request.estimatedUsd) <= Number(smoke.max_usd), endpointId);

  return executeEndpoint({
    endpoint,
    request,
    maxUsd: smoke.max_usd,
    paymentMode: smoke.payment_mode,
    traceId: `live_${endpointId.replace(/\W/gu, "_")}_${Date.now()}`,
    paymentSigner: livePaymentSigner(),
  });
}

describe("working x402 endpoint live smoke", () => {
  for (const [provider, endpointIds] of Object.entries(providerEndpointIds)) {
    for (const endpointId of endpointIds) {
      it(`${endpointId} succeeds through a capped x402 path`, { skip: providerEnabled(provider) ? false : `live ${provider} smoke disabled` }, async () => {
        const result = await runSmoke(endpointId);
        assert.equal(result.ok, true, endpointId);
        assert.equal(result.path, "x402", endpointId);
        assert.equal(result.charged, true, endpointId);
        assert.equal(result.status_code, 200, endpointId);
        assert.ok(result.body !== null, endpointId);
      });
    }
  }
});
