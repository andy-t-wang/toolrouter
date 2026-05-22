import { createHash } from "node:crypto";

import { executeEndpoint } from "@toolrouter/router-core";

import { createCrossmintClient } from "../../services/crossmint.ts";
import { agentmailProviderPriceUsd } from "./pricing.ts";

const DEFAULT_AGENTMAIL_X402_API_BASE = "https://x402.api.agentmail.to";
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/u;

function agentmailX402ApiBase() {
  return (process.env.AGENTMAIL_X402_API_BASE || DEFAULT_AGENTMAIL_X402_API_BASE).replace(/\/$/u, "");
}

function stripControlFields(body: any) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const {
    maxUsd: _maxUsd,
    max_usd: _maxUsdAlt,
    payment_mode: _paymentMode,
    paymentMode: _paymentModeAlt,
    force_new: _forceNew,
    forceNew: _forceNewAlt,
    endpoint_id: _endpointId,
    endpointId: _endpointIdAlt,
    ...rest
  } = body;
  return rest;
}

function requireStringField(input: any, field: string) {
  const value = input?.[field];
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`${field} is required`), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return value.trim();
}

function encodedPathPart(value: string) {
  return encodeURIComponent(value).replace(/%40/giu, "@");
}

function addQueryParams(url: URL, params: Record<string, unknown>) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function safeAgentmailError(status: number | null) {
  if (status === 400) return "AgentMail validation failed";
  if (status === 401 || status === 403) return "AgentMail payment or authorization failed";
  if (status === 404) return "AgentMail resource not found";
  if (status === 429) return "AgentMail rate limited";
  if (status !== null && status >= 500) return "AgentMail provider error";
  return "AgentMail request failed";
}

function normalizeEvmAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!EVM_ADDRESS_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function safeHash(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return `sha256:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16)}`;
}

function paymentPayloadFromContext(payment: any) {
  if (payment && typeof payment === "object" && payment.paymentPayload) {
    return payment.paymentPayload;
  }
  return payment;
}

export function agentmailPayerAddressFromPayment(payment: any) {
  const payload = paymentPayloadFromContext(payment);
  const candidates = [
    payload?.payload?.authorization?.from,
    payload?.payload?.permit2Authorization?.from,
    payload?.payload?.from,
    payment?.payer,
  ];
  for (const candidate of candidates) {
    const address = normalizeEvmAddress(candidate);
    if (address) return address;
  }
  return null;
}

function agentmailOwnershipStoreUnavailable(reply: any) {
  reply.status(503);
  return {
    ok: false,
    error: "AgentMail ownership store unavailable",
    code: "agentmail_ownership_store_unavailable",
  };
}

function agentmailOwnerUnavailable(reply: any) {
  reply.status(403);
  return {
    ok: false,
    error: "AgentMail payment owner unavailable",
    code: "agentmail_payment_owner_unavailable",
  };
}

function agentmailInboxNotOwned(reply: any, diagnostics: any = {}) {
  reply.status(403);
  return {
    ok: false,
    error: "AgentMail inbox is not owned by this payer",
    code: "agentmail_inbox_not_owned",
    diagnostics: {
      inbox_found: Boolean(diagnostics.inbox_found),
      reason: diagnostics.reason || "owner_mismatch",
      payer_address_hash: safeHash(diagnostics.payer_address),
      stored_owner_address_hash: safeHash(diagnostics.stored_owner_address),
    },
  };
}

function agentmailInboxRecordMissing(reply: any) {
  reply.status(502);
  return {
    ok: false,
    error: "AgentMail create response did not include an inbox identifier",
    code: "agentmail_inbox_identifier_missing",
  };
}

function requireAgentmailOwnershipStore(store: any, reply: any) {
  if (
    store &&
    typeof store.upsertAgentmailInbox === "function" &&
    typeof store.repairAgentmailHealthInboxOwner === "function" &&
    typeof store.findAgentmailInboxByIdentifier === "function"
  ) {
    return store;
  }
  return agentmailOwnershipStoreUnavailable(reply);
}

function requireAgentmailOwner(payment: any, reply: any) {
  const ownerAddress = agentmailPayerAddressFromPayment(payment);
  if (ownerAddress) return ownerAddress;
  return agentmailOwnerUnavailable(reply);
}

function configuredAgentmailHealthInbox() {
  const inboxId = firstString(process.env.AGENTMAIL_HEALTH_INBOX_ID);
  const email = firstString(process.env.AGENTMAIL_HEALTH_INBOX_EMAIL);
  return {
    inbox_id: inboxId,
    email,
    identifiers: new Set([inboxId, email].filter(Boolean).map((value) => value.toLowerCase())),
    owner_address: normalizeEvmAddress(process.env.CROSSMINT_HEALTH_WALLET_ADDRESS),
  };
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function agentmailPayloadFromResult(result: any) {
  return result?.result ?? result?.body ?? result?.data ?? result;
}

function fallbackInboxIdentifiersFromRequest(body: any) {
  const username = firstString(body?.username);
  if (!username) return {};
  const domain = firstString(body?.domain) || "agentmail.to";
  const email = `${username}@${domain}`;
  return {
    inbox_id: email,
    email,
  };
}

function agentmailInboxIdentifiersFromResult(result: any, fallback: any = {}) {
  const payload = agentmailPayloadFromResult(result);
  const nested = payload?.inbox ?? payload?.data?.inbox ?? payload?.data ?? {};
  const id = firstString(
    payload?.id,
    payload?.inbox_id,
    payload?.inboxId,
    payload?.inboxID,
    nested?.id,
    nested?.inbox_id,
    nested?.inboxId,
    nested?.inboxID,
  );
  const email = firstString(
    payload?.email,
    payload?.address,
    payload?.inbox_email,
    payload?.inboxEmail,
    nested?.email,
    nested?.address,
    nested?.inbox_email,
    nested?.inboxEmail,
  );
  return {
    inbox_id: id || email || fallback?.inbox_id || fallback?.email,
    email: email || fallback?.email || null,
  };
}

async function recordAgentmailInboxOwner({
  store,
  reply,
  ownerAddress,
  result,
  fallbackIdentifiers,
}: {
  store: any;
  reply: any;
  ownerAddress: string;
  result: any;
  fallbackIdentifiers?: any;
}) {
  const identifiers = agentmailInboxIdentifiersFromResult(result, fallbackIdentifiers);
  if (!identifiers.inbox_id) return agentmailInboxRecordMissing(reply);
  for (const identifier of [identifiers.inbox_id, identifiers.email]) {
    if (!identifier) continue;
    const existing = await store.findAgentmailInboxByIdentifier({ identifier });
    if (existing && normalizeEvmAddress(existing.owner_address) !== ownerAddress) {
      return agentmailInboxNotOwned(reply);
    }
  }
  await store.upsertAgentmailInbox({
    inbox_id: identifiers.inbox_id,
    email: identifiers.email,
    owner_address: ownerAddress,
    metadata: { provider: "agentmail" },
  });
  return result;
}

async function repairAgentmailHealthInboxOwner({
  store,
  ownerAddress,
  inboxId,
  existing,
}: {
  store: any;
  ownerAddress: string;
  inboxId: string;
  existing?: any;
}) {
  const health = configuredAgentmailHealthInbox();
  if (!health.owner_address || ownerAddress !== health.owner_address) return false;
  if (!health.identifiers.has(inboxId.toLowerCase())) return false;

  await store.repairAgentmailHealthInboxOwner({
    inbox_id: health.inbox_id || existing?.inbox_id || inboxId,
    email: health.email || existing?.email || (inboxId.includes("@") ? inboxId : null),
    owner_address: ownerAddress,
    metadata: {
      provider: "agentmail",
      health_probe: true,
      repaired_owner: true,
    },
  });
  return true;
}

async function assertAgentmailInboxOwner({
  store,
  reply,
  ownerAddress,
  inboxId,
}: {
  store: any;
  reply: any;
  ownerAddress: string;
  inboxId: string;
}) {
  const inbox = await store.findAgentmailInboxByIdentifier({ identifier: inboxId });
  if (!inbox || normalizeEvmAddress(inbox.owner_address) !== ownerAddress) {
    const repaired = await repairAgentmailHealthInboxOwner({
      store,
      ownerAddress,
      inboxId,
      existing: inbox,
    });
    if (repaired) return null;

    return agentmailInboxNotOwned(reply, {
      inbox_found: Boolean(inbox),
      reason: inbox ? "owner_mismatch" : "missing_inbox_owner_row",
      payer_address: ownerAddress,
      stored_owner_address: inbox?.owner_address,
    });
  }
  return null;
}

export function createAgentmailUpstreamPaymentSigner() {
  const walletLocator = process.env.CROSSMINT_HEALTH_WALLET_LOCATOR || process.env.CROSSMINT_LIVE_WALLET_LOCATOR;
  const address = process.env.CROSSMINT_HEALTH_WALLET_ADDRESS || process.env.CROSSMINT_LIVE_WALLET_ADDRESS;
  const hasCrossmintAuth = Boolean(
    process.env.CROSSMINT_SIGNER_SECRET &&
      (process.env.CROSSMINT_SERVER_SIDE_API_KEY || process.env.CROSSMINT_API_KEY),
  );
  if (walletLocator && address && hasCrossmintAuth) {
    const crossmint = createCrossmintClient();
    return {
      address,
      signMessage: async (payload: any) => {
        const message = payload && typeof payload === "object" && "message" in payload
          ? payload.message
          : payload;
        return crossmint.signMessage({ walletLocator, message });
      },
      signTypedData: async (payload: any) =>
        crossmint.signTypedData({
          walletLocator,
          domain: payload.domain,
          types: payload.types,
          primaryType: payload.primaryType,
          message: payload.message,
        }),
    };
  }
  if (process.env.AGENT_WALLET_PRIVATE_KEY) return null;
  throw Object.assign(
    new Error("Crossmint live wallet env or AGENT_WALLET_PRIVATE_KEY is required for AgentMail upstream x402"),
    {
      statusCode: 503,
      code: "agentmail_upstream_wallet_required",
    },
  );
}

async function executeAgentmailUpstream({
  method = "POST",
  path,
  body,
  maxUsd,
  reply,
  fetchImpl,
  paymentSigner,
}: {
  method?: "GET" | "POST";
  path: string;
  body: Record<string, unknown>;
  maxUsd: string;
  reply: any;
  fetchImpl: typeof fetch;
  paymentSigner?: any;
}) {
  const baseUrl = agentmailX402ApiBase();
  const request: any = {
    method,
    url: `${baseUrl}${path}`,
    headers: method === "POST" ? { "content-type": "application/json" } : {},
    estimatedUsd: maxUsd,
  };
  if (method === "POST") request.json = body;
  const result = await executeEndpoint({
    endpoint: {
      id: "agentmail.upstream",
      defaultPaymentMode: "x402_only",
      agentkit_proof_header: false,
    },
    request,
    maxUsd,
    paymentMode: "x402_only",
    traceId: `agentmail_upstream_${Date.now()}`,
    fetchImpl,
    paymentSigner,
    timeoutMs: 30_000,
  });
  if (!result.ok) {
    const statusCode = Number.isFinite(result.status_code) ? Number(result.status_code) : null;
    reply.status(statusCode && statusCode >= 500 ? 502 : statusCode || 502);
    return {
      ok: false,
      error: safeAgentmailError(statusCode),
      provider_status_code: statusCode,
      body: result.body ?? null,
    };
  }
  return {
    ok: true,
    provider: "agentmail",
    result: result.body,
  };
}

export async function forwardAgentmailCreateInboxUpstream({
  request,
  reply,
  payment,
  store,
  fetchImpl = fetch,
  paymentSigner = createAgentmailUpstreamPaymentSigner(),
}: {
  request: any;
  reply: any;
  payment?: any;
  store?: any;
  fetchImpl?: typeof fetch;
  paymentSigner?: any;
}) {
  const input = stripControlFields(request.body || {});
  const ownershipStore = requireAgentmailOwnershipStore(store, reply);
  if (!ownershipStore || ownershipStore.ok === false) return ownershipStore;
  const ownerAddress = requireAgentmailOwner(payment, reply);
  if (typeof ownerAddress !== "string") return ownerAddress;
  const result = await executeAgentmailUpstream({
    path: "/v0/inboxes",
    body: input,
    maxUsd: agentmailProviderPriceUsd("create_inbox"),
    reply,
    fetchImpl,
    paymentSigner,
  });
  if (!result.ok) return result;
  return recordAgentmailInboxOwner({
    store: ownershipStore,
    reply,
    ownerAddress,
    result,
    fallbackIdentifiers: fallbackInboxIdentifiersFromRequest(input),
  });
}

export async function forwardAgentmailListMessagesUpstream({
  request,
  reply,
  payment,
  store,
  fetchImpl = fetch,
  paymentSigner = createAgentmailUpstreamPaymentSigner(),
}: {
  request: any;
  reply: any;
  payment?: any;
  store?: any;
  fetchImpl?: typeof fetch;
  paymentSigner?: any;
}) {
  const input = stripControlFields(request.body || {});
  const inboxId = requireStringField(input, "inbox_id");
  const ownershipStore = requireAgentmailOwnershipStore(store, reply);
  if (!ownershipStore || ownershipStore.ok === false) return ownershipStore;
  const ownerAddress = requireAgentmailOwner(payment, reply);
  if (typeof ownerAddress !== "string") return ownerAddress;
  const ownershipError = await assertAgentmailInboxOwner({
    store: ownershipStore,
    reply,
    ownerAddress,
    inboxId,
  });
  if (ownershipError) return ownershipError;
  const {
    inbox_id: _inboxId,
    limit,
    page_token: pageToken,
    labels,
    before,
    after,
    ascending,
    include_spam: includeSpam,
    include_blocked: includeBlocked,
    include_unauthenticated: includeUnauthenticated,
    include_trash: includeTrash,
  } = input;
  const baseUrl = agentmailX402ApiBase();
  const url = new URL(`${baseUrl}/v0/inboxes/${encodedPathPart(inboxId)}/messages`);
  const upstreamUrl = addQueryParams(url, {
    limit,
    page_token: pageToken,
    labels,
    before,
    after,
    ascending,
    include_spam: includeSpam,
    include_blocked: includeBlocked,
    include_unauthenticated: includeUnauthenticated,
    include_trash: includeTrash,
  });
  return executeAgentmailUpstream({
    method: "GET",
    path: upstreamUrl.slice(baseUrl.length),
    body: {},
    maxUsd: agentmailProviderPriceUsd("list_messages"),
    reply,
    fetchImpl,
    paymentSigner,
  });
}

export async function forwardAgentmailGetMessageUpstream({
  request,
  reply,
  payment,
  store,
  fetchImpl = fetch,
  paymentSigner = createAgentmailUpstreamPaymentSigner(),
}: {
  request: any;
  reply: any;
  payment?: any;
  store?: any;
  fetchImpl?: typeof fetch;
  paymentSigner?: any;
}) {
  const input = stripControlFields(request.body || {});
  const inboxId = requireStringField(input, "inbox_id");
  const messageId = requireStringField(input, "message_id");
  const ownershipStore = requireAgentmailOwnershipStore(store, reply);
  if (!ownershipStore || ownershipStore.ok === false) return ownershipStore;
  const ownerAddress = requireAgentmailOwner(payment, reply);
  if (typeof ownerAddress !== "string") return ownerAddress;
  const ownershipError = await assertAgentmailInboxOwner({
    store: ownershipStore,
    reply,
    ownerAddress,
    inboxId,
  });
  if (ownershipError) return ownershipError;
  return executeAgentmailUpstream({
    method: "GET",
    path: `/v0/inboxes/${encodedPathPart(inboxId)}/messages/${encodedPathPart(messageId)}`,
    body: {},
    maxUsd: agentmailProviderPriceUsd("get_message"),
    reply,
    fetchImpl,
    paymentSigner,
  });
}

export async function forwardAgentmailSendMessageUpstream({
  request,
  reply,
  payment,
  store,
  fetchImpl = fetch,
  paymentSigner = createAgentmailUpstreamPaymentSigner(),
}: {
  request: any;
  reply: any;
  payment?: any;
  store?: any;
  fetchImpl?: typeof fetch;
  paymentSigner?: any;
}) {
  const input = stripControlFields(request.body || {});
  const inboxId = requireStringField(input, "inbox_id");
  const ownershipStore = requireAgentmailOwnershipStore(store, reply);
  if (!ownershipStore || ownershipStore.ok === false) return ownershipStore;
  const ownerAddress = requireAgentmailOwner(payment, reply);
  if (typeof ownerAddress !== "string") return ownerAddress;
  const ownershipError = await assertAgentmailInboxOwner({
    store: ownershipStore,
    reply,
    ownerAddress,
    inboxId,
  });
  if (ownershipError) return ownershipError;
  const { inbox_id: _inboxId, ...body } = input;
  return executeAgentmailUpstream({
    path: `/v0/inboxes/${encodedPathPart(inboxId)}/messages/send`,
    body,
    maxUsd: agentmailProviderPriceUsd("send_message"),
    reply,
    fetchImpl,
    paymentSigner,
  });
}

export async function forwardAgentmailReplyToMessageUpstream({
  request,
  reply,
  payment,
  store,
  fetchImpl = fetch,
  paymentSigner = createAgentmailUpstreamPaymentSigner(),
}: {
  request: any;
  reply: any;
  payment?: any;
  store?: any;
  fetchImpl?: typeof fetch;
  paymentSigner?: any;
}) {
  const input = stripControlFields(request.body || {});
  const inboxId = requireStringField(input, "inbox_id");
  const messageId = requireStringField(input, "message_id");
  const ownershipStore = requireAgentmailOwnershipStore(store, reply);
  if (!ownershipStore || ownershipStore.ok === false) return ownershipStore;
  const ownerAddress = requireAgentmailOwner(payment, reply);
  if (typeof ownerAddress !== "string") return ownerAddress;
  const ownershipError = await assertAgentmailInboxOwner({
    store: ownershipStore,
    reply,
    ownerAddress,
    inboxId,
  });
  if (ownershipError) return ownershipError;
  const { inbox_id: _inboxId, message_id: _messageId, ...body } = input;
  return executeAgentmailUpstream({
    path: `/v0/inboxes/${encodedPathPart(inboxId)}/messages/${encodedPathPart(messageId)}/reply`,
    body,
    maxUsd: agentmailProviderPriceUsd("reply_to_message"),
    reply,
    fetchImpl,
    paymentSigner,
  });
}
