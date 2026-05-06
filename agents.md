# ToolRouter Agent Notes

These are durable project decisions for future agents working in this repo.

## Product Shape

- ToolRouter is an AgentKit-first x402 endpoint router.
- The API proxy is the core product. The dashboard is an admin surface.
- Agents call named endpoints explicitly through `POST /v1/requests`; do not add intent routing until the product has enough real endpoint volume to justify it.
- The launch registry should stay small and reliable. As of this note, only `exa.search` is public.

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

## AgentKit And x402 Execution

- Default runtime behavior is `agentkit_first`.
- AgentKit signing should default to World Chain, `AGENTKIT_CHAIN_ID || "eip155:480"`.
- x402 USDC payment should support Base, `eip155:8453`.
- If AgentKit succeeds, trace path is `agentkit` and `charged` is false.
- If AgentKit returns `402` and x402 succeeds, trace path is `agentkit_to_x402`.
- Use `x402_only` only for explicit wallet/payment smoke tests, not normal user traffic.
- Product-level spend caps are intentionally not active yet. `maxUsd` is optional caller protection, and `X402_MAX_USD_PER_REQUEST` remains only as an emergency wallet ceiling in the x402 signer path.
- Keep wallet/private key material inside the server process. Never expose wallet secrets, Supabase service role keys, API key hashes, or payment signatures to the browser.

## Testing

- Normal PR tests must be deterministic and must not spend money.
- Live provider tests belong under `tests/live/**` and run through `npm run test:live:endpoints`.
- Live Exa tests are skipped unless `RUN_LIVE_EXA_TESTS=true` and `AGENT_WALLET_PRIVATE_KEY` are present.
- Forced paid Exa smoke is additionally gated by `RUN_LIVE_EXA_PAID_SMOKE=true`.
- Daily live smoke should use strict spend caps and safe logs.
- Supabase-backed feature verification lives in `scripts/verify-supabase-e2e.mjs` and is gated by `RUN_SUPABASE_E2E=true`.
- The Supabase E2E harness must create temporary auth/user data, verify API keys, traces, credits, dashboard rows, and then clean up. Keep-artifacts mode is only for short browser walkthroughs and must be followed by cleanup.

## Supabase

- Use the Supabase project named `agent-router`.
- Its project ref is `wdgsbgyaqltvcvyatkpp`, and the project MCP URL is `https://mcp.supabase.com/mcp?project_ref=wdgsbgyaqltvcvyatkpp`.
- Remote migrations are applied through Supabase MCP using the repo files in `supabase/migrations`.
- The remote database has RLS enabled for all durable ToolRouter tables.
- The live `requests` table must include credit reservation fields: `credit_reservation_id`, `credit_reserved_usd`, `credit_captured_usd`, and `credit_released_usd`.
- Browser code may use only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Server code may use `SUPABASE_SERVICE_ROLE_KEY`; never expose it to the browser or logs.

## Dashboard And Local Dev

- The public landing page lives at `/`; the authenticated admin app lives at `/dashboard`.
- Local API and web dev commands must load the repo root `.env`.
- The Next.js app uses `scripts/with-root-env.mjs` instead of Node's direct `--env-file-if-exists` flag because Turbopack workers reject that flag in worker exec args.
- Local dashboard API calls should use `NEXT_PUBLIC_TOOLROUTER_API_URL=http://127.0.0.1:9402`.
- With Supabase env configured, the dashboard must use real Supabase Auth. Local dev session fallback is only allowed when Supabase public env is absent.
- Magic-link redirects with `#access_token` and `refresh_token` must be hydrated through `supabase.auth.setSession` before dashboard data refreshes.
- Dashboard payment-path math treats `agentkit` as free AgentKit, and treats both `x402` and `agentkit_to_x402` as paid x402.
- Dashboard paid totals prefer `credit_captured_usd` when present, otherwise `amount_usd`.
