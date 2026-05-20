import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { buildParallelSearchRequest, parallelSearchPriceUsd } from "../../builders.ts";

function wrapperBaseUrl() {
  return (process.env.TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world").replace(/\/$/u, "");
}

export const parallelSearchEndpointDefinition = Object.freeze({
  id: "parallel.search",
  provider: "parallel",
  category: "search",
  name: "Parallel Search",
  description: "Keyword-driven web search through ToolRouter's x402 Parallel wrapper.",
  url: `${wrapperBaseUrl()}/x402/parallel/search`,
  method: "POST",
  agentkit: true,
  x402: true,
  estimated_cost_usd: 0.02,
  agentkit_value_type: "free_trial",
  agentkit_value_label: "AgentKit-Free Trial",
  default_payment_mode: "agentkit_first",
  ui: {
    badge: "Search",
    fixture_label: "Search with Parallel",
  },
  fixture_input: {
    search_queries: ["top sushi places San Francisco"],
    mode: "advanced",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: parallelSearchPriceUsd(),
    latency_budget_ms: 15000,
    timeout_ms: 15000,
    input: {
      search_queries: ["ToolRouter health check"],
      mode: "basic",
    },
  },
  agentkit_health_probe: {
    mode: "agentkit_benefit",
    payment_mode: "agentkit_first",
    max_usd: parallelSearchPriceUsd(),
    latency_budget_ms: 15000,
    timeout_ms: 15000,
    input: {
      search_queries: ["ToolRouter AgentKit health check"],
      mode: "basic",
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "agentkit_first",
      max_usd: parallelSearchPriceUsd(),
      input: {
        search_queries: ["ToolRouter AgentKit smoke test"],
        mode: "basic",
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: parallelSearchPriceUsd(),
      input: {
        search_queries: ["ToolRouter x402 smoke test"],
        mode: "basic",
      },
    },
  },
  builder: buildParallelSearchRequest,
}) satisfies EndpointManifest;
