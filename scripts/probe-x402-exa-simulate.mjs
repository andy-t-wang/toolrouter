// Simulate exa's settlement step on Base USDC using the X-PAYMENT we just
// produced. eth_call the EIP-3009 transferWithAuthorization with our exact
// signature so the chain tells us whether the authorization is valid.
// Run with: node scripts/with-root-env.mjs node --import tsx scripts/probe-x402-exa-simulate.mjs

import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, encodeFunctionData, http, recoverTypedDataAddress, hexToSignature } from "viem";
import { base } from "viem/chains";

const url = "https://api.exa.ai/search";
const body = { query: "ToolRouter settlement probe", type: "fast", numResults: 5 };

let pk = process.env.AGENT_WALLET_PRIVATE_KEY || "";
if (!pk.startsWith("0x")) pk = `0x${pk}`;
const account = privateKeyToAccount(pk);

const client = new x402Client();
if (typeof registerExactEvmScheme === "function") registerExactEvmScheme(client, { signer: account });
else client.register("eip155:*", new ExactEvmScheme(account));

let capturedAuth = null;
const baseFetch = async (input, init = {}) => {
  let reqUrl, method = init?.method, inHeaders = new Headers(init?.headers || {}), inBody = init?.body;
  if (input instanceof Request) {
    reqUrl = input.url;
    method = method || input.method;
    for (const [k, v] of input.headers.entries()) if (!inHeaders.has(k)) inHeaders.set(k, v);
    if (inBody === undefined) { try { inBody = await input.clone().text(); } catch {} }
  } else {
    reqUrl = typeof input === "string" || input instanceof URL ? input.toString() : String(input);
  }
  const headerNames = ["payment-signature", "x-payment", "x-payment-signature"];
  for (const name of headerNames) {
    const v = inHeaders.get(name);
    if (v && !capturedAuth) {
      try { capturedAuth = JSON.parse(Buffer.from(v, "base64").toString("utf8"))?.payload; } catch {}
    }
  }
  return fetch(reqUrl, { ...init, method, headers: inHeaders, body: inBody });
};
const paidFetch = wrapFetchWithPayment(baseFetch, client);
const res = await paidFetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify(body),
});
const txt = await res.text();
console.log("exa final:", res.status, txt);

if (!capturedAuth) {
  console.log("no X-PAYMENT captured");
  process.exit(1);
}

const auth = capturedAuth.authorization;
const signature = capturedAuth.signature;
console.log("\ncaptured authorization:", JSON.stringify(auth, null, 2));
console.log("signature:", signature);

// USDC on Base
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const publicClient = createPublicClient({ chain: base, transport: http() });

// EIP-712 verify
const domain = { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC };
const types = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};
const message = {
  from: auth.from,
  to: auth.to,
  value: BigInt(auth.value),
  validAfter: BigInt(auth.validAfter),
  validBefore: BigInt(auth.validBefore),
  nonce: auth.nonce,
};
const recovered = await recoverTypedDataAddress({ domain, types, primaryType: "TransferWithAuthorization", message, signature });
console.log("\nrecovered signer:", recovered);
console.log("matches `from`? ", recovered.toLowerCase() === auth.from.toLowerCase());

// Check on-chain authorization state (already-used nonces revert).
// USDC has authorizationState(address authorizer, bytes32 nonce) → bool
const authStateAbi = [{
  type: "function", name: "authorizationState", stateMutability: "view",
  inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }],
  outputs: [{ type: "bool" }],
}];
const used = await publicClient.readContract({
  address: USDC, abi: authStateAbi, functionName: "authorizationState",
  args: [auth.from, auth.nonce],
});
console.log("nonce already used on-chain?", used);

// Block timestamp vs validity window
const block = await publicClient.getBlock();
console.log("block timestamp:", block.timestamp.toString(), "validAfter:", auth.validAfter, "validBefore:", auth.validBefore);

// Simulate transferWithAuthorization via eth_call (any caller can submit it).
const { r, s, v } = hexToSignature(signature);
const transferAbi = [{
  type: "function", name: "transferWithAuthorization", stateMutability: "nonpayable",
  inputs: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" },
  ],
  outputs: [],
}];
const data = encodeFunctionData({
  abi: transferAbi, functionName: "transferWithAuthorization",
  args: [auth.from, auth.to, BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, Number(v), r, s],
});

try {
  // Simulate from a random relayer address so it mirrors a facilitator submitting it.
  const relayer = "0x0000000000000000000000000000000000000001";
  const result = await publicClient.call({ account: relayer, to: USDC, data });
  console.log("\n✅ eth_call succeeded — auth would settle:", result);
} catch (error) {
  console.log("\n❌ eth_call reverted:");
  console.log("  shortMessage:", error?.shortMessage);
  console.log("  cause:", error?.cause?.shortMessage || error?.cause?.message);
  console.log("  data:", error?.cause?.data || error?.data);
}
