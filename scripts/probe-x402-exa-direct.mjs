// Direct x402 paid call to exa using AGENT_WALLET_PRIVATE_KEY.
// Bypasses our executor — uses @x402/* libs directly and logs the
// X-PAYMENT header that gets sent and the raw response.
// Run with: node scripts/with-root-env.mjs node --import tsx scripts/probe-x402-exa-direct.mjs

import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const url = "https://api.exa.ai/search";
const body = { query: "ToolRouter direct probe", type: "fast", numResults: 5 };

let pk = process.env.AGENT_WALLET_PRIVATE_KEY || "";
if (!pk.startsWith("0x")) pk = `0x${pk}`;
const account = privateKeyToAccount(pk);
console.log("wallet address:", account.address);

const client = new x402Client();
if (typeof registerExactEvmScheme === "function") {
  registerExactEvmScheme(client, { signer: account });
} else {
  client.register("eip155:*", new ExactEvmScheme(account));
}

// Capture which requirement gets selected and the resulting payment payload.
client.onBeforePaymentCreation?.((context) => {
  console.log("onBeforePaymentCreation:", {
    network: context.selectedRequirements?.network,
    scheme: context.selectedRequirements?.scheme,
    amount: context.selectedRequirements?.amount ?? context.selectedRequirements?.maxAmountRequired,
    asset: context.selectedRequirements?.asset,
    payTo: context.selectedRequirements?.payTo,
    maxTimeoutSeconds: context.selectedRequirements?.maxTimeoutSeconds,
  });
  return null;
});
client.onAfterPaymentCreation?.((context) => {
  console.log("onAfterPaymentCreation: produced X-PAYMENT (truncated)", {
    payloadKeys: context?.payload && typeof context.payload === "object" ? Object.keys(context.payload) : null,
    headerLength: context?.header?.length ?? null,
  });
  if (context?.header) {
    try {
      const decoded = JSON.parse(Buffer.from(context.header, "base64").toString("utf8"));
      console.log("X-PAYMENT decoded:", JSON.stringify(decoded, null, 2));
    } catch (error) {
      console.log("X-PAYMENT raw (non-base64):", context.header.slice(0, 400));
    }
  }
  return null;
});

// Logging fetch wrapper so we see the actual outbound request.
let callIdx = 0;
const baseFetch = async (input, init = {}) => {
  callIdx += 1;
  // Normalize: input may be a string, URL, or Request.
  let reqUrl;
  let method = init?.method;
  const inHeaders = new Headers(init?.headers || {});
  let inBody = init?.body;
  if (input instanceof Request) {
    reqUrl = input.url;
    method = method || input.method;
    for (const [k, v] of input.headers.entries()) if (!inHeaders.has(k)) inHeaders.set(k, v);
    if (inBody === undefined && input.bodyUsed === false) {
      try {
        inBody = await input.clone().text();
      } catch {}
    }
  } else {
    reqUrl = typeof input === "string" || input instanceof URL ? input.toString() : String(input);
  }
  method = method || "GET";
  console.log(`\n→ fetch #${callIdx} ${method} ${reqUrl}`);
  for (const [k, v] of inHeaders.entries()) {
    if (k.toLowerCase() === "x-payment") {
      console.log(`  X-PAYMENT (len ${v.length}):`);
      try {
        const decoded = JSON.parse(Buffer.from(v, "base64").toString("utf8"));
        console.log("    decoded:", JSON.stringify(decoded, null, 2).split("\n").map((l) => "    " + l).join("\n").slice(4));
      } catch {
        console.log("    raw:", v.slice(0, 200));
      }
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }
  if (inBody) console.log("  body:", typeof inBody === "string" ? inBody : "<non-string>");

  const res = await fetch(reqUrl, { ...init, method, headers: inHeaders, body: inBody });
  console.log(`← response #${callIdx} ${res.status} ${res.statusText}`);
  for (const [k, v] of res.headers.entries()) {
    if (k.toLowerCase() === "payment-required") console.log(`  ${k}: <${v.length} chars>`);
    else if (k.toLowerCase() === "payment-response") {
      console.log(`  ${k}: ${v}`);
      try {
        console.log("    decoded:", JSON.stringify(JSON.parse(Buffer.from(v, "base64").toString("utf8")), null, 2));
      } catch {}
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }
  return res;
};

const paidFetch = wrapFetchWithPayment(baseFetch, client);

console.log("\n--- making paid call to exa ---");
const res = await paidFetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log("\n=== final status:", res.status, "===");
try {
  console.log("body:", JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log("body (raw):", text.slice(0, 1500));
}
