import { AgentationDev } from "../agentation-dev.tsx";
import { McpClientTabs } from "../mcp-client-tabs.tsx";
import { firstQueryPrompt } from "../mcp-content.ts";

const setupDescription =
  "Use one ToolRouter API key with the MCP adapter. Hermes, OpenClaw, OpenJarvis, ZeroClaw, Codex, Claude Code, Cursor, and other MCP clients can call the same named tools.";
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
              <img className="brand-mark" src="/toolrouter-mark.svg" alt="" aria-hidden="true" />
              <span>ToolRouter</span>
            </a>
            <div className="mkt-nav-actions">
              <a className="mkt-btn ghost sm" href="/docs">Endpoint docs</a>
              <a className="mkt-btn sm" href="/dashboard">Get an API key</a>
            </div>
          </div>
        </nav>

        <header className="doc-hero">
          <div className="mkt-container">
            <div className="mkt-eyebrow">Agent setup</div>
            <h1 className="mkt-display">Connect any MCP-capable agent.</h1>
            <p className="mkt-lede">
              Use one ToolRouter API key with the MCP adapter. Hermes, OpenClaw, OpenJarvis, ZeroClaw, Codex,
              Claude Code, Cursor, and other MCP clients can call the same named tools.
            </p>
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
                Agents should think in generic categories first. ToolRouter recommends a concrete endpoint for each
                category, then records the actual provider, AgentKit path, x402 fallback, and spend cap in the trace.
              </p>
            </div>
            <div className="doc-list tool-list">
              <div><strong>search</strong><span>Recommended: Exa Search. Also includes Browserbase Search for rendered web results.</span></div>
              <div><strong>browser use</strong><span>Recommended: Browserbase Session for interactive browser workflows.</span></div>
              <div><strong>data fetch</strong><span>Recommended: Browserbase Fetch for page content and metadata.</span></div>
              <div><strong>toolrouter_list_categories</strong><span>Ask ToolRouter which categories and recommended endpoints are available.</span></div>
              <div><strong>toolrouter_call_endpoint</strong><span>Call the selected endpoint explicitly when you already know the endpoint_id.</span></div>
            </div>
          </div>
        </section>

        <section className="doc-section doc-final">
          <div className="mkt-container doc-code-grid">
            <div>
              <h2 className="mkt-display">First query</h2>
              <p>
                This query uses a one-cent cap and should create a trace showing the AgentKit path if the account is
                registered, with paid fallback only when required.
              </p>
            </div>
            <pre className="landing-code"><code>{firstQueryPrompt}</code></pre>
          </div>
        </section>
      </main>
      <AgentationDev />
    </>
  );
}
