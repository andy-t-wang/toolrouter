import { buildWolframAlphaResultRequest } from "../../builders.ts";

export const wolframAlphaResultEndpointDefinition = Object.freeze({
  id: "wolframalpha.result",
  provider: "wolframalpha",
  category: "knowledge",
  name: "Wolfram|Alpha Result",
  description: "x402 paid short plaintext answer from Wolfram|Alpha.",
  url: "https://wolframalpha.x402.paysponge.com/v1/result",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: {
    badge: "Answer",
    fixture_label: "Ask Wolfram|Alpha",
  },
  fixture_input: {
    query: "2+2",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 10000,
    input: {
      query: "2+2",
    },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.02", input: { query: "2+2" } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: { query: "2+2" } },
  },
  builder: buildWolframAlphaResultRequest,
});
