import { buildFlightAwareDisruptionCountsAirlineRequest } from "../../builders.ts";

export const flightAwareDisruptionCountsAirlineEndpointDefinition = Object.freeze({
  id: "flightaware.disruption_counts_airline",
  provider: "flightaware",
  category: "travel",
  name: "FlightAware Airline Disruption Counts",
  description: "x402 paid disruption statistics by airline from FlightAware.",
  url: "https://stabletravel.dev/api/flightaware/disruption-counts/airline",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Stats", fixture_label: "Check airline disruptions" },
  fixture_input: { time_period: "today", max_pages: 1 },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 12000,
    input: { time_period: "today", max_pages: 1 },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.02", input: { time_period: "today", max_pages: 1 } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: { time_period: "today", max_pages: 1 } },
  },
  builder: buildFlightAwareDisruptionCountsAirlineRequest,
});
