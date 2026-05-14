const routerMcpJson = `{
  "mcpServers": {
    "toolrouter": {
      "command": "npx",
      "args": ["-y", "@worldcoin/toolrouter"],
      "env": {
        "TOOLROUTER_API_URL": "https://toolrouter.world",
        "TOOLROUTER_API_KEY": "tr_..."
      }
    }
  }
}`;

export const firstQueryPrompt = `Use ToolRouter through MCP.

First list the available ToolRouter tool categories. Then use the recommended search endpoint to find the top sushi places in San Francisco.

For deep research requests, use manus_research_start once, then check the MCP tools manus_research_status or manus_research_result with the returned task_id instead of starting another task. Status/result are helper tools, not endpoint IDs.

Summarize the best 5 options and include the ToolRouter request id.`;

export const mcpClients = [
  {
    id: "claude-code",
    label: "Claude Code",
    detail: "Run this once where Claude Code is authenticated. It installs the MCP adapter with npx.",
    code: `claude mcp add --scope user \\
  -e TOOLROUTER_API_URL=https://toolrouter.world \\
  -e TOOLROUTER_API_KEY=tr_... \\
  -- toolrouter npx -y @worldcoin/toolrouter`,
  },
  {
    id: "codex",
    label: "Codex",
    detail: "Run this once to add ToolRouter to Codex. It installs the MCP adapter with npx.",
    code: `codex mcp add \\
  --env TOOLROUTER_API_URL=https://toolrouter.world \\
  --env TOOLROUTER_API_KEY=tr_... \\
  -- toolrouter npx -y @worldcoin/toolrouter`,
  },
  {
    id: "cursor",
    label: "Cursor",
    detail: "Paste this into your workspace or global Cursor MCP config. Cursor will run the npm package with npx.",
    code: `.cursor/mcp.json

${routerMcpJson}`,
  },
  {
    id: "vs-code",
    label: "VS Code",
    detail: "Paste this into VS Code's MCP config. VS Code will run the npm package with npx.",
    code: `.vscode/mcp.json

{
  "servers": {
    "toolrouter": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@worldcoin/toolrouter"],
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
    detail: "Paste this under ~/.hermes/config.yaml, then run hermes mcp test toolrouter and use /reload-mcp or start Hermes.",
    code: `# ~/.hermes/config.yaml
mcp_servers:
  toolrouter:
    command: "npx"
    args: ["-y", "@worldcoin/toolrouter"]
    env:
      TOOLROUTER_API_URL: "https://toolrouter.world"
      TOOLROUTER_API_KEY: \${TOOLROUTER_API_KEY}`,
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    detail: "Paste this into ~/.openclaw/openclaw.json. OpenClaw will run the npm package with npx; reload MCP or open a fresh session.",
    code: `~/.openclaw/openclaw.json

${routerMcpJson}`,
  },
];
