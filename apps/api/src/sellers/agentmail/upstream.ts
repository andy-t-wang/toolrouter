import { executeEndpoint } from "@toolrouter/router-core";

import { createCrossmintClient } from "../../services/crossmint.ts";
import { agentmailProviderPriceUsd } from "./pricing.ts";

const AGENTMAIL_X402_API_BASE = "https://x402.api.agentmail.to";

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

function safeAgentmailError(status: number | null) {
  if (status === 400) return "AgentMail validation failed";
  if (status === 401 || status === 403) return "AgentMail payment or authorization failed";
  if (status === 404) return "AgentMail resource not found";
  if (status === 429) return "AgentMail rate limited";
  if (status !== null && status >= 500) return "AgentMail provider error";
  return "AgentMail request failed";
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
  path,
  body,
  maxUsd,
  reply,
  fetchImpl,
  paymentSigner,
}: {
  path: string;
  body: Record<string, unknown>;
  maxUsd: string;
  reply: any;
  fetchImpl: typeof fetch;
  paymentSigner?: any;
}) {
  const request = {
    method: "POST",
    url: `${AGENTMAIL_X402_API_BASE}${path}`,
    headers: { "content-type": "application/json" },
    json: body,
    estimatedUsd: maxUsd,
  };
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
  fetchImpl = fetch,
  paymentSigner = createAgentmailUpstreamPaymentSigner(),
}: {
  request: any;
  reply: any;
  fetchImpl?: typeof fetch;
  paymentSigner?: any;
}) {
  return executeAgentmailUpstream({
    path: "/v0/inboxes",
    body: stripControlFields(request.body || {}),
    maxUsd: agentmailProviderPriceUsd("create_inbox"),
    reply,
    fetchImpl,
    paymentSigner,
  });
}

export async function forwardAgentmailSendMessageUpstream({
  request,
  reply,
  fetchImpl = fetch,
  paymentSigner = createAgentmailUpstreamPaymentSigner(),
}: {
  request: any;
  reply: any;
  fetchImpl?: typeof fetch;
  paymentSigner?: any;
}) {
  const input = stripControlFields(request.body || {});
  const inboxId = requireStringField(input, "inbox_id");
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
  fetchImpl = fetch,
  paymentSigner = createAgentmailUpstreamPaymentSigner(),
}: {
  request: any;
  reply: any;
  fetchImpl?: typeof fetch;
  paymentSigner?: any;
}) {
  const input = stripControlFields(request.body || {});
  const inboxId = requireStringField(input, "inbox_id");
  const messageId = requireStringField(input, "message_id");
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

