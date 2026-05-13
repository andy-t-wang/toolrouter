import { buildFlightAwareFlightsBetweenAirportsRequest } from "../../builders.ts";

export const flightAwareFlightsBetweenAirportsEndpointDefinition = Object.freeze({
  id: "flightaware.flights_between_airports",
  provider: "flightaware",
  category: "travel",
  name: "FlightAware Flights Between Airports",
  description: "x402 paid live flights between two airports from FlightAware.",
  url: "https://stabletravel.dev/api/flightaware/airports",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.1,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Routes", fixture_label: "Find flights between airports" },
  fixture_input: { origin_airport_code: "KSFO", destination_airport_code: "KJFK", max_pages: 1 },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.11",
    latency_budget_ms: 15000,
    input: { origin_airport_code: "KSFO", destination_airport_code: "KJFK", max_pages: 1 },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.11", input: { origin_airport_code: "KSFO", destination_airport_code: "KJFK", max_pages: 1 } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.11", input: { origin_airport_code: "KSFO", destination_airport_code: "KJFK", max_pages: 1 } },
  },
  builder: buildFlightAwareFlightsBetweenAirportsRequest,
});
