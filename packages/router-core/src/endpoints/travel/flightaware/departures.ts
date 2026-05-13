import { buildFlightAwareDeparturesRequest } from "../../builders.ts";

export const flightAwareDeparturesEndpointDefinition = Object.freeze({
  id: "flightaware.departures",
  provider: "flightaware",
  category: "travel",
  name: "FlightAware Departures",
  description: "x402 paid live airport departures from FlightAware.",
  url: "https://stabletravel.dev/api/flightaware/airports",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Departures", fixture_label: "List departures" },
  fixture_input: { airport_code: "KSFO", max_pages: 1 },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 12000,
    input: { airport_code: "KSFO", max_pages: 1 },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.02", input: { airport_code: "KSFO", max_pages: 1 } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: { airport_code: "KSFO", max_pages: 1 } },
  },
  builder: buildFlightAwareDeparturesRequest,
});
