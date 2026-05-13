import { buildPerplexitySearchRequest } from "../../builders.ts";

export const perplexitySearchEndpointDefinition = Object.freeze({
  id: "perplexity.search",
  provider: "perplexity",
  category: "search",
  name: "Perplexity Search",
  description: "x402 paid AI-synthesized web search through Perplexity.",
  url: "https://pplx.x402.paysponge.com/search",
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: {
    badge: "Search",
    fixture_label: "Search with Perplexity",
  },
  fixture_input: {
    query: "AgentKit examples",
    max_results: 5,
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 15000,
    input: {
      query: "ToolRouter health check",
      max_results: 3,
    },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.02", input: { query: "ToolRouter smoke test", max_results: 3 } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: { query: "ToolRouter x402 smoke test", max_results: 3 } },
  },
  builder: buildPerplexitySearchRequest,
});
