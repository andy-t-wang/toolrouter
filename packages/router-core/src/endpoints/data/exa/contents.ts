import { buildExaContentsRequest } from "../../builders.ts";

export const exaContentsEndpointDefinition = Object.freeze({
  id: "exa.contents",
  provider: "exa",
  category: "data",
  name: "Exa Contents",
  description: "AgentKit-first clean text and summary fetch from URLs with x402 paid fallback.",
  url: "https://api.exa.ai/contents",
  method: "POST",
  agentkit: true,
  x402: true,
  estimated_cost_usd: 0.001,
  agentkit_value_type: "free_trial",
  agentkit_value_label: "AgentKit-Free Trial",
  default_payment_mode: "agentkit_first",
  ui: {
    badge: "Fetch",
    fixture_label: "Fetch URL contents with Exa",
  },
  fixture_input: {
    urls: ["https://example.com"],
    text: true,
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.01",
    latency_budget_ms: 10000,
    input: {
      urls: ["https://example.com"],
      text: true,
    },
  },
  agentkit_health_probe: {
    mode: "agentkit_benefit",
    payment_mode: "agentkit_first",
    max_usd: "0.01",
    latency_budget_ms: 10000,
    input: {
      urls: ["https://example.com"],
      text: true,
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "agentkit_first",
      max_usd: "0.01",
      input: {
        urls: ["https://example.com"],
        text: true,
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: "0.01",
      input: {
        urls: ["https://example.com"],
        text: true,
      },
    },
  },
  builder: buildExaContentsRequest,
});
