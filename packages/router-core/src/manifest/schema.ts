// JSON-Schema export utilities for the endpoint manifest.
//
// Consumed by `apps/mcp/scripts/build-endpoints.mjs` (U2 prepack codegen) and
// by `tests/unit/endpoints/manifest.test.mjs` (U1 snapshot test).
//
// Returns a structural snapshot of the manifest fields the downstream MCP +
// dashboard need. This is NOT a full JSON Schema for the EndpointManifest type
// (the TS type is the source of truth); it is the minimal portable
// representation that ships to the published MCP artifact.

import type { MaterializedEndpoint } from "./endpoint.ts";

export interface EndpointSnapshot {
  id: string;
  provider: string;
  category: string;
  name: string;
  description: string;
  url_host: string;
  method: string;
  agentkit_value_type: string;
  agentkit_value_label: string;
  agentkit_proof_header: boolean;
  estimated_cost_usd: number;
  default_payment_mode: string;
  ui_badge: string;
  fixture_input: Record<string, unknown>;
  field_order: string[];
}

/**
 * Pure, deterministic projection of a materialized endpoint into the snapshot
 * shape consumed by MCP codegen and dashboard fallback. Round-trip stable —
 * snapshot tests compare byte-equivalence against a frozen baseline.
 */
export function endpointSnapshot(endpoint: MaterializedEndpoint): EndpointSnapshot {
  const fieldOrder = Object.keys(endpoint.fixture_input);
  let urlHost = "";
  try {
    urlHost = new URL(endpoint.url).hostname;
  } catch {
    urlHost = "";
  }
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    category: endpoint.category,
    name: endpoint.name,
    description: endpoint.description,
    url_host: urlHost,
    method: endpoint.method,
    agentkit_value_type: endpoint.agentkit_value_type,
    agentkit_value_label: endpoint.agentkit_value_label,
    agentkit_proof_header: Boolean(endpoint.agentkit_proof_header),
    estimated_cost_usd: endpoint.estimated_cost_usd,
    default_payment_mode: endpoint.defaultPaymentMode,
    ui_badge: endpoint.ui.badge,
    fixture_input: endpoint.fixture_input,
    field_order: fieldOrder,
  };
}
