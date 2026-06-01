import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import {
  STABLETRAVEL_API_BASE,
  STABLETRAVEL_HEALTH_INTERVAL_MS,
  buildStabletravelFlightawareFlightsRequest,
  stabletravelCostLabel,
  stabletravelMaxUsd,
  stabletravelPriceUsd,
} from "../../builders.ts";

export const stabletravelFlightawareFlightsEndpointDefinition = Object.freeze({
  id: "stabletravel.flightaware_flights",
  provider: "stabletravel",
  category: "travel",
  name: "StableTravel FlightAware Flights",
  description: `Look up live FlightAware flight details by designator, registration, or FlightAware ID; ${stabletravelCostLabel("flightaware_flights")}.`,
  url: `${STABLETRAVEL_API_BASE}/api/flightaware/flights`,
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: Number(stabletravelPriceUsd("flightaware_flights")),
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Travel",
    fixture_label: "Look up a flight",
  },
  fixture_input: {
    ident: "UAL123",
    ident_type: "designator",
    max_pages: 1,
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: stabletravelMaxUsd("flightaware_flights"),
    interval_ms: STABLETRAVEL_HEALTH_INTERVAL_MS,
    latency_budget_ms: 10000,
    timeout_ms: 15000,
    input: {
      ident: "UAL123",
      ident_type: "designator",
      max_pages: 1,
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: stabletravelMaxUsd("flightaware_flights"),
      input: {
        ident: "UAL123",
        ident_type: "designator",
        max_pages: 1,
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: stabletravelMaxUsd("flightaware_flights"),
      input: {
        ident: "UAL123",
        ident_type: "designator",
        max_pages: 1,
      },
    },
  },
  builder: buildStabletravelFlightawareFlightsRequest,
}) satisfies EndpointManifest;
