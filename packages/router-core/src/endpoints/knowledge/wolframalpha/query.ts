import { buildWolframAlphaQueryRequest } from "../../builders.ts";

export const wolframAlphaQueryEndpointDefinition = Object.freeze({
  id: "wolframalpha.query",
  provider: "wolframalpha",
  category: "knowledge",
  name: "Wolfram|Alpha Query",
  description: "x402 paid structured Wolfram|Alpha result with units and steps.",
  url: "https://wolframalpha.x402.paysponge.com/v2/query",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.02,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: {
    badge: "Answer",
    fixture_label: "Query Wolfram|Alpha",
  },
  fixture_input: {
    query: "2+2",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.03",
    latency_budget_ms: 12000,
    input: {
      query: "2+2",
    },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.03", input: { query: "2+2" } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.03", input: { query: "2+2" } },
  },
  builder: buildWolframAlphaQueryRequest,
});
