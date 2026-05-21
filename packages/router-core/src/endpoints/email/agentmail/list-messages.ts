import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { buildAgentmailListMessagesRequest } from "../../builders.ts";
import {
  AGENTMAIL_CATEGORY,
  AGENTMAIL_PROVIDER,
  AGENTMAIL_READ_URL,
  envFixture,
} from "./common.ts";

export const agentmailListMessagesEndpointDefinition = Object.freeze({
  id: "agentmail.list_messages",
  provider: AGENTMAIL_PROVIDER,
  category: AGENTMAIL_CATEGORY,
  name: "AgentMail List Messages",
  description: "List messages in an AgentMail inbox through ToolRouter's server-side x402 execution path.",
  url: `${AGENTMAIL_READ_URL}/inboxes/messages`,
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0,
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Email",
    fixture_label: "List AgentMail messages",
  },
  fixture_input: {
    inbox_id: "agent@example.com",
    limit: 10,
  },
  health_probe: {
    mode: "free_availability",
    payment_mode: "x402_only",
    max_usd: "0",
    latency_budget_ms: 10000,
    timeout_ms: 10000,
    required_env: ["AGENTMAIL_HEALTH_INBOX_ID"],
    input: {
      inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
      limit: 10,
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: "0",
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        limit: 10,
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: "0",
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        limit: 10,
      },
    },
  },
  builder: buildAgentmailListMessagesRequest,
}) satisfies EndpointManifest;
