import { buildFirecrawlExtractWebDataRequest } from "../../builders.ts";

export const firecrawlExtractWebDataEndpointDefinition = Object.freeze({
  id: "firecrawl.extract_web_data",
  provider: "firecrawl",
  category: "data",
  name: "Firecrawl Extract Web Data",
  description: "x402 paid structured data extraction from URLs, provided by Heurist.",
  url: "https://mesh.heurist.xyz/x402/agents/FirecrawlSearchDigestAgent/firecrawl_extract_web_data",
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: {
    badge: "Extract",
    fixture_label: "Extract web data with Firecrawl",
  },
  fixture_input: {
    urls: ["https://example.com"],
    extraction_prompt: "Extract the page title.",
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 15000,
    input: {
      urls: ["https://example.com"],
      extraction_prompt: "Extract the page title.",
    },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.02", input: { urls: ["https://example.com"], extraction_prompt: "Extract the page title." } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: { urls: ["https://example.com"], extraction_prompt: "Extract the page title." } },
  },
  builder: buildFirecrawlExtractWebDataRequest,
});
