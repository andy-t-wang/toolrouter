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

The adapter does not load wallet secrets or provider API keys. It only calls ToolRouter's API:

- `GET /v1/endpoints`
- `GET /v1/categories`
- `POST /v1/requests`
- `GET /v1/requests/:id`
