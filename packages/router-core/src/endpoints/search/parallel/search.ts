import { buildParallelSearchRequest } from "../../builders.ts";

export const parallelSearchEndpointDefinition = Object.freeze({
  id: "parallel.search",
  provider: "parallel",
  category: "search",
  name: "Parallel Search",
  description: "x402 paid web search through Parallel.",
  url: "https://parallelmpp.dev/api/search",
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: {
    badge: "Search",
    fixture_label: "Search with Parallel",
  },
  fixture_input: {
    query: "AgentKit examples",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 10000,
    input: {
      query: "ToolRouter health check",
    },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.02", input: { query: "ToolRouter smoke test" } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: { query: "ToolRouter x402 smoke test" } },
  },
  builder: buildParallelSearchRequest,
});
