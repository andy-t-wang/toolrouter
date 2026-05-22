import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { STABLETRAVEL_API_BASE, buildStabletravelHotelsListRequest, stabletravelMaxUsd } from "../../builders.ts";

export const stabletravelHotelsListEndpointDefinition = Object.freeze({
  id: "stabletravel.hotels_list",
  provider: "stabletravel",
  category: "travel",
  name: "StableTravel Hotels List",
  description: "List hotels by city code so agents can discover hotel IDs; costs $0.0324 with a $0.04 default cap.",
  url: `${STABLETRAVEL_API_BASE}/api/hotels/list`,
  method: "GET",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.0324,
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Travel",
    fixture_label: "List hotels by city",
  },
  fixture_input: {
    city_code: "PAR",
    max: 5,
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: stabletravelMaxUsd("hotels_list"),
    latency_budget_ms: 15000,
    timeout_ms: 20000,
    input: {
      city_code: "PAR",
      max: 1,
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: stabletravelMaxUsd("hotels_list"),
      input: {
        city_code: "PAR",
        max: 1,
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: stabletravelMaxUsd("hotels_list"),
      input: {
        city_code: "PAR",
        max: 1,
      },
    },
  },
  builder: buildStabletravelHotelsListRequest,
}) satisfies EndpointManifest;
