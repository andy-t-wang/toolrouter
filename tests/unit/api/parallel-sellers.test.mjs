import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parallelExtractSellerManifest,
  parallelSearchSellerManifest,
  parallelTaskSellerManifest,
  PARALLEL_EXTRACT_PATH,
  PARALLEL_SEARCH_PATH,
  PARALLEL_TASK_PATH,
} from "../../../apps/api/src/sellers/parallel/index.ts";
import {
  parallelExtractPriceUsd,
  parallelSearchPriceUsd,
  parallelTaskPriceUsd,
} from "../../../apps/api/src/sellers/parallel/pricing.ts";
import { safeParallelError } from "../../../apps/api/src/sellers/parallel/upstream.ts";

describe("Parallel seller manifests", () => {
  it("mounts each manifest at the documented x402 path", () => {
    assert.equal(parallelSearchSellerManifest.route, PARALLEL_SEARCH_PATH);
    assert.equal(parallelExtractSellerManifest.route, PARALLEL_EXTRACT_PATH);
    assert.equal(parallelTaskSellerManifest.route, PARALLEL_TASK_PATH);
    for (const manifest of [
      parallelSearchSellerManifest,
      parallelExtractSellerManifest,
      parallelTaskSellerManifest,
    ]) {
      assert.equal(manifest.method, "POST");
      assert.deepEqual([...manifest.secrets], ["PARALLEL_API_KEY"]);
      assert.equal(manifest.agentkit.type, "free_trial");
      assert.ok(manifest.upstream.url.startsWith("https://api.parallel.ai/"));
    }
  });

  it("emits parallel x-api-key header for each upstream call", () => {
    const headers = parallelSearchSellerManifest.upstream.headers_factory(
      { PARALLEL_API_KEY: "secret" },
      { input: {}, payer: "0x", paymentReference: null },
    );
    assert.equal(headers["x-api-key"], "secret");
    assert.equal(headers["content-type"], "application/json");
  });

  it("prices search at $0.02 (Parallel $0.01 + $0.01 ToolRouter markup)", () => {
    assert.equal(parallelSearchPriceUsd(), "0.02");
    assert.equal(parallelSearchSellerManifest.pricing({}), "0.02");
  });

  it("prices extract per URL plus the per-call markup", () => {
    assert.equal(parallelExtractPriceUsd({ urls: ["https://a.example"] }), "0.02");
    assert.equal(
      parallelExtractPriceUsd({
        urls: ["https://a.example", "https://b.example", "https://c.example"],
      }),
      "0.04",
    );
    assert.equal(
      parallelExtractSellerManifest.pricing({
        urls: ["https://a.example", "https://b.example", "https://c.example", "https://d.example", "https://e.example"],
      }),
      "0.06",
    );
  });

  it("prices task by processor with markup, defaulting to ultra", () => {
    assert.equal(parallelTaskPriceUsd({}), "0.31");
    assert.equal(parallelTaskPriceUsd({ processor: "core" }), "0.035");
    assert.equal(parallelTaskPriceUsd({ processor: "lite" }), "0.015");
    assert.equal(parallelTaskSellerManifest.pricing({ processor: "core" }), "0.035");
    assert.throws(() => parallelTaskPriceUsd({ processor: "mega" }), /unsupported Parallel task processor/u);
  });

  it("free-trial counters differ between Parallel endpoints", () => {
    assert.equal(parallelSearchSellerManifest.agentkit.uses, 5);
    assert.equal(parallelExtractSellerManifest.agentkit.uses, 5);
    assert.equal(parallelTaskSellerManifest.agentkit.uses, 1);
  });

  it("safeParallelError maps HTTP statuses to user-safe labels", () => {
    assert.equal(safeParallelError(401), "Parallel authentication failed");
    assert.equal(safeParallelError(403), "Parallel authentication failed");
    assert.equal(safeParallelError(429), "Parallel rate limited");
    assert.equal(safeParallelError(500), "Parallel provider error");
    assert.equal(safeParallelError(400), "Parallel request failed");
  });
});
