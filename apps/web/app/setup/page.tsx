import { AgentationDev } from "../agentation-dev.tsx";

const routerMcpJson = `{
  "mcpServers": {
    "toolrouter": {
      "command": "npm",
      "args": ["--prefix", "/path/to/toolrouter", "run", "start:mcp"],
      "env": {
        "TOOLROUTER_API_URL": "https://toolrouter.world",
        "TOOLROUTER_API_KEY": "tr_..."
      }
    }
  }
}`;

const codexConfig = `[mcp_servers.toolrouter]
command = "npm"
args = ["--prefix", "/path/to/toolrouter", "run", "start:mcp"]

[mcp_servers.toolrouter.env]
TOOLROUTER_API_URL = "https://toolrouter.world"
TOOLROUTER_API_KEY = "tr_..."`;

const claudeCodeConfig = `claude mcp add-json toolrouter '{
  "command": "npm",
  "args": ["--prefix", "/path/to/toolrouter", "run", "start:mcp"],
  "env": {
    "TOOLROUTER_API_URL": "https://toolrouter.world",
    "TOOLROUTER_API_KEY": "tr_..."
  }
}'`;

const cursorConfig = `.cursor/mcp.json

${routerMcpJson}`;

const hermesConfig = `mcp_servers:
  toolrouter:
    command: "npm"
    args: ["--prefix", "/path/to/toolrouter", "run", "start:mcp"]
    env:
      TOOLROUTER_API_URL: "https://toolrouter.world"
      TOOLROUTER_API_KEY: "tr_..."
    tools:
      prompts: false
      resources: false`;

const openClawConfig = `~/.openclaw/openclaw.json

${routerMcpJson}`;

const testPrompt = `Use ToolRouter's search category to research the top sushi places in SF.
Call toolrouter_search with:
{
  "query": "top sushi places in San Francisco",
  "maxUsd": "0.01"
}

Summarize the best 5 options and include the ToolRouter request id.`;

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
          <div className="mkt-container doc-code-grid">
            <div>
              <h2 className="mkt-display">Common MCP config</h2>
              <p>
                Create an API key in the dashboard, clone the ToolRouter repo somewhere stable, then point your MCP
                client at the adapter. The adapter calls the production router at toolrouter.world.
              </p>
            </div>
            <pre className="landing-code"><code>{routerMcpJson}</code></pre>
          </div>
        </section>

        <section className="doc-section">
          <div className="mkt-container doc-grid">
            <div>
              <h2 className="mkt-display">Client setup</h2>
              <p>
                Replace <code>/path/to/toolrouter</code> with your local checkout and replace <code>tr_...</code> with
                the API key shown once in the dashboard.
              </p>
            </div>
            <div className="doc-list tool-list">
              <div><strong>Codex</strong><span>Add the TOML block to <code>~/.codex/config.toml</code>.</span></div>
              <div><strong>Claude Code</strong><span>Run the CLI command from a terminal where Claude Code is authenticated.</span></div>
              <div><strong>Cursor</strong><span>Add the JSON block to your workspace or global Cursor MCP config.</span></div>
              <div><strong>Hermes Agent</strong><span>Add the YAML block under Hermes <code>mcp_servers</code>, then reload MCP or restart the gateway.</span></div>
              <div><strong>OpenClaw</strong><span>Add the JSON server entry to OpenClaw&apos;s MCP config, then restart the OpenClaw gateway.</span></div>
            </div>
          </div>
        </section>

        <section className="doc-section">
          <div className="mkt-container doc-code-grid">
            <div>
              <h2 className="mkt-display">Codex</h2>
              <p>Use this when configuring Codex directly with TOML.</p>
            </div>
            <pre className="landing-code"><code>{codexConfig}</code></pre>
          </div>
        </section>

        <section className="doc-section">
          <div className="mkt-container doc-code-grid">
            <div>
              <h2 className="mkt-display">Claude Code</h2>
              <p>Use Claude Code's MCP command to register ToolRouter as a stdio MCP server.</p>
            </div>
            <pre className="landing-code"><code>{claudeCodeConfig}</code></pre>
          </div>
        </section>

        <section className="doc-section">
          <div className="mkt-container doc-code-grid">
            <div>
              <h2 className="mkt-display">Cursor</h2>
              <p>Cursor uses the same MCP JSON shape as most desktop MCP clients.</p>
            </div>
            <pre className="landing-code"><code>{cursorConfig}</code></pre>
          </div>
        </section>

        <section className="doc-section">
          <div className="mkt-container doc-code-grid">
            <div>
              <h2 className="mkt-display">Hermes Agent</h2>
              <p>
                Hermes can use ToolRouter directly, or through your personal-tools MCP adapter if you want custom
                wrappers.
              </p>
            </div>
            <pre className="landing-code"><code>{hermesConfig}</code></pre>
          </div>
        </section>

        <section className="doc-section">
          <div className="mkt-container doc-code-grid">
            <div>
              <h2 className="mkt-display">OpenClaw</h2>
              <p>
                Use the same ToolRouter MCP adapter from OpenClaw and keep the API key in the OpenClaw runtime
                environment.
              </p>
            </div>
            <pre className="landing-code"><code>{openClawConfig}</code></pre>
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
            <pre className="landing-code"><code>{testPrompt}</code></pre>
          </div>
        </section>
      </main>
      <AgentationDev />
    </>
  );
}
