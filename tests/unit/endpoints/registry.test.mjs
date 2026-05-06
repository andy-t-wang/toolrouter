import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildEndpointHealthProbeRequest,
  buildEndpointRequest,
  endpointRegistry,
  listEndpoints,
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
      ["exa.search"],
    );
    assertValidEndpointRegistry(endpointRegistry);
    for (const endpoint of endpointRegistry) {
      assertEndpointFixtureBuilds(endpoint);
      assertEndpointHealthProbeBuilds(endpoint);
    }
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
});
