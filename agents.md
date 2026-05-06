# ToolRouter Agent Notes

These are durable project decisions for future agents working in this repo.

## Product Shape

- ToolRouter is an AgentKit-first x402 endpoint router.
- The API proxy is the core product. The dashboard is an admin surface.
- Agents call named endpoints explicitly through `POST /v1/requests`; do not add intent routing until the product has enough real endpoint volume to justify it.
- The launch registry should stay small and reliable. As of this note, public endpoints are `exa.search`, `browserbase.search`, `browserbase.fetch`, and `browserbase.session`.

## Endpoint Template

- New endpoints should follow the category/provider/endpoint module pattern.
- Each endpoint module should define metadata, UI metadata, typed input validation through its builder, fixture input, health probe, live smoke config, and request builder.
- Keep provider onboarding manual for now. Providers should only need correct AgentKit/x402 support; ToolRouter maps their endpoint into our template.

## Exa Search Decision

- `exa.search` lives under `packages/router-core/src/endpoints/search/exa/search.ts`.
- Exa calls must POST to `https://api.exa.ai/search`.
- Do not send `x-api-key` or `Authorization` headers to Exa for ToolRouter endpoint execution. Exa's docs say those headers bypass both AgentKit and x402.
- Use low-cost default inputs: `type: "fast"` and `numResults: 5`.
- Cheap Exa search is about `$0.007`; live smoke tests should cap `maxUsd` at `"0.01"`.

## Browserbase Endpoint Decisions

- Browserbase endpoints use `https://x402.browserbase.com`.
- Registered Browserbase endpoints are `browserbase.search` (`POST /search`, about `$0.01`), `browserbase.fetch` (`POST /fetch`, about `$0.01`), and `browserbase.session` (`POST /browser/session/create`, about `$0.12/hour`).
- Browserbase is an AgentKit-verified access path, not a free-trial path. Its endpoint metadata should use `agentkit_value_type: "access"` and label `AgentKit-Access`.
- Dashboard tables should distinguish AgentKit value labels: `AgentKit-Free Trial`, `AgentKit-Discount`, and `AgentKit-Access`.

## AgentKit And x402 Execution

- Default runtime behavior is `agentkit_first`.
- AgentKit signing should default to World Chain, `AGENTKIT_CHAIN_ID || "eip155:480"`.
- x402 USDC payment should support Base, `eip155:8453`.
- If AgentKit succeeds, trace path is `agentkit` and `charged` is false.
- If AgentKit returns `402` and x402 succeeds, trace path is `agentkit_to_x402`.
- Use `x402_only` only for explicit wallet/payment smoke tests, not normal user traffic.
- Live Exa AgentKit smoke should prove the free-trial path by requiring `path === "agentkit"` and `charged === false`.
- Product-level spend caps are intentionally not active yet. `maxUsd` is optional caller protection, and `X402_MAX_USD_PER_REQUEST` remains only as an emergency wallet ceiling in the x402 signer path.
- Keep wallet/private key material inside the server process. Never expose wallet secrets, Supabase service role keys, API key hashes, or payment signatures to the browser.
- AgentKit wallet verification belongs behind authenticated server routes. Store only badge-safe status in browser responses; raw AgentBook human IDs must never be exposed, and any stored human identifier must be hashed.
- API keys are user-scoped and revocable. A compromised key should be disabled and replaced from the dashboard without rotating server wallet secrets or affecting other users.

## MCP Server

- The ToolRouter MCP server lives in `apps/mcp` and runs with `npm run start:mcp`.
- It reads `TOOLROUTER_API_URL` and `TOOLROUTER_API_KEY` from its environment and calls ToolRouter through `POST /v1/requests`.
- MCP tools should remain thin wrappers over named endpoints plus generic endpoint/list/trace tools. The MCP process must not load wallet private keys, Crossmint signer secrets, Supabase service role keys, or provider API keys.
- The setup page at `/setup` should stay agent-agnostic and include a first test query for top sushi places in SF.

## Testing

- Normal PR tests must be deterministic and must not spend money.
- Live provider tests belong under `tests/live/**` and run through `npm run test:live:endpoints`.
- Live Exa tests are skipped unless `RUN_LIVE_EXA_TESTS=true` and `AGENT_WALLET_PRIVATE_KEY` are present.
- Forced paid Exa smoke is additionally gated by `RUN_LIVE_EXA_PAID_SMOKE=true`.
- Live Browserbase tests are skipped unless `RUN_LIVE_BROWSERBASE_TESTS=true`; forced paid Browserbase smoke is additionally gated by `RUN_LIVE_BROWSERBASE_PAID_SMOKE=true`.
- Daily live smoke should use strict spend caps and safe logs.
- Supabase-backed feature verification lives in `scripts/verify-supabase-e2e.mjs` and is gated by `RUN_SUPABASE_E2E=true`.
- The Supabase E2E harness must create temporary auth/user data, verify API keys, traces, credits, dashboard rows, and then clean up. Keep-artifacts mode is only for short browser walkthroughs and must be followed by cleanup.

## Supabase

- Use the Supabase project named `agent-router`.
- Its project ref is `wdgsbgyaqltvcvyatkpp`, and the project MCP URL is `https://mcp.supabase.com/mcp?project_ref=wdgsbgyaqltvcvyatkpp`.
- Remote migrations are applied through Supabase MCP using the repo files in `supabase/migrations`.
- The remote database has RLS enabled for all durable ToolRouter tables.
- The live `requests` table must include credit reservation fields: `credit_reservation_id`, `credit_reserved_usd`, `credit_captured_usd`, and `credit_released_usd`.
- The live `requests` table should include AgentKit value metadata fields: `agentkit_value_type` and `agentkit_value_label`.
- Supabase monitoring uses request rows, health checks, endpoint status, and the `toolrouter_monitoring_daily` view for request counts, error counts, path split, and paid totals.
- Browser code may use only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Server code may use `SUPABASE_SERVICE_ROLE_KEY`; never expose it to the browser or logs.

## Dashboard And Local Dev

- The public landing page lives at `/`; the authenticated admin app lives at `/dashboard`.
- The public docs page lives at `/docs`; the agent setup page lives at `/setup`; the authenticated admin app lives at `/dashboard`.
- The landing page should follow the provided reference design: "Tools your agent can actually trust." Avoid public links to pages that do not exist yet, such as pricing, changelog, or a full status/catalog page.
- Landing-page health/status data must come from the public `GET /v1/status` API route, which exposes only safe endpoint metadata plus `endpoint_status` and `health_checks` summaries. Do not hard-code fake provider uptime rows on the public page.
- Local API and web dev commands must load the repo root `.env`.
- The Next.js app uses `scripts/with-root-env.mjs` instead of Node's direct `--env-file-if-exists` flag because Turbopack workers reject that flag in worker exec args.
- Local dashboard API calls should use `NEXT_PUBLIC_TOOLROUTER_API_URL=http://127.0.0.1:9402`.
- With Supabase env configured, the dashboard must use real Supabase Auth unless `NEXT_PUBLIC_TOOLROUTER_DEV_AUTH=true` is set for local development.
- To avoid burning Supabase magic-link email quota during local work, `NEXT_PUBLIC_TOOLROUTER_DEV_AUTH=true` allows `localhost` and `127.0.0.1` to use the server-side `dev_supabase_session` path. Do not enable this for public deployments.
- Magic-link redirects with `#access_token` and `refresh_token` must be hydrated through `supabase.auth.setSession` before dashboard data refreshes.
- Dashboard payment-path math treats `agentkit` as free AgentKit, and treats both `x402` and `agentkit_to_x402` as paid x402.
- Dashboard paid totals prefer `credit_captured_usd` when present, otherwise `amount_usd`.
- Dashboard monitoring comes from `GET /v1/dashboard/monitoring`.
- Billing should show the World ID-style `human` badge only when server-side AgentKit wallet verification has succeeded.
