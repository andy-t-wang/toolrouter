const routerMcpJson = `{
  "mcpServers": {
    "toolrouter": {
      "command": "npm",
      "args": ["--silent", "--prefix", "/path/to/toolrouter", "run", "start:mcp"],
      "env": {
        "TOOLROUTER_API_URL": "https://toolrouter.world",
        "TOOLROUTER_API_KEY": "tr_..."
      }
    }
  }
}`;

export const firstQueryPrompt = `Use ToolRouter's search category to research the top sushi places in SF.
Call toolrouter_search with:
{
  "query": "top sushi places in San Francisco",
  "maxUsd": "0.01"
}

Summarize the best 5 options and include the ToolRouter request id.`;

export const mcpClients = [
  {
    id: "claude-code",
    label: "Claude Code",
    detail: "Run this terminal command where Claude Code is authenticated.",
    code: `claude mcp add --scope user \\
  -e TOOLROUTER_API_URL=https://toolrouter.world \\
  -e TOOLROUTER_API_KEY=tr_... \\
  toolrouter -- npm --silent --prefix /path/to/toolrouter run start:mcp`,
  },
  {
    id: "codex",
    label: "Codex",
    detail: "Run this terminal command to add ToolRouter to Codex.",
    code: `codex mcp add \\
  --env TOOLROUTER_API_URL=https://toolrouter.world \\
  --env TOOLROUTER_API_KEY=tr_... \\
  toolrouter -- npm --silent --prefix /path/to/toolrouter run start:mcp`,
  },
  {
    id: "cursor",
    label: "Cursor",
    detail: "Add this to your workspace or global Cursor MCP config.",
    code: `.cursor/mcp.json

${routerMcpJson}`,
  },
  {
    id: "vs-code",
    label: "VS Code",
    detail: "Add this server to your VS Code MCP configuration.",
    code: `.vscode/mcp.json

{
  "servers": {
    "toolrouter": {
      "type": "stdio",
      "command": "npm",
      "args": ["--silent", "--prefix", "/path/to/toolrouter", "run", "start:mcp"],
      "env": {
        "TOOLROUTER_API_URL": "https://toolrouter.world",
        "TOOLROUTER_API_KEY": "tr_..."
      }
    }
  }
}`,
  },
  {
    id: "hermes",
    label: "Hermes",
    detail: "Add this under Hermes mcp_servers, then reload MCP.",
    code: `mcp_servers:
  toolrouter:
    command: "npm"
    args: ["--silent", "--prefix", "/path/to/toolrouter", "run", "start:mcp"]
    env:
      TOOLROUTER_API_URL: "https://toolrouter.world"
      TOOLROUTER_API_KEY: "tr_..."
    tools:
      prompts: false
      resources: false`,
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    detail: "Add this server entry to OpenClaw, then restart the gateway.",
    code: `~/.openclaw/openclaw.json

${routerMcpJson}`,
  },
];
