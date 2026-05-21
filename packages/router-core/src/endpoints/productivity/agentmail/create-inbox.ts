import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { buildAgentmailCreateInboxRequest } from "../../builders.ts";
import {
  AGENTMAIL_CATEGORY,
  AGENTMAIL_CREATE_PRICE,
  AGENTMAIL_PROVIDER,
  wrapperBaseUrl,
} from "./common.ts";

export const agentmailCreateInboxEndpointDefinition = Object.freeze({
  id: "agentmail.create_inbox",
  provider: AGENTMAIL_PROVIDER,
  category: AGENTMAIL_CATEGORY,
  name: "AgentMail Create Inbox",
  description: "Create a new AgentMail inbox through ToolRouter's x402 AgentMail wrapper.",
  url: `${wrapperBaseUrl()}/x402/agentmail/inboxes`,
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: Number(AGENTMAIL_CREATE_PRICE),
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Email",
    fixture_label: "Create AgentMail inbox",
  },
  fixture_input: {
    username: "toolrouter-demo",
    display_name: "ToolRouter Demo",
    client_id: "toolrouter-demo-inbox",
  },
  health_probe: {
    mode: "manual_only",
    payment_mode: "x402_only",
    max_usd: AGENTMAIL_CREATE_PRICE,
    latency_budget_ms: 20000,
    timeout_ms: 20000,
    input: {
      username: "toolrouter-health",
      display_name: "ToolRouter Health",
      client_id: "toolrouter-agentmail-health-inbox",
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: AGENTMAIL_CREATE_PRICE,
      input: {
        username: "toolrouter-smoke",
        display_name: "ToolRouter Smoke",
        client_id: "toolrouter-agentmail-smoke-inbox",
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: AGENTMAIL_CREATE_PRICE,
      input: {
        username: "toolrouter-smoke",
        display_name: "ToolRouter Smoke",
        client_id: "toolrouter-agentmail-smoke-inbox",
      },
    },
  },
  builder: buildAgentmailCreateInboxRequest,
}) satisfies EndpointManifest;

