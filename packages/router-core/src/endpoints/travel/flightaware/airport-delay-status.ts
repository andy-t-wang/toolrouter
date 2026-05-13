import { buildFlightAwareAirportDelayStatusRequest } from "../../builders.ts";

export const flightAwareAirportDelayStatusEndpointDefinition = Object.freeze({
  id: "flightaware.airport_delay_status",
  provider: "flightaware",
  category: "travel",
  name: "FlightAware Airport Delay Status",
  description: "x402 paid delay status for a specific airport from FlightAware.",
  url: "https://stabletravel.dev/api/flightaware/airports",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.02,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Delays", fixture_label: "Check airport delay status" },
  fixture_input: { airport_code: "KSFO" },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.03",
    latency_budget_ms: 12000,
    input: { airport_code: "KSFO" },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.03", input: { airport_code: "KSFO" } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.03", input: { airport_code: "KSFO" } },
  },
  builder: buildFlightAwareAirportDelayStatusRequest,
});
