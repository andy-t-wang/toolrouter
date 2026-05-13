import { buildAgentMailPodsRequest } from "../../builders.ts";

export const agentMailPodsEndpointDefinition = Object.freeze({
  id: "agentmail.pods",
  provider: "agentmail",
  category: "productivity",
  name: "AgentMail Pods",
  description: "x402 paid programmable email inbox creation through AgentMail.",
  url: "https://x402.api.agentmail.to/v0/pods",
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Email", fixture_label: "Create AgentMail pod" },
  fixture_input: { name: "toolrouter-demo", client_id: "toolrouter" },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 10000,
    input: { name: "toolrouter-health", client_id: "toolrouter" },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.02", input: { name: "toolrouter-smoke", client_id: "toolrouter" } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: { name: "toolrouter-smoke", client_id: "toolrouter" } },
  },
  builder: buildAgentMailPodsRequest,
});
