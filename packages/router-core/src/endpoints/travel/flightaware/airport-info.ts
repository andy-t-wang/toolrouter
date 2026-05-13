import { buildFlightAwareAirportInfoRequest } from "../../builders.ts";

export const flightAwareAirportInfoEndpointDefinition = Object.freeze({
  id: "flightaware.airport_info",
  provider: "flightaware",
  category: "travel",
  name: "FlightAware Airport Info",
  description: "x402 paid airport information lookup from FlightAware.",
  url: "https://stabletravel.dev/api/flightaware/airports",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.03,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Airport", fixture_label: "Lookup airport" },
  fixture_input: { airport_code: "KSFO" },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.04",
    latency_budget_ms: 12000,
    input: { airport_code: "KSFO" },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.04", input: { airport_code: "KSFO" } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.04", input: { airport_code: "KSFO" } },
  },
  builder: buildFlightAwareAirportInfoRequest,
});
