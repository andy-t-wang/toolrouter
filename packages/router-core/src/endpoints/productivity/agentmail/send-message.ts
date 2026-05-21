import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { buildAgentmailSendMessageRequest } from "../../builders.ts";
import {
  AGENTMAIL_CATEGORY,
  AGENTMAIL_PROVIDER,
  AGENTMAIL_SEND_PRICE,
  envFixture,
  wrapperBaseUrl,
} from "./common.ts";

export const agentmailSendMessageEndpointDefinition = Object.freeze({
  id: "agentmail.send_message",
  provider: AGENTMAIL_PROVIDER,
  category: AGENTMAIL_CATEGORY,
  name: "AgentMail Send Message",
  description: "Send an email from an AgentMail inbox through ToolRouter's server-side x402 AgentMail wrapper.",
  url: `${wrapperBaseUrl()}/x402/agentmail/messages/send`,
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: Number(AGENTMAIL_SEND_PRICE),
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Email",
    fixture_label: "Send AgentMail message",
  },
  fixture_input: {
    inbox_id: "agent@example.com",
    to: "recipient@example.com",
    subject: "Hello from ToolRouter",
    text: "Hello from AgentMail via ToolRouter.",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: AGENTMAIL_SEND_PRICE,
    latency_budget_ms: 20000,
    timeout_ms: 20000,
    required_env: ["AGENTMAIL_HEALTH_INBOX_ID", "AGENTMAIL_HEALTH_INBOX_EMAIL"],
    input: {
      inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
      to: envFixture("AGENTMAIL_HEALTH_INBOX_EMAIL", "agentmail-health@example.com"),
      subject: "ToolRouter AgentMail health check",
      text: "ToolRouter AgentMail send health check.",
      labels: ["toolrouter-health"],
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: AGENTMAIL_SEND_PRICE,
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        to: envFixture("AGENTMAIL_HEALTH_INBOX_EMAIL", "agentmail-health@example.com"),
        subject: "ToolRouter AgentMail smoke test",
        text: "ToolRouter AgentMail send smoke test.",
        labels: ["toolrouter-smoke"],
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: AGENTMAIL_SEND_PRICE,
      input: {
        inbox_id: envFixture("AGENTMAIL_HEALTH_INBOX_ID", "agentmail-health-inbox-id"),
        to: envFixture("AGENTMAIL_HEALTH_INBOX_EMAIL", "agentmail-health@example.com"),
        subject: "ToolRouter AgentMail paid smoke test",
        text: "ToolRouter AgentMail send paid smoke test.",
        labels: ["toolrouter-smoke"],
      },
    },
  },
  builder: buildAgentmailSendMessageRequest,
}) satisfies EndpointManifest;
