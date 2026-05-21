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
  listCategories,
  type MaterializedEndpoint,
} from "@toolrouter/router-core";

import { providerLogoPath } from "./provider-logos.ts";

export type LayerStatusName = "healthy" | "degraded" | "failing" | "unknown" | string;

export type LayerStatusRow = {
  status: LayerStatusName;
  updated_at: string | null;
};

export type EndpointLayerStatuses = {
  facilitator: LayerStatusRow;
  agentkit: LayerStatusRow;
  upstream: LayerStatusRow;
  transport: LayerStatusRow;
};

export const HEALTH_LAYER_NAMES = ["facilitator", "agentkit", "upstream", "transport"] as const;

function unknownLayerStatuses(): EndpointLayerStatuses {
  return {
    facilitator: { status: "unknown", updated_at: null },
    agentkit: { status: "unknown", updated_at: null },
    upstream: { status: "unknown", updated_at: null },
    transport: { status: "unknown", updated_at: null },
  };
}

export type LandingEndpointFallback = {
  id: string;
  provider: string;
  category: string;
  name: string;
  agentkit: boolean;
  agentkit_value_type: string | null;
  agentkit_value_label: string | null;
  status: string;
  last_checked_at: null;
  latency_ms: null;
  p50_latency_ms: null;
  uptime_30d: null;
  sparkline_30d: number[];
  health_check_count_30d: number;
  provider_logo_path: string;
  layers: EndpointLayerStatuses;
};

export type LandingCategoryFallback = {
  id: string;
  name: string;
  endpoint_count: number;
  recommended_endpoint_id: string | null;
};

function toLandingFallback(endpoint: MaterializedEndpoint): LandingEndpointFallback {
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    category: endpoint.category,
    name: endpoint.name,
    agentkit: endpoint.agentkit,
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
    layers: unknownLayerStatuses(),
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

export function landingCategoryFallbacks(): LandingCategoryFallback[] {
  return listCategories().map((category) => ({
    id: category.id,
    name: category.name,
    endpoint_count: category.endpoint_count,
    recommended_endpoint_id: category.recommended_endpoint_id,
  }));
}

export function landingEndpointCount(): number {
  return endpointRegistry.length;
}

export type LandingEndpointAgentKitRow = {
  id: string;
  provider?: string;
  agentkit?: boolean;
  agentkit_value_type?: string | null;
  agentkit_value_label?: string | null;
};

export function landingEndpointHasAgentKitIntegration(
  endpoint: LandingEndpointAgentKitRow,
): boolean {
  if (endpoint.provider === "parallel" || endpoint.id.startsWith("parallel.")) {
    return false;
  }
  if (endpoint.agentkit === false) return false;
  if (endpoint.agentkit === true) return true;
  return Boolean(endpoint.agentkit_value_type || endpoint.agentkit_value_label);
}

export function sortLandingEndpoints<T extends LandingEndpointAgentKitRow>(
  endpoints: T[],
  isRecommendedEndpoint: (endpoint: T) => boolean = () => false,
): T[] {
  return [...endpoints].sort((a, b) => {
    const agentkitRank =
      Number(landingEndpointHasAgentKitIntegration(b)) -
      Number(landingEndpointHasAgentKitIntegration(a));
    if (agentkitRank !== 0) return agentkitRank;
    return Number(isRecommendedEndpoint(b)) - Number(isRecommendedEndpoint(a));
  });
}
