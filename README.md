# ToolRouter

ToolRouter is an AgentKit-first MCP router for paid agent tools.

Agents connect once with a ToolRouter API key, then call named tools such as Exa search or Browserbase sessions. ToolRouter handles API-key billing, AgentKit/x402 execution, request traces, endpoint liveness checks, and dashboard account management.

Set up ToolRouter at [toolrouter.world](https://toolrouter.world/).

## What It Does

- One MCP adapter for MCP-capable agents such as Claude Code, Codex, Cursor, Hermes, OpenClaw, and VS Code.
- Simple API-key billing instead of asking every agent user to manage stablecoins or provider wallets.
- AgentKit benefits for verified-human delegation, including free trials, discounts, or access paths where providers support them.
- End-to-end paid liveness checks before agents spend against a provider path.

## MCP Package

The public MCP package is `@worldcoin/toolrouter`.

```sh
TOOLROUTER_API_URL=https://toolrouter.world TOOLROUTER_API_KEY=tr_... npx -y @worldcoin/toolrouter
```

The MCP server is intentionally thin: it reads `TOOLROUTER_API_URL` and `TOOLROUTER_API_KEY`, then calls ToolRouter through `POST /v1/requests`. It does not load wallet secrets, provider API keys, or payment signing keys.

## Public Endpoints

Current launch endpoints:

- `exa.search`
- `browserbase.session`

Endpoint discovery is available through `GET /v1/endpoints`, `GET /v1/categories`, and MCP category tools.

Example direct API call:

```bash
curl https://toolrouter.world/v1/requests \
  -H "Authorization: Bearer tr_..." \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint_id": "exa.search",
    "input": { "query": "top sushi places in San Francisco", "num_results": 5 },
    "maxUsd": "0.01"
  }'
```

## Repository Layout

```text
apps/api          Fastify API proxy and dashboard API
apps/mcp          Published MCP adapter package
apps/web          Next.js public site and dashboard
apps/worker       Paid and AgentKit health probes
packages/auth     API-key and Supabase auth helpers
packages/cache    Redis-compatible rate-limit helpers
packages/db       Supabase and local development stores
packages/router-core endpoint registry, builders, executor, health worker
supabase/         Migrations, RLS, and email templates
deploy/           Dockerfiles and DigitalOcean App Platform template
tests/            Deterministic unit, integration, and static tests
```

## Development Checks

The default test suite is deterministic and does not spend money.

```bash
npm run type-check
npm test
npm --workspace @toolrouter/web run build
```

Live provider tests are opt-in and gated by `RUN_LIVE_*` environment flags:

```bash
npm run test:live:endpoints
```

## Operations Notes

- Production request execution should use Crossmint hosted-wallet signing. `AGENT_WALLET_PRIVATE_KEY` is only for local/manual smoke testing.
- Health checks use hourly paid availability probes and 12-hour AgentKit benefit probes.
- Supabase migrations enable RLS on durable tables. Browser clients must never receive API key hashes, wallet secrets, provider payment headers, raw signatures, or treasury details.

More detail lives in:

- [Deployment hosting](docs/deployment-hosting.md)
- [Wallet/auth rotation](docs/wallet-auth-rotation.md)
- [Agent notes](agents.md)
