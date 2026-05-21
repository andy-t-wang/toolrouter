const hostedMcpJson = `{
  "mcpServers": {
    "toolrouter": {
      "url": "https://toolrouter.world/mcp",
      "headers": {
        "Authorization": "Bearer tr_..."
      }
    }
  }
}`;

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
    id: "hosted-http",
    label: "Hosted HTTP",
    detail: "Use this for clients that support remote MCP servers. No npm package or local command is required.",
    code: hostedMcpJson,
  },
  {
    id: "claude-code",
    label: "Claude Code stdio",
    detail: "Use this fallback where Claude Code only supports local stdio MCP commands.",
    code: `claude mcp add --scope user \\
  -e TOOLROUTER_API_URL=https://toolrouter.world \\
  -e TOOLROUTER_API_KEY=tr_... \\
  -- toolrouter npx -y @worldcoin/toolrouter`,
  },
  {
    id: "codex",
    label: "Codex stdio",
    detail: "Use this fallback where Codex only supports local stdio MCP commands.",
    code: `codex mcp add \\
  --env TOOLROUTER_API_URL=https://toolrouter.world \\
  --env TOOLROUTER_API_KEY=tr_... \\
  -- toolrouter npx -y @worldcoin/toolrouter`,
  },
  {
    id: "cursor",
    label: "Cursor",
    detail: "Paste this into your workspace or global Cursor MCP config when remote MCP is enabled.",
    code: `.cursor/mcp.json

${hostedMcpJson}`,
  },
  {
    id: "vs-code",
    label: "VS Code",
    detail: "Paste this into VS Code's MCP config when remote MCP is enabled.",
    code: `.vscode/mcp.json

{
  "servers": {
    "toolrouter": {
      "type": "http",
      "url": "https://toolrouter.world/mcp",
      "headers": {
        "Authorization": "Bearer tr_..."
      }
    }
  }
}`,
  },
  {
    id: "hermes",
    label: "Hermes",
    detail: "Use this stdio fallback if your Hermes version cannot connect to the hosted MCP URL, then run hermes mcp test toolrouter.",
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
    detail: "Paste this into ~/.openclaw/openclaw.json when remote MCP is enabled; reload MCP or open a fresh session.",
    code: `~/.openclaw/openclaw.json

${hostedMcpJson}`,
  },
  {
    id: "stdio-json",
    label: "Stdio fallback",
    detail: "Use this only for clients that require a local command transport.",
    code: routerMcpJson,
  },
];
