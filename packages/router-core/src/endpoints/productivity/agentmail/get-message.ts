import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { buildAgentmailGetMessageRequest } from "../../builders.ts";
import {
  AGENTMAIL_CATEGORY,
  AGENTMAIL_PROVIDER,
  AGENTMAIL_READ_URL,
  envFixture,
} from "./common.ts";

export const agentmailGetMessageEndpointDefinition = Object.freeze({
  id: "agentmail.get_message",
  provider: AGENTMAIL_PROVIDER,
  category: AGENTMAIL_CATEGORY,
  name: "AgentMail Get Message",
  description: "Fetch a single AgentMail message over x402.",
  url: `${AGENTMAIL_READ_URL}/inboxes/messages/message`,
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0,
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
    mode: "free_availability",
    payment_mode: "x402_only",
    max_usd: "0",
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
      max_usd: "0",
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        message_id: envFixture("AGENTMAIL_HEALTH_MESSAGE_ID", "agentmail-health-message-id"),
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: "0",
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        message_id: envFixture("AGENTMAIL_HEALTH_MESSAGE_ID", "agentmail-health-message-id"),
      },
    },
  },
  builder: buildAgentmailGetMessageRequest,
}) satisfies EndpointManifest;

