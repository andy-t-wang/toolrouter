# ToolRouter Agent Notes

These are durable project decisions for future agents working in this repo.

## Product Shape

- ToolRouter is an AgentKit-first x402 endpoint router.
- The API proxy is the core product. The dashboard is an admin surface.
- Agents call named endpoints explicitly through `POST /v1/requests`; do not add intent routing until the product has enough real endpoint volume to justify it.
- Categories are the agent-facing discovery layer, not hidden intent routing. Agents can ask for generic categories like `search`, `browser_usage`, or `data`, inspect the recommended endpoint, then call the selected endpoint explicitly so traces and billing stay concrete.
- Category discovery is exposed through `GET /v1/categories` and MCP tools like `toolrouter_list_categories` and `toolrouter_recommend_endpoint`.
- The launch registry should stay small and reliable. As of this note, active public endpoints are `exa.search` and `browserbase.session`.

## Endpoint Template

- New endpoints should follow the category/provider/endpoint module pattern.
- Each endpoint module should define metadata, UI metadata, typed input validation through its builder, fixture input, health probe, live smoke config, and request builder.
- Keep provider onboarding manual for now. Providers should only need correct AgentKit/x402 support; ToolRouter maps their endpoint into our template.
- When asked to add a new endpoint to the service, treat this section like a mini-skill: first identify the provider, endpoint id, category, request shape, expected cost, and x402/AgentKit behavior, then implement the endpoint, UI metadata, MCP surface, and tests together.
- Before coding a new endpoint, ask the user what the AgentKit benefit will be if it is not already explicit in the request or provider docs. Capture whether there is no AgentKit benefit, a free trial, access unlock, or discount before choosing endpoint metadata.
- Endpoint modules live at `packages/router-core/src/endpoints/<category>/<provider>/<endpoint>.ts`. Add or update the typed request builder in `packages/router-core/src/endpoints/builders.ts`, register the endpoint in `packages/router-core/src/endpoints/registry.ts`, and update `packages/router-core/src/endpoints/categories.ts` only when the endpoint should become the recommended endpoint for a category.
- Every endpoint must explicitly classify what the user gets from AgentKit/x402 with `agentkit_value_type` and `agentkit_value_label`:
  - `free_trial` / `AgentKit-Free Trial`: AgentKit succeeds without an x402 charge and provides free provider usage.
  - `access` / `AgentKit-Access`: x402 still pays, and a valid AgentKit proof unlocks access or a premium capability such as Browserbase Verified browsers.
  - `discount` / `AgentKit-Discount`: x402 still pays, and AgentKit lowers the price versus the normal paid path.
- Do not guess the AgentKit value category from branding. Confirm it from the user and/or the provider's x402/AgentKit behavior, then encode the exact category in endpoint metadata.
- If the provider requires a separate AgentKit proof header in addition to x402 payment, set `agentkit_proof_header: true` and cover it in executor tests.
- Provider logos are part of endpoint onboarding. Save a small provider logomark in `apps/web/public/<provider>-logomark.svg` from an official source when possible, then wire it into the landing/status and dashboard provider logo maps. Keep endpoint `ui.badge` as a short text fallback, not the primary logo.
- Do not send provider API keys, `Authorization`, or provider-specific auth headers in endpoint execution when those headers bypass AgentKit/x402. The endpoint builder should emit only the headers needed for x402/AgentKit execution.
- For each new endpoint, include deterministic tests before live tests:
  - Registry/unit tests in `tests/unit/endpoints/registry.test.mjs` for endpoint registration, category grouping or recommendation, request building, health probe config, live smoke config, and AgentKit value metadata.
  - Builder validation tests for required input, aliases, safe defaults, estimated USD, and strict spend caps.
  - Executor tests when the endpoint uses provider-specific x402 behavior, AgentKit proof headers, protocol-version quirks, chain aliases, or custom payment modes.
  - API integration tests for `GET /v1/status` and dashboard request rows so public status and AgentKit value metadata remain badge-safe.
  - Web/static tests when adding logos, dashboard chips, status table rows, or new user-visible labels.
  - MCP tests when adding named endpoint tools or category wrappers.
  - Live tests under `tests/live/**` gated by provider-specific env flags, with `RUN_LIVE_<PROVIDER>_TESTS=true` for default smoke and `RUN_LIVE_<PROVIDER>_PAID_SMOKE=true` for forced paid paths.
- Normal PR tests must stay deterministic and must not spend money. Live smoke tests should be opt-in, use fixture inputs, enforce `maxUsd`, avoid sensitive logs, and assert the expected path and `charged` state for the endpoint's value category.

## Exa Search Decision

- `exa.search` lives under `packages/router-core/src/endpoints/search/exa/search.ts`.
- Exa calls must POST to `https://api.exa.ai/search`.
- Do not send `x-api-key` or `Authorization` headers to Exa for ToolRouter endpoint execution. Exa's docs say those headers bypass both AgentKit and x402.
- Use low-cost default inputs: `type: "fast"` and `numResults: 5`.
- Cheap Exa search is about `$0.007`; live smoke tests should cap `maxUsd` at `"0.01"`.

## Browserbase Endpoint Decisions

- Browserbase endpoints use `https://x402.browserbase.com`.
- Active Browserbase endpoint is `browserbase.session` (`POST /browser/session/create`, about `$0.12/hour`).
- Browserbase is an AgentKit-verified access path, not a free-trial path. Its endpoint metadata should use `agentkit_value_type: "access"` and label `AgentKit-Access`.
- Dashboard tables should distinguish AgentKit value labels: `AgentKit-Free Trial`, `AgentKit-Discount`, and `AgentKit-Access`.

## AgentKit And x402 Execution

- Default runtime behavior is `agentkit_first`.
- AgentKit signing should default to World Chain, `AGENTKIT_CHAIN_ID || "eip155:480"`.
- x402 USDC payment should support Base, `eip155:8453`.
- If AgentKit succeeds, trace path is `agentkit` and `charged` is false.
- If AgentKit returns `402` and x402 succeeds, trace path is `agentkit_to_x402`.
- For `free_trial` endpoints, AgentKit value is realized only when the final request path is `agentkit` and `charged` is false. A paid `agentkit_to_x402` fallback is useful trace detail, but it must not be displayed or stored as `AgentKit-Free Trial` and must not count as healthy free-trial AgentKit evidence.
- Use `x402_only` only for explicit wallet/payment smoke tests, not normal user traffic.
- Live Exa AgentKit smoke should prove the free-trial path by requiring `path === "agentkit"` and `charged === false`.
- Product-level spend caps are intentionally not active yet. `maxUsd` is optional caller protection, and `X402_MAX_USD_PER_REQUEST` remains only as an emergency wallet ceiling in the x402 signer path.
- Keep wallet/private key material inside the server process. Never expose wallet secrets, Supabase service role keys, API key hashes, or payment signatures to the browser.
- AgentKit account verification belongs behind authenticated server routes. Store only badge-safe status in browser responses; raw AgentBook human IDs must never be exposed, and any stored human identifier must be hashed.
- API keys are user-scoped and revocable. A compromised key should be disabled and replaced from the dashboard without rotating server wallet secrets or affecting other users.

## MCP Server

- The ToolRouter MCP server lives in `apps/mcp`, publishes as `@worldcoin/toolrouter`, and runs for users with `npx -y @worldcoin/toolrouter`.
- It reads `TOOLROUTER_API_URL` and `TOOLROUTER_API_KEY` from its environment and calls ToolRouter through `POST /v1/requests`.
- MCP tools should remain thin wrappers over named endpoints plus generic category/list/trace tools. The MCP process must not load wallet private keys, Crossmint signer secrets, Supabase service role keys, or provider API keys.
- Generic MCP tools such as `toolrouter_search` and `toolrouter_browser_use` are convenience wrappers over the current recommended endpoint for that category. They should still submit a concrete `endpoint_id` to the API.
- The setup page at `/setup` should stay agent-agnostic and include a first test query for top sushi places in SF.

## Testing

- Normal PR tests must be deterministic and must not spend money.
- Live provider tests belong under `tests/live/**` and run through `npm run test:live:endpoints`.
- Live Exa tests are skipped unless `RUN_LIVE_EXA_TESTS=true` and either `AGENT_WALLET_PRIVATE_KEY` or Crossmint live signer env is present.
- Forced paid Exa smoke is additionally gated by `RUN_LIVE_EXA_PAID_SMOKE=true`.
- Live Browserbase tests are skipped unless `RUN_LIVE_BROWSERBASE_TESTS=true`; forced paid Browserbase smoke is additionally gated by `RUN_LIVE_BROWSERBASE_PAID_SMOKE=true`.
- Daily live smoke should use strict spend caps and safe logs.
- Supabase-backed feature verification lives in `scripts/verify-supabase-e2e.mjs` and is gated by `RUN_SUPABASE_E2E=true`.
- The Supabase E2E harness must create temporary auth/user data, verify API keys, traces, credits, dashboard rows, and then clean up. Keep-artifacts mode is only for short browser walkthroughs and must be followed by cleanup.

## Supabase

- Use the Supabase project configured in the deployment environment.
- Keep project refs and Supabase MCP URLs in local/private config, not committed repo files.
- Remote migrations are applied through Supabase MCP using the repo files in `supabase/migrations`.
- Supabase Auth must use a custom SMTP provider in production. The MVP default is Resend SMTP (`smtp.resend.com:587`, user `resend`) with `auth@toolrouter.world` as the sender and `https://toolrouter.world` as the Site URL. Apply this through `npm run supabase:auth-config`; do not leave the hosted Auth config pointing at `localhost`. If Resend DNS is not verified yet, use `npm run supabase:auth-config -- --url-only` to fix redirects without enabling SMTP.
- Supabase Auth emails should not expose the raw Supabase verify URL. The confirmation and magic-link templates use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...&redirect_to={{ .RedirectTo }}`, and the Next route at `/auth/confirm` calls `verifyOtp` before redirecting to the dashboard with the session fragment.
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
- When the API is backed by Supabase, `dev_supabase_session` must resolve to a real Supabase Auth user UUID. Never pass placeholder IDs like `dev-user` into Supabase tables because user-owned columns are typed as UUIDs and reference `auth.users(id)`.
- Magic-link redirects with `#access_token` and `refresh_token` must be hydrated through `supabase.auth.setSession` before dashboard data refreshes.
- Dashboard payment-path math treats `agentkit` as free AgentKit, and treats both `x402` and `agentkit_to_x402` as paid x402.
- Dashboard paid totals prefer `credit_captured_usd` when present, otherwise `amount_usd`.
- Dashboard monitoring comes from `GET /v1/dashboard/monitoring`.
- Billing should show the World ID-style `human` badge only when server-side AgentKit account verification has succeeded. Do not show a `not verified` badge, payment address, pending/reserved credit breakdown, or crypto-specific copy. Keep user-facing copy account-oriented rather than wallet-oriented.
- AgentKit account verification should use `POST /v1/agentkit/account-verification` from the dashboard. The legacy `/v1/wallet/agentkit-verification` route exists only as a compatibility alias.
- AgentKit account registration should follow the same Step 2 flow as `npx @worldcoin/agentkit-cli register <agent-address>`: prepare an AgentBook nonce and World ID signal server-side, let the browser complete World App verification, then submit the proof to the hosted relay. The dashboard should show account-oriented copy and must not display the underlying wallet address.
- AgentKit registration parity with the CLI lives in `apps/api/src/agentkitRegistration.ts`; update that module and its unit tests when the upstream CLI behavior changes.
- AgentKit registration signals must use IDKit's `solidityEncode(["address", "uint256"], [agentAddress, nonce])` object shape. Do not use ABI-encoded hex from `viem.encodeAbiParameters`; that produces an invalid World ID proof for AgentBook.
- Add Credits uses Stripe Checkout for USD credits. Crossmint Orders/onramp is no longer part of the credit purchase flow.
- Stripe top-ups are capped at `TOOLROUTER_MAX_TOP_UP_USD`, which defaults to `5` for MVP testing. Local E2E must use an `sk_test_` Stripe key. The API refuses live Checkout Sessions while `ROUTER_DEV_MODE=true` unless `STRIPE_ALLOW_LIVE_CHECKOUT=true` is set intentionally.
- If Stripe checkout succeeds but treasury funding fails, the webhook must return a non-2xx response so Stripe retries. The purchase remains unavailable in `funding_failed`, an operator alert should be sent to `TOOLROUTER_ALERT_EMAIL`, and `npm run billing:retry-funding` can settle failed purchases after the treasury is refilled.
- Credits become available only after the Stripe success webhook funds the account's ToolRouter-controlled agent wallet from the Crossmint treasury wallet. If funding fails, keep the purchase unavailable and record the operational error.
- Crossmint remains wallet infrastructure only: server-signer agent wallets, treasury wallet funding, and AgentKit/x402 message signing. Do not expose wallet addresses, signer secrets, treasury details, payment signatures, withdrawals, or crypto-specific copy in the browser.
- Production dashboard balance loads should silently bootstrap the user's Crossmint agent wallet if it does not already exist. This keeps the account ready for AgentKit verification, credits, and paid endpoint calls without exposing wallet details in the UI. If Crossmint is unavailable, the dashboard should still load and retry on a later balance refresh.
- New per-account Crossmint agent wallets must be created with `owner: email:<supabase account email>` so the Crossmint dashboard links the wallet back to the account. Keep recovery as ToolRouter's server signer; do not use email recovery or expose wallet ownership in the product UI.
- Each account should use a stable Crossmint agent-wallet alias `tr-agent-<sha256(user_id)[0:27]>`; Crossmint aliases must stay at or below 36 characters. The treasury defaults to `CROSSMINT_TREASURY_WALLET_LOCATOR=evm:alias:toolrouter-treasury-base` and must be funded manually with USDC for MVP.
- Before deployment, `npm run crossmint:check` must pass. The Crossmint API key needs `wallets.create`, `wallets.read`, `wallets:balance.read`, `wallets:messages.sign`, `wallets:signatures.create`, `wallets:signatures.read`, `wallets:transactions.create`, `wallets:transactions.sign`, and `wallets:transactions.read`.
- AgentKit account status is implemented the same way as `npx @worldcoin/agentkit-cli status <agent-address>`: read AgentBook `lookupHuman(agentAddress)` on World Chain. Registration is a separate human action equivalent to `npx @worldcoin/agentkit-cli register <agent-address>`.
