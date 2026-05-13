import { buildFlightAwareWeatherObservationsRequest } from "../../builders.ts";

export const flightAwareWeatherObservationsEndpointDefinition = Object.freeze({
  id: "flightaware.weather_observations",
  provider: "flightaware",
  category: "travel",
  name: "FlightAware Weather Observations",
  description: "x402 paid METAR weather observations for an airport from FlightAware.",
  url: "https://stabletravel.dev/api/flightaware/airports",
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.004,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: { badge: "Weather", fixture_label: "Check airport weather" },
  fixture_input: { airport_code: "KSFO", temperature_units: "fahrenheit" },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.01",
    latency_budget_ms: 12000,
    input: { airport_code: "KSFO", temperature_units: "fahrenheit" },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.01", input: { airport_code: "KSFO", temperature_units: "fahrenheit" } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.01", input: { airport_code: "KSFO", temperature_units: "fahrenheit" } },
  },
  builder: buildFlightAwareWeatherObservationsRequest,
});
