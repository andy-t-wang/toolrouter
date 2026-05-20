import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildEndpointHealthProbeRequest,
  buildEndpointRequest,
  endpointRegistry,
  listCategories,
  listEndpoints,
  recommendEndpoint,
  validateRegistry,
} from "../../../packages/router-core/src/endpoints/index.ts";
import {
  manusResearchPriceForDepth,
  parallelExtractPriceUsd,
  parallelSearchPriceUsd,
  parallelTaskPriceForProcessor,
} from "../../../packages/router-core/src/endpoints/builders.ts";
import {
  assertEndpointFixtureBuilds,
  assertEndpointHealthProbeBuilds,
  assertValidEndpointRegistry,
} from "../../../packages/router-core/src/testing/endpointHarness.ts";

describe("endpoint registry", () => {
  it("validates the launch registry", () => {
    assert.equal(validateRegistry(), true);
    assert.deepEqual(
      listEndpoints().map((endpoint) => endpoint.id),
      [
        "browserbase.session",
        "exa.search",
        "parallel.search",
        "parallel.extract",
        "manus.research",
        "parallel.task",
      ],
    );
    assertValidEndpointRegistry(endpointRegistry);
    for (const endpoint of endpointRegistry) {
      assertEndpointFixtureBuilds(endpoint);
      assertEndpointHealthProbeBuilds(endpoint);
    }
  });

  it("groups endpoints into generic categories with recommendations", () => {
    const categories = listCategories();
    assert.deepEqual(
      categories.map((category) => category.id),
      ["search", "research", "extract", "browser_usage"],
    );

    const search = categories.find((category) => category.id === "search");
    assert.equal(search.name, "Search");
    assert.equal(search.recommended_endpoint_id, "exa.search");
    assert.deepEqual(
      search.endpoints.map((endpoint) => endpoint.id),
      ["exa.search", "parallel.search"],
    );

    const browserUse = recommendEndpoint("browser_usage");
    assert.equal(browserUse.id, "browserbase.session");

    const research = recommendEndpoint("research");
    assert.equal(research.id, "manus.research");

    const extract = recommendEndpoint("extract");
    assert.equal(extract.id, "parallel.extract");
  });

  it("builds Parallel Search requests with the per-call markup price", () => {
    assert.throws(
      () => buildEndpointRequest("parallel.search", { search_queries: [] }),
      /search_queries must include at least 1 item/u,
    );
    assert.throws(
      () => buildEndpointRequest("parallel.search", { search_queries: ["x"], mode: "bogus" }),
      /unsupported Parallel search mode/u,
    );

    const request = buildEndpointRequest("parallel.search", {
      search_queries: ["top sushi places in San Francisco"],
      objective: "Find the highest-rated sushi restaurants",
      mode: "advanced",
    });
    assert.equal(request.method, "POST");
    assert.ok(request.url.endsWith("/x402/parallel/search"));
    assert.equal(request.headers["x-api-key"], undefined);
    assert.deepEqual(request.json, {
      search_queries: ["top sushi places in San Francisco"],
      mode: "advanced",
      objective: "Find the highest-rated sushi restaurants",
    });
    assert.equal(request.estimatedUsd, "0.02");
    assert.equal(parallelSearchPriceUsd(), "0.02");

    const probe = buildEndpointHealthProbeRequest("parallel.search");
    assert.equal(probe.paymentMode, "x402_only");
    assert.equal(probe.maxUsd, "0.02");
  });

  it("builds Parallel Extract requests priced per URL plus markup", () => {
    assert.throws(
      () => buildEndpointRequest("parallel.extract", { urls: [] }),
      /urls must include at least 1 item/u,
    );
    assert.throws(
      () => buildEndpointRequest("parallel.extract", { urls: ["http://example.com"] }),
      /urls\[0\] must use https/u,
    );

    const single = buildEndpointRequest("parallel.extract", {
      urls: ["https://example.com"],
    });
    assert.equal(single.method, "POST");
    assert.ok(single.url.endsWith("/x402/parallel/extract"));
    assert.deepEqual(single.json, { urls: ["https://example.com/"] });
    assert.equal(single.estimatedUsd, "0.02");
    assert.equal(parallelExtractPriceUsd(1), "0.02");

    const five = buildEndpointRequest("parallel.extract", {
      urls: [
        "https://a.example.com",
        "https://b.example.com",
        "https://c.example.com",
        "https://d.example.com",
        "https://e.example.com",
      ],
      objective: "Compare landing pages",
      full_content: true,
    });
    assert.equal(five.estimatedUsd, "0.06");
    assert.deepEqual(five.json.advanced_settings, { full_content: true });
    assert.equal(parallelExtractPriceUsd(5), "0.06");
  });

  it("builds Parallel Task requests with processor pricing", () => {
    assert.throws(
      () => buildEndpointRequest("parallel.task", { input: "x", processor: "mega" }),
      /unsupported Parallel task processor/u,
    );
    assert.throws(
      () => buildEndpointRequest("parallel.task", { processor: "core" }),
      /input is required/u,
    );

    const core = buildEndpointRequest("parallel.task", {
      input: "Find the best MCP browser automation tools",
      processor: "core",
    });
    assert.equal(core.method, "POST");
    assert.ok(core.url.endsWith("/x402/parallel/task"));
    assert.equal(core.json.processor, "core");
    assert.equal(core.estimatedUsd, "0.035");
    assert.equal(parallelTaskPriceForProcessor("core"), "0.035");

    const ultra = buildEndpointRequest("parallel.task", {
      input: "Deep research brief",
      processor: "ultra",
    });
    assert.equal(ultra.estimatedUsd, "0.31");
    assert.equal(parallelTaskPriceForProcessor("ultra"), "0.31");

    const probe = buildEndpointHealthProbeRequest("parallel.task");
    assert.equal(probe.paymentMode, "x402_only");
    assert.equal(probe.timeoutMs, 30_000);
  });

  it("uses configured Parallel task prices via env override", () => {
    const previous = process.env.TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD;
    process.env.TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD = "0.05";
    try {
      assert.equal(parallelTaskPriceForProcessor("core"), "0.06");
      const request = buildEndpointRequest("parallel.task", {
        input: "Configured price check",
        processor: "core",
      });
      assert.equal(request.estimatedUsd, "0.06");
    } finally {
      if (previous === undefined) delete process.env.TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD;
      else process.env.TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD = previous;
    }
  });

  it("builds Exa search requests from typed input", () => {
    const defaultRequest = buildEndpointRequest("exa.search", {
      query: "AgentKit",
    });
    assert.equal(defaultRequest.json.type, "fast");
    assert.equal(defaultRequest.json.numResults, 5);

    const request = buildEndpointRequest("exa.search", {
      query: "AgentKit",
      search_type: "fast",
      num_results: 2,
      include_summary: true,
    });
    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://api.exa.ai/search");
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers["x-api-key"], undefined);
    assert.deepEqual(request.json, {
      query: "AgentKit",
      type: "fast",
      numResults: 2,
      contents: { summary: true },
    });
    assert.equal(request.estimatedUsd, "0.009");
  });

  it("builds the Exa AgentKit-first health probe", () => {
    const probe = buildEndpointHealthProbeRequest("exa.search");
    assert.equal(probe.request.url, "https://api.exa.ai/search");
    assert.deepEqual(probe.request.json, {
      query: "ToolRouter health check",
      type: "fast",
      numResults: 5,
    });
    assert.equal(probe.maxUsd, "0.01");
  });

  it("builds Browserbase AgentKit-access session requests from typed input", () => {
    assert.throws(
      () => buildEndpointRequest("browserbase.session", { estimated_minutes: 1 }),
      /estimatedMinutes must be between 5 and 120/,
    );

    const session = buildEndpointRequest("browserbase.session", { estimated_minutes: 5 });
    assert.equal(session.url, "https://x402.browserbase.com/browser/session/create");
    assert.deepEqual(session.json, { estimatedMinutes: 5 });
    assert.equal(session.estimatedUsd, "0.01");
  });

  it("uses a longer Browserbase session health timeout than fast endpoints", () => {
    const probe = buildEndpointHealthProbeRequest("browserbase.session");
    assert.equal(probe.maxUsd, "0.02");
    assert.equal(probe.paymentMode, "x402_only");
    assert.equal(probe.timeoutMs, 15_000);
    assert.equal(probe.latencyBudgetMs, 10_000);
  });

  it("builds Manus research requests for the ToolRouter x402 wrapper", () => {
    assert.throws(
      () =>
        buildEndpointRequest("manus.research", {
          query: "Find a tool for visual product lookup",
          urls: ["http://example.com/docs"],
        }),
      /urls\[0\] must use https/u,
    );
    assert.throws(
      () =>
        buildEndpointRequest("manus.research", {
          query: "Find a tool for visual product lookup",
          images: ["not-a-url"],
        }),
      /images\[0\] must be a valid URL/u,
    );

    const request = buildEndpointRequest("manus.research", {
      query: "Find a tool for visual product lookup",
      task_type: "tool_discovery",
      depth: "quick",
      urls: ["https://example.com/docs"],
      images: ["https://example.com/image.png"],
    });
    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://toolrouter.world/x402/manus/research");
    assert.deepEqual(request.json, {
      query: "Find a tool for visual product lookup",
      depth: "quick",
      task_type: "tool_discovery",
      urls: ["https://example.com/docs"],
      images: ["https://example.com/image.png"],
    });
    assert.equal(request.estimatedUsd, "0.03");

    const deepRequest = buildEndpointRequest("manus.research", {
      query: "Build a detailed research brief",
      depth: "deep",
    });
    assert.equal(deepRequest.estimatedUsd, "0.1");

    const probe = buildEndpointHealthProbeRequest("manus.research");
    assert.equal(probe.paymentMode, "x402_only");
    assert.equal(probe.maxUsd, "0.03");
    assert.equal(probe.timeoutMs, 30_000);
  });

  it("uses configured Manus prices for dynamic request estimates", () => {
    const previous = process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD;
    process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD = "0.04";
    try {
      assert.equal(manusResearchPriceForDepth("quick"), "0.04");
      const request = buildEndpointRequest("manus.research", {
        query: "Quick configured price check",
        depth: "quick",
      });
      assert.equal(request.estimatedUsd, "0.04");
    } finally {
      if (previous === undefined) delete process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD;
      else process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD = previous;
    }
  });
});
