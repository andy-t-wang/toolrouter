"use client";

import { useEffect, useMemo, useState } from "react";
import { providerLogoPath } from "../lib/provider-logos.ts";

type LandingEndpoint = {
  id: string;
  provider: string;
  category?: string;
  name: string;
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
};

function titleCase(value: string) {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

function publicEndpointStatus(endpoint: Pick<LandingEndpoint, "status">) {
  return endpoint.status || "unverified";
}

function formatProbeAge(value?: string | null) {
  if (!value) return "Awaiting first live probe";
  const diffSeconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 1000),
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
  if (provider.id.startsWith("parallel.")) {
    return false;
  }
  if (provider.agentkit === false) return false;
  if (provider.agentkit === true) return true;
  return Boolean(provider.agentkit_value_type || provider.agentkit_value_label);
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

function UptimeRow({
  provider,
  recommended,
}: {
  provider: LandingEndpoint;
  recommended: boolean;
}) {
  return (
    <div className="mkt-uptime-grid mkt-uptime-row">
      <div>
        <div className="row provider-cell">
          <ProviderMark provider={provider} />
          <span>
            <span className="provider-name">{provider.name}</span>
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
        {formatProbeAge(provider.last_checked_at)}
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
          const recommended =
            Boolean(provider.category) &&
            recommendedEndpointIdByCategory.get(provider.category || "") === provider.id;
          return (
            <div className="uptime-row-shell" key={provider.id}>
              <UptimeRow provider={provider} recommended={recommended} />
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
