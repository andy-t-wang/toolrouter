const providers = [
  { id: "exa.search", provider: "Exa", name: "Exa Search", status: "healthy", latency: 284, uptime: 99.98, sparkUp: [100, 100, 100, 100, 99.9, 100, 100, 100, 100, 99.9, 100, 100, 100, 100, 100, 100, 99.9, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 99.9, 100, 100] },
  { id: "exa.contents", provider: "Exa", name: "Exa Contents", status: "healthy", latency: 312, uptime: 99.94, sparkUp: [100, 100, 100, 100, 100, 99.7, 100, 100, 100, 100, 99.6, 100, 100, 100, 100, 99.8, 100, 100, 100, 100, 100, 100, 99.9, 100, 100, 100, 100, 100, 100, 100] },
  { id: "browserbase.session", provider: "Browserbase", name: "Browser Session", status: "healthy", latency: 540, uptime: 99.81, sparkUp: [100, 100, 99.5, 100, 100, 100, 99, 100, 100, 100, 98.5, 99, 100, 100, 100, 99, 100, 100, 100, 99.5, 100, 100, 100, 100, 100, 99.8, 100, 100, 100, 100] },
  { id: "browserbase.fetch", provider: "Browserbase", name: "Browser Fetch", status: "degraded", latency: 1240, uptime: 97.42, sparkUp: [100, 99, 100, 98, 99, 100, 95, 98, 100, 100, 99, 97, 100, 100, 98, 96, 99, 100, 99, 98, 100, 100, 99, 95, 92, 94, 96, 93, 97, 95] },
  { id: "algolia.search", provider: "Algolia", name: "Algolia Application", status: "healthy", latency: 96, uptime: 100, sparkUp: Array(30).fill(100) },
];

function Uptime30({ values }: { values: number[] }) {
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

function UptimeRow({ provider }: { provider: (typeof providers)[number] }) {
  return (
    <div className="mkt-uptime-grid mkt-uptime-row">
      <div>
        <div className="row provider-cell">
          <span className="prov-mark">{provider.provider.slice(0, 2).toUpperCase()}</span>
          <span>
            <span className="provider-name">{provider.name}</span>
            <span className="mono muted provider-id">{provider.id}</span>
          </span>
        </div>
      </div>
      <div><StatusDot status={provider.status} /></div>
      <div className="hide-md"><Uptime30 values={provider.sparkUp} /></div>
      <div className="num mono">{provider.uptime.toFixed(2)}%</div>
      <div className="num mono muted">{provider.latency}ms</div>
    </div>
  );
}

function ProviderCluster() {
  const initials = ["EX", "BB", "AG", "AM", "CH", "MP", "FC", "RS", "AI"];
  const positions = [
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
  return (
    <div className="vp-cluster">
      {initials.map((initial, index) => (
        <span key={initial} className="lg" style={{ left: positions[index].l, top: positions[index].t }}>{initial}</span>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const avg = providers.reduce((sum, provider) => sum + provider.uptime, 0) / providers.length;
  const operational = providers.filter((provider) => provider.status === "healthy").length;

  return (
    <main className="mkt-page">
      <nav className="mkt-nav" aria-label="Main navigation">
        <div className="mkt-container mkt-nav-inner">
          <a className="mkt-brand" href="/">
            <span className="brand-mark" aria-hidden="true" />
            <span>ToolRouter</span>
          </a>
          <div className="mkt-nav-actions">
            <a className="mkt-btn ghost sm" href="/dashboard">Sign in</a>
            <a className="mkt-btn sm" href="/dashboard">Get started</a>
          </div>
        </div>
      </nav>

      <header className="mkt-hero">
        <div className="mkt-container">
          <div className="hero-eyebrow">
            <span className="pill"><span className="dot live" /> All systems live</span>
            <span className="muted">Last probe 2 min ago</span>
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
            <a className="mkt-btn" href="/dashboard">Get an MCP key</a>
            <a className="mkt-btn ghost" href="/dashboard">View console</a>
          </div>
        </div>
      </header>

      <section className="mkt-section value-section">
        <div className="mkt-container">
          <div className="vp-grid">
            <div className="vp-card">
              <div className="vp-art">
                <ProviderCluster />
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
                <div className="us-num num">{avg.toFixed(2)}<span className="us-sm">%</span></div>
                <div className="us-lbl">Fleet uptime · 30d</div>
              </div>
              <div className="us-row">
                <div className="us-num num">{operational}<span className="us-sm muted">/{providers.length}</span></div>
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
              <span>Showing verified launch endpoints.</span>
              <span className="mono">v0.1.0</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mkt-section mkt-cta">
        <div className="mkt-container">
          <h2 className="mkt-display cta-h">OpenRouter for tool calling.</h2>
          <div className="mkt-actions centered">
            <a className="mkt-btn" href="/dashboard">Sign in to get a key</a>
            <a className="mkt-btn ghost" href="/dashboard">Open the console</a>
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
  );
}
