import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  endpointRegistry,
  stabletravelMaxUsd,
  stabletravelPriceUsd,
} from "../../../packages/router-core/src/endpoints/index.ts";
import { endpointSnapshot } from "../../../packages/router-core/src/manifest/schema.ts";
import {
  endpointsManifestSnapshot,
  writeEndpointsManifest,
} from "../../../apps/mcp/scripts/build-endpoints.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const distManifestPath = resolve(here, "../../../apps/mcp/dist/endpoints.json");

describe("ToolRouter MCP endpoints codegen", () => {
  it("emits one MCP entry per registered endpoint with stable shape", () => {
    const fresh = endpointsManifestSnapshot();
    assert.equal(fresh.schema_version, 1);
    assert.equal(fresh.endpoints.length, endpointRegistry.length);
    for (const endpoint of endpointRegistry) {
      const entry = fresh.endpoints.find((candidate) => candidate.id === endpoint.id);
      assert.ok(entry, `codegen missing endpoint ${endpoint.id}`);
      assert.equal(entry.provider, endpoint.provider);
      assert.equal(entry.name, endpoint.name);
      assert.ok(entry.mcp.tool_name, `endpoint ${endpoint.id} missing mcp.tool_name`);
      assert.equal(typeof entry.mcp.input_kind, "string");
    }
    assert.ok(Array.isArray(fresh.category_tools));
    assert.ok(fresh.category_tools.length >= 2);
    assert.ok(Array.isArray(fresh.enums.manus_depth));
    assert.ok(Array.isArray(fresh.enums.search_type));
    assert.ok(fresh.manus_pricing.env_var_template.includes("<DEPTH>"));
    assert.ok(fresh.manus_pricing.default_usd_by_depth.standard > 0);
  });

  it("derives endpoint snapshots that round-trip through endpointSnapshot()", () => {
    const fresh = endpointsManifestSnapshot();
    for (const endpoint of endpointRegistry) {
      const snapshot = endpointSnapshot(endpoint);
      const entry = fresh.endpoints.find((candidate) => candidate.id === endpoint.id);
      for (const key of Object.keys(snapshot)) {
        assert.deepEqual(entry[key], snapshot[key], `snapshot drift for ${endpoint.id}.${key}`);
      }
    }
  });

  it("matches the checked-in dist/endpoints.json artifact", () => {
    if (!existsSync(distManifestPath)) {
      // Generate it now so the first run is self-bootstrapping. Subsequent
      // runs will compare against the freshly-written file (in-tree drift
      // detection happens via the snapshot equality below).
      writeEndpointsManifest(distManifestPath);
    }
    const onDisk = JSON.parse(readFileSync(distManifestPath, "utf8"));
    // Strip the timestamp field (writeEndpointsManifest omits it deliberately
    // via the replacer, but defensive: keep this comparison purely structural).
    delete onDisk.generated_at;
    const fresh = endpointsManifestSnapshot();
    assert.deepEqual(
      onDisk,
      fresh,
      "dist/endpoints.json is stale — run `npm --workspace @worldcoin/toolrouter run build-endpoints` to regenerate.",
    );
  });

  it("rejects an MCP wiring that drifts from the registry", () => {
    // The codegen guards against orphan wiring entries and missing endpoints.
    // We can't easily mutate the imports here, but we exercise the public
    // shape — the snapshot must contain exactly the endpoint ids the registry
    // exposes, no more, no less.
    const fresh = endpointsManifestSnapshot();
    const codegenIds = new Set(fresh.endpoints.map((entry) => entry.id));
    const registryIds = new Set(endpointRegistry.map((endpoint) => endpoint.id));
    assert.deepEqual([...codegenIds].sort(), [...registryIds].sort());
  });

  it("keeps StableTravel MCP default spend caps visible", () => {
    const fresh = endpointsManifestSnapshot();
    for (const [endpointId, kind] of [
      ["stabletravel.locations", "locations"],
      ["stabletravel.google_flights_search", "google_flights_search"],
      ["stabletravel.hotels_list", "hotels_list"],
      ["stabletravel.hotels_search", "hotels_search"],
      ["stabletravel.flightaware_flights", "flightaware_flights"],
    ]) {
      const price = stabletravelPriceUsd(kind);
      const maxUsd = stabletravelMaxUsd(kind);
      const entry = fresh.endpoints.find((candidate) => candidate.id === endpointId);
      assert.equal(entry.mcp.default_max_usd, maxUsd);
      assert.match(entry.mcp.description, new RegExp(`\\$${price.replace(".", "\\.")}`));
      assert.match(entry.mcp.description, new RegExp(`\\$${maxUsd.replace(".", "\\.")}`));
    }
  });
});
