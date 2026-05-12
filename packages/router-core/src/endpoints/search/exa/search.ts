import { buildExaSearchRequest } from "../../builders.ts";

export const exaSearchEndpointDefinition = Object.freeze({
  id: "exa.search",
  provider: "exa",
  category: "search",
  name: "Exa Search",
  description: "AgentKit-first neural web search with x402 paid fallback.",
  url: "https://api.exa.ai/search",
  method: "POST",
  agentkit: true,
  x402: true,
  estimated_cost_usd: 0.007,
  agentkit_value_type: "free_trial",
  agentkit_value_label: "AgentKit-Free Trial",
  default_payment_mode: "agentkit_first",
  ui: {
    badge: "Search",
    fixture_label: "Search with Exa",
  },
  fixture_input: {
    query: "AgentKit examples",
    search_type: "fast",
    num_results: 5,
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.01",
    latency_budget_ms: 10000,
    input: {
      query: "ToolRouter health check",
      search_type: "fast",
      num_results: 5,
    },
  },
  agentkit_health_probe: {
    mode: "agentkit_benefit",
    payment_mode: "agentkit_first",
    max_usd: "0.01",
    latency_budget_ms: 10000,
    input: {
      query: "ToolRouter AgentKit health check",
      search_type: "fast",
      num_results: 5,
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "agentkit_first",
      max_usd: "0.01",
      input: {
        query: "ToolRouter AgentKit smoke test",
        search_type: "fast",
        num_results: 5,
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: "0.01",
      input: {
        query: "ToolRouter x402 smoke test",
        search_type: "fast",
        num_results: 5,
      },
    },
  },
  builder: buildExaSearchRequest,
});
