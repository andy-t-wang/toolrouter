import type { SellerManifest } from "@toolrouter/router-core";

import { MonthlyAgentKitStorage } from "../agentkit-storage.ts";
import {
  createSellerService,
  type SellerService,
} from "../createSellerService.ts";
import {
  agentmailCreateInboxPriceUsd,
  agentmailReplyToMessagePriceUsd,
  agentmailSendMessagePriceUsd,
} from "./pricing.ts";
import {
  createAgentmailUpstreamPaymentSigner,
  forwardAgentmailCreateInboxUpstream,
  forwardAgentmailReplyToMessageUpstream,
  forwardAgentmailSendMessageUpstream,
} from "./upstream.ts";
import { createParallelFacilitatorConfig } from "../parallel/upstream.ts";

export const AGENTMAIL_CREATE_INBOX_PATH = "/x402/agentmail/inboxes";
export const AGENTMAIL_SEND_MESSAGE_PATH = "/x402/agentmail/messages/send";
export const AGENTMAIL_REPLY_TO_MESSAGE_PATH = "/x402/agentmail/messages/reply";

const AGENTMAIL_PAY_TO_ENV_ORDER = Object.freeze([
  "X402_AGENTMAIL_PAY_TO_ADDRESS",
  "X402_PAY_TO_ADDRESS",
  "CROSSMINT_TREASURY_WALLET_ADDRESS",
  "CROSSMINT_HEALTH_WALLET_ADDRESS",
  "CROSSMINT_LIVE_WALLET_ADDRESS",
]) as readonly string[];

const AGENTMAIL_SECRETS = Object.freeze([]) as readonly string[];

export const agentmailCreateInboxSellerManifest: SellerManifest = Object.freeze({
  id: "agentmail.create_inbox",
  route: AGENTMAIL_CREATE_INBOX_PATH,
  method: "POST",
  description: "AgentMail inbox creation",
  mime_type: "application/json",
  secrets: AGENTMAIL_SECRETS,
  pricing: () => agentmailCreateInboxPriceUsd(),
  agentkit: null,
  pay_to_env_order: AGENTMAIL_PAY_TO_ENV_ORDER,
  upstream: Object.freeze({
    url: "https://x402.api.agentmail.to/v0/inboxes",
    headers_factory: () => ({ "content-type": "application/json" }),
    body_factory: (input: any) => input,
  }),
  unpaid_response_body: Object.freeze({ error: "x402 payment required" }),
}) as SellerManifest;

export const agentmailSendMessageSellerManifest: SellerManifest = Object.freeze({
  id: "agentmail.send_message",
  route: AGENTMAIL_SEND_MESSAGE_PATH,
  method: "POST",
  description: "AgentMail send message",
  mime_type: "application/json",
  secrets: AGENTMAIL_SECRETS,
  pricing: () => agentmailSendMessagePriceUsd(),
  agentkit: null,
  pay_to_env_order: AGENTMAIL_PAY_TO_ENV_ORDER,
  upstream: Object.freeze({
    url: "https://x402.api.agentmail.to/v0/inboxes/{inbox_id}/messages/send",
    headers_factory: () => ({ "content-type": "application/json" }),
    body_factory: (input: any) => input,
  }),
  unpaid_response_body: Object.freeze({ error: "x402 payment required" }),
}) as SellerManifest;

export const agentmailReplyToMessageSellerManifest: SellerManifest = Object.freeze({
  id: "agentmail.reply_to_message",
  route: AGENTMAIL_REPLY_TO_MESSAGE_PATH,
  method: "POST",
  description: "AgentMail reply to message",
  mime_type: "application/json",
  secrets: AGENTMAIL_SECRETS,
  pricing: () => agentmailReplyToMessagePriceUsd(),
  agentkit: null,
  pay_to_env_order: AGENTMAIL_PAY_TO_ENV_ORDER,
  upstream: Object.freeze({
    url: "https://x402.api.agentmail.to/v0/inboxes/{inbox_id}/messages/{message_id}/reply",
    headers_factory: () => ({ "content-type": "application/json" }),
    body_factory: (input: any) => input,
  }),
  unpaid_response_body: Object.freeze({ error: "x402 payment required" }),
}) as SellerManifest;

export interface RegisterAgentmailSellerDeps {
  cache: any;
  agentBook: any;
  fetchImpl?: typeof fetch;
  facilitatorClient?: any;
  upstreamPaymentSigner?: any;
}

function buildSeller(
  manifest: SellerManifest,
  forwardUpstream: (args: {
    request: any;
    reply: any;
    fetchImpl: typeof fetch;
    paymentSigner: any;
  }) => Promise<unknown>,
  { cache, agentBook, fetchImpl = fetch, facilitatorClient, upstreamPaymentSigner }: RegisterAgentmailSellerDeps,
) {
  const storage = new MonthlyAgentKitStorage(cache, manifest.id);
  const paymentSigner = upstreamPaymentSigner === undefined
    ? createAgentmailUpstreamPaymentSigner()
    : upstreamPaymentSigner;
  return createSellerService(manifest, {
    cache,
    agentBook,
    facilitatorConfig: facilitatorClient ? undefined : createParallelFacilitatorConfig(),
    facilitatorClient,
    storage,
    forwardUpstream: async ({ request, reply }) =>
      forwardUpstream({ request, reply, fetchImpl, paymentSigner }),
  });
}

export async function registerAgentmailCreateInboxSellerService(
  deps: RegisterAgentmailSellerDeps,
): Promise<SellerService> {
  return buildSeller(agentmailCreateInboxSellerManifest, forwardAgentmailCreateInboxUpstream, deps);
}

export async function registerAgentmailSendMessageSellerService(
  deps: RegisterAgentmailSellerDeps,
): Promise<SellerService> {
  return buildSeller(agentmailSendMessageSellerManifest, forwardAgentmailSendMessageUpstream, deps);
}

export async function registerAgentmailReplyToMessageSellerService(
  deps: RegisterAgentmailSellerDeps,
): Promise<SellerService> {
  return buildSeller(agentmailReplyToMessageSellerManifest, forwardAgentmailReplyToMessageUpstream, deps);
}

