import { AgentationDev } from "./agentation-dev.tsx";

export const dynamic = "force-dynamic";

type LandingEndpoint = {
  id: string;
  provider: string;
  category?: string;
  name: string;
  status: string;
  last_checked_at?: string | null;
  latency_ms?: number | null;
  p50_latency_ms?: number | null;
  uptime_30d?: number | null;
  sparkline_30d?: Array<number | null>;
  health_check_count_30d?: number;
};

type LandingStatus = {
  status: string;
  summary: {
    endpoint_count: number;
    operational_count: number;
    uptime_30d: number | null;
    last_checked_at: string | null;
  };
  endpoints: LandingEndpoint[];
};

const fallbackStatus: LandingStatus = {
  status: "unverified",
  summary: {
    endpoint_count: 4,
    operational_count: 0,
    uptime_30d: null,
    last_checked_at: null,
  },
  endpoints: [
    {
      id: "browserbase.fetch",
      provider: "browserbase",
      category: "data",
      name: "Browserbase Fetch",
      status: "unverified",
      last_checked_at: null,
      latency_ms: null,
      p50_latency_ms: null,
      uptime_30d: null,
      sparkline_30d: [],
      health_check_count_30d: 0,
    },
    {
      id: "browserbase.search",
      provider: "browserbase",
      category: "search",
      name: "Browserbase Search",
      status: "unverified",
      last_checked_at: null,
      latency_ms: null,
      p50_latency_ms: null,
      uptime_30d: null,
      sparkline_30d: [],
      health_check_count_30d: 0,
    },
    {
      id: "browserbase.session",
      provider: "browserbase",
      category: "browser_usage",
      name: "Browserbase Session",
      status: "unverified",
      last_checked_at: null,
      latency_ms: null,
      p50_latency_ms: null,
      uptime_30d: null,
      sparkline_30d: [],
      health_check_count_30d: 0,
    },
    {
      id: "exa.search",
      provider: "exa",
      category: "search",
      name: "Exa Search",
      status: "unverified",
      last_checked_at: null,
      latency_ms: null,
      p50_latency_ms: null,
      uptime_30d: null,
      sparkline_30d: [],
      health_check_count_30d: 0,
    },
  ],
};

async function loadLandingStatus(): Promise<LandingStatus> {
  const base = process.env.TOOLROUTER_API_INTERNAL_URL || process.env.NEXT_PUBLIC_TOOLROUTER_API_URL || "http://127.0.0.1:9402";
  try {
    const response = await fetch(`${base.replace(/\/$/u, "")}/v1/status`, { cache: "no-store" });
    if (!response.ok) return fallbackStatus;
    const body = await response.json();
    if (!Array.isArray(body?.endpoints)) return fallbackStatus;
    return {
      status: body.status || "unverified",
      summary: {
        endpoint_count: Number(body.summary?.endpoint_count || body.endpoints.length),
        operational_count: Number(body.summary?.operational_count || 0),
        uptime_30d: typeof body.summary?.uptime_30d === "number" ? body.summary.uptime_30d : null,
        last_checked_at: body.summary?.last_checked_at || null,
      },
      endpoints: body.endpoints.length ? body.endpoints : fallbackStatus.endpoints,
    };
  } catch {
    return fallbackStatus;
  }
}

function titleCase(value: string) {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

function fleetLabel(status: string) {
  if (status === "healthy") return "All systems live";
  if (status === "degraded") return "Some endpoints degraded";
  if (status === "failing") return "Endpoint outage";
  return "Awaiting live checks";
}

function statusDot(status: string) {
  if (status === "healthy") return "live";
  if (status === "degraded") return "warn";
  if (status === "failing") return "bad";
  return "";
}

function formatProbeAge(value?: string | null) {
  if (!value) return "Awaiting first live probe";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (diffSeconds < 60) return "Last probe just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `Last probe ${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 48) return `Last probe ${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `Last probe ${diffDays} days ago`;
}

function Uptime30({ values }: { values: Array<number | null> }) {
  if (!values?.some((value) => typeof value === "number")) {
    return <span className="mono muted no-probes">not yet probed</span>;
  }
  const padded = values.length >= 30 ? values.slice(-30) : [...Array(30 - values.length).fill(null), ...values];
  return (
    <div className="mkt-uptime-bars" aria-hidden="true">
      {padded.map((value, index) => {
        if (value === null) return <span key={index} className="ub null" />;
        const cls = value >= 99.9 ? "ok" : value >= 99 ? "ok2" : value >= 95 ? "warn" : "bad";
        return (
          <span key={index} className={`ub ${cls}`} title={`Day -${30 - index}: ${value.toFixed(2)}%`}>
            <span className="ub-fill" style={{ height: `${Math.max(8, value)}%` }} />
          </span>
        );
      })}
    </div>
  );
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

function UptimeRow({ provider }: { provider: LandingEndpoint }) {
  const displayProvider = titleCase(provider.provider);
  const uptime = typeof provider.uptime_30d === "number" ? `${provider.uptime_30d.toFixed(2)}%` : "—";
  const latency = provider.p50_latency_ms ?? provider.latency_ms;
  return (
    <div className="mkt-uptime-grid mkt-uptime-row">
      <div>
        <div className="row provider-cell">
          <span className="prov-mark">{displayProvider.slice(0, 2).toUpperCase()}</span>
          <span>
            <span className="provider-name">{provider.name}</span>
            <span className="mono muted provider-id">{provider.id}</span>
          </span>
        </div>
      </div>
      <div><StatusDot status={provider.status} /></div>
      <div className="hide-md"><Uptime30 values={provider.sparkline_30d || []} /></div>
      <div className="num mono">{uptime}</div>
      <div className="num mono muted">{typeof latency === "number" ? `${latency}ms` : "—"}</div>
    </div>
  );
}

function ProviderCluster({ providers }: { providers: LandingEndpoint[] }) {
  const initials = providers.slice(0, 9).map((provider) => titleCase(provider.provider).slice(0, 2).toUpperCase());
  const resolved = initials.length ? initials : ["EX"];
  const compactPositions: Record<number, Array<{ l: string; t: string }>> = {
    1: [{ l: "calc(50% - 16px)", t: "calc(50% - 16px)" }],
    2: [{ l: "calc(38% - 16px)", t: "calc(50% - 16px)" }, { l: "calc(62% - 16px)", t: "calc(50% - 16px)" }],
    3: [{ l: "calc(50% - 16px)", t: "calc(26% - 16px)" }, { l: "calc(34% - 16px)", t: "calc(66% - 16px)" }, { l: "calc(66% - 16px)", t: "calc(66% - 16px)" }],
  };
  const fullPositions = [
    { l: "14%", t: "12%" },
    { l: "46%", t: "6%" },
    { l: "76%", t: "14%" },
    { l: "6%", t: "42%" },
    { l: "38%", t: "38%" },
    { l: "68%", t: "44%" },
    { l: "22%", t: "70%" },
    { l: "54%", t: "72%" },
    { l: "82%", t: "68%" },
  ];
  const positions = compactPositions[resolved.length] || fullPositions;
  return (
    <div className="vp-cluster">
      {resolved.map((initial, index) => (
        <span key={`${initial}-${index}`} className="lg" style={{ left: positions[index].l, top: positions[index].t }}>{initial}</span>
      ))}
    </div>
  );
}

export default async function LandingPage() {
  const statusData = await loadLandingStatus();
  const providers = statusData.endpoints;
  const avg = statusData.summary.uptime_30d;
  const operational = statusData.summary.operational_count;
  const endpointCount = statusData.summary.endpoint_count || providers.length;
  const probedCount = providers.reduce((count, provider) => count + (provider.health_check_count_30d ? 1 : 0), 0);

  return (
    <>
      <main className="mkt-page">
        <nav className="mkt-nav" aria-label="Main navigation">
          <div className="mkt-container mkt-nav-inner">
            <a className="mkt-brand" href="/">
              <span className="brand-mark" aria-hidden="true" />
              <span>ToolRouter</span>
            </a>
            <div className="mkt-nav-actions">
              <a className="mkt-btn ghost sm" href="/setup">Setup</a>
              <a className="mkt-btn ghost sm" href="/docs">Docs</a>
              <a className="mkt-btn ghost sm" href="/dashboard">Sign in</a>
              <a className="mkt-btn sm" href="/dashboard">Get an API key</a>
            </div>
          </div>
        </nav>

        <header className="mkt-hero">
          <div className="mkt-container">
            <div className="hero-eyebrow">
              <span className="pill"><span className={`dot ${statusDot(statusData.status)}`} /> {fleetLabel(statusData.status)}</span>
              <span className="muted">{formatProbeAge(statusData.summary.last_checked_at)}</span>
            </div>
            <h1 className="mkt-display hero-h">
              Tools your agent
              <br />
              can actually trust.
            </h1>
            <p className="mkt-lede">
              ToolRouter is an MCP server your agent connects to once. Every endpoint behind it is verified, paid through
              AgentKit, and traced end-to-end, so when the model calls a tool, you know it works before you spend a cent.
            </p>
            <div className="mkt-actions">
              <a className="mkt-btn" href="/dashboard">Get an API key</a>
              <a className="mkt-btn ghost" href="/dashboard">View console</a>
            </div>
          </div>
        </header>

        <section className="mkt-section value-section">
          <div className="mkt-container">
            <div className="vp-grid">
              <div className="vp-card">
                <div className="vp-art">
                  <ProviderCluster providers={providers} />
                </div>
                <h3>One API for any tool</h3>
                <p>Connect once over MCP. Call any verified endpoint by name: Exa, Browserbase, Algolia, AgentMail, and more. No per-vendor SDKs, no per-vendor wallets.</p>
              </div>

              <div className="vp-card">
                <div className="vp-art vp-fallback">
                  <svg viewBox="0 0 160 120" aria-hidden="true">
                    <rect className="node" x="64" y="6" width="32" height="22" rx="6" />
                    <text x="80" y="20" textAnchor="middle" fontSize="9" fontFamily="Inter Tight" fill="currentColor">agent</text>
                    <rect className="node" x="56" y="50" width="48" height="22" rx="6" />
                    <text x="80" y="64" textAnchor="middle" fontSize="9" fontFamily="Inter Tight" fill="currentColor">router</text>
                    <rect className="node down" x="14" y="92" width="32" height="22" rx="6" />
                    <text x="30" y="106" textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono" fill="var(--bad)">A</text>
                    <rect className="node" x="64" y="92" width="32" height="22" rx="6" />
                    <text x="80" y="106" textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono" fill="currentColor">B</text>
                    <rect className="node" x="114" y="92" width="32" height="22" rx="6" />
                    <text x="130" y="106" textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono" fill="currentColor">C</text>
                    <line className="lk" x1="80" y1="28" x2="80" y2="50" />
                    <line className="lk dead" x1="68" y1="72" x2="30" y2="92" />
                    <line className="lk live" x1="80" y1="72" x2="80" y2="92" />
                    <line className="lk" x1="92" y1="72" x2="130" y2="92" />
                  </svg>
                </div>
                <h3>Higher availability</h3>
                <p>If a provider goes down, ToolRouter routes to a verified equivalent. Your agent keeps working through the incident, and you see the failover in the trace.</p>
              </div>

              <div className="vp-card">
                <div className="vp-art vp-shield">
                  <svg viewBox="0 0 88 88" aria-hidden="true">
                    <path className="body" d="M44 6 L74 18 V44 C74 62 60 76 44 82 C28 76 14 62 14 44 V18 Z" />
                    <path className="check" d="M30 46 L40 56 L60 34" />
                  </svg>
                </div>
                <h3>Verified reliability</h3>
                <p>Every endpoint is probed end-to-end every 12 hours with a real paid call. No mocks. If it does not work for us, it does not ship to your agent.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mkt-section compat-section">
          <div className="mkt-container">
            <div className="compat-head">
              <div>
                <div className="mkt-eyebrow">Agent compatibility</div>
                <h2 className="mkt-display">One MCP server for every agent.</h2>
              </div>
              <p className="mkt-lede compact">
                Hermes, OpenClaw, OpenJarvis, ZeroClaw, Codex, Claude, and any MCP-capable agent can call the same
                endpoint names with the same API key controls.
              </p>
            </div>
            <div className="compat-strip" aria-label="Compatible agents">
              {["Hermes", "OpenClaw", "OpenJarvis", "ZeroClaw", "Codex", "Claude", "Any MCP agent"].map((agent) => (
                <span key={agent}>{agent}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="mkt-section">
          <div className="mkt-container">
            <div className="uptime-head">
              <div>
                <div className="mkt-eyebrow">Live status · 30 days</div>
                <h2 className="mkt-display">Verified, every twelve hours.</h2>
                <p className="mkt-lede compact">
                  Each endpoint runs through a real AgentKit or x402 call on schedule. If a provider drifts, agents on ToolRouter learn before you do.
                </p>
              </div>
              <div className="uptime-summary">
                <div className="us-row">
                  <div className="us-num num">{typeof avg === "number" ? avg.toFixed(2) : "—"}<span className="us-sm">%</span></div>
                  <div className="us-lbl">Fleet uptime · 30d</div>
                </div>
                <div className="us-row">
                  <div className="us-num num">{operational}<span className="us-sm muted">/{endpointCount}</span></div>
                  <div className="us-lbl">Operational right now</div>
                </div>
              </div>
            </div>

            <div className="mkt-uptime-card">
              <div className="mkt-uptime-grid uptime-grid-head">
                <div>Endpoint</div>
                <div>Status</div>
                <div className="hide-md">Last 30 days</div>
                <div>Uptime</div>
                <div>p50</div>
              </div>
              {providers.map((provider) => <UptimeRow key={provider.id} provider={provider} />)}
              <div className="uptime-foot">
                <span>{probedCount ? `Showing ${providers.length} endpoints from live health checks.` : `Showing ${providers.length} endpoints from the live registry. Awaiting probe history.`}</span>
                <span className="mono">v0.1.0</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mkt-section mkt-cta">
          <div className="mkt-container">
            <h2 className="mkt-display cta-h">OpenRouter for tool calling.</h2>
            <div className="mkt-actions centered">
              <a className="mkt-btn" href="/dashboard">Get an API key</a>
              <a className="mkt-btn ghost" href="/setup">Setup MCP</a>
            </div>
          </div>
        </section>

        <footer className="mkt-foot">
          <div className="mkt-container mkt-foot-inner">
            <a className="mkt-brand small" href="/">
              <span className="brand-mark" aria-hidden="true" />
              <span>ToolRouter</span>
            </a>
            <span className="mono">v0.1.0</span>
          </div>
        </footer>
      </main>
      <AgentationDev />
    </>
  );
}
