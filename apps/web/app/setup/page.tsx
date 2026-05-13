import { McpClientTabs } from "../mcp-client-tabs.tsx";
import { firstQueryPrompt } from "../mcp-content.ts";

const setupDescription =
  "Add one MCP server and give any agent the same verified ToolRouter tools.";
const setupOgImage = {
  url: "/og?path=/setup",
  width: 1200,
  height: 630,
  alt: "ToolRouter setup",
};

export const metadata = {
  title: "ToolRouter Setup",
  description: setupDescription,
  openGraph: {
    title: "Connect any MCP-capable agent.",
    description: setupDescription,
    url: "/setup",
    images: [setupOgImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Connect any MCP-capable agent.",
    description: setupDescription,
    images: [setupOgImage],
  },
};

export default function SetupPage() {
  return (
    <>
      <main className="mkt-page docs-page">
        <nav className="mkt-nav" aria-label="Main navigation">
          <div className="mkt-container mkt-nav-inner">
            <a className="mkt-brand" href="/">
              <img
                className="brand-mark"
                src="/logo.png"
                alt=""
                aria-hidden="true"
              />
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
              <a className="mkt-btn ghost sm" href="/docs">
                Endpoint docs
              </a>
              <a className="mkt-btn sm" href="/dashboard">
                Get Started
              </a>
            </div>
          </div>
        </nav>

        <header className="doc-hero">
          <div className="mkt-container">
            <div className="mkt-eyebrow">Agent setup</div>
            <h1 className="mkt-display">Set up your Agent with ToolRouter</h1>
            <p className="mkt-lede">One MCP layer for all your tool calls</p>
          </div>
        </header>

        <section className="doc-section">
          <div className="mkt-container">
            <McpClientTabs />
          </div>
        </section>

        <section className="doc-section">
          <div className="mkt-container doc-grid">
            <div>
              <h2 className="mkt-display">Tool categories</h2>
              <p>
                Agents should think in generic categories first. ToolRouter
                recommends a concrete endpoint for each category, then records
                the actual provider, AgentKit path, x402 fallback, and spend cap
                in the trace.
              </p>
            </div>
            <div className="doc-list tool-list">
              <div>
                <strong>ai_ml</strong>
                <span>Recommended: Fal Image Fast for x402-paid image generation.</span>
              </div>
              <div>
                <strong>search</strong>
                <span>Recommended: Exa Search, with Perplexity and Parallel available explicitly.</span>
              </div>
              <div>
                <strong>data</strong>
                <span>Recommended: Exa Contents for clean URL text, with Firecrawl available for scraping and extraction.</span>
              </div>
              <div>
                <strong>knowledge</strong>
                <span>Recommended: WolframAlpha Result for short computed answers.</span>
              </div>
              <div>
                <strong>travel</strong>
                <span>Recommended: FlightAware Flight Track, with airports, delays, arrivals, departures, weather, and activities endpoints available explicitly.</span>
              </div>
              <div>
                <strong>browser use</strong>
                <span>
                  Recommended: Browserbase Session for interactive browser
                  workflows.
                </span>
              </div>
              <div>
                <strong>toolrouter_list_categories</strong>
                <span>
                  Ask ToolRouter which categories and recommended endpoints are
                  available.
                </span>
              </div>
              <div>
                <strong>toolrouter_call_endpoint</strong>
                <span>
                  Call the selected endpoint explicitly when you already know
                  the endpoint_id.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="doc-section doc-final">
          <div className="mkt-container doc-code-grid">
            <div>
              <h2 className="mkt-display">First query</h2>
              <p>
                After the MCP server is loaded, this verifies discovery and
                execution by making the agent inspect ToolRouter categories,
                call a concrete endpoint, and return the request id from the
                trace.
              </p>
            </div>
            <pre className="landing-code">
              <code>{firstQueryPrompt}</code>
            </pre>
          </div>
        </section>
      </main>
    </>
  );
}
