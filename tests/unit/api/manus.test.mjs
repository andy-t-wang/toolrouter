import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { manusResearchPriceUsd } from "../../../apps/api/src/manus.ts";

const PRICE_ENV = [
  "TOOLROUTER_MANUS_RESEARCH_PRICE_USD",
  "TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD",
  "TOOLROUTER_MANUS_RESEARCH_PRICE_STANDARD_USD",
  "TOOLROUTER_MANUS_RESEARCH_PRICE_DEEP_USD",
  "TOOLROUTER_MANUS_RESEARCH_URL_PRICE_USD",
  "TOOLROUTER_MANUS_RESEARCH_IMAGE_PRICE_USD",
];

function withCleanPriceEnv(fn) {
  const previous = Object.fromEntries(PRICE_ENV.map((key) => [key, process.env[key]]));
  for (const key of PRICE_ENV) delete process.env[key];
  try {
    fn();
  } finally {
    for (const key of PRICE_ENV) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

describe("Manus x402 wrapper pricing", () => {
  it("prices Manus requests dynamically by requested depth", () => {
    withCleanPriceEnv(() => {
      assert.equal(manusResearchPriceUsd({ query: "quick check", depth: "quick" }), "0.03");
      assert.equal(manusResearchPriceUsd({ query: "normal check", depth: "standard" }), "0.05");
      assert.equal(manusResearchPriceUsd({ query: "deep check", depth: "deep" }), "0.1");
    });
  });

  it("allows deployment-time pricing overrides and optional media surcharges", () => {
    withCleanPriceEnv(() => {
      process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_STANDARD_USD = "0.07";
      process.env.TOOLROUTER_MANUS_RESEARCH_URL_PRICE_USD = "0.01";
      process.env.TOOLROUTER_MANUS_RESEARCH_IMAGE_PRICE_USD = "0.02";
      assert.equal(
        manusResearchPriceUsd({
          depth: "standard",
          urls: ["https://example.com/a", "https://example.com/b"],
          images: ["https://example.com/image.png"],
        }),
        "0.11",
      );
    });
  });
});
