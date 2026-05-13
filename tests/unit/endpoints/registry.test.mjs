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

const expectedEndpointIds = [
  "fal.image_fast",
  "browserbase.session",
  "run402.prototype",
  "exa.contents",
  "firecrawl.scrape_url",
  "firecrawl.extract_web_data",
  "wolframalpha.result",
  "wolframalpha.query",
  "agentmail.pods",
  "exa.search",
  "perplexity.search",
  "parallel.search",
  "flightaware.airports",
  "flightaware.airport_delays",
  "flightaware.airport_info",
  "flightaware.arrivals",
  "flightaware.departures",
  "flightaware.weather_observations",
  "flightaware.airport_delay_status",
  "flightaware.flights_between_airports",
  "flightaware.disruption_counts_airline",
  "flightaware.flight_track",
  "amadeus.activities_search",
  "amadeus.activities_by_square",
];

describe("endpoint registry", () => {
  it("validates the launch registry", () => {
    assert.equal(validateRegistry(), true);
    assert.deepEqual(
      listEndpoints().map((endpoint) => endpoint.id),
      expectedEndpointIds,
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
      ["ai_ml", "search", "data", "compute", "knowledge", "productivity", "browser_usage", "travel"],
    );

    const aiMl = categories.find((category) => category.id === "ai_ml");
    assert.equal(aiMl.name, "AI / ML");
    assert.equal(aiMl.recommended_endpoint_id, "fal.image_fast");
    assert.deepEqual(aiMl.endpoints.map((endpoint) => endpoint.id), ["fal.image_fast"]);

    const search = categories.find((category) => category.id === "search");
    assert.equal(search.name, "Search");
    assert.equal(search.recommended_endpoint_id, "exa.search");
    assert.deepEqual(search.endpoints.map((endpoint) => endpoint.id), [
      "exa.search",
      "perplexity.search",
      "parallel.search",
    ]);

    const browserUse = recommendEndpoint("browser_usage");
    assert.equal(recommendEndpoint("ai_ml").id, "fal.image_fast");
    assert.equal(browserUse.id, "browserbase.session");
    assert.equal(recommendEndpoint("data").id, "exa.contents");
    assert.equal(recommendEndpoint("compute").id, "run402.prototype");
    assert.equal(recommendEndpoint("knowledge").id, "wolframalpha.result");
    assert.equal(recommendEndpoint("productivity").id, "agentmail.pods");
    assert.equal(recommendEndpoint("travel").id, "flightaware.flight_track");
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

  it("builds Exa contents as a confirmed AgentKit free-trial endpoint", () => {
    const endpoint = listEndpoints().find((candidate) => candidate.id === "exa.contents");
    assert.equal(endpoint.agentkit, true);
    assert.equal(endpoint.agentkit_value_type, "free_trial");
    assert.equal(endpoint.default_payment_mode, "agentkit_first");

    const request = buildEndpointRequest("exa.contents", {
      urls: ["https://example.com"],
      text: true,
      summary: true,
    });
    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://api.exa.ai/contents");
    assert.deepEqual(request.json, {
      urls: ["https://example.com/"],
      contents: { text: true, summary: true },
    });
    assert.equal(request.estimatedUsd, "0.002");
  });

  it("builds x402-only POST endpoint requests without AgentKit metadata", () => {
    const run402 = listEndpoints().find((candidate) => candidate.id === "run402.prototype");
    assert.equal(run402.agentkit, false);
    assert.equal(run402.agentkit_value_type, "none");
    assert.equal(run402.default_payment_mode, "x402_only");

    const fal = buildEndpointRequest("fal.image_fast", {
      prompt: "a small deterministic test image",
      width: 512,
      height: 768,
      seed: 123,
    });
    assert.equal(fal.method, "POST");
    assert.equal(fal.url, "https://x402-gateway-production.up.railway.app/api/image/fast");
    assert.equal(fal.headers.authorization, undefined);
    assert.equal(fal.headers["x-api-key"], undefined);
    assert.deepEqual(fal.json, {
      prompt: "a small deterministic test image",
      width: 512,
      height: 768,
      seed: 123,
    });
    assert.equal(fal.estimatedUsd, "0.015");
    assert.throws(
      () => buildEndpointRequest("fal.image_fast", { prompt: "too small", width: 200 }),
      /width must be between 256 and 1536/,
    );

    const perplexity = buildEndpointRequest("perplexity.search", {
      query: "AgentKit examples",
      max_results: 3,
      country: "US",
    });
    assert.equal(perplexity.method, "POST");
    assert.equal(perplexity.url, "https://pplx.x402.paysponge.com/search");
    assert.deepEqual(perplexity.json, {
      query: "AgentKit examples",
      country: "US",
      max_results: 3,
    });
    assert.equal(perplexity.estimatedUsd, "0.01");

    const agentmail = buildEndpointRequest("agentmail.pods", {
      name: "toolrouter-demo",
      client_id: "toolrouter",
    });
    assert.deepEqual(agentmail.json, {
      name: "toolrouter-demo",
      client_id: "toolrouter",
    });
  });

  it("builds x402-only GET endpoint requests with strict query and path validation", () => {
    const wolfram = buildEndpointRequest("wolframalpha.result", { query: "2+2" });
    assert.equal(wolfram.method, "GET");
    assert.equal(wolfram.url, "https://wolframalpha.x402.paysponge.com/v1/result?i=2%2B2");
    assert.equal(wolfram.estimatedUsd, "0.01");

    const airport = buildEndpointRequest("flightaware.airport_info", { airport_code: "ksfo" });
    assert.equal(airport.url, "https://stabletravel.dev/api/flightaware/airports/KSFO");

    const activities = buildEndpointRequest("amadeus.activities_search", {
      latitude: 37.7749,
      longitude: -122.4194,
      radius: 1,
    });
    assert.equal(
      activities.url,
      "https://stabletravel.dev/api/activities/search?latitude=37.7749&longitude=-122.4194&radius=1",
    );
    assert.equal(activities.estimatedUsd, "0.054");

    assert.throws(
      () => buildEndpointRequest("amadeus.activities_by_square", {
        north: 37.7,
        south: 37.81,
        east: -122.35,
        west: -122.52,
      }),
      /south must be less than north/,
    );
  });
});
