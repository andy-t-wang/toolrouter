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
  agentkit_proof_header: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "access",
  agentkit_value_label: "AgentKit-Access",
  default_payment_mode: "agentkit_first",
  ui: {
    badge: "Browser",
    fixture_label: "Create Browserbase session",
  },
  fixture_input: {
    estimated_minutes: 5,
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 5000,
    input: {
      estimated_minutes: 5,
    },
  },
  agentkit_health_probe: {
    mode: "agentkit_benefit",
    payment_mode: "agentkit_first",
    max_usd: "0.02",
    latency_budget_ms: 5000,
    input: {
      estimated_minutes: 5,
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "agentkit_first",
      max_usd: "0.02",
      input: {
        estimated_minutes: 5,
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: "0.02",
      input: {
        estimated_minutes: 5,
      },
    },
  },
  builder: buildBrowserbaseSessionRequest,
});
