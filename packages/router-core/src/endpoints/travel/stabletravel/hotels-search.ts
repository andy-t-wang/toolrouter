import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { STABLETRAVEL_API_BASE, buildStabletravelHotelsSearchRequest, stabletravelMaxUsd } from "../../builders.ts";

export const stabletravelHotelsSearchEndpointDefinition = Object.freeze({
  id: "stabletravel.hotels_search",
  provider: "stabletravel",
  category: "travel",
  name: "StableTravel Hotels Search",
  description: "Search dated hotel offers by hotel ID; costs $0.0324 with a $0.04 default cap.",
  url: `${STABLETRAVEL_API_BASE}/api/hotels/search`,
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.0324,
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
    check_in_date: "2026-06-15",
    check_out_date: "2026-06-16",
    currency_code: "USD",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: stabletravelMaxUsd("hotels_search"),
    latency_budget_ms: 15000,
    timeout_ms: 20000,
    input: {
      hotel_ids: ["HLPAR266"],
      adults: 1,
      check_in_date: "2026-06-15",
      check_out_date: "2026-06-16",
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
        check_in_date: "2026-06-15",
        check_out_date: "2026-06-16",
        currency_code: "USD",
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: stabletravelMaxUsd("hotels_search"),
      input: {
        hotel_ids: ["HLPAR266"],
        adults: 1,
        check_in_date: "2026-06-15",
        check_out_date: "2026-06-16",
        currency_code: "USD",
      },
    },
  },
  builder: buildStabletravelHotelsSearchRequest,
}) satisfies EndpointManifest;
