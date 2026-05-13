import { buildFlightAwareAirportDelaysRequest } from "../../builders.ts";

export const flightAwareAirportDelaysEndpointDefinition = Object.freeze({
  id: "flightaware.airport_delays",
  provider: "flightaware",
  category: "travel",
  name: "FlightAware Airport Delays",
  description: "x402 paid live global airport delay map from FlightAware.",
  url: "https://stabletravel.dev/api/flightaware/airports/delays",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.1,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Delays", fixture_label: "Check global delays" },
  fixture_input: {},
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.11",
    latency_budget_ms: 15000,
    input: {},
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.11", input: {} },
    paid_path: { payment_mode: "x402_only", max_usd: "0.11", input: {} },
  },
  builder: buildFlightAwareAirportDelaysRequest,
});
