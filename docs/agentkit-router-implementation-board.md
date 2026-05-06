# AgentKit Router Implementation Board

Status: Public MVP split-service implementation landed locally
Tech lead: Codex
Project path: `/Users/andy.wang/Documents/hackathon/agentkit-router`
Source specs:

- AgentKit Router MVP
- AgentKit Router E2E Build Plan

## Now

| Ticket | Owner | Status | Acceptance |
| --- | --- | --- | --- |
| AR-006 Live E2E workflow | Unassigned | Todo | Scheduled/release workflow runs live third-party checks with explicit spend caps and safe logging. |
| AR-007 Production deployment | Unassigned | Todo | DigitalOcean App Platform deployment runs API, web, worker, Supabase env, Managed Valkey, and Hermes API key. |
| AR-009 Real AgentKit payment verification | Unassigned | Todo | Run live Exa/Browserbase calls with the wallet in a capped environment and verify payment receipt fields. |

## Next

No queued implementation tickets beyond the launch hardening items above.

## Done

| Ticket | Owner | Status | Acceptance |
| --- | --- | --- | --- |
| AR-000 Final review cleanup | Codex lead | Done | Specs use resource-style API, Supabase, one deployable app, and payment receipt fields. |
| AR-001 Core API runtime | Codex lead + Ptolemy | Done | `GET /health`, `GET /v1/endpoints`, `POST /v1/requests`, `GET /v1/requests`, and `GET /v1/requests/:id` work through one deployable Node app. |
| AR-002 Endpoint registry and health checks | Codex lead + Lagrange | Done | Exa and Browserbase are registered with typed builders, health probes, fixtures, Supabase migration, and endpoint tests. |
| AR-003 Admin dashboard | Codex lead + Hubble | Done | Sparse operational dashboard shows endpoint status, request history, request detail, API key surfaces, and manual test action. |
| AR-004 Hermes MCP integration | Planck | Done | Hermes MCP tools call the new resource-style router API and preserve provider-specific UX. |
| AR-005 Integration and verification | Codex lead | Done | Deterministic Node tests, MCP tests, syntax checks, and local dev-mode smoke test passed. |
| AR-010 Supabase RLS baseline | Codex lead | Done | Durable tables have RLS enabled, broad client grants revoked, user-owned tables scoped by `auth.uid()`, and `api_keys.key_hash` hidden from client roles. |
| AR-011 Public MVP split architecture | Codex lead | Done | Repo split into Fastify API, Next dashboard, health worker, shared packages, Dockerfiles, App Platform spec, CI, rate limits, and spend guards. |

## Risks

- Real AgentKit/x402 behavior requires wallet and provider credentials; local deterministic tests must not spend money.
- Supabase credentials must stay in `.env` and never appear in logs.
- Provider-specific tools should never bypass the router or load wallet private keys.

## Update Log

- 2026-05-05: Started tech-lead implementation rollout with four parallel worker streams.
- 2026-05-05: Landed local MVP implementation. Verification: `npm test`, `node --check` across app/tests, MCP pytest suite, and dev-mode smoke test on `127.0.0.1:9412`.
- 2026-05-05: Added Supabase RLS migration `0002_enable_rls.sql` and test coverage for table RLS, owner-scoped policies, and hidden API key hashes.
- 2026-05-05: Converted to public-MVP split architecture with `apps/api`, `apps/web`, `apps/worker`, shared packages, DigitalOcean App Platform deployment template, Managed Valkey cache support, and 19 passing tests.
