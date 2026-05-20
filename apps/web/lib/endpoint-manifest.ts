// Web-side adapter over the router-core endpoint manifest. The Next.js
// landing page and dashboard read endpoint metadata from here so they always
// reflect what's actually in `packages/router-core/src/endpoints/`. Adding a
// new endpoint to router-core surfaces it on /dashboard and /  automatically.
//
// Why this lives in apps/web/lib/ and not in the manifest itself: router-core
// keeps its manifest provider field as a string for backwards compat (U1
// deferred a richer `provider: { id, name, logo_path }` shape). The logo
// lookup is web-only, so it stays here behind `providerLogoPath()`.

import {
  endpointRegistry,
  type MaterializedEndpoint,
} from "@toolrouter/router-core";

import { providerLogoPath } from "./provider-logos.ts";

export type LandingEndpointFallback = {
  id: string;
  provider: string;
  category: string;
  name: string;
  agentkit_value_type: string;
  agentkit_value_label: string;
  status: string;
  last_checked_at: null;
  latency_ms: null;
  p50_latency_ms: null;
  uptime_30d: null;
  sparkline_30d: number[];
  health_check_count_30d: number;
  provider_logo_path: string;
};

function toLandingFallback(endpoint: MaterializedEndpoint): LandingEndpointFallback {
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    category: endpoint.category,
    name: endpoint.name,
    agentkit_value_type: endpoint.agentkit_value_type,
    agentkit_value_label: endpoint.agentkit_value_label,
    status: "unverified",
    last_checked_at: null,
    latency_ms: null,
    p50_latency_ms: null,
    uptime_30d: null,
    sparkline_30d: [],
    health_check_count_30d: 0,
    provider_logo_path: providerLogoPath(endpoint.provider),
  };
}

/**
 * Build the fallback endpoint rows the landing page renders when the
 * upstream `/v1/status` response is unavailable. Order matches
 * `endpointRegistry`.
 */
export function landingEndpointFallbacks(): LandingEndpointFallback[] {
  return endpointRegistry.map(toLandingFallback);
}

export function landingEndpointCount(): number {
  return endpointRegistry.length;
}
