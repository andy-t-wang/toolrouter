import { buildFlightAwareFlightTrackRequest } from "../../builders.ts";

export const flightAwareFlightTrackEndpointDefinition = Object.freeze({
  id: "flightaware.flight_track",
  provider: "flightaware",
  category: "travel",
  name: "FlightAware Flight Track",
  description: "x402 paid live flight tracking by callsign from FlightAware.",
  url: "https://stabletravel.dev/api/flightaware/flights",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Track", fixture_label: "Track flight" },
  fixture_input: { callsign: "UAL123", ident_type: "designator", max_pages: 1 },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 12000,
    input: { callsign: "UAL123", ident_type: "designator", max_pages: 1 },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.02", input: { callsign: "UAL123", ident_type: "designator", max_pages: 1 } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: { callsign: "UAL123", ident_type: "designator", max_pages: 1 } },
  },
  builder: buildFlightAwareFlightTrackRequest,
});
