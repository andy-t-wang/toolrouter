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
import {
  forwardParallelExtractUpstream,
  forwardParallelSearchUpstream,
  forwardParallelTaskUpstream,
  safeParallelError,
} from "../../../apps/api/src/sellers/parallel/upstream.ts";

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
      assert.ok(manifest.upstream.url.startsWith("https://api.parallel.ai/"));
    }
    assert.equal(parallelSearchSellerManifest.agentkit, null);
    assert.equal(parallelExtractSellerManifest.agentkit, null);
    assert.equal(parallelTaskSellerManifest.agentkit, null);
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

  it("keeps every Parallel seller x402-only", () => {
    assert.equal(parallelSearchSellerManifest.agentkit, null);
    assert.equal(parallelExtractSellerManifest.agentkit, null);
    assert.equal(parallelTaskSellerManifest.agentkit, null);
  });

  it("forwarders preserve `input` for both string and object shapes (parallel.task)", async () => {
    const captured = [];
    const fetchImpl = async (url, init) => {
      captured.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response('{"run_id":"r","status":"queued"}', {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    };
    const secrets = { PARALLEL_API_KEY: "test_key" };
    const makeReply = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; } });

    // String input
    const stringReply = makeReply();
    const stringResult = await forwardParallelTaskUpstream({
      request: { body: { input: "Hello world", processor: "core", max_usd: "0.035" } },
      reply: stringReply,
      secrets,
      fetchImpl,
    });
    assert.equal(stringResult.ok, true);
    assert.deepEqual(captured.at(-1).body, { input: "Hello world", processor: "core" });

    // Object input — was previously dropped by the hoist branch
    const objectReply = makeReply();
    const objectResult = await forwardParallelTaskUpstream({
      request: {
        body: {
          input: { topic: "rate limits", filters: { since: "2026-01-01" } },
          processor: "core",
          payment_mode: "x402_only",
        },
      },
      reply: objectReply,
      secrets,
      fetchImpl,
    });
    assert.equal(objectResult.ok, true);
    assert.deepEqual(captured.at(-1).body, {
      input: { topic: "rate limits", filters: { since: "2026-01-01" } },
      processor: "core",
    });

    // Control fields are stripped from every forwarder regardless of shape
    const searchReply = makeReply();
    await forwardParallelSearchUpstream({
      request: {
        body: { search_queries: ["x"], mode: "basic", endpoint_id: "parallel.search", maxUsd: "0.02" },
      },
      reply: searchReply,
      secrets,
      fetchImpl,
    });
    assert.deepEqual(captured.at(-1).body, { search_queries: ["x"], mode: "basic" });

    const extractReply = makeReply();
    await forwardParallelExtractUpstream({
      request: { body: { urls: ["https://example.com"], force_new: true } },
      reply: extractReply,
      secrets,
      fetchImpl,
    });
    assert.deepEqual(captured.at(-1).body, { urls: ["https://example.com"] });
  });

  it("safeParallelError maps HTTP statuses to user-safe labels", () => {
    assert.equal(safeParallelError(401), "Parallel authentication failed");
    assert.equal(safeParallelError(403), "Parallel authentication failed");
    assert.equal(safeParallelError(429), "Parallel rate limited");
    assert.equal(safeParallelError(500), "Parallel provider error");
    assert.equal(safeParallelError(400), "Parallel request failed");
  });
});
