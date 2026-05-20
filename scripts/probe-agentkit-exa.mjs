// Manually perform the AgentKit handshake against exa:
//   1) POST → 402, decode the `payment-required` extension.
//   2) Build an `agentkit` header via createHeader(extension).
//   3) Re-POST with the header and capture exa's response.
// Run: node scripts/with-root-env.mjs node --import tsx scripts/probe-agentkit-exa.mjs

import { createAgentkitClient } from "@worldcoin/agentkit";
import { createAgentBookVerifier } from "@worldcoin/agentkit-core";
import { privateKeyToAccount } from "viem/accounts";

let pk = process.env.AGENT_WALLET_PRIVATE_KEY || "";
if (!pk.startsWith("0x")) pk = `0x${pk}`;
const account = privateKeyToAccount(pk);
console.log("wallet:", account.address);

const agentBook = createAgentBookVerifier();
const humanId = await agentBook.lookupHuman(account.address);
console.log("humanId on World Chain AgentBook:", humanId);
if (!humanId) {
  console.log("⚠️ wallet is NOT registered as an agent — free trial impossible");
  process.exit(0);
}

const agentkit = createAgentkitClient({
  signer: {
    address: account.address,
    chainId: "eip155:480",
    type: "eip191",
    signMessage: (message) => account.signMessage({ message }),
  },
});

const url = "https://api.exa.ai/search";
const body = JSON.stringify({ query: "ToolRouter agentkit handshake", type: "fast", numResults: 5 });
const headers = { "content-type": "application/json", accept: "application/json" };

// Step 1: trigger 402 challenge.
console.log("\n--- step 1: POST without agentkit header ---");
const res1 = await fetch(url, { method: "POST", headers, body });
console.log("status:", res1.status);
const prHeader = res1.headers.get("payment-required");
let extension = null;
if (prHeader) {
  const decoded = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"));
  extension = decoded?.extensions?.agentkit;
  console.log("extensions.agentkit._options:", extension?._options);
  console.log("extensions.agentkit.info:", extension?.info);
}
if (!extension) {
  console.log("no AgentKit extension in payment-required header");
  process.exit(1);
}

// Step 2: build agentkit header.
console.log("\n--- step 2: createHeader(extension) ---");
const akHeader = await agentkit.createHeader(extension);
console.log("agentkit header (len", akHeader.length + ")");
const decodedHeader = JSON.parse(Buffer.from(akHeader, "base64").toString("utf8"));
console.log("decoded:", JSON.stringify(decodedHeader, null, 2));

// Step 3: re-POST with the header.
console.log("\n--- step 3: POST with agentkit header ---");
const res2 = await fetch(url, {
  method: "POST",
  headers: { ...headers, agentkit: akHeader },
  body,
});
console.log("status:", res2.status);
console.log("response headers:");
for (const [k, v] of res2.headers.entries()) {
  if (k === "payment-required") console.log(`  ${k}: <${v.length} chars>`);
  else console.log(`  ${k}: ${v}`);
}
const text = await res2.text();
try { console.log("body:", JSON.stringify(JSON.parse(text), null, 2)); }
catch { console.log("body (raw):", text.slice(0, 1500)); }
