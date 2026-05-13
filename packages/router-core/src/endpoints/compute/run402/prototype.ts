import { buildRun402PrototypeRequest } from "../../builders.ts";

export const run402PrototypeEndpointDefinition = Object.freeze({
  id: "run402.prototype",
  provider: "run402",
  category: "compute",
  name: "Run402 Prototype Tier",
  description: "x402 paid API tier lease for Run402 prototype access.",
  url: "https://api.run402.com/tiers/v1/prototype",
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.1,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: {
    badge: "Compute",
    fixture_label: "Lease prototype tier",
  },
  fixture_input: {},
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.11",
    latency_budget_ms: 10000,
    input: {},
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.11", input: {} },
    paid_path: { payment_mode: "x402_only", max_usd: "0.11", input: {} },
  },
  builder: buildRun402PrototypeRequest,
});
