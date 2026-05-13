import { buildFlightAwareArrivalsRequest } from "../../builders.ts";

export const flightAwareArrivalsEndpointDefinition = Object.freeze({
  id: "flightaware.arrivals",
  provider: "flightaware",
  category: "travel",
  name: "FlightAware Arrivals",
  description: "x402 paid live airport arrivals from FlightAware.",
  url: "https://stabletravel.dev/api/flightaware/airports",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Arrivals", fixture_label: "List arrivals" },
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
  builder: buildFlightAwareArrivalsRequest,
});
