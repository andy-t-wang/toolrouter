"use client";

import { useMemo, useState } from "react";

import { mcpClients } from "./mcp-content.ts";

type McpClientTabsProps = {
  compact?: boolean;
};

export function McpClientTabs({ compact = false }: McpClientTabsProps) {
  const [selectedId, setSelectedId] = useState(mcpClients[0].id);
  const [copied, setCopied] = useState(false);
  const selected = useMemo(() => mcpClients.find((client) => client.id === selectedId) || mcpClients[0], [selectedId]);

  async function copySelected() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(selected.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`mcp-connect${compact ? " compact" : ""}`}>
      <div className="mcp-connect-head">
        <h2>Connect your client</h2>
        <p>
          Replace <code>tr_...</code> with the API key you copied from ToolRouter.
        </p>
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
          <button className="mcp-copy-button" onClick={copySelected} type="button">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="mcp-code"><code>{selected.code}</code></pre>
      </div>
    </div>
  );
}
