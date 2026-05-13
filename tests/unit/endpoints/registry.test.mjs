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
  assertEndpointFixtureBuilds,
  assertEndpointHealthProbeBuilds,
  assertValidEndpointRegistry,
} from "../../../packages/router-core/src/testing/endpointHarness.ts";

describe("endpoint registry", () => {
  it("validates the launch registry", () => {
    assert.equal(validateRegistry(), true);
    assert.deepEqual(
      listEndpoints().map((endpoint) => endpoint.id),
      ["browserbase.session", "exa.search", "manus.research"],
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
      ["search", "research", "browser_usage"],
    );

    const search = categories.find((category) => category.id === "search");
    assert.equal(search.name, "Search");
    assert.equal(search.recommended_endpoint_id, "exa.search");
    assert.deepEqual(search.endpoints.map((endpoint) => endpoint.id), ["exa.search"]);

    const browserUse = recommendEndpoint("browser_usage");
    assert.equal(browserUse.id, "browserbase.session");

    const research = recommendEndpoint("research");
    assert.equal(research.id, "manus.research");
  });

  it("builds Exa search requests from typed input", () => {
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
});
