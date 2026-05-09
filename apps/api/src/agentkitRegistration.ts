import {
  createPublicClient,
  decodeAbiParameters,
  http,
} from "viem";
import { worldchain } from "viem/chains";
import { solidityEncode } from "@worldcoin/idkit-core/hashing";

export const AGENT_BOOK_CONTRACT = "0xA23aB2712eA7BBa896930544C7d6636a96b944dA";
export const AGENTKIT_REGISTRATION_APP_ID = "app_a7c3e2b6b83927251a0db5345bd7146a";
export const AGENTKIT_REGISTRATION_ACTION = "agentbook-registration";
export const AGENTKIT_REGISTRATION_RELAY = "https://x402-worldchain.vercel.app";

const AGENT_BOOK_ABI = [
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "getNextNonce",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function relayError(message: string, response: any, contentType: string) {
  return Object.assign(new Error(message), {
    statusCode: 502,
    code: "agentkit_registration_failed",
    details: {
      relay_status: response.status,
      relay_content_type: contentType || "unknown",
    },
  });
}

export async function parseAgentKitRelayResponse(response: any) {
  const contentType =
    typeof response.headers?.get === "function"
      ? response.headers.get("content-type") || ""
      : "";
  const text = await response.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw relayError(
        "AgentKit registration relay returned a non-JSON response. Please try again.",
        response,
        contentType,
      );
    }
  }
  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.error ||
      body?.message ||
      `relay returned ${response.status}`;
    throw relayError(`AgentKit registration failed: ${message}`, response, contentType);
  }
  return body || {};
}

export function agentBookRegistrationService() {
  const client = createPublicClient({
    chain: worldchain,
    transport: http(process.env.AGENTKIT_WORLDCHAIN_RPC_URL || undefined),
  });
  const relayUrl =
    process.env.AGENTKIT_REGISTRATION_RELAY_URL ||
    AGENTKIT_REGISTRATION_RELAY;
  return {
    nextNonce: (address: string) =>
      (client as any).readContract({
        address: AGENT_BOOK_CONTRACT,
        abi: AGENT_BOOK_ABI,
        functionName: "getNextNonce",
        args: [address as `0x${string}`],
      }) as Promise<bigint>,
    submit: async (registration: any) => {
      const response = await fetch(
        `${relayUrl.replace(/\/$/u, "")}/register`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(registration),
        },
      );
      return parseAgentKitRelayResponse(response);
    },
  };
}

export function buildAgentKitVerificationRequest({
  agentAddress,
  nonce,
  appId = process.env.AGENTKIT_REGISTRATION_APP_ID ||
    AGENTKIT_REGISTRATION_APP_ID,
  action = process.env.AGENTKIT_REGISTRATION_ACTION ||
    AGENTKIT_REGISTRATION_ACTION,
  expiresInSeconds = 300,
}: {
  agentAddress: string;
  nonce: bigint | number | string;
  appId?: string;
  action?: string;
  expiresInSeconds?: number;
}) {
  const nonceText = String(nonce);

  return {
    app_id: appId,
    action,
    verification_level: "orb",
    // Mirrors `npx @worldcoin/agentkit-cli register <agent-address>`.
    // The CLI passes IDKit's solidityEncode object, not ABI-encoded hex.
    // We stringify the nonce so this server response remains JSON-safe;
    // IDKit hashes it the same way as the CLI's bigint value.
    signal: solidityEncode(
      ["address", "uint256"],
      [agentAddress, nonceText],
    ),
    nonce: nonceText,
    expires_in_seconds: expiresInSeconds,
  };
}

export function normalizeAgentKitProof(rawProof: unknown) {
  if (Array.isArray(rawProof)) return rawProof.map((value) => String(value));
  if (typeof rawProof !== "string" || !rawProof.trim()) {
    throw Object.assign(new Error("World ID proof is required"), {
      statusCode: 400,
      code: "invalid_agentkit_registration",
    });
  }
  const trimmed = rawProof.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((value) => String(value));
    } catch {
      // Fall through to ABI decode, matching the AgentKit CLI.
    }
  }
  try {
    const decoded = decodeAbiParameters(
      [{ type: "uint256[8]" }],
      trimmed as `0x${string}`,
    )[0];
    return decoded.map((value) => `0x${value.toString(16).padStart(64, "0")}`);
  } catch {
    throw Object.assign(new Error("World ID proof format is invalid"), {
      statusCode: 400,
      code: "invalid_agentkit_registration",
    });
  }
}

function requiredString(value: unknown, label: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw Object.assign(new Error(`${label} is required`), {
    statusCode: 400,
    code: "invalid_agentkit_registration",
  });
}

export function registrationProofFromBody(body: any) {
  const result = body?.result && typeof body.result === "object" ? body.result : {};
  return {
    root: requiredString(body?.root || body?.merkle_root || result.merkle_root, "merkle root"),
    nullifierHash: requiredString(
      body?.nullifierHash || body?.nullifier_hash || result.nullifier_hash,
      "nullifier hash",
    ),
    nonce: requiredString(body?.nonce, "nonce"),
    proof: normalizeAgentKitProof(body?.proof || result.proof),
  };
}

export function registrationPayloadFromBody(agentAddress: string, body: any) {
  const proof = registrationProofFromBody(body || {});
  return {
    agent: agentAddress,
    root: proof.root,
    nonce: proof.nonce,
    nullifierHash: proof.nullifierHash,
    proof: proof.proof,
    contract: AGENT_BOOK_CONTRACT,
  };
}
