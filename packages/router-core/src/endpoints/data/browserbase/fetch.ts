import { buildBrowserbaseFetchRequest } from "../../builders.ts";

export const browserbaseFetchEndpointDefinition = Object.freeze({
  id: "browserbase.fetch",
  provider: "browserbase",
  category: "data",
  name: "Browserbase Fetch",
  description: "AgentKit-verified x402 page fetch with content and metadata.",
  url: "https://x402.browserbase.com/fetch",
  method: "POST",
  agentkit: true,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "access",
  agentkit_value_label: "AgentKit-Access",
  default_payment_mode: "agentkit_first",
  ui: {
    badge: "Fetch",
    fixture_label: "Fetch with Browserbase",
  },
  fixture_input: {
    url: "https://example.com",
  },
  health_probe: {
    mode: "challenge",
    payment_mode: "agentkit_first",
    max_usd: "0.02",
    input: {
      url: "https://example.com",
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "agentkit_first",
      max_usd: "0.02",
      input: {
        url: "https://example.com",
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: "0.02",
      input: {
        url: "https://example.com",
      },
    },
  },
  builder: buildBrowserbaseFetchRequest,
});
