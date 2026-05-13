import { buildAmadeusActivitiesBySquareRequest } from "../../builders.ts";

export const amadeusActivitiesBySquareEndpointDefinition = Object.freeze({
  id: "amadeus.activities_by_square",
  provider: "amadeus",
  category: "travel",
  name: "Amadeus Activities By Square",
  description: "x402 paid tours and activities search inside a bounding box.",
  url: "https://stabletravel.dev/api/activities/by-square",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.054,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Activities", fixture_label: "Find activities in area" },
  fixture_input: { north: 37.81, south: 37.7, east: -122.35, west: -122.52 },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.06",
    latency_budget_ms: 15000,
    input: { north: 37.81, south: 37.7, east: -122.35, west: -122.52 },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.06", input: { north: 37.81, south: 37.7, east: -122.35, west: -122.52 } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.06", input: { north: 37.81, south: 37.7, east: -122.35, west: -122.52 } },
  },
  builder: buildAmadeusActivitiesBySquareRequest,
});
