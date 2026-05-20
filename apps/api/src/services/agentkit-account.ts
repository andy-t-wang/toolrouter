// AgentKit wallet + account helpers. Used by both the orchestrator (payment
// signer resolution) and the `/v1/agentkit/*` route plugin.

import { createHash, randomUUID } from "node:crypto";

import {
  agentBookRegistrationService,
  buildAgentKitVerificationRequest,
  registrationPayloadFromBody,
} from "./agentkit-registration.ts";
import { safeAgentKitVerification } from "./monitoring.ts";

export async function ensureAgentWalletAccount(
  store: any,
  crossmint: any,
  user: { user_id: string; email?: string | null },
) {
  const existing = await store.getWalletAccount({ user_id: user.user_id });
  if (existing?.address && existing?.wallet_locator) return existing;
  const wallet = await crossmint.ensureWallet(user);
  return store.upsertWalletAccount({
    id: existing?.id || `wa_${randomUUID()}`,
    user_id: user.user_id,
    ...wallet,
  });
}

export function shouldUseCrossmintSigner() {
  return (
    process.env.ROUTER_DEV_MODE !== "true" &&
    Boolean(
      process.env.CROSSMINT_SERVER_SIDE_API_KEY ||
      process.env.CROSSMINT_API_KEY,
    )
  );
}

export async function getOrBootstrapVisibleAccount(
  store: any,
  crossmint: any,
  user: { user_id: string; email?: string | null },
) {
  const existing = await store.getWalletAccount({ user_id: user.user_id });
  if (existing?.address && existing?.wallet_locator) return existing;
  if (!shouldUseCrossmintSigner()) return existing;
  try {
    return await ensureAgentWalletAccount(store, crossmint, user);
  } catch {
    return existing;
  }
}

function hashHumanId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function loadAgentBookVerifier() {
  const { createAgentBookVerifier } = await import("@worldcoin/agentkit");
  return createAgentBookVerifier({
    rpcUrl: process.env.AGENTKIT_WORLDCHAIN_RPC_URL || undefined,
  });
}

export async function verifyAgentKitAccount({
  store,
  crossmint,
  user,
  agentBookVerifier,
}: any) {
  const wallet = await ensureAgentWalletAccount(store, crossmint, user);
  const checkedAt = new Date().toISOString();
  let verified = false;
  let humanIdHash = null;
  let error = null;

  if (!wallet.address) {
    error = "agent address is missing";
  } else {
    try {
      const verifier = agentBookVerifier || (await loadAgentBookVerifier());
      const humanId = await verifier.lookupHuman(wallet.address);
      verified = Boolean(humanId);
      humanIdHash = humanId ? hashHumanId(humanId) : null;
      if (!verified) error = "Not Verified";
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  const updated = await store.upsertWalletAccount({
    id: wallet.id,
    user_id: user.user_id,
    provider: wallet.provider || "crossmint",
    wallet_locator: wallet.wallet_locator,
    address: wallet.address,
    chain_id: wallet.chain_id || "eip155:8453",
    asset: wallet.asset || "USDC",
    status: wallet.status || "active",
    metadata: wallet.metadata || {},
    agentkit_verified: verified,
    agentkit_human_id_hash: humanIdHash,
    agentkit_verified_at: verified ? checkedAt : null,
    agentkit_last_checked_at: checkedAt,
    agentkit_verification_error: error,
  });
  return {
    agentkit_verification: safeAgentKitVerification(updated),
  };
}

export async function prepareAgentKitRegistration({
  store,
  crossmint,
  user,
  agentBookRegistration,
}: any) {
  const wallet = await ensureAgentWalletAccount(store, crossmint, user);
  if (!wallet.address) {
    throw Object.assign(new Error("AgentKit account address is missing"), {
      statusCode: 500,
      code: "agentkit_wallet_missing",
    });
  }
  const registration = agentBookRegistration || agentBookRegistrationService();
  const nonce = await registration.nextNonce(wallet.address);
  return {
    registration: buildAgentKitVerificationRequest({
      agentAddress: wallet.address,
      nonce,
    }),
    agentkit_verification: safeAgentKitVerification(wallet),
  };
}

export async function completeAgentKitRegistration({
  store,
  crossmint,
  user,
  body,
  agentBookVerifier,
  agentBookRegistration,
}: any) {
  const wallet = await ensureAgentWalletAccount(store, crossmint, user);
  if (!wallet.address) {
    throw Object.assign(new Error("AgentKit account address is missing"), {
      statusCode: 500,
      code: "agentkit_wallet_missing",
    });
  }
  const registration = registrationPayloadFromBody(wallet.address, body);
  const service = agentBookRegistration || agentBookRegistrationService();
  const result = await service.submit(registration);
  const verification = await verifyAgentKitAccount({
    store,
    crossmint,
    user,
    agentBookVerifier,
  });
  return {
    registration: {
      tx_hash: result?.txHash || result?.transactionHash || null,
      already_registered: Boolean(result?.already_registered),
    },
    ...verification,
  };
}

/**
 * Resolve the payment signer for an authenticated API request. Returns `null`
 * when Crossmint is disabled (dev mode or missing API key). Throws if the
 * Crossmint wallet has no address.
 */
export async function paymentSignerForRequest(store: any, crossmint: any, auth: any) {
  if (!shouldUseCrossmintSigner()) return null;
  const wallet = await ensureAgentWalletAccount(store, crossmint, {
    user_id: auth.user_id,
  });
  if (!wallet.address) {
    throw Object.assign(
      new Error("Crossmint wallet address is required for payment signing"),
      {
        statusCode: 500,
        code: "crossmint_wallet_missing",
      },
    );
  }
  return {
    address: wallet.address,
    signMessage: async (payload: any) => {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? payload.message
          : payload;
      return crossmint.signMessage({
        walletLocator: wallet.wallet_locator,
        message,
      });
    },
    signTypedData: async (payload: any) => {
      return crossmint.signTypedData({
        walletLocator: wallet.wallet_locator,
        domain: payload.domain,
        types: payload.types,
        primaryType: payload.primaryType,
        message: payload.message,
      });
    },
  };
}
