import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MonthlyAgentKitStorage,
  buildManusTaskBody,
  createManusFacilitatorConfig,
  manusResearchPriceUsd,
} from "../../../apps/api/src/manus.ts";
import { MemoryCache } from "../../../packages/cache/src/index.ts";

const PRICE_ENV = [
  "TOOLROUTER_MANUS_RESEARCH_PRICE_USD",
  "TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD",
  "TOOLROUTER_MANUS_RESEARCH_PRICE_STANDARD_USD",
  "TOOLROUTER_MANUS_RESEARCH_PRICE_DEEP_USD",
  "TOOLROUTER_MANUS_RESEARCH_URL_PRICE_USD",
  "TOOLROUTER_MANUS_RESEARCH_IMAGE_PRICE_USD",
];
const FACILITATOR_ENV = [
  "COINBASE_KEY_ID",
  "COINBASE_KEY_SECRET",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "X402_FACILITATOR_URL",
  "X402_DEFAULT_CHAIN_ID",
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

function withCleanFacilitatorEnv(fn) {
  const previous = Object.fromEntries(FACILITATOR_ENV.map((key) => [key, process.env[key]]));
  for (const key of FACILITATOR_ENV) delete process.env[key];
  try {
    fn();
  } finally {
    for (const key of FACILITATOR_ENV) {
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

describe("Manus task payloads", () => {
  it("builds the current Manus task.create body from a query", () => {
    const body = buildManusTaskBody({
      query: "Find tools for image lookup",
      task_type: "tool_discovery",
      depth: "quick",
      images: ["https://example.com/image.png"],
    });

    assert.equal(body.title, "ToolRouter research: Find tools for image lookup");
    assert.equal(body.message.content[0].type, "text");
    assert.match(body.message.content[0].text, /Find tools for image lookup/u);
    assert.match(body.message.content[0].text, /Task type: tool_discovery/u);
    assert.deepEqual(body.message.content[1], {
      type: "file",
      file_url: "https://example.com/image.png",
    });
    assert.equal("query" in body, false);
  });

  it("accepts prompt as a query alias and rejects empty research tasks", () => {
    const body = buildManusTaskBody({ prompt: "Summarize MCP browser automation tools" });
    assert.match(body.message.content[0].text, /Summarize MCP browser automation tools/u);

    assert.throws(
      () => buildManusTaskBody({ prompt: " " }),
      /query is required/u,
    );
  });
});

describe("Manus x402 facilitator config", () => {
  it("uses Coinbase facilitator when Coinbase credentials are configured", () => {
    withCleanFacilitatorEnv(() => {
      process.env.COINBASE_KEY_ID = "test-key-id";
      process.env.COINBASE_KEY_SECRET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr";
      const config = createManusFacilitatorConfig();
      assert.equal(config.url, "https://api.cdp.coinbase.com/platform/v2/x402");
      assert.equal(typeof config.createAuthHeaders, "function");
    });
  });

  it("rejects Coinbase credentials that are not CDP signing keys", () => {
    withCleanFacilitatorEnv(() => {
      process.env.COINBASE_KEY_ID = "test-key-id";
      process.env.COINBASE_KEY_SECRET = "00000000-0000-0000-0000-000000000000";
      assert.throws(
        () => createManusFacilitatorConfig(),
        /COINBASE_KEY_SECRET must be a CDP API key secret/u,
      );
    });
  });

  it("falls back to an explicit facilitator URL without Coinbase credentials", () => {
    withCleanFacilitatorEnv(() => {
      process.env.X402_DEFAULT_CHAIN_ID = "eip155:84532";
      process.env.X402_FACILITATOR_URL = "https://facilitator.example.test";
      const config = createManusFacilitatorConfig();
      assert.equal(config.url, "https://facilitator.example.test");
      assert.equal(config.createAuthHeaders, undefined);
    });
  });

  it("does not allow explicit non-Coinbase facilitator URLs to bypass Base mainnet credentials", () => {
    withCleanFacilitatorEnv(() => {
      process.env.X402_FACILITATOR_URL = "https://facilitator.example.test";
      assert.throws(
        () => createManusFacilitatorConfig(),
        /Coinbase\/CDP facilitator credentials are required/u,
      );
    });
  });

  it("requires Coinbase facilitator credentials for Base mainnet without an explicit facilitator URL", () => {
    withCleanFacilitatorEnv(() => {
      assert.throws(
        () => createManusFacilitatorConfig(),
        /Coinbase\/CDP facilitator credentials are required/u,
      );
    });
  });

  it("allows the generic x402 facilitator fallback on non-Base networks", () => {
    withCleanFacilitatorEnv(() => {
      process.env.X402_DEFAULT_CHAIN_ID = "eip155:84532";
      const config = createManusFacilitatorConfig();
      assert.equal(config.url, "https://x402.org/facilitator");
    });
  });
});

describe("Manus AgentKit storage", () => {
  it("stores replay nonces in shared cache with expiry", async () => {
    const cache = new MemoryCache();
    const storage = new MonthlyAgentKitStorage(cache);
    assert.equal(await storage.hasUsedNonce("nonce_1"), false);
    await storage.recordNonce("nonce_1");
    assert.equal(await storage.hasUsedNonce("nonce_1"), true);

    const secondStorage = new MonthlyAgentKitStorage(cache);
    assert.equal(await secondStorage.hasUsedNonce("nonce_1"), true);
  });
});
