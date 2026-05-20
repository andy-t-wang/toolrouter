// Same decisive test as probe-cdp-settle-exa.mjs but against browserbase's
// session-create endpoint. If CDP /settle succeeds with our keys against
// browserbase's requirements, the failure is on browserbase's CDP side.
// Side effect: actually transfers ~$0.02 USDC from our wallet to browserbase's
// payTo address — the same payment we'd make if their endpoint worked.
// Run: node scripts/with-root-env.mjs node --import tsx scripts/probe-cdp-settle-browserbase.mjs

import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";

const URL_ = "https://x402.browserbase.com/browser/session/create";

let pk = process.env.AGENT_WALLET_PRIVATE_KEY || "";
if (!pk.startsWith("0x")) pk = `0x${pk}`;
const account = privateKeyToAccount(pk);
console.log("wallet:", account.address);

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
  // v1 fallback: requirements come in the response body.
  if (!capturedReq && res.status === 402) {
    try {
      const cloned = res.clone();
      const body = await cloned.json();
      if (body?.accepts) capturedReq = body;
    } catch {}
  }
  return res;
};
try {
  const r = await wrapFetchWithPayment(baseFetch, client)(URL_, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ estimatedMinutes: 5 }),
  });
  console.log("wrapFetchWithPayment final status:", r.status);
  console.log("body:", (await r.text()).slice(0, 600));
} catch (error) {
  console.log("wrapFetchWithPayment threw:", error?.message);
}

if (!capturedSig || !capturedReq) {
  console.log("did not capture signature/requirements — bailing");
  console.log("capturedSig?", !!capturedSig, "capturedReq?", !!capturedReq);
  process.exit(1);
}

const requirements = capturedReq?.accepts?.[0];
const paymentPayload = JSON.parse(Buffer.from(capturedSig, "base64").toString("utf8"));
console.log("\nrequirements:", JSON.stringify(requirements, null, 2));
console.log("\nauthorization:", JSON.stringify(paymentPayload.payload?.authorization, null, 2));

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

console.log("\n--- CDP /settle (will actually settle USDC tx) ---");
try {
  const settleResult = await facClient.settle(paymentPayload, requirements);
  console.log("settle result:", JSON.stringify(settleResult, null, 2));
  console.log("\n✅ CDP /settle SUCCEEDED with our keys against browserbase's requirements.");
  console.log("   => browserbase's 'Failed to settle payment: 402' is caused by THEIR CDP");
  console.log("      integration — same pattern as exa.");
} catch (error) {
  console.log("settle threw:", error?.message);
  console.log("  cause:", error?.cause?.message || error?.cause);
  if (error?.response) console.log("  response status:", error.response.status);
  if (error?.body) console.log("  body:", error.body);
  console.log("\n❌ CDP /settle FAILED.");
}
