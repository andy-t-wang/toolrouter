# ToolRouter MCP

MCP adapter for ToolRouter. It exposes ToolRouter endpoints to MCP-capable agents and calls the ToolRouter API with your API key. Agents run this package with `npx`; they do not need a local ToolRouter repo checkout.

Create an account, verify World ID, and generate an API key at [toolrouter.world](https://toolrouter.world/).

## Usage

```sh
TOOLROUTER_API_KEY=tr_... npx -y @worldcoin/toolrouter
```

Optional:

```sh
TOOLROUTER_API_URL=https://toolrouter.world
```

## MCP Client Config

Most stdio MCP clients can run the adapter with `npx`:

```json
{
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
}
```

Claude Code:

```sh
claude mcp add --scope user \
  -e TOOLROUTER_API_URL=https://toolrouter.world \
  -e TOOLROUTER_API_KEY=tr_... \
  -- toolrouter npx -y @worldcoin/toolrouter
```

Codex:

```sh
codex mcp add \
  --env TOOLROUTER_API_URL=https://toolrouter.world \
  --env TOOLROUTER_API_KEY=tr_... \
  -- toolrouter npx -y @worldcoin/toolrouter
```

The adapter does not load wallet secrets or provider API keys. It only calls ToolRouter's API:

- `GET /v1/endpoints`
- `GET /v1/categories`
- `POST /v1/requests`
- `GET /v1/requests/:id`
- `GET /v1/manus/tasks/:task_id/status`
- `GET /v1/manus/tasks/:task_id/result`

Exposed tools include:

- `toolrouter_list_endpoints`
- `toolrouter_list_categories`
- `toolrouter_recommend_endpoint`
- `toolrouter_call_endpoint`
- `toolrouter_search`
- `toolrouter_browser_use`
- `manus_research_start`
- `manus_research_status`
- `manus_research_result`
- `toolrouter_get_request`
- `exa_search`
- `browserbase_session_create`

Use `toolrouter_search` or `exa_search` for quick synchronous lookup. Use `manus_research_start` for deep research, then poll `manus_research_status` or `manus_research_result` with the returned `task_id`; do not start another task for the same query unless the user explicitly asks for a fresh run.
