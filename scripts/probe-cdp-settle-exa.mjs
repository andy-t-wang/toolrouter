// Decisive test: call CDP /settle DIRECTLY with our keys, against exa's own
// requirements + a freshly-signed authorization. If CDP settles, then exa's
// "Settlement failed: 402" is *not* the payload — it's their /settle call
// (their keys, their project state, or middleware that mangles the payload).
// Side effect: actually transfers ~$0.007 USDC from our wallet to exa's
// payTo address — the same payment we'd make if exa's endpoint worked.
// Run: node scripts/with-root-env.mjs node --import tsx scripts/probe-cdp-settle-exa.mjs

import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";

const exaUrl = "https://api.exa.ai/search";

let pk = process.env.AGENT_WALLET_PRIVATE_KEY || "";
if (!pk.startsWith("0x")) pk = `0x${pk}`;
const account = privateKeyToAccount(pk);
console.log("wallet:", account.address);

// 1) Get a fresh challenge from exa + sign an X-PAYMENT.
const client = new x402Client();
if (typeof registerExactEvmScheme === "function") registerExactEvmScheme(client, { signer: account });
else client.register("eip155:*", new ExactEvmScheme(account));

let capturedSig = null;
let capturedReq = null;
const baseFetch = async (input, init = {}) => {
  let reqUrl, method = init?.method, h = new Headers(init?.headers || {}), b = init?.body;
  if (input instanceof Request) {
    reqUrl = input.url; method = method || input.method;
    for (const [k, v] of input.headers.entries()) if (!h.has(k)) h.set(k, v);
    if (b === undefined) { try { b = await input.clone().text(); } catch {} }
  } else reqUrl = typeof input === "string" || input instanceof URL ? input.toString() : String(input);
  const sig = h.get("payment-signature") || h.get("x-payment");
  if (sig && !capturedSig) capturedSig = sig;
  const res = await fetch(reqUrl, { ...init, method, headers: h, body: b });
  if (!capturedReq) {
    const pr = res.headers.get("payment-required");
    if (pr) try { capturedReq = JSON.parse(Buffer.from(pr, "base64").toString("utf8")); } catch {}
  }
  return res;
};
await wrapFetchWithPayment(baseFetch, client)(exaUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: "cdp settle probe", type: "fast", numResults: 5 }),
});

const requirements = capturedReq?.accepts?.[0];
const paymentPayload = JSON.parse(Buffer.from(capturedSig, "base64").toString("utf8"));
console.log("\nrequirements:", JSON.stringify(requirements, null, 2));
console.log("\nauthorization:", JSON.stringify(paymentPayload.payload?.authorization, null, 2));

// 2) /verify first — sanity check it still says isValid.
const keyId = process.env.COINBASE_KEY_ID;
const keySecret = (process.env.COINBASE_KEY_SECRET || "").replace(/\\n/g, "\n");
const facilitator = createFacilitatorConfig(keyId, keySecret);
console.log("\nfacilitator url:", facilitator.url);
const facClient = new HTTPFacilitatorClient(facilitator);

console.log("\n--- CDP /verify ---");
try {
  const verifyResult = await facClient.verify(paymentPayload, requirements);
  console.log("verify result:", JSON.stringify(verifyResult, null, 2));
  if (!verifyResult?.isValid) {
    console.log("⚠️ verify rejected — skipping settle");
    process.exit(1);
  }
} catch (error) {
  console.log("verify threw:", error?.message);
  process.exit(1);
}

// 3) /settle — the decisive call.
console.log("\n--- CDP /settle (this will actually settle the USDC tx) ---");
try {
  const settleResult = await facClient.settle(paymentPayload, requirements);
  console.log("settle result:", JSON.stringify(settleResult, null, 2));
  console.log("\n✅ CDP /settle SUCCEEDED with our keys against exa's requirements.");
  console.log("   => exa's 'Settlement failed: 402' is caused by THEIR CDP integration,");
  console.log("      not by the payload, not by us, not by CDP's core verification.");
} catch (error) {
  console.log("settle threw:", error?.message);
  console.log("  cause:", error?.cause?.message || error?.cause);
  if (error?.response) console.log("  response status:", error.response.status);
  if (error?.body) console.log("  body:", error.body);
  console.log("\n❌ CDP /settle FAILED.");
  console.log("   => the recipient/requirements are the issue, not exa's CDP creds.");
}
