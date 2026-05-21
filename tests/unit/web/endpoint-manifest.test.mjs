import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { endpointRegistry } from "../../../packages/router-core/src/endpoints/index.ts";
import {
  landingEndpointHasAgentKitIntegration,
  landingEndpointCount,
  landingEndpointFallbacks,
  sortLandingEndpoints,
} from "../../../apps/web/lib/endpoint-manifest.ts";
import { providerLogoPath } from "../../../apps/web/lib/provider-logos.ts";

describe("apps/web endpoint manifest adapter", () => {
  it("derives one fallback row per registered endpoint in registry order", () => {
    const fallbacks = landingEndpointFallbacks();
    assert.equal(landingEndpointCount(), endpointRegistry.length);
    assert.equal(fallbacks.length, endpointRegistry.length);
    for (const [index, endpoint] of endpointRegistry.entries()) {
      const row = fallbacks[index];
      assert.equal(row.id, endpoint.id);
      assert.equal(row.provider, endpoint.provider);
      assert.equal(row.name, endpoint.name);
      assert.equal(row.category, endpoint.category);
      assert.equal(row.agentkit, endpoint.agentkit);
      assert.equal(row.agentkit_value_type, endpoint.agentkit_value_type);
      assert.equal(row.agentkit_value_label, endpoint.agentkit_value_label);
      assert.equal(row.status, "unverified");
      assert.equal(row.provider_logo_path, providerLogoPath(endpoint.provider));
    }
  });

  it("maps every shipped provider to a non-empty logo path", () => {
    for (const endpoint of endpointRegistry) {
      assert.notEqual(
        providerLogoPath(endpoint.provider),
        "",
        `provider ${endpoint.provider} is missing from apps/web/lib/provider-logos.ts`,
      );
    }
  });

  it("returns an empty string for unknown providers", () => {
    assert.equal(providerLogoPath("nonexistent"), "");
    assert.equal(providerLogoPath(""), "");
    assert.equal(providerLogoPath(null), "");
    assert.equal(providerLogoPath(undefined), "");
  });

  it("sorts landing rows by AgentKit integration first, then recommendation", () => {
    const recommendedIds = new Set([
      "exa.search",
      "browserbase.session",
      "manus.research",
      "parallel.extract",
      "agentmail.send_message",
    ]);
    const ids = sortLandingEndpoints(landingEndpointFallbacks(), (endpoint) =>
      recommendedIds.has(endpoint.id),
    ).map((endpoint) => endpoint.id);
    assert.deepEqual(ids, [
      "browserbase.session",
      "exa.search",
      "manus.research",
      "parallel.extract",
      "agentmail.send_message",
      "parallel.search",
      "parallel.task",
      "agentmail.create_inbox",
      "agentmail.list_messages",
      "agentmail.get_message",
      "agentmail.reply_to_message",
    ]);
  });

  it("does not count any Parallel endpoint as AgentKit-integrated from stale status data", () => {
    for (const id of ["parallel.search", "parallel.extract", "parallel.task"]) {
      assert.equal(
        landingEndpointHasAgentKitIntegration({
          id,
          agentkit: true,
          agentkit_value_type: "free_trial",
          agentkit_value_label: "AgentKit-Free Trial",
        }),
        false,
      );
    }
  });
});
