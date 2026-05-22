import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { buildAgentmailGetMessageRequest } from "../../builders.ts";
import {
  AGENTMAIL_CATEGORY,
  AGENTMAIL_GET_PRICE,
  AGENTMAIL_PROVIDER,
  envFixture,
  wrapperBaseUrl,
} from "./common.ts";

export const agentmailGetMessageEndpointDefinition = Object.freeze({
  id: "agentmail.get_message",
  provider: AGENTMAIL_PROVIDER,
  category: AGENTMAIL_CATEGORY,
  name: "AgentMail Get Message",
  description: "Fetch a single AgentMail message through ToolRouter's server-side x402 AgentMail wrapper.",
  url: `${wrapperBaseUrl()}/x402/agentmail/messages/get`,
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: Number(AGENTMAIL_GET_PRICE),
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Email",
    fixture_label: "Get AgentMail message",
  },
  fixture_input: {
    inbox_id: "agent@example.com",
    message_id: "msg_123",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: AGENTMAIL_GET_PRICE,
    latency_budget_ms: 10000,
    timeout_ms: 10000,
    required_env: ["AGENTMAIL_HEALTH_INBOX_ID", "AGENTMAIL_HEALTH_MESSAGE_ID"],
    input: {
      inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
      message_id: envFixture("AGENTMAIL_HEALTH_MESSAGE_ID", "agentmail-health-message-id"),
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: AGENTMAIL_GET_PRICE,
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        message_id: envFixture("AGENTMAIL_HEALTH_MESSAGE_ID", "agentmail-health-message-id"),
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: AGENTMAIL_GET_PRICE,
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        message_id: envFixture("AGENTMAIL_HEALTH_MESSAGE_ID", "agentmail-health-message-id"),
      },
    },
  },
  builder: buildAgentmailGetMessageRequest,
}) satisfies EndpointManifest;
