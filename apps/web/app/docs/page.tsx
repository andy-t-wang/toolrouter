const docsDescription =
  "ToolRouter lists endpoints that behave predictably through AgentKit first, x402 fallback, typed input validation, capped health probes, and traceable payment metadata.";
const docsOgImage = {
  url: "/og?path=/docs",
  width: 1200,
  height: 630,
  alt: "ToolRouter endpoint docs",
};

export const metadata = {
  title: "ToolRouter Endpoint Docs",
  description: docsDescription,
  openGraph: {
    title: "Ship endpoints agents can trust.",
    description: docsDescription,
    url: "/docs",
    images: [docsOgImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ship endpoints agents can trust.",
    description: docsDescription,
    images: [docsOgImage],
  },
};

const endpointExample = `export const providerEndpointDefinition = Object.freeze({
  id: "provider.endpoint",
  provider: "provider",
  category: "search",
  name: "Provider Endpoint",
  description: "AgentKit-first x402 endpoint.",
  url: "https://api.provider.com/endpoint",
  method: "POST",
  agentkit: true,
  x402: true,
  estimated_cost_usd: 0.01,
  agentkit_value_type: "free_trial",
  agentkit_value_label: "AgentKit-Free Trial",
  default_payment_mode: "agentkit_first",
  fixture_input: { query: "ToolRouter health check" },
  health_probe: {
    mode: "challenge",
    payment_mode: "agentkit_first",
    max_usd: "0.02",
    input: { query: "ToolRouter health check" }
  },
  live_smoke: {
    default_path: { payment_mode: "agentkit_first", max_usd: "0.02", input: {} },
    paid_path: { payment_mode: "x402_only", max_usd: "0.02", input: {} }
  },
  builder: buildProviderRequest
});`;

export default function DocsPage() {
  return (
    <>
      <main className="mkt-page docs-page">
        <nav className="mkt-nav" aria-label="Main navigation">
          <div className="mkt-container mkt-nav-inner">
            <a className="mkt-brand" href="/">
              <img className="brand-mark" src="/logo.png" alt="" aria-hidden="true" />
              <span>ToolRouter</span>
            </a>
            <div className="mkt-nav-actions">
              <a
                className="mkt-icon-link"
                href="https://github.com/andy-t-wang/toolrouter"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 .5a12 12 0 0 0-3.8 23.39c.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23A11.5 11.5 0 0 1 12 5.8c1.02 0 2.04.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.93.43.37.82 1.1.82 2.23v3.31c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
                </svg>
              </a>
              <a className="mkt-btn ghost sm" href="/setup">Setup</a>
              <a className="mkt-btn sm" href="/dashboard">Get Started</a>
            </div>
          </div>
        </nav>

        <header className="doc-hero">
          <div className="mkt-container">
            <div className="mkt-eyebrow">Relying-party endpoint format</div>
            <h1 className="mkt-display">Ship endpoints agents can trust.</h1>
            <p className="mkt-lede">
              ToolRouter lists endpoints that behave predictably through AgentKit first, x402 fallback, typed input
              validation, capped health probes, and traceable payment metadata.
            </p>
          </div>
        </header>

        <section className="doc-section">
          <div className="mkt-container doc-grid">
            <div>
              <h2 className="mkt-display">Listing checklist</h2>
              <p>
                Providers stay manually onboarded for launch. A listing needs a stable HTTPS POST endpoint, an
                AgentKit/x402 challenge path, deterministic test input, and a safe live smoke config.
              </p>
            </div>
            <div className="doc-list">
              <div><strong>Transport</strong><span>HTTPS POST with JSON request and JSON or text response.</span></div>
              <div><strong>Auth</strong><span>AgentKit and x402 only. Provider API keys must not be required on router execution.</span></div>
              <div><strong>Cost</strong><span>Expose a predictable estimated USD cost and accept caller maxUsd caps.</span></div>
              <div><strong>Reliability</strong><span>Provide fixture input, an AgentKit-first health probe, and a paid x402 smoke gate.</span></div>
              <div><strong>Value type</strong><span>Classify the AgentKit value as Free Trial, Discount, or Access.</span></div>
            </div>
          </div>
        </section>

        <section className="doc-section">
          <div className="mkt-container doc-code-grid">
            <div>
              <h2 className="mkt-display">Endpoint module shape</h2>
              <p>
                New endpoints follow the category/provider/endpoint module pattern under router-core. The builder owns
                input validation and produces the provider request.
              </p>
            </div>
            <pre className="landing-code"><code>{endpointExample}</code></pre>
          </div>
        </section>

        <section className="doc-section doc-final">
          <div className="mkt-container doc-grid">
            <div>
              <h2 className="mkt-display">Review path</h2>
              <p>
                Send the endpoint URL, input schema, fixture input, price, AgentKit mode, and a short failure-mode note.
                ToolRouter adds the module, deterministic tests, live smoke gates, and dashboard metadata before listing.
              </p>
            </div>
            <div className="doc-table">
              <div><span>Public launch</span><strong>Exa, Browserbase, and Manus endpoints</strong></div>
              <div><span>Normal traffic</span><strong>agentkit_first</strong></div>
              <div><span>Paid smoke</span><strong>x402_only with explicit opt-in</strong></div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
