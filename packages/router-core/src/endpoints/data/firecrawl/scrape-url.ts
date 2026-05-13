import { buildFirecrawlScrapeUrlRequest } from "../../builders.ts";

export const firecrawlScrapeUrlEndpointDefinition = Object.freeze({
  id: "firecrawl.scrape_url",
  provider: "firecrawl",
  category: "data",
  name: "Firecrawl Scrape URL",
  description: "x402 paid URL scrape to clean markdown, provided by Heurist.",
  url: "https://mesh.heurist.xyz/x402/agents/FirecrawlSearchDigestAgent/firecrawl_scrape_url",
  method: "POST",
  agentkit: false,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "none",
  agentkit_value_label: "x402-Paid",
  default_payment_mode: "x402_only",
  ui: {
    badge: "Scrape",
    fixture_label: "Scrape URL with Firecrawl",
  },
  fixture_input: {
    url: "https://example.com",
    wait_time: 7500,
  },
  health_probe: {
    mode: "paid_availability",
    payment_mode: "x402_only",
    max_usd: "0.02",
    latency_budget_ms: 15000,
    input: {
      url: "https://example.com",
      wait_time: 7500,
    },
  },
  live_smoke: {
    default_path: { payment_mode: "x402_only", max_usd: "0.02", input: { url: "https://example.com", wait_time: 7500 } },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: { url: "https://example.com", wait_time: 7500 } },
  },
  builder: buildFirecrawlScrapeUrlRequest,
});
