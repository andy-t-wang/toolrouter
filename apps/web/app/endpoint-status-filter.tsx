"use client";

import { useEffect, useMemo, useState } from "react";
import { providerLogoPath } from "../lib/provider-logos.ts";

type LandingEndpoint = {
  id: string;
  provider: string;
  category?: string;
  name: string;
  description?: string | null;
  agentkit?: boolean;
  agentkit_value_type?: string | null;
  agentkit_value_label?: string | null;
  status: string;
  last_checked_at?: string | null;
  health_check_count_30d?: number;
};

type LandingCategory = {
  id: string;
  name: string;
  endpoint_count: number;
  recommended_endpoint_id: string | null;
};

type EndpointStatusFilterProps = {
  categories: LandingCategory[];
  endpoints: LandingEndpoint[];
  initialCategory: string;
  renderedAtMs: number;
};

export const ENDPOINT_POPOVER_COPY: Record<string, string> = Object.freeze({
  "agentmail.create_inbox": "Create a new AgentMail inbox for an agent.",
  "agentmail.get_message": "Fetch a single AgentMail message.",
  "agentmail.list_messages": "List messages in an AgentMail inbox.",
  "agentmail.reply_to_message": "Reply to an AgentMail message.",
  "agentmail.send_message": "Send an email from an AgentMail inbox.",
  "browserbase.session": "Create a verified browser session for automation.",
  "exa.search": "Search the web with Exa neural search.",
  "manus.research": "Start a deep research task that returns a sourced report.",
  "parallel.extract": "Extract clean content from one or more URLs.",
  "parallel.search": "Search the web for fresh, relevant results.",
  "parallel.task": "Start an async research task with citations.",
  "stabletravel.flightaware_flights":
    "Look up live flight details by flight number, registration, or FlightAware ID.",
  "stabletravel.google_flights_search":
    "Compare flight options and prices between airports for a travel date.",
  "stabletravel.hotels_list":
    "Find hotel IDs in a city before pricing specific stays.",
  "stabletravel.hotels_search":
    "Search dated hotel availability and rates for selected hotel IDs.",
  "stabletravel.locations":
    "Find airport and city codes from a place name.",
});

function titleCase(value: string) {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

function publicEndpointStatus(endpoint: Pick<LandingEndpoint, "status">) {
  return endpoint.status || "unverified";
}

function formatProbeAge(value: string | null | undefined, renderedAtMs: number) {
  if (!value) return "Awaiting first live probe";
  const diffSeconds = Math.max(
    0,
    Math.floor((renderedAtMs - Date.parse(value)) / 1000),
  );
  if (diffSeconds < 60) return "Last probe just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `Last probe ${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 48) return `Last probe ${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `Last probe ${diffDays} days ago`;
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, { dot: string; label: string }> = {
    degraded: { dot: "warn", label: "Degraded" },
    failing: { dot: "bad", label: "Outage" },
    healthy: { dot: "good", label: "Operational" },
    unverified: { dot: "", label: "Unverified" },
  };
  const resolved = map[status] || map.unverified;
  return (
    <span className="row status-dot-label">
      <span className={`dot ${resolved.dot}`} />
      <span>{resolved.label}</span>
    </span>
  );
}

function displayEndpointId(provider: LandingEndpoint) {
  const prefix = `${provider.provider}.`;
  return provider.id.startsWith(prefix)
    ? provider.id.slice(prefix.length)
    : provider.id;
}

function hasAgentKitBenefit(provider: LandingEndpoint) {
  if (provider.provider === "parallel" || provider.id.startsWith("parallel.")) {
    return false;
  }
  if (provider.agentkit === false) return false;
  if (provider.agentkit === true) return true;
  return Boolean(provider.agentkit_value_type || provider.agentkit_value_label);
}

function isRecommendedEndpoint(
  provider: LandingEndpoint,
  recommendedEndpointIdByCategory: Map<string, string>,
) {
  if (provider.provider === "parallel" || provider.id.startsWith("parallel.")) {
    return false;
  }
  if (!provider.category) return false;
  return recommendedEndpointIdByCategory.get(provider.category) === provider.id;
}

function ProviderMark({ provider }: { provider: LandingEndpoint }) {
  const src = providerLogoPath(provider.provider);
  const label = titleCase(provider.provider);
  return (
    <span className={`prov-mark ${src ? "prov-logo" : ""}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : label.slice(0, 2).toUpperCase()}
    </span>
  );
}

function agentKitBenefit(provider: LandingEndpoint) {
  const type = String(
    provider.agentkit_value_type || provider.agentkit_value_label || "",
  ).toLowerCase();
  if (type.includes("free")) return "Free trial";
  if (type.includes("discount")) return "Discount";
  if (type.includes("access")) return "Access";
  return "AgentKit";
}

function AgentKitBenefit({ provider }: { provider: LandingEndpoint }) {
  if (!hasAgentKitBenefit(provider)) {
    return (
      <div className="agentkit-status-benefit">
        <span className="agentkit-status-pill is-muted">
          No AgentKit Support
        </span>
      </div>
    );
  }
  return (
    <div className="agentkit-status-benefit">
      <span className="agentkit-status-pill">
        <img src="/human.svg" alt="" aria-hidden="true" />
        {agentKitBenefit(provider)}
      </span>
    </div>
  );
}

function endpointDescription(provider: LandingEndpoint) {
  return (
    ENDPOINT_POPOVER_COPY[provider.id] ||
    provider.description ||
    "No endpoint description available yet."
  );
}

function endpointDescriptionId(provider: LandingEndpoint) {
  return `endpoint-description-${provider.id.replace(/[^a-z0-9_-]/giu, "-")}`;
}

function UptimeRow({
  provider,
  recommended,
  renderedAtMs,
}: {
  provider: LandingEndpoint;
  recommended: boolean;
  renderedAtMs: number;
}) {
  const descriptionId = endpointDescriptionId(provider);
  return (
    <div className="mkt-uptime-grid mkt-uptime-row">
      <div>
        <div className="row provider-cell">
          <ProviderMark provider={provider} />
          <span className="provider-copy">
            <span
              className="provider-title-wrap"
              tabIndex={0}
              aria-describedby={descriptionId}
            >
              <span className="provider-name">{provider.name}</span>
              <span
                className="endpoint-info-popover"
                id={descriptionId}
                role="tooltip"
              >
                {endpointDescription(provider)}
              </span>
            </span>
            <span className="provider-meta">
              <span className="mono muted provider-id">
                {displayEndpointId(provider)}
              </span>
              {recommended ? (
                <span
                  className="recommended-pill"
                  aria-label="Recommended default endpoint"
                >
                  Recommended
                </span>
              ) : null}
            </span>
          </span>
        </div>
      </div>
      <AgentKitBenefit provider={provider} />
      <div>
        <StatusDot status={publicEndpointStatus(provider)} />
      </div>
      <div className="mono muted check-age">
        {formatProbeAge(provider.last_checked_at, renderedAtMs)}
      </div>
    </div>
  );
}

function categoryFromLocation(validIds: Set<string>, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const category = new URLSearchParams(window.location.search).get("category") || "all";
  return validIds.has(category) ? category : "all";
}

export function EndpointStatusFilter({
  categories,
  endpoints,
  initialCategory,
  renderedAtMs,
}: EndpointStatusFilterProps) {
  const validCategoryIds = useMemo(
    () => new Set(categories.map((category) => category.id)),
    [categories],
  );
  const [activeCategory, setActiveCategory] = useState(
    validCategoryIds.has(initialCategory) ? initialCategory : "all",
  );
  const recommendedEndpointIdByCategory = useMemo(
    () =>
      new Map(
        categories
          .filter((category) => category.recommended_endpoint_id)
          .map((category) => [
            category.id,
            category.recommended_endpoint_id as string,
          ]),
      ),
    [categories],
  );
  const selectedCategoryName =
    categories.find((category) => category.id === activeCategory)?.name || "All";
  const visibleEndpoints =
    activeCategory === "all"
      ? endpoints
      : endpoints.filter((endpoint) => endpoint.category === activeCategory);
  const visibleProbedCount = visibleEndpoints.reduce(
    (count, endpoint) => count + (endpoint.health_check_count_30d ? 1 : 0),
    0,
  );

  useEffect(() => {
    const syncFromUrl = () => {
      setActiveCategory(categoryFromLocation(validCategoryIds, initialCategory));
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [initialCategory, validCategoryIds]);

  function selectCategory(categoryId: string) {
    setActiveCategory(categoryId);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (categoryId === "all") {
      url.searchParams.delete("category");
    } else {
      url.searchParams.set("category", categoryId);
    }
    url.hash = "endpoints";
    window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <>
      <nav className="endpoint-tabs" aria-label="Endpoint categories">
        {categories.map((category) => (
          <button
            key={category.id}
            className={category.id === activeCategory ? "active" : ""}
            type="button"
            onClick={() => selectCategory(category.id)}
            aria-current={category.id === activeCategory ? "page" : undefined}
          >
            <span>{category.name}</span>
            <span className="endpoint-tab-count">{category.endpoint_count}</span>
          </button>
        ))}
      </nav>

      <div className="mkt-uptime-card">
        <div className="mkt-uptime-grid uptime-grid-head">
          <div>Endpoint</div>
          <div>Benefit</div>
          <div>Status</div>
          <div>Last check</div>
        </div>
        {visibleEndpoints.map((provider) => {
          const recommended = isRecommendedEndpoint(
            provider,
            recommendedEndpointIdByCategory,
          );
          return (
            <div className="uptime-row-shell" key={provider.id}>
              <UptimeRow
                provider={provider}
                recommended={recommended}
                renderedAtMs={renderedAtMs}
              />
            </div>
          );
        })}
        <div className="uptime-foot">
          <span>
            {visibleProbedCount
              ? `Showing ${visibleEndpoints.length} ${selectedCategoryName.toLowerCase()} endpoints from live health checks.`
              : `Showing ${visibleEndpoints.length} ${selectedCategoryName.toLowerCase()} endpoints from the live registry. Awaiting probe history.`}
          </span>
          <span className="mono">v0.1.0</span>
        </div>
      </div>
    </>
  );
}
