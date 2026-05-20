// One-off probe to diagnose exa.search x402 failure.
// Run with: node scripts/with-root-env.mjs node --import tsx scripts/probe-x402-exa.mjs

import { createCrossmintClient } from "../apps/api/src/crossmint.ts";
import { executeEndpoint, getEndpoint } from "../packages/router-core/src/index.ts";

process.env.ROUTER_DEV_MODE = "false";
process.env.X402_ALLOWED_HOSTS ||= "api.exa.ai";
process.env.X402_ALLOWED_CHAINS ||= "eip155:8453,eip155:480";
process.env.X402_MAX_USD_PER_REQUEST ||= "0.05";
process.env.AGENTKIT_CHAIN_ID ||= "eip155:480";

function paymentSigner() {
  if (!process.env.CROSSMINT_LIVE_WALLET_LOCATOR || !process.env.CROSSMINT_LIVE_WALLET_ADDRESS) return null;
  const crossmint = createCrossmintClient();
  return {
    address: process.env.CROSSMINT_LIVE_WALLET_ADDRESS,
    signMessage: async (payload) => {
      const message = payload && typeof payload === "object" && "message" in payload ? payload.message : payload;
      return crossmint.signMessage({ walletLocator: process.env.CROSSMINT_LIVE_WALLET_LOCATOR, message });
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

async function probe(label, smoke, useCrossmint) {
  const endpoint = getEndpoint("exa.search");
  const request = endpoint.buildRequest(smoke.input);
  console.log(`\n=== ${label} ===`);
  console.log("request", { url: request.url, method: request.method, json: request.json, estimatedUsd: request.estimatedUsd });
  const signer = useCrossmint ? paymentSigner() : null;
  console.log("signer", signer ? { type: "crossmint", address: signer.address } : { type: "local-pk" });
  try {
    const result = await executeEndpoint({
      endpoint,
      request,
      maxUsd: smoke.max_usd,
      paymentMode: smoke.payment_mode,
      traceId: `probe_${label}_${Date.now()}`,
      paymentSigner: signer,
      timeoutMs: 20000,
    });
    const { body, ...rest } = result;
    console.log("result", rest);
    console.log("body", typeof body === "string" ? body.slice(0, 2000) : body);
  } catch (error) {
    console.log("threw", { message: error?.message, code: error?.code, stack: error?.stack?.split("\n").slice(0, 5).join("\n") });
  }
}

const endpoint = getEndpoint("exa.search");

// 1) AgentKit-free-trial path — both signers
await probe("agentkit_default_localpk", endpoint.liveSmoke.default_path, false);
await probe("agentkit_default_crossmint", endpoint.liveSmoke.default_path, true);

// 2) x402-only paid path — both signers
await probe("x402_paid_localpk", endpoint.liveSmoke.paid_path, false);
await probe("x402_paid_crossmint", endpoint.liveSmoke.paid_path, true);
