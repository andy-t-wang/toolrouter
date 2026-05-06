import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { MemoryCache, enforceRequestPolicy } from "../../../packages/cache/src/index.ts";

describe("request policy", () => {
  beforeEach(() => {
    process.env.X402_MAX_USD_PER_REQUEST = "0.05";
    process.env.TOOLROUTER_RATE_LIMIT_PER_MINUTE = "2";
    process.env.TOOLROUTER_IP_RATE_LIMIT_PER_MINUTE = "10";
  });

  it("accepts a request and records caller maxUsd when provided", async () => {
    const result = await enforceRequestPolicy({
      cache: new MemoryCache(),
      auth: { api_key_id: "key_1", user_id: "user_1" },
      ip: "127.0.0.1",
      estimatedUsd: "0.007",
      maxUsd: "0.02",
    });
    assert.equal(result.estimated_usd, 0.007);
    assert.equal(result.requested_max_usd, 0.02);
  });

  it("honors explicit caller maxUsd protection", async () => {
    await assert.rejects(
      enforceRequestPolicy({
        cache: new MemoryCache(),
        auth: { api_key_id: "key_1", user_id: "user_1" },
        estimatedUsd: "0.007",
        maxUsd: "0.001",
      }),
      /estimated endpoint cost/,
    );
  });

  it("rejects over-limit API key bursts", async () => {
    const cache = new MemoryCache();
    const auth = { api_key_id: "key_1", user_id: "user_1" };
    await enforceRequestPolicy({ cache, auth, estimatedUsd: "0.001", maxUsd: "0.02" });
    await enforceRequestPolicy({ cache, auth, estimatedUsd: "0.001", maxUsd: "0.02" });
    await assert.rejects(
      enforceRequestPolicy({ cache, auth, estimatedUsd: "0.001", maxUsd: "0.02" }),
      /rate limit exceeded/,
    );
  });

  it("does not apply product-level daily spend budgets yet", async () => {
    process.env.TOOLROUTER_DAILY_USD_BUDGET = "0.001";
    const result = await enforceRequestPolicy({
      cache: new MemoryCache(),
      auth: { api_key_id: "key_1", user_id: "user_1" },
      estimatedUsd: "0.03",
    });
    assert.equal(result.estimated_usd, 0.03);
    assert.equal(result.requested_max_usd, null);
  });
});
