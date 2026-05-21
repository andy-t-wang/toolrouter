import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { buildAgentmailReplyToMessageRequest } from "../../builders.ts";
import {
  AGENTMAIL_CATEGORY,
  AGENTMAIL_PROVIDER,
  AGENTMAIL_REPLY_PRICE,
  envFixture,
  wrapperBaseUrl,
} from "./common.ts";

export const agentmailReplyToMessageEndpointDefinition = Object.freeze({
  id: "agentmail.reply_to_message",
  provider: AGENTMAIL_PROVIDER,
  category: AGENTMAIL_CATEGORY,
  name: "AgentMail Reply To Message",
  description: "Reply to an AgentMail message through ToolRouter's server-side x402 AgentMail wrapper.",
  url: `${wrapperBaseUrl()}/x402/agentmail/messages/reply`,
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: Number(AGENTMAIL_REPLY_PRICE),
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Email",
    fixture_label: "Reply with AgentMail",
  },
  fixture_input: {
    inbox_id: "agent@example.com",
    message_id: "msg_123",
    text: "Thanks for the note.",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: AGENTMAIL_REPLY_PRICE,
    latency_budget_ms: 20000,
    timeout_ms: 20000,
    required_env: ["AGENTMAIL_HEALTH_INBOX_ID", "AGENTMAIL_HEALTH_REPLY_MESSAGE_ID"],
    input: {
      inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
      message_id: envFixture("AGENTMAIL_HEALTH_REPLY_MESSAGE_ID", "agentmail-health-message-id"),
      text: "ToolRouter AgentMail reply health check.",
      labels: ["toolrouter-health"],
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: AGENTMAIL_REPLY_PRICE,
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        message_id: envFixture("AGENTMAIL_HEALTH_REPLY_MESSAGE_ID", "agentmail-health-message-id"),
        text: "ToolRouter AgentMail reply smoke test.",
        labels: ["toolrouter-smoke"],
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: AGENTMAIL_REPLY_PRICE,
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        message_id: envFixture("AGENTMAIL_HEALTH_REPLY_MESSAGE_ID", "agentmail-health-message-id"),
        text: "ToolRouter AgentMail paid reply smoke test.",
        labels: ["toolrouter-smoke"],
      },
    },
  },
  builder: buildAgentmailReplyToMessageRequest,
}) satisfies EndpointManifest;
