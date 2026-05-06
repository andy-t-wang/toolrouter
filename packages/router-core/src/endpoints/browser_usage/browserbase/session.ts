import { buildBrowserbaseSessionRequest } from "../../builders.ts";

export const browserbaseSessionEndpointDefinition = Object.freeze({
  id: "browserbase.session",
  provider: "browserbase",
  category: "browser_usage",
  name: "Browserbase Session",
  description: "AgentKit-verified x402 browser session creation.",
  url: "https://x402.browserbase.com/browser/session/create",
  method: "POST",
  agentkit: true,
  x402: true,
  estimated_cost_usd: 0.002,
  agentkit_value_type: "access",
  agentkit_value_label: "AgentKit-Access",
  default_payment_mode: "agentkit_first",
  ui: {
    badge: "Browser",
    fixture_label: "Create Browserbase session",
  },
  fixture_input: {
    estimated_minutes: 1,
  },
  health_probe: {
    mode: "challenge",
    payment_mode: "agentkit_first",
    max_usd: "0.01",
    input: {
      estimated_minutes: 1,
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "agentkit_first",
      max_usd: "0.01",
      input: {
        estimated_minutes: 1,
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: "0.01",
      input: {
        estimated_minutes: 1,
      },
    },
  },
  builder: buildBrowserbaseSessionRequest,
});
