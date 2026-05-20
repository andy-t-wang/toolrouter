// Probe the public x402.org facilitator directly with the auth we generate for
// exa, to test whether x402.org/facilitator (NOT CDP) is the broken piece.
// Run: node scripts/with-root-env.mjs node --import tsx scripts/probe-public-facilitator.mjs

import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

let pk = process.env.AGENT_WALLET_PRIVATE_KEY || "";
if (!pk.startsWith("0x")) pk = `0x${pk}`;
const account = privateKeyToAccount(pk);
console.log("wallet:", account.address);

const exaUrl = "https://api.exa.ai/search";
const body = JSON.stringify({ query: "facilitator probe", type: "fast", numResults: 5 });

// Capture the X-PAYMENT we'd send to exa
const client = new x402Client();
if (typeof registerExactEvmScheme === "function") registerExactEvmScheme(client, { signer: account });
else client.register("eip155:*", new ExactEvmScheme(account));

let capturedHeader = null;
let capturedRequirements = null;
let firstResponse = null;

const baseFetch = async (input, init = {}) => {
  let reqUrl, method = init?.method, h = new Headers(init?.headers || {}), b = init?.body;
  if (input instanceof Request) {
    reqUrl = input.url; method = method || input.method;
    for (const [k, v] of input.headers.entries()) if (!h.has(k)) h.set(k, v);
    if (b === undefined) { try { b = await input.clone().text(); } catch {} }
  } else reqUrl = typeof input === "string" || input instanceof URL ? input.toString() : String(input);

  const sig = h.get("payment-signature") || h.get("x-payment");
  if (sig && !capturedHeader) capturedHeader = sig;

  const res = await fetch(reqUrl, { ...init, method, headers: h, body: b });
  if (!firstResponse) {
    firstResponse = res;
    const pr = res.headers.get("payment-required");
    if (pr) try { capturedRequirements = JSON.parse(Buffer.from(pr, "base64").toString("utf8")); } catch {}
  }
  return res;
};

const paidFetch = wrapFetchWithPayment(baseFetch, client);
await paidFetch(exaUrl, { method: "POST", headers: { "content-type": "application/json" }, body });

console.log("\nRequirements from exa:");
const req = capturedRequirements?.accepts?.[0];
console.log(req);
const payment = JSON.parse(Buffer.from(capturedHeader, "base64").toString("utf8"));
console.log("\nX-PAYMENT decoded:");
console.log(JSON.stringify(payment, null, 2).slice(0, 500));

async function callFacilitator(name, url, path, payload) {
  console.log(`\n--- ${name} POST ${url}${path} ---`);
  try {
    const r = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    console.log("status:", r.status);
    try { console.log("body:", JSON.stringify(JSON.parse(txt), null, 2).slice(0, 800)); }
    catch { console.log("body:", txt.slice(0, 500)); }
  } catch (e) {
    console.log("threw:", e?.message);
  }
}

const verifyPayload = { x402Version: 2, paymentPayload: payment, paymentRequirements: req };
const settlePayload = verifyPayload;

await callFacilitator("x402.org",     "https://x402.org/facilitator", "/verify", verifyPayload);
await callFacilitator("x402.org",     "https://x402.org/facilitator", "/settle", settlePayload);
await callFacilitator("x402.rs CDP",  "https://api.cdp.coinbase.com/platform/v2/x402", "/verify", verifyPayload);
await callFacilitator("x402.rs CDP",  "https://api.cdp.coinbase.com/platform/v2/x402", "/settle", settlePayload);
