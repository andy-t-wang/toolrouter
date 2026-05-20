// Paid call to browserbase.session using AGENT_WALLET_PRIVATE_KEY.
// Mirrors what the health probe does (x402 + agentkit-proof-header) and
// dumps the X-PAYMENT we sent + browserbase's full response.
// Run: node scripts/with-root-env.mjs node --import tsx scripts/probe-x402-browserbase.mjs

import { createCrossmintClient } from "../apps/api/src/crossmint.ts";
import { executeEndpoint, getEndpoint } from "../packages/router-core/src/index.ts";
import { createAgentBookVerifier } from "@worldcoin/agentkit-core";
import { privateKeyToAccount } from "viem/accounts";

process.env.ROUTER_DEV_MODE = "false";
process.env.X402_ALLOWED_HOSTS ||= "x402.browserbase.com";
process.env.X402_ALLOWED_CHAINS ||= "eip155:8453,eip155:480,base";
process.env.X402_MAX_USD_PER_REQUEST ||= "0.05";
process.env.AGENTKIT_CHAIN_ID ||= "eip155:480";

let pk = process.env.AGENT_WALLET_PRIVATE_KEY || "";
if (!pk.startsWith("0x")) pk = `0x${pk}`;
const account = privateKeyToAccount(pk);
console.log("wallet:", account.address);

const humanId = await createAgentBookVerifier().lookupHuman(account.address);
console.log("humanId:", humanId);

function paymentSigner() {
  if (!process.env.CROSSMINT_LIVE_WALLET_LOCATOR) return null;
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
        domain: payload.domain, types: payload.types,
        primaryType: payload.primaryType, message: payload.message,
      }),
  };
}

async function probe(label, smoke, useCrossmint) {
  const endpoint = getEndpoint("browserbase.session");
  const request = endpoint.buildRequest(smoke.input);
  console.log(`\n=== ${label} ===`);
  console.log("request", { url: request.url, method: request.method, json: request.json, estimatedUsd: request.estimatedUsd });
  try {
    const result = await executeEndpoint({
      endpoint, request,
      maxUsd: smoke.max_usd,
      paymentMode: smoke.payment_mode,
      traceId: `probe_bb_${label}_${Date.now()}`,
      paymentSigner: useCrossmint ? paymentSigner() : null,
      timeoutMs: 20000,
    });
    const { body, ...rest } = result;
    console.log("result", rest);
    console.log("body", typeof body === "string" ? body.slice(0, 2000) : body);
  } catch (error) {
    console.log("threw", { message: error?.message, code: error?.code });
  }
}

const endpoint = getEndpoint("browserbase.session");
await probe("agentkit_default_localpk", endpoint.liveSmoke.default_path, false);
await probe("x402_paid_localpk", endpoint.liveSmoke.paid_path, false);
await probe("x402_paid_crossmint", endpoint.liveSmoke.paid_path, true);
