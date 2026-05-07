# ToolRouter

AgentKit-first x402 router for paid agent tools. The API proxy is the core product; the dashboard is a separate admin surface.

## Repo Shape

```text
apps/api        Fastify API proxy
apps/web        Next.js dashboard
apps/worker     12-hour endpoint health worker
packages/auth   API-key and Supabase session auth
packages/cache  Redis-compatible rate limits
packages/db     Supabase and local dev stores for requests, credits, and wallets
packages/router-core endpoint registry, builders, AgentKit/x402 executor, health checks
deploy/         DigitalOcean App Platform and Docker assets
supabase/       Postgres migrations and RLS
tests/          unit, integration, and static dashboard tests
```

## Local Dev

Install dependencies:

```bash
cd /Users/andy.wang/Documents/hackathon/agentkit-router
npm install
```

Run the API in deterministic mode. This does not spend money and does not require wallet secrets:

```bash
ROUTER_DEV_MODE=true \
AGENTKIT_ROUTER_DEV_API_KEY=dev_agentkit_router_key \
TOOLROUTER_API_HOST=127.0.0.1 \
TOOLROUTER_API_PORT=9402 \
npm run dev:api
```

Run the dashboard:

```bash
NEXT_PUBLIC_TOOLROUTER_API_URL=http://127.0.0.1:9402 npm run dev:web
```

Open `http://127.0.0.1:3000`. Without Supabase public env vars, the dashboard uses the local dev session token.

## API

Agent-facing routes:

```text
GET  /health
GET  /v1/endpoints
POST /v1/requests
GET  /v1/requests
GET  /v1/requests/:id
```

Agent routes require `Authorization: Bearer <api-key>`.

Dashboard routes use Supabase session bearer tokens:

```text
GET    /v1/dashboard/endpoints
GET    /v1/dashboard/requests
GET    /v1/dashboard/monitoring
GET    /v1/balance
GET    /v1/ledger
POST   /v1/top-ups
GET    /v1/api-keys
POST   /v1/api-keys
DELETE /v1/api-keys/:id
POST   /webhooks/stripe
```

`POST /v1/requests` reserves ToolRouter credits before execution, captures the actual paid amount from the AgentKit/x402 receipt, and releases unused reserve. In local dev mode, the store seeds a configurable test balance with `TOOLROUTER_DEV_CREDIT_BALANCE_USD`.

Stripe top-ups are capped by `TOOLROUTER_MAX_TOP_UP_USD`, which defaults to `$5`. Local Stripe E2E should use an `sk_test_` key; the API refuses live Checkout Sessions in dev mode unless `STRIPE_ALLOW_LIVE_CHECKOUT=true` is explicitly set.

After Stripe Checkout succeeds, credits usually appear in 30-90 seconds. If treasury funding fails, the webhook returns an error so Stripe can retry, ToolRouter sends an operational alert through Resend, and the purchase stays unavailable until funding succeeds. After topping up the treasury, run:

```bash
npm run billing:retry-funding
```

Run the MCP server for Hermes, Codex, Claude, and other MCP-capable agents:

```sh
TOOLROUTER_API_URL=http://127.0.0.1:9402 TOOLROUTER_API_KEY=tr_... npm run start:mcp
```

The MCP server exposes `exa_search`, Browserbase tools, a generic endpoint call tool, endpoint listing, and trace lookup. It calls ToolRouter through `POST /v1/requests`; it does not load wallet secrets.

## Deployment

Recommended public MVP hosting:

- DigitalOcean App Platform for `api`, `web`, and `health-worker`.
- DigitalOcean Managed Valkey for Redis-compatible rate limits and spend counters.
- Supabase Auth/Postgres for login, API keys, request traces, credits, wallet metadata, endpoint status, and RLS.
- Stripe Checkout for USD credit purchases.
- Crossmint hosted wallets for per-account agent wallets, treasury funding, and AgentKit/x402 signing.
- AgentBook wallet verification for a badge-safe AgentKit human status in Billing.

Required Crossmint API scopes for production:

```text
wallets.create
wallets.read
wallets:balance.read
wallets:messages.sign
wallets:signatures.create
wallets:signatures.read
wallets:transactions.create
wallets:transactions.sign
wallets:transactions.read
```

Run `npm run crossmint:check` before deployment. It verifies the treasury wallet, treasury USDC balance, per-account wallet creation, and server-side message signing without moving funds.

Set `RESEND_API_KEY`, `TOOLROUTER_ALERT_EMAIL`, and `TOOLROUTER_ALERT_FROM` in production so failed credit settlement alerts go to the operator inbox.

Deployment assets:

```text
deploy/Dockerfile.api
deploy/Dockerfile.web
deploy/Dockerfile.worker
deploy/digitalocean-app.yaml
```

`deploy/digitalocean-app.yaml` is a template. Fill in the GitHub repo, Supabase secrets, Valkey URL, Stripe secrets, Crossmint wallet secrets, and public origin before creating the App Platform app. `AGENT_WALLET_PRIVATE_KEY` is only for local/manual smoke testing; production request execution should use Crossmint hosted-wallet signing.

See `docs/deployment-hosting.md` for the operational hosting plan and scale path.
See `docs/wallet-auth-rotation.md` for the API-key compromise and wallet isolation model.

## Verification

```bash
npm run type-check
npm test
npm --workspace @toolrouter/web run build
npm audit --omit=dev
```

The integration tests bind a local test port, so Codex may need permission to run them outside the default sandbox.

## Supabase Security

Apply migrations in order:

```text
supabase/migrations/*.sql
```

The migrations enable RLS on all durable tables. Authenticated dashboard users can read only their own `api_keys` metadata, `requests`, badge-safe wallet/account state, credit balance, credit ledger, and credit purchase state; `key_hash`, wallet addresses, wallet locators, signer data, and treasury data are not granted to client roles. Endpoint status and health-check history are readable to authenticated users only. Router writes use the Supabase service role from `apps/api` and `apps/worker`.
