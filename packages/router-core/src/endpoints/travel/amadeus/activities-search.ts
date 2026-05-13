import { buildAmadeusActivitiesSearchRequest } from "../../builders.ts";

export const amadeusActivitiesSearchEndpointDefinition = Object.freeze({
  id: "amadeus.activities_search",
  provider: "amadeus",
  category: "travel",
  name: "Amadeus Activities Search",
  description: "x402 paid tours and activities search near coordinates.",
  url: "https://stabletravel.dev/api/activities/search",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.054,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Activities", fixture_label: "Find nearby activities" },
  fixture_input: { latitude: 37.7749, longitude: -122.4194, radius: 1 },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.06",
    latency_budget_ms: 15000,
    input: { latitude: 37.7749, longitude: -122.4194, radius: 1 },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.06", input: { latitude: 37.7749, longitude: -122.4194, radius: 1 } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.06", input: { latitude: 37.7749, longitude: -122.4194, radius: 1 } },
  },
  builder: buildAmadeusActivitiesSearchRequest,
});
