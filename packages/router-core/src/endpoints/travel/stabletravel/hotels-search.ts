import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import {
  STABLETRAVEL_API_BASE,
  STABLETRAVEL_HEALTH_INTERVAL_MS,
  buildStabletravelHotelsSearchRequest,
  stabletravelCostLabel,
  stabletravelMaxUsd,
  stabletravelPriceUsd,
} from "../../builders.ts";

export const stabletravelHotelsSearchEndpointDefinition = Object.freeze({
  id: "stabletravel.hotels_search",
  provider: "stabletravel",
  category: "travel",
  name: "StableTravel Hotels Search",
  description: `Search dated hotel offers by hotel ID; ${stabletravelCostLabel("hotels_search")}.`,
  url: `${STABLETRAVEL_API_BASE}/api/hotels/search`,
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: Number(stabletravelPriceUsd("hotels_search")),
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Travel",
    fixture_label: "Search hotel offers",
  },
  fixture_input: {
    hotel_ids: ["HLPAR266"],
    adults: 1,
    check_in_date: "today+30d",
    check_out_date: "today+31d",
    currency_code: "USD",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: stabletravelMaxUsd("hotels_search"),
    interval_ms: STABLETRAVEL_HEALTH_INTERVAL_MS,
    latency_budget_ms: 15000,
    timeout_ms: 20000,
    input: {
      hotel_ids: ["HLPAR266"],
      adults: 1,
      check_in_date: "today+30d",
      check_out_date: "today+31d",
      currency_code: "USD",
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: stabletravelMaxUsd("hotels_search"),
      input: {
        hotel_ids: ["HLPAR266"],
        adults: 1,
        check_in_date: "today+30d",
        check_out_date: "today+31d",
        currency_code: "USD",
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: stabletravelMaxUsd("hotels_search"),
      input: {
        hotel_ids: ["HLPAR266"],
        adults: 1,
        check_in_date: "today+30d",
        check_out_date: "today+31d",
        currency_code: "USD",
      },
    },
  },
  builder: buildStabletravelHotelsSearchRequest,
}) satisfies EndpointManifest;
