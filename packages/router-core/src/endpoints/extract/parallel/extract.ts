import type { EndpointManifest } from "../../../manifest/endpoint.ts";
import { buildParallelExtractRequest, parallelExtractPriceUsd } from "../../builders.ts";

function wrapperBaseUrl() {
  return (process.env.TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world").replace(/\/$/u, "");
}

const SINGLE_URL_PRICE = parallelExtractPriceUsd(1);

export const parallelExtractEndpointDefinition = Object.freeze({
  id: "parallel.extract",
  provider: "parallel",
  category: "extract",
  name: "Parallel Extract",
  description: "URL content extraction through ToolRouter's x402 Parallel wrapper.",
  url: `${wrapperBaseUrl()}/x402/parallel/extract`,
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.02,
  agentkit_value_type: null,
  agentkit_value_label: null,
  default_payment_mode: "x402_only",
  ui: {
    badge: "Extract",
    fixture_label: "Extract with Parallel",
  },
  fixture_input: {
    urls: ["https://example.com"],
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: SINGLE_URL_PRICE,
    latency_budget_ms: 20000,
    timeout_ms: 20000,
    input: {
      urls: ["https://example.com"],
    },
  },
  live_smoke: {
    default_path: {
      payment_mode: "x402_only",
      max_usd: SINGLE_URL_PRICE,
      input: {
        urls: ["https://example.com"],
      },
    },
    paid_path: {
      payment_mode: "x402_only",
      max_usd: SINGLE_URL_PRICE,
      input: {
        urls: ["https://example.com"],
      },
    },
  },
  builder: buildParallelExtractRequest,
}) satisfies EndpointManifest;
