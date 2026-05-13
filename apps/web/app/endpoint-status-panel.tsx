"use client";

import { useMemo, useState } from "react";

type LandingEndpoint = {
  id: string;
  provider: string;
  category?: string;
  name: string;
  agentkit_value_type?: string;
  agentkit_value_label?: string;
  status: string;
  status_code?: number | null;
  last_checked_at?: string | null;
  health_check_count_30d?: number;
  last_error?: string | null;
  charged?: boolean;
};

const categoryLabels: Record<string, string> = {
  ai_ml: "AI / ML",
  browser_usage: "Browser use",
  compute: "Compute",
  data: "Data",
  knowledge: "Knowledge",
  productivity: "Productivity",
  search: "Search",
  travel: "Travel",
};

const providerLabels: Record<string, string> = {
  agentmail: "AgentMail",
  amadeus: "Amadeus",
  browserbase: "Browserbase",
  exa: "Exa",
  fal: "Fal",
  firecrawl: "Firecrawl",
  flightaware: "FlightAware",
  parallel: "Parallel",
  perplexity: "Perplexity",
  run402: "Run402",
  wolframalpha: "Wolfram|Alpha",
};

const ENDPOINTS_PER_PAGE = 10;

function titleCase(value: string) {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

function labelFromId(value: string) {
  return value
    .split(/[_-]/u)
    .filter(Boolean)
    .map(titleCase)
    .join(" ");
}

function categoryLabel(value = "") {
  return categoryLabels[value] || labelFromId(value);
}

function providerLabel(value = "") {
  return providerLabels[value] || labelFromId(value);
}

function publicEndpointStatus(endpoint: Pick<LandingEndpoint, "status">) {
  return endpoint.status || "unverified";
}

function formatProbeAge(value: string | null | undefined, now: number) {
  if (!value) return "Awaiting first live probe";
  const diffSeconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
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

function providerLogoSrc(provider: string) {
  const logos: Record<string, string> = {
    agentmail: "/agentmail-logomark.svg",
    amadeus: "/amadeus-logomark.svg",
    browserbase: "/browserbase-logomark.svg",
    exa: "/exa-logomark.svg",
    fal: "/fal-logomark.svg",
    firecrawl: "/firecrawl-logomark.svg",
    flightaware: "/flightaware-logomark.svg",
    parallel: "/parallel-logomark.svg",
    perplexity: "/perplexity-logomark.svg",
    run402: "/run402-logomark.svg",
    wolframalpha: "/wolframalpha-logomark.svg",
  };
  return logos[provider] || null;
}

function displayEndpointId(endpoint: LandingEndpoint) {
  const prefix = `${endpoint.provider}.`;
  return endpoint.id.startsWith(prefix) ? endpoint.id.slice(prefix.length) : endpoint.id;
}

function ProviderMark({ provider }: { provider: string }) {
  const src = providerLogoSrc(provider);
  const label = providerLabel(provider);
  return (
    <span className={`prov-mark ${src ? "prov-logo" : ""}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : label.slice(0, 2).toUpperCase()}
    </span>
  );
}

function statusReason(endpoint: LandingEndpoint) {
  const status = publicEndpointStatus(endpoint);
  if (status === "healthy") return "Latest check passed";
  const error = String(endpoint.last_error || "");
  if (error.includes("timed out")) return "Provider timed out";
  if (error.includes("minimum charge amount")) return "Provider payment error";
  if (status === "degraded" && Number(endpoint.status_code) === 200) {
    return "Latest check was slow";
  }
  if (Number(endpoint.status_code) >= 500) return "Provider error";
  if (status === "unverified") return "Awaiting first check";
  return "Needs recovery check";
}

function agentKitBenefit(endpoint: LandingEndpoint) {
  const type = String(endpoint.agentkit_value_type || endpoint.agentkit_value_label || "").toLowerCase();
  if (type.includes("none") || type.includes("x402")) {
    return {
      agentkit: false,
      filter: "x402",
      label: "x402",
    };
  }
  if (type.includes("free")) {
    return {
      agentkit: true,
      filter: "agentkit",
      label: "Free trial",
    };
  }
  if (type.includes("discount")) {
    return {
      agentkit: true,
      filter: "agentkit",
      label: "Discount",
    };
  }
  if (type.includes("access")) {
    return {
      agentkit: true,
      filter: "agentkit",
      label: "Access",
    };
  }
  return {
    agentkit: true,
    filter: "agentkit",
    label: "AgentKit",
  };
}

function AgentKitBenefit({ endpoint }: { endpoint: LandingEndpoint }) {
  const benefit = agentKitBenefit(endpoint);
  return (
    <div className="agentkit-status-benefit">
      <span className="agentkit-status-pill">
        {benefit.agentkit ? <img src="/human.svg" alt="" aria-hidden="true" /> : null}
        {benefit.label}
      </span>
    </div>
  );
}

function optionValues(endpoints: LandingEndpoint[], field: "category" | "provider" | "status") {
  const values = new Set<string>();
  for (const endpoint of endpoints) {
    const value = field === "status" ? publicEndpointStatus(endpoint) : endpoint[field];
    if (value) values.add(value);
  }
  return [...values].sort((left, right) => {
    const leftLabel = field === "category" ? categoryLabel(left) : field === "provider" ? providerLabel(left) : left;
    const rightLabel = field === "category" ? categoryLabel(right) : field === "provider" ? providerLabel(right) : right;
    return leftLabel.localeCompare(rightLabel);
  });
}

function endpointMatchesQuery(endpoint: LandingEndpoint, query: string) {
  if (!query) return true;
  const haystack = [
    endpoint.id,
    endpoint.name,
    endpoint.provider,
    providerLabel(endpoint.provider),
    endpoint.category || "",
    categoryLabel(endpoint.category || ""),
    endpoint.agentkit_value_label || "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function EndpointRow({ endpoint, now }: { endpoint: LandingEndpoint; now: number }) {
  return (
    <div className="mkt-uptime-grid mkt-uptime-row">
      <div>
        <div className="row provider-cell">
          <ProviderMark provider={endpoint.provider} />
          <span>
            <span className="provider-name">{endpoint.name}</span>
            <span className="provider-meta">
              <span className="mono muted provider-id">{displayEndpointId(endpoint)}</span>
            </span>
          </span>
        </div>
      </div>
      <AgentKitBenefit endpoint={endpoint} />
      <div>
        <StatusDot status={publicEndpointStatus(endpoint)} />
        <span className="status-reason">{statusReason(endpoint)}</span>
      </div>
      <div className="mono muted check-age">{formatProbeAge(endpoint.last_checked_at, now)}</div>
    </div>
  );
}

export function EndpointStatusPanel({
  endpoints,
  now,
  probedCount,
}: {
  endpoints: LandingEndpoint[];
  now: number;
  probedCount: number;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [benefit, setBenefit] = useState("");
  const [page, setPage] = useState(1);
  const normalizedQuery = query.trim().toLowerCase();
  const categoryOptions = useMemo(() => optionValues(endpoints, "category"), [endpoints]);
  const providerOptions = useMemo(() => optionValues(endpoints, "provider"), [endpoints]);
  const statusOptions = useMemo(() => optionValues(endpoints, "status"), [endpoints]);
  const filteredEndpoints = useMemo(
    () =>
      endpoints.filter((endpoint) => {
        if (category && endpoint.category !== category) return false;
        if (provider && endpoint.provider !== provider) return false;
        if (status && publicEndpointStatus(endpoint) !== status) return false;
        if (benefit && agentKitBenefit(endpoint).filter !== benefit) return false;
        return endpointMatchesQuery(endpoint, normalizedQuery);
      }),
    [benefit, category, endpoints, normalizedQuery, provider, status],
  );
  const sortedEndpoints = useMemo(
    () =>
      [...filteredEndpoints].sort((left, right) => {
        const providerSort = providerLabel(left.provider).localeCompare(providerLabel(right.provider));
        return providerSort || left.name.localeCompare(right.name);
      }),
    [filteredEndpoints],
  );
  const pageCount = Math.max(1, Math.ceil(sortedEndpoints.length / ENDPOINTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = sortedEndpoints.length ? (currentPage - 1) * ENDPOINTS_PER_PAGE : 0;
  const pageEnd = Math.min(pageStart + ENDPOINTS_PER_PAGE, sortedEndpoints.length);
  const visibleEndpoints = sortedEndpoints.slice(pageStart, pageEnd);
  const activeFilters = Boolean(query || category || provider || status || benefit);

  function resetPage() {
    setPage(1);
  }

  function resetFilters() {
    setQuery("");
    setCategory("");
    setProvider("");
    setStatus("");
    setBenefit("");
    resetPage();
  }

  return (
    <div className="mkt-uptime-card">
      <div className="endpoint-filter-panel" aria-label="Endpoint filters">
        <label className="endpoint-filter-control endpoint-filter-search">
          <span>Search</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              resetPage();
            }}
            placeholder="Endpoint, provider, category"
          />
        </label>
        <label className="endpoint-filter-control">
          <span>Provider</span>
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              resetPage();
            }}
          >
            <option value="">All providers</option>
            {providerOptions.map((value) => (
              <option key={value} value={value}>
                {providerLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="endpoint-filter-control">
          <span>Category</span>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              resetPage();
            }}
          >
            <option value="">All categories</option>
            {categoryOptions.map((value) => (
              <option key={value} value={value}>
                {categoryLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="endpoint-filter-control">
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              resetPage();
            }}
          >
            <option value="">All statuses</option>
            {statusOptions.map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="endpoint-filter-control">
          <span>Benefit</span>
          <select
            value={benefit}
            onChange={(event) => {
              setBenefit(event.target.value);
              resetPage();
            }}
          >
            <option value="">All paths</option>
            <option value="agentkit">AgentKit</option>
            <option value="x402">x402</option>
          </select>
        </label>
        <button className="endpoint-filter-reset" type="button" disabled={!activeFilters} onClick={resetFilters}>
          Reset
        </button>
      </div>
      <div className="mkt-uptime-grid uptime-grid-head">
        <div>Endpoint</div>
        <div>Benefit</div>
        <div>Status</div>
        <div>Last check</div>
      </div>
      {visibleEndpoints.length ? (
        visibleEndpoints.map((endpoint) => <EndpointRow key={endpoint.id} endpoint={endpoint} now={now} />)
      ) : (
        <div className="endpoint-empty-state">No endpoints match these filters.</div>
      )}
      <div className="uptime-foot">
        <span>
          Showing {sortedEndpoints.length ? pageStart + 1 : 0}-{pageEnd} of {filteredEndpoints.length} endpoints, sorted by provider.
          {probedCount ? " Live checks are reflected as they complete." : " Awaiting probe history."}
        </span>
        <div className="endpoint-pager" aria-label="Endpoint pagination">
          <span className="muted">10 per page</span>
          <span className="mono">
            {currentPage}/{pageCount}
          </span>
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">
            <span aria-hidden="true">←</span>
          </button>
          <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} aria-label="Next page">
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
