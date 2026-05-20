// Forensic probe of browserbase.session: capture the exact X-PAYMENT we send,
// verify the EIP-3009 authorization locally, simulate the settlement on Base,
// and try with vs. without the AgentKit proof header to isolate which knob
// breaks things.
// Run: node scripts/with-root-env.mjs node --import tsx scripts/probe-x402-browserbase-deep.mjs

import { x402Client } from "@x402/core/client";
import { ExactEvmScheme, registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, encodeFunctionData, http, recoverTypedDataAddress, hexToSignature } from "viem";
import { base } from "viem/chains";
import { createAgentkitClient } from "@worldcoin/agentkit";
import { randomBytes } from "node:crypto";

const URL = "https://x402.browserbase.com/browser/session/create";
const BODY = JSON.stringify({ estimatedMinutes: 5 });

let pk = process.env.AGENT_WALLET_PRIVATE_KEY || "";
if (!pk.startsWith("0x")) pk = `0x${pk}`;
const account = privateKeyToAccount(pk);
console.log("wallet:", account.address);

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const publicClient = createPublicClient({ chain: base, transport: http() });

async function buildAgentkitHeader() {
  const agentkit = createAgentkitClient({
    signer: {
      address: account.address,
      chainId: "eip155:480",
      type: "eip191",
      signMessage: (m) => account.signMessage({ message: m }),
    },
  });
  const parsed = new globalThis.URL(URL);
  const now = new Date();
  const info = {
    domain: parsed.host,
    uri: URL,
    version: "1",
    nonce: randomBytes(16).toString("hex"),
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    chainId: "eip155:480",
    type: "eip191",
    statement: "Verify your agent is backed by a real human",
    resources: [URL],
  };
  return agentkit.createHeader({ info, _options: {} });
}

async function runProbe({ label, includeAgentKit }) {
  console.log(`\n========= ${label} =========`);
  let captured = null;
  const client = new x402Client();
  if (typeof registerExactEvmScheme === "function") registerExactEvmScheme(client, { signer: account });
  else client.register("eip155:*", new ExactEvmScheme(account));

  let callIdx = 0;
  const baseFetch = async (input, init = {}) => {
    callIdx += 1;
    let reqUrl, method = init?.method, h = new Headers(init?.headers || {}), b = init?.body;
    if (input instanceof Request) {
      reqUrl = input.url; method = method || input.method;
      for (const [k, v] of input.headers.entries()) if (!h.has(k)) h.set(k, v);
      if (b === undefined) { try { b = await input.clone().text(); } catch {} }
    } else reqUrl = typeof input === "string" || input instanceof URL ? input.toString() : String(input);

    if (includeAgentKit && !h.has("agentkit")) h.set("agentkit", await buildAgentkitHeader());

    const sig = h.get("payment-signature") || h.get("x-payment");
    if (sig && !captured) {
      try { captured = JSON.parse(Buffer.from(sig, "base64").toString("utf8")); } catch {}
    }
    console.log(`→ #${callIdx} ${method} ${reqUrl}`);
    for (const k of ["accept", "content-type", "agentkit"]) if (h.get(k)) console.log(`  ${k}: ${h.get(k).slice(0, 60)}${h.get(k).length > 60 ? "…" : ""}`);
    if (sig) console.log(`  payment-signature: <${sig.length} chars>`);

    const res = await fetch(reqUrl, { ...init, method, headers: h, body: b });
    console.log(`← #${callIdx} ${res.status} ${res.statusText}`);
    const pr = res.headers.get("payment-response");
    if (pr) {
      try { console.log("  payment-response:", JSON.parse(Buffer.from(pr, "base64").toString("utf8"))); }
      catch { console.log("  payment-response (raw):", pr.slice(0, 200)); }
    }
    return res;
  };

  const paidFetch = wrapFetchWithPayment(baseFetch, client);
  const res = await paidFetch(URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: BODY,
  });
  const txt = await res.text();
  try { console.log("final body:", JSON.stringify(JSON.parse(txt), null, 2).slice(0, 1500)); }
  catch { console.log("final body raw:", txt.slice(0, 500)); }

  if (captured?.payload?.authorization) {
    const auth = captured.payload.authorization;
    const signature = captured.payload.signature;
    console.log("\n-- captured authorization --");
    console.log(JSON.stringify(auth, null, 2));
    console.log("signature:", signature);

    const domain = { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    };
    const message = {
      from: auth.from, to: auth.to, value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore), nonce: auth.nonce,
    };
    const recovered = await recoverTypedDataAddress({ domain, types, primaryType: "TransferWithAuthorization", message, signature });
    console.log("recovered signer:", recovered, "match?", recovered.toLowerCase() === auth.from.toLowerCase());

    const used = await publicClient.readContract({
      address: USDC,
      abi: [{ type: "function", name: "authorizationState", stateMutability: "view",
              inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }],
              outputs: [{ type: "bool" }] }],
      functionName: "authorizationState", args: [auth.from, auth.nonce],
    });
    console.log("nonce already used?", used);

    const block = await publicClient.getBlock();
    console.log("block ts:", block.timestamp.toString(), "validAfter:", auth.validAfter, "validBefore:", auth.validBefore);

    const { r, s, v } = hexToSignature(signature);
    const data = encodeFunctionData({
      abi: [{ type: "function", name: "transferWithAuthorization", stateMutability: "nonpayable",
              inputs: [
                { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
                { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
                { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" },
              ], outputs: [] }],
      functionName: "transferWithAuthorization",
      args: [auth.from, auth.to, BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, Number(v), r, s],
    });
    try {
      const result = await publicClient.call({ account: "0x0000000000000000000000000000000000000001", to: USDC, data });
      console.log("✅ on-chain eth_call: would settle");
    } catch (error) {
      console.log("❌ on-chain eth_call reverted:", error?.shortMessage || error?.cause?.shortMessage || error?.message);
    }
  } else {
    console.log("(no X-PAYMENT captured)");
  }
}

// Run with vs. without the AgentKit proof header.
await runProbe({ label: "without agentkit header (raw x402)", includeAgentKit: false });
await runProbe({ label: "with agentkit header (our actual code path)", includeAgentKit: true });
