import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { endpointRegistry } from "../../../packages/router-core/src/endpoints/index.ts";
import {
  landingEndpointCount,
  landingEndpointFallbacks,
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
});
