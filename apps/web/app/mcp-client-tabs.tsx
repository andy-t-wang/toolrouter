"use client";

import { useMemo, useState } from "react";

import { mcpClients } from "./mcp-content.ts";

type McpClientTabsProps = {
  apiKey?: string;
  compact?: boolean;
};

function codeWithApiKey(code: string, apiKey?: string) {
  const key = apiKey?.trim();
  if (!key) return code;
  return code.replaceAll("tr_...", key).replaceAll("${TOOLROUTER_API_KEY}", key);
}

export function McpClientTabs({ apiKey = "", compact = false }: McpClientTabsProps) {
  const [selectedId, setSelectedId] = useState(mcpClients[0].id);
  const [copied, setCopied] = useState(false);
  const hasInjectedKey = Boolean(apiKey.trim());
  const selected = useMemo(() => mcpClients.find((client) => client.id === selectedId) || mcpClients[0], [selectedId]);
  const selectedCode = useMemo(() => codeWithApiKey(selected.code, apiKey), [apiKey, selected.code]);

  async function copySelected() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(selectedCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`mcp-connect${compact ? " compact" : ""}`}>
      <div className="mcp-connect-head">
        <h2>Connect your client</h2>
        {hasInjectedKey ? (
          <p>
            Your API key is filled in. These snippets run the published{" "}
            <code>@worldcoin/toolrouter</code> MCP package with npx.
            After updating MCP config, reload MCP from your client or start a
            fresh session.
          </p>
        ) : (
          <p>
            Generate an API key, then replace <code>tr_...</code>. These
            snippets run the published <code>@worldcoin/toolrouter</code>{" "}
            package, so you do not need a local ToolRouter repo path.
          </p>
        )}
      </div>

      <div className="mcp-tabs" role="tablist" aria-label="MCP clients">
        {mcpClients.map((client) => (
          <button
            aria-controls={`mcp-panel-${client.id}`}
            aria-selected={client.id === selected.id}
            className="mcp-tab"
            id={`mcp-tab-${client.id}`}
            key={client.id}
            onClick={() => {
              setSelectedId(client.id);
              setCopied(false);
            }}
            role="tab"
            type="button"
          >
            {client.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`mcp-tab-${selected.id}`}
        className="mcp-code-panel"
        id={`mcp-panel-${selected.id}`}
        role="tabpanel"
      >
        <div className="mcp-panel-actions">
          <span>{selected.detail}</span>
          <span className={`mcp-key-state ${hasInjectedKey ? "ready" : ""}`}>
            <span className={`dot ${hasInjectedKey ? "good" : ""}`} />
            {hasInjectedKey ? "API key injected" : "API key needed"}
          </span>
          <button className="mcp-copy-button" onClick={copySelected} type="button">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="mcp-code"><code>{selectedCode}</code></pre>
      </div>
    </div>
  );
}
