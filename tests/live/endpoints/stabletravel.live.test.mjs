import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { executeEndpoint, getEndpoint } from "../../../packages/router-core/src/index.ts";

const runLive = process.env.RUN_LIVE_STABLETRAVEL_TESTS === "true";
const runPaid = runLive &&
  process.env.RUN_LIVE_STABLETRAVEL_PAID_SMOKE === "true" &&
  Boolean(process.env.AGENT_WALLET_PRIVATE_KEY);

function configureLiveDefaults() {
  process.env.ROUTER_DEV_MODE = "false";
  process.env.X402_ALLOWED_HOSTS ||= "stabletravel.dev";
  process.env.X402_ALLOWED_CHAINS ||= "eip155:8453,base";
  process.env.X402_MAX_USD_PER_REQUEST ||= "0.04";
}

function decodePaymentRequired(header) {
  assert.ok(header, "payment-required header is required");
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
}

describe("stabletravel live x402 handshake", () => {
  for (const endpointId of [
    "stabletravel.locations",
    "stabletravel.google_flights_search",
    "stabletravel.hotels_list",
    "stabletravel.hotels_search",
    "stabletravel.flightaware_flights",
  ]) {
    it(`${endpointId} returns a bounded x402 challenge`, { skip: runLive ? false : "live StableTravel smoke disabled" }, async () => {
      configureLiveDefaults();
      const endpoint = getEndpoint(endpointId);
      const request = endpoint.buildRequest(endpoint.liveSmoke.default_path.input);
      assert.equal(request.method, "GET");
      assert.equal(request.json, undefined);
      assert.ok(Number(request.estimatedUsd) <= Number(endpoint.liveSmoke.default_path.max_usd));

      const response = await fetch(request.url, { method: request.method });
      assert.equal(response.status, 402);
      assert.ok(response.headers.get("www-authenticate"));
      const challenge = decodePaymentRequired(response.headers.get("payment-required"));
      assert.equal(challenge.resource.method, "GET");
      assert.equal(challenge.resource.url, request.url);
      assert.ok(Array.isArray(challenge.accepts));
      const baseUsdc = challenge.accepts.find((accept) => accept.network === "eip155:8453");
      assert.ok(baseUsdc, "expected Base USDC x402 accept");
      assert.ok(Number(baseUsdc.amount) / 1_000_000 <= Number(endpoint.liveSmoke.default_path.max_usd));
    });

    it(`${endpointId} settles x402 and returns a provider response`, { skip: runPaid ? false : "paid StableTravel smoke disabled" }, async () => {
      configureLiveDefaults();
      const endpoint = getEndpoint(endpointId);
      const smoke = endpoint.liveSmoke.paid_path;
      const request = endpoint.buildRequest(smoke.input);
      assert.equal(request.method, "GET");
      assert.equal(request.json, undefined);
      assert.ok(Number(request.estimatedUsd) <= Number(smoke.max_usd));

      const result = await executeEndpoint({
        endpoint,
        request,
        maxUsd: smoke.max_usd,
        paymentMode: "x402_only",
        traceId: `live_stabletravel_${endpointId.replace(/\W/gu, "_")}_${Date.now()}`,
        timeoutMs: endpoint.healthProbe.timeoutMs || 20_000,
      });

      assert.equal(result.ok, true);
      assert.equal(result.path, "x402");
      assert.equal(result.charged, true);
      assert.equal(result.status_code, 200);
      assert.ok(result.body);
      assert.ok(Number(result.amount_usd || request.estimatedUsd) <= Number(smoke.max_usd));
    });
  }
});
