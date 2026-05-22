import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { STABLETRAVEL_API_BASE, buildStabletravelLocationsRequest, stabletravelMaxUsd } from "../../builders.ts";

export const stabletravelLocationsEndpointDefinition = Object.freeze({
  id: "stabletravel.locations",
  provider: "stabletravel",
  category: "travel",
  name: "StableTravel Locations",
  description: "Search airports and cities by keyword for travel planning; costs $0.0054 with a $0.007 default cap.",
  url: `${STABLETRAVEL_API_BASE}/api/reference/locations`,
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.0054,
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Travel",
    fixture_label: "Find airport and city codes",
  },
  fixture_input: {
    keyword: "Paris",
    sub_type: "AIRPORT,CITY",
    country_code: "FR",
    limit: 5,
    view: "LIGHT",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: stabletravelMaxUsd("locations"),
    latency_budget_ms: 10000,
    timeout_ms: 15000,
    input: {
      keyword: "Paris",
      sub_type: "CITY",
      country_code: "FR",
      limit: 1,
      view: "LIGHT",
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: stabletravelMaxUsd("locations"),
      input: {
        keyword: "Paris",
        sub_type: "CITY",
        country_code: "FR",
        limit: 1,
        view: "LIGHT",
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: stabletravelMaxUsd("locations"),
      input: {
        keyword: "Paris",
        sub_type: "CITY",
        country_code: "FR",
        limit: 1,
        view: "LIGHT",
      },
    },
  },
  builder: buildStabletravelLocationsRequest,
}) satisfies EndpointManifest;
