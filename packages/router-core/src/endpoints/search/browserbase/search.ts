import { buildBrowserbaseSearchRequest } from "../../builders.ts";

export const browserbaseSearchEndpointDefinition = Object.freeze({
  id: "browserbase.search",
  provider: "browserbase",
  category: "search",
  name: "Browserbase Search",
  description: "AgentKit-verified x402 web search from Browserbase.",
  url: "https://x402.browserbase.com/search",
  method: "POST",
  agentkit: true,
  x402: true,
  agentkit_proof_header: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "access",
  agentkit_value_label: "AgentKit-Access",
  default_payment_mode: "agentkit_first",
  ui: {
    badge: "Browser",
    fixture_label: "Search with Browserbase",
  },
  fixture_input: {
    query: "top sushi places in San Francisco",
  },
  health_probe: {
    mode: "challenge",
    payment_mode: "agentkit_first",
    max_usd: "0.02",
    input: {
      query: "ToolRouter Browserbase health check",
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "agentkit_first",
      max_usd: "0.02",
      input: {
        query: "ToolRouter Browserbase AgentKit smoke test",
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: "0.02",
      input: {
        query: "ToolRouter Browserbase x402 smoke test",
      },
    },
  },
  builder: buildBrowserbaseSearchRequest,
});
