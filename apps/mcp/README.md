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

By default the adapter asks ToolRouter for a live MCP manifest at startup and
on tool-list refreshes. That lets newly deployed ToolRouter endpoints appear as
MCP tools without waiting for a new npm package install. If the API is
unavailable, or if no API key is configured yet, the adapter falls back to the
endpoint manifest bundled in the npm package.

For deterministic local debugging against only the bundled manifest:

```sh
TOOLROUTER_MCP_LIVE_MANIFEST=false
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

- `GET /v1/mcp/manifest`
- `GET /v1/endpoints`
- `GET /v1/categories`
- `POST /v1/requests`
- `GET /v1/requests/:id`
- `GET /v1/manus/tasks/:task_id/status`
- `GET /v1/manus/tasks/:task_id/result`
- `GET /v1/parallel/tasks/:task_id/status`
- `GET /v1/parallel/tasks/:task_id/result`

Exposed tools include:

- `toolrouter_list_endpoints`
- `toolrouter_list_categories`
- `toolrouter_recommend_endpoint`
- `toolrouter_call_endpoint`
- `toolrouter_search`
- `toolrouter_send_email`
- `toolrouter_browser_use`
- `manus_research_start`
- `manus_research_status`
- `manus_research_result`
- `parallel_search`
- `parallel_extract`
- `parallel_task_start`
- `parallel_task_status`
- `parallel_task_result`
- `toolrouter_get_request`
- `exa_search`
- `browserbase_session_create`

Use `toolrouter_search` or `exa_search` for quick synchronous lookup. Use `toolrouter_send_email` to send email through the current recommended email endpoint. Use `manus_research_start` for deep research, then poll the MCP tools `manus_research_status` or `manus_research_result` with the returned `task_id`; those helper names are not ToolRouter endpoint IDs. Do not start another task for the same query unless the user explicitly asks for a fresh run.
