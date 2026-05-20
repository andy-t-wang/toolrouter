---
name: feat-parallel-endpoints
description: Add Parallel.ai as a new provider with Search, Extract (new category), and async Task endpoints — all behind first-party x402 wrappers on Base with a $0.01 markup
status: active
created: 2026-05-20
type: feat
---

# feat: Add Parallel Search, Extract, and async Task endpoints

**Origin:** `docs/sprint-2.md`

> "Setup Parallel as another tool. Use x402 on Base like we have the others. Do the same pricing plus one cent per call: https://docs.parallel.ai/integrations/agentic-payments#available-endpoints
> - Support Search — same category as Exa
> - Extract — new category, primary endpoint
> - Task — another research; follow the Manus pattern as it's asynchronous"

---

## Summary

Add three new endpoints from Parallel.ai, all routed through first-party ToolRouter x402 seller wrappers so we can apply a $0.01 markup on top of Parallel's pricing:

| Endpoint            | Category | Pattern     | Parallel price | Wrapper price (markup +$0.01) |
|---------------------|----------|-------------|----------------|-------------------------------|
| `parallel.search`   | search   | sync        | $0.01          | $0.02                         |
| `parallel.extract`  | extract  | sync (NEW)  | $0.01 / URL    | $0.01 / URL + $0.01           |
| `parallel.task`     | research | async       | $0.30 (ultra)  | $0.31 (ultra)                 |

`parallel.task` reuses the Manus async-task pattern (start → poll status → fetch result). The existing Manus-specific async-task module is generalized to support an arbitrary async strategy so we don't duplicate the dedupe/reservation/poll flow.

The new `extract` category is added to `packages/router-core/src/endpoints/categories.ts` with `parallel.extract` as its recommended endpoint. The Browserbase recommended endpoint stays `browserbase.session`; the Search recommended endpoint stays `exa.search` (Exa stays cheapest for default search). For Research, `manus.research` stays the recommended endpoint.

All three Parallel endpoints expose AgentKit as a `free_trial` benefit (since `createSellerService` currently maps only `free_trial`; access/discount mapping is explicitly deferred upstream). Free trial quotas:

- `parallel.search`: 5 uses / month / verified human
- `parallel.extract`: 5 uses / month / verified human
- `parallel.task`: 1 use / month / verified human

---

## Problem Frame

Sprint-2 expands the launch endpoint set. We need Parallel.ai's three endpoints accessible via the same `POST /v1/requests` flow agents already use, with billing that nets ToolRouter a $0.01 margin per call. The async Task endpoint is the second occurrence of the async-task pattern, which is the explicitly-deferred trigger to generalize the Manus-specific async-task module (`apps/api/src/services/execution/async-task.ts`).

---

## Scope Boundaries

**In scope:**
- New seller wrappers (`/x402/parallel/search`, `/x402/parallel/extract`, `/x402/parallel/task`) under `apps/api/src/sellers/parallel/`
- New endpoint manifests under `packages/router-core/src/endpoints/`
- New `extract` category with `parallel.extract` as recommended endpoint
- Async-task generalization to support both Manus and Parallel task strategies
- MCP tools (`parallel_search`, `parallel_extract`, `parallel_task_start`, `parallel_task_status`, `parallel_task_result`)
- Provider logo + dashboard chips
- Deterministic unit/integration tests + opt-in live smoke tests
- AgentKit free-trial counters (per-endpoint keyspace in `MonthlyAgentKitStorage`)

**Outside this PR's identity:**
- Wallet/treasury infra changes — none required; Parallel uses Base USDC, same as Manus
- Crossmint integration — unchanged
- Stripe / credit purchase flow — unchanged

### Deferred to Follow-Up Work
- AgentKit `access`/`discount` modes in `createSellerService.mapAgentkitMode` (still throws today; only `free_trial` works). Future: extend `SellerAgentkitMode` per the comment at `apps/api/src/sellers/createSellerService.ts:130`.
- Per-processor pricing for Parallel Task beyond `ultra`. Defaults shipped, but only `ultra` price is confirmed in Parallel's public docs — other processor tiers fall back to env-var-configurable defaults.
- Promoting `parallel.search` above `exa.search` as the recommended Search endpoint (Exa is cheaper and has paid availability history).

---

## Key Technical Decisions

### D1. All three endpoints are first-party x402 wrappers, not direct calls
The user-supplied requirement "plus one cent per call" requires a ToolRouter-controlled settlement seam. Direct calls to `https://parallelmpp.dev` would let the buyer pay Parallel exactly Parallel's price with no margin. The wrapper pattern (`/x402/parallel/*`) is what Manus already uses for the same purpose. Endpoint manifest `url` fields point at `TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world"` like `manus.research`.

### D2. AgentKit benefit modeled as `free_trial` with monthly counters
Parallel does not advertise an AgentKit-native benefit. To preserve agents.md's "every endpoint MUST classify AgentKit value" invariant and stay within what `createSellerService` supports today, we offer ToolRouter-funded free-trial uses. Per-endpoint `MonthlyAgentKitStorage` keyspaces ensure search/extract/task counters do not collide with each other or with Manus.

### D3. Generalize the async-task module rather than duplicate it
`apps/api/src/services/execution/async-task.ts` was explicitly written with N=1 in mind, deferring generalization until the second async endpoint arrived. That moment is now. We introduce an `AsyncTaskStrategy` shape that captures the Manus-specific pieces (endpoint id, dedupe key, task-row extraction, start-response builder, poll status normalization) and refactor `prepareManusAsyncTask`/`finalizeManusAsyncTask`/`abandonManusAsyncTask` into a single `prepareAsyncTask`/`finalizeAsyncTask`/`abandonAsyncTask` flow that takes a strategy. The two strategies (manus, parallel) live next to their respective seller modules. The Manus public read routes (`/v1/manus/tasks/...`) stay where they are for backward compatibility; new Parallel read routes mount at `/v1/parallel/tasks/:task_id/{status,result}`.

### D4. Per-URL pricing for `parallel.extract` is computed in the seller's `pricing(input)` callback
Parallel charges $0.01 per URL submitted to Extract (up to 20). The seller manifest's `pricing` function returns `(0.01 * urls.length) + 0.01` (USD), echoing the Manus depth-based pricing pattern. Buyer-side `estimatedUsd` in the builder uses the same formula.

### D5. `parallel.task` exposes `processor` as input with env-overridable per-processor pricing
Like Manus depth pricing, the processor enum (`lite | base | core | pro | ultra`) maps to a default USD amount (only `ultra=$0.30` is confirmed in docs; the rest are conservative defaults that admins can override via `TOOLROUTER_PARALLEL_TASK_PRICE_<PROCESSOR>_USD`). The seller's `pricing(input)` resolves the processor, looks up the configured/default price, adds the $0.01 markup.

### D6. Read endpoints (`/v1/parallel/tasks/:id/status|result`) use Parallel's free polling/result APIs
Parallel's task status and result lookups are free (no x402 charge). Our routes call `GET https://api.parallel.ai/v1/tasks/runs/{run_id}` and `GET https://api.parallel.ai/v1/tasks/runs/{run_id}/result` with the server-side `PARALLEL_API_KEY`. This mirrors `apps/api/src/sellers/manus/tasks.ts`.

---

## High-Level Technical Design

*Directional guidance for review, not implementation specification. Implementing agent should treat as context, not code to reproduce.*

### Async-task strategy seam (post-refactor)

```text
orchestrator.ts
  ├─ getAsyncTaskStrategy(endpoint) → strategy | null
  ├─ if strategy:
  │     prepareAsyncTask(strategy, ...) → { type: passthrough | deduped | reserved }
  │     executeEndpoint(...)            ← unchanged
  │     finalizeAsyncTask(strategy, ...) → returns provider-task start payload
  │     abandonAsyncTask(strategy, ...) on error
  └─ merge start payload into response

strategies/
  manus.ts     — wraps existing manus-tasks helpers
  parallel.ts  — implements same surface for Parallel runs
```

Each `AsyncTaskStrategy` exposes:
- `endpointId: string`
- `provider: string`
- `dedupeKey(auth, input)`
- `extractCreatedTask(body)` → `{ provider_task_id, status, task_url, title } | null`
- `normalizeStatus(value, fallback)` → normalized lifecycle status
- `startPayload(task, ctx)` → response body merged into orchestrator output
- `dedupedResponse(endpoint, existingTask, traceId)` → short-circuit response

### Seller request flow (per Parallel endpoint)

```text
agent → POST https://toolrouter.world/x402/parallel/search
         ├─ x402 challenge (or AgentKit free-trial use) at $0.02
         ├─ buyer pays USDC on Base via x402 facilitator
         └─ forward to https://api.parallel.ai/v1/search with x-api-key
         ← response (settled, HMAC matches body bytes)
```

---

## Implementation Units

### U1. Add `extract` category to router-core
**Goal:** Introduce the `extract` category metadata so endpoint manifests can declare it.
**Requirements:** Sprint-2 — "Extract which is a new category".
**Dependencies:** none
**Files:**
- `packages/router-core/src/endpoints/categories.ts`
**Approach:** Add a new entry `{ id: "extract", name: "Extract", description: "...", recommended_endpoint_id: "parallel.extract", use_cases: ["URL content extraction", "page content scraping", "fetch + structured excerpts"] }` between `data` and `compute` (or at the end). Decide ordering with an eye on dashboard category-tab order.
**Patterns to follow:** the existing `data` and `search` entries.
**Test scenarios:**
- Registry test: `listCategories()` includes `extract` with the right `recommended_endpoint_id` after U3 lands.
- `isEndpointCategory("extract")` returns true.
**Verification:** `tests/unit/endpoints/registry.test.mjs` passes with the new category id assertion.

### U2. Generalize async-task module behind an `AsyncTaskStrategy` interface
**Goal:** Refactor the Manus-only async-task helpers into a strategy-driven flow that can host both `manus.research` and `parallel.task`. Keep all existing Manus behavior unchanged.
**Requirements:** D3.
**Dependencies:** none (precedes U7)
**Files:**
- `apps/api/src/services/execution/async-task.ts` (refactor: rename to strategy-aware flow; export `prepareAsyncTask`, `finalizeAsyncTask`, `abandonAsyncTask`, `getAsyncTaskStrategyForEndpoint`)
- `apps/api/src/services/execution/strategies/manus.ts` (new — encapsulates Manus-specific extractors and dedupe-key construction by delegating to `services/manus-tasks.ts`)
- `apps/api/src/services/execution/orchestrator.ts` (update import + call sites)
- `apps/api/src/services/manus-tasks.ts` (no behavior change; export any internal helpers the strategy needs)
**Approach:**
- Introduce `AsyncTaskStrategy` shape per D3.
- `getAsyncTaskStrategyForEndpoint(endpoint)` returns the matching strategy or `null` (passthrough).
- Replace the three `Manus*`-named functions with generic equivalents that accept a strategy; orchestrator no longer hard-codes `MANUS_RESEARCH_ENDPOINT_ID`.
- Keep `manus-tasks.ts` as the canonical Manus helper module; the strategy file is a thin adapter.
**Patterns to follow:** the current Manus-only flow at `apps/api/src/services/execution/async-task.ts:46-167`.
**Test scenarios:**
- Existing Manus orchestrator tests still pass without modification (regression sentinel).
- New unit test: with a fake `AsyncTaskStrategy`, `prepareAsyncTask` dedupes, reserves, and short-circuits correctly. Same coverage shape as today's Manus tests.
- `getAsyncTaskStrategyForEndpoint("exa.search")` returns `null`; `getAsyncTaskStrategyForEndpoint("manus.research")` returns the manus strategy.
**Verification:** `npm test` green; no Manus integration regressions.

### U3. Add `parallel.search` endpoint manifest + builder
**Goal:** Register `parallel.search` in the router-core endpoint registry pointed at the first-party wrapper URL.
**Requirements:** Sprint-2 — Search support.
**Dependencies:** U1 (only soft — registry validator doesn't gate on category-side recommendation), U5 (the wrapper URL needs to exist at runtime; manifest just declares it)
**Files:**
- `packages/router-core/src/endpoints/search/parallel/search.ts` (new)
- `packages/router-core/src/endpoints/builders.ts` (add `buildParallelSearchRequest`, plus a `PARALLEL_SEARCH_BASE_PRICE_USD = 0.01` and `PARALLEL_MARKUP_USD = 0.01` constant)
- `packages/router-core/src/endpoints/registry.ts` (register the new manifest)
**Approach:**
- URL: `${TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world"}/x402/parallel/search`
- `agentkit_value_type: "free_trial"`, label `AgentKit-Free Trial`
- `estimated_cost_usd: 0.02`
- Builder validates `objective?`, `search_queries: string[]` (1-8, 3-6 words each), `mode?: "basic"|"advanced"` (default `"advanced"` per Parallel doc), `max_chars_total?`, returns `{ method, url, json, estimatedUsd: "0.02" }`.
- `fixture_input`, `health_probe`, `agentkit_health_probe`, `live_smoke` mirror `exa.search` structure with sample queries.
**Patterns to follow:** `packages/router-core/src/endpoints/search/exa/search.ts`.
**Test scenarios:**
- `validateRegistry()` passes.
- `buildEndpointRequest("parallel.search", fixtureInput).estimatedUsd === "0.02"`.
- Builder rejects empty `search_queries`, missing required field; accepts both `search_queries` and `searchQueries` aliases.
- Health probe `maxUsd === "0.03"` (small cushion above wrapper price); `paymentMode === "x402_only"`.
- Registry listing includes `parallel.search` under the `search` category.
**Verification:** `tests/unit/endpoints/registry.test.mjs` + a new builder-validation block pass.

### U4. Add `parallel.extract` endpoint manifest + builder
**Goal:** Register `parallel.extract` in the registry under the new `extract` category.
**Requirements:** Sprint-2 — Extract as new category and primary.
**Dependencies:** U1, U6
**Files:**
- `packages/router-core/src/endpoints/extract/parallel/extract.ts` (new — first endpoint in the `extract/` directory)
- `packages/router-core/src/endpoints/builders.ts` (add `buildParallelExtractRequest`, `parallelExtractPriceUsd(input)` helper)
- `packages/router-core/src/endpoints/registry.ts` (register)
**Approach:**
- URL points at `/x402/parallel/extract`.
- Builder validates `urls: string[]` (1-20 https URLs), `objective?`, `search_queries?`, `max_chars_total?`, `advanced_settings?.full_content?`.
- Cost calculation: `0.01 * urls.length + 0.01` (markup once per call, not per URL).
- `estimated_cost_usd: 0.02` (single URL minimum).
- Fixture input: single URL.
**Patterns to follow:** `manus.research` for variable pricing, `exa.search` for URL validation in `readHttpsUrlArray`.
**Test scenarios:**
- Builder enforces 1-20 URLs, https-only, rejects malformed.
- Single-URL request `estimatedUsd === "0.02"`.
- Five-URL request `estimatedUsd === "0.06"`.
- `recommendEndpoint("extract")` returns `parallel.extract`.
- Registry listing has the new endpoint under `extract` category.
**Verification:** `tests/unit/endpoints/registry.test.mjs` extended.

### U5. Add `parallel.task` endpoint manifest + builder
**Goal:** Register `parallel.task` under `research` category, with processor-tiered pricing.
**Requirements:** Sprint-2 — Task follows Manus pattern.
**Dependencies:** U7 (the wrapper route needs to exist), U8 (async-strategy wiring)
**Files:**
- `packages/router-core/src/endpoints/research/parallel/task.ts` (new)
- `packages/router-core/src/endpoints/builders.ts` (add `PARALLEL_TASK_PROCESSORS`, `parallelTaskPriceForProcessor`, `buildParallelTaskRequest`)
- `packages/router-core/src/endpoints/registry.ts` (register)
**Approach:**
- URL points at `/x402/parallel/task`.
- Builder validates `processor: "lite"|"base"|"core"|"pro"|"ultra"` (default `"ultra"` for MVP — only confirmed price), `input: string | object`, `metadata?`, `task_spec?`, `source_policy?`, `webhook?`.
- Price per processor (defaults, env-overridable): lite `$0.015`, base `$0.02`, core `$0.035`, pro `$0.11`, ultra `$0.31` (all include $0.01 markup).
- Env keys follow `TOOLROUTER_PARALLEL_TASK_PRICE_<PROCESSOR>_USD` pattern (mirror Manus).
- `agentkit_value_type: "free_trial"`, label `AgentKit-Free Trial`.
**Patterns to follow:** `manus.research` (variable pricing via depth lookup, async-pattern manifest).
**Test scenarios:**
- Builder rejects unknown processor.
- Each processor maps to its expected `estimatedUsd`.
- Env override `TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD=0.05` propagates into builder output.
- `recommendEndpoint("research")` still returns `manus.research` (Parallel does NOT take over).
- Registry validation accepts the manifest.
**Verification:** `tests/unit/endpoints/registry.test.mjs` extended.

### U6. Add Parallel seller wrappers (search, extract, task)
**Goal:** Wire three first-party x402 seller services that settle on Base, then forward to Parallel's standard API with the server-side API key.
**Requirements:** D1, D4, D5.
**Dependencies:** none (U3-U5 declare URLs; the wrappers fulfill them)
**Files:**
- `apps/api/src/sellers/parallel/index.ts` (new — exports three manifests + factory functions)
- `apps/api/src/sellers/parallel/upstream.ts` (new — `forwardParallelSearch/Extract/Task`, `safeUpstreamError`, shared facilitator config helper that delegates to the same Coinbase config as Manus)
- `apps/api/src/sellers/parallel/pricing.ts` (new — `parallelSearchPriceUsd`, `parallelExtractPriceUsd`, `parallelTaskPriceUsd`)
- `apps/api/src/sellers/parallel/tasks.ts` (new — `getParallelTaskRun`, `getParallelTaskResult` for the read-only routes)
- `apps/api/src/routes/sellers.routes.ts` (register Parallel sellers alongside Manus — extend the eager/lazy boot logic to handle multiple sellers)
- `apps/api/src/app.ts` (import + thread Parallel deps if needed; consider exposing `parallelFetch?: typeof fetch` parallel to `manusFetch`)
**Approach:**
- Three `SellerManifest` entries with `secrets: ["PARALLEL_API_KEY"]`.
- Pricing functions exact match to D4/D5.
- `pay_to_env_order` follows Manus precedence (`X402_PARALLEL_PAY_TO_ADDRESS`, then `X402_PAY_TO_ADDRESS`, then Crossmint treasury/health/live).
- `upstream.url` per endpoint:
  - search → `https://api.parallel.ai/v1/search`
  - extract → `https://api.parallel.ai/v1/extract`
  - task → `https://api.parallel.ai/v1/tasks/runs`
- `headers_factory` returns `{ "content-type": "application/json", "x-api-key": secrets.PARALLEL_API_KEY }`.
- `body_factory` for each: pass through validated input from the buyer body, dropping payment-control fields.
- AgentKit modes: `{ type: "free_trial", uses: 5, window: "monthly" }` for search/extract; `{ type: "free_trial", uses: 1, window: "monthly" }` for task.
- `MonthlyAgentKitStorage` keyspace = `"parallel.search"`, `"parallel.extract"`, `"parallel.task"` (per-endpoint so counters don't collide).
- For task: forward returns Parallel's `{ run_id, ... }` body; the orchestrator's async-task finalizer (U8) reads `run_id` and reserves a row.
**Patterns to follow:** `apps/api/src/sellers/manus/{index,upstream,pricing,tasks}.ts` for all four files.
**Test scenarios:**
- Boot-time secret validation: missing `PARALLEL_API_KEY` throws `parallel_search_parallel_api_key_required` (and equivalents for extract/task).
- Each seller answers the unpaid 402 with the manifest's unpaid response body.
- Settled response: forwarder forwards body + sets settlement headers + writes the HMAC'd response bytes (mirror Manus's serialize-once pattern at `apps/api/src/sellers/createSellerService.ts:262-279`).
- Pricing functions correct for sample inputs (single URL extract = `0.02`, 5-URL extract = `0.06`, ultra task = `0.31`).
- Upstream 401/429/5xx → 502/429 with `safeUpstreamError("Parallel ...")`.
**Verification:** existing seller integration tests still pass; new Parallel seller tests pass.

### U7. Wire Parallel sellers into `createApiApp` registration
**Goal:** Boot the three Parallel sellers alongside Manus with the same eager-init opt-in behavior and lazy fallback for tests.
**Requirements:** consistency with Manus boot pattern.
**Dependencies:** U6
**Files:**
- `apps/api/src/routes/sellers.routes.ts`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
**Approach:**
- Extend `SellerRoutesOpts` to accept an iterable of seller factories (or hardcode the three Parallel ones alongside Manus).
- `eagerSellerInit` still triggers the production fail-fast path for *all* sellers; the lazy default path stays unchanged for tests that omit `PARALLEL_API_KEY`.
- Add `parallelFetch?: typeof fetch` deco if test injection of upstream HTTP is needed (mirror `manusFetch`).
**Patterns to follow:** the existing Manus DI pattern in `app.ts` and `sellers.routes.ts`.
**Test scenarios:**
- `createApiApp({})` boots without `PARALLEL_API_KEY` in env (lazy mode).
- `createApiApp({ eagerSellerInit: true })` with `MANUS_API_KEY` set but `PARALLEL_API_KEY` missing → `parallel_search_parallel_api_key_required` thrown synchronously.
- All three `/x402/parallel/*` routes serve 402 challenges on unauth GETs (or 404/405 on GET, 402 on POST without payment header).
**Verification:** API server starts locally; existing Manus integration tests still pass.

### U8. Implement `parallelTaskStrategy` and wire orchestrator
**Goal:** Hook Parallel's task creation into the generalized async-task flow so dedupe, reservation, and start-payload generation work the same way Manus does.
**Requirements:** D3, parity with Manus async flow.
**Dependencies:** U2 (generalized flow), U5 (endpoint registered), U6 (wrapper forwards correctly)
**Files:**
- `apps/api/src/services/execution/strategies/parallel.ts` (new)
- `apps/api/src/services/parallel-tasks.ts` (new — helpers analogous to `services/manus-tasks.ts`: dedupe-key construction, task-row builder, status normalization, start payload shape, deduped response)
- `apps/api/src/services/execution/async-task.ts` (register the parallel strategy alongside manus)
**Approach:**
- `parallelTaskStrategy.endpointId = "parallel.task"`, provider `"parallel"`.
- `dedupeKey` hashes `{ user_id, endpoint_id, processor, normalized_input }`.
- `extractCreatedTask(body)` reads Parallel's `{ run_id, status, ... }` → maps to `{ provider_task_id: run_id, status, task_url: null, title: null }`.
- `normalizeStatus`: maps Parallel's `queued|running|action_required|completed|failed|cancelled` → ToolRouter's `running|waiting|stopped|error`.
- Start-payload builder emits `next_mcp_tools = { status: "parallel_task_status", result: "parallel_task_result" }` and `next_api_routes = { status: "/v1/parallel/tasks/<id>/status", result: "/v1/parallel/tasks/<id>/result" }`.
**Patterns to follow:** `services/manus-tasks.ts` and `services/execution/async-task.ts`.
**Test scenarios:**
- Dedupe: two identical `parallel.task` calls in the same window short-circuit on the second with `deduped: true`.
- Force-new: `force_new: true` bypasses dedupe.
- Stale reservation (provider_task_id null past expiry) is recoverable on retry.
- `extractCreatedTask({ run_id: "run-abc", status: "queued" }) → { provider_task_id: "run-abc", status: "queued" }`.
- `normalizeStatus("action_required") === "waiting"`, `normalizeStatus("completed") === "stopped"`, `normalizeStatus("failed") === "error"`.
- Orchestrator finalizer correctly inserts/updates `endpoint_task` row.
**Verification:** `npm test` green including the new parallel strategy tests; orchestrator integration test with a stub Parallel forwarder covers happy + force_new + deduped paths.

### U9. Add `/v1/parallel/tasks/:task_id/{status,result}` routes
**Goal:** Mirror `/v1/manus/tasks/...` for Parallel runs so MCP and dashboard clients can poll task state.
**Requirements:** D6.
**Dependencies:** U6 (task forwarding), U8 (strategy + helper module)
**Files:**
- `apps/api/src/routes/requests.routes.ts` (add the two new routes alongside the Manus ones)
**Approach:**
- `GET /v1/parallel/tasks/:task_id/status` — authenticate, look up owned `endpoint_task`, call `getParallelTaskRun(provider_task_id)`, update row via shared `updateEndpointTaskFromDetail` (extend to accept a strategy or split into `updateManusEndpointTask` + `updateParallelEndpointTask`).
- `GET /v1/parallel/tasks/:task_id/result` — same auth, call `getParallelTaskResult`, return normalized result payload.
- Reuse `findEndpointTaskByTaskId` with `endpoint_id: "parallel.task"`.
**Patterns to follow:** the existing Manus routes at `apps/api/src/routes/requests.routes.ts:66-91`.
**Test scenarios:**
- 404 when caller doesn't own the task id (cross-account access denied).
- 404 for unknown task id.
- Status endpoint surfaces `running|waiting|stopped|error` normalized.
- Result endpoint returns `{ task_id, status, final_answer_available, answer, ... }` matching the Manus result-shape contract.
- 502 wrapping on Parallel 5xx; preserves Parallel error body on 4xx.
**Verification:** integration tests with stubbed `parallelFetch` cover both routes.

### U10. Update MCP server to expose Parallel tools
**Goal:** Add `parallel_search`, `parallel_extract`, `parallel_task_start`, `parallel_task_status`, `parallel_task_result` tools to the published MCP package so agents can discover and call them.
**Requirements:** parity with how Exa/Manus surface in the MCP package.
**Dependencies:** U3-U5 (endpoint manifests), U9 (status/result API routes)
**Files:**
- `apps/mcp/scripts/build-endpoints.mjs` (add Parallel wirings to `MCP_TOOL_DEFINITIONS` and `PROVIDER_LOGO_PATHS`)
- `apps/mcp/src/server.ts` (add `parallel_task_status`/`parallel_task_result` tools; reuse the start-result helper; add `extract` input kind and `task` input kind)
- `packages/router-core/src/manifest/schema.ts` (only if the snapshot needs new fields — likely no change)
**Approach:**
- New input kinds: `extract` (urls array + advanced opts) and `parallel_task` (processor + input string/object).
- For `parallel_task_start`, follow Manus's structured-content + `next_mcp_tools` / `next_api_routes` shape so agents get the same async-task lifecycle hints.
- MCP descriptions for start: include "one call creates one task; do not retry by creating more tasks" per agents.md.
- Default `maxUsd` for `parallel_task_start` resolved from `TOOLROUTER_PARALLEL_TASK_PRICE_<PROCESSOR>_USD` env or the manifest fallback.
- Generic `toolrouter_call_endpoint` schema gains `processor` enum and remains backward compatible.
**Patterns to follow:** `apps/mcp/src/server.ts:208-225` (research kind) and `manusResearchStartResult`/`manusResearchStatusResult`/`manusResearchFinalResult`.
**Test scenarios:**
- `tools/list` includes the new Parallel tools.
- `parallel_task_start` returns a `task_id` and `next_mcp_tools`.
- `parallel_task_status` calls `/v1/parallel/tasks/.../status` with the stubbed router fetch.
- `parallel_task_result` formats `running`/`waiting`/`stopped`/`error` text correctly.
- `parallel_search` input rejects missing `search_queries`.
- `parallel_extract` input rejects empty `urls` array.
- `dist/endpoints.json` regenerates deterministically.
**Verification:** `npm --workspace @worldcoin/toolrouter run build-endpoints` succeeds; MCP unit tests pass.

### U11. Add Parallel provider logo and dashboard wiring
**Goal:** Show the Parallel logomark next to Parallel endpoints on the landing page and dashboard.
**Requirements:** "Provider logos are part of endpoint onboarding" (agents.md).
**Dependencies:** U3-U5 (provider="parallel" in manifests)
**Files:**
- `apps/web/public/parallel-logomark.svg` (new — small SVG mark sourced from Parallel's brand assets)
- `apps/web/lib/provider-logos.ts` (add `parallel: "/parallel-logomark.svg"`)
- `apps/mcp/scripts/build-endpoints.mjs` (`PROVIDER_LOGO_PATHS.parallel = "/parallel-logomark.svg"`)
**Approach:** copy a Parallel logomark SVG (the user can supply the asset; if not, use a placeholder filename and note in the implementation comment that the asset is pending).
**Patterns to follow:** the existing Exa/Manus/Browserbase logomarks.
**Test scenarios:**
- `providerLogoPath("parallel") === "/parallel-logomark.svg"`.
- Snapshot dashboard tests still pass.
**Verification:** landing page renders all five providers (browserbase, exa, manus, parallel — three endpoints from Parallel collapse on one provider name) without missing icons.

### U12. Deterministic test coverage end-to-end
**Goal:** Add and update unit/integration tests so registry, MCP, executor, and async-task flows all stay green.
**Requirements:** agents.md testing checklist for new endpoints.
**Dependencies:** U1-U11
**Files:**
- `tests/unit/endpoints/registry.test.mjs` (extend with Parallel cases)
- `tests/unit/endpoints/manifest.test.mjs` (add new snapshot entries)
- `tests/unit/sellers/parallel-*.test.mjs` (new — boot validation, pricing, forwarding, error mapping)
- `tests/unit/services/execution/async-task.test.mjs` (new or extend — strategy generalization regression sentinel)
- `tests/unit/services/parallel-tasks.test.mjs` (new — helpers parity with `manus-tasks.test.mjs`)
- `tests/integration/api/parallel-tasks-routes.test.mjs` (new — `/v1/parallel/tasks/.../*`)
- `tests/integration/api/requests-parallel.test.mjs` (new — `POST /v1/requests` path for each Parallel endpoint)
- `tests/unit/mcp/parallel.test.mjs` (new — MCP tool list + tool calls)
**Approach:**
- All tests deterministic; no network. Stub `parallelFetch` and the facilitator client.
- Reuse existing testing helpers (`assertEndpointFixtureBuilds`, `assertEndpointHealthProbeBuilds`).
- New static test: every Parallel endpoint manifest passes `validateEndpoint`.
**Patterns to follow:** existing Manus test layout and stub strategies.
**Test scenarios:** all the per-unit scenarios above, plus:
- API-key billing math: paid Parallel call writes the correct `credit_captured_usd`.
- Trace path `agentkit` when AgentKit free-trial succeeds (charged=false), `agentkit_to_x402` when it falls through.
- Free-trial counter increments and resets monthly.
- `GET /v1/status` exposes Parallel endpoints with safe metadata.
**Verification:** `npm run type-check` and `npm test` pass clean.

### U13. Opt-in live smoke tests for Parallel endpoints
**Goal:** Add live-path smoke tests gated by `RUN_LIVE_PARALLEL_TESTS=true` so production deploys can validate end-to-end without spending money in CI.
**Requirements:** agents.md live-test conventions.
**Dependencies:** U6, U9
**Files:**
- `tests/live/endpoints/parallel-search.test.mjs` (new)
- `tests/live/endpoints/parallel-extract.test.mjs` (new)
- `tests/live/endpoints/parallel-task.test.mjs` (new — async; create + poll + result)
- `tests/live/mcp/parallel.test.mjs` (new — same flows over the MCP route)
- `package.json` (extend `test:live:endpoints` script if needed; add `RUN_LIVE_PARALLEL_*` gates to README)
**Approach:**
- Default path: `agentkit_first` with strict `maxUsd` caps matching fixture.
- Paid path: `x402_only` for forced settlement smoke, gated by `RUN_LIVE_PARALLEL_PAID_SMOKE=true`.
- Task live smoke: create task with shortest processor (`lite` or `core`), poll until `stopped` or 60s elapse, fetch result — soft-assert structure not exact contents.
- Skip when `PARALLEL_API_KEY` is missing.
**Patterns to follow:** `tests/live/endpoints/manus-*.test.mjs` and `tests/live/endpoints/exa-*.test.mjs`.
**Test scenarios:**
- Live smoke `parallel.search` succeeds and stays under `maxUsd`.
- Live smoke `parallel.extract` returns content for a stable test URL (e.g. `https://example.com`).
- Live smoke `parallel.task` lifecycle: start → status running → result eventually returns.
- All live tests cap spend at fixture `maxUsd`.
**Verification:** `RUN_LIVE_PARALLEL_TESTS=true PARALLEL_API_KEY=... npm run test:live:endpoints` succeeds when env is configured; otherwise tests skip cleanly.

### U14. Documentation and README updates
**Goal:** Surface the new endpoints, category, and env vars in the repo's public-facing docs.
**Requirements:** keep onboarding accurate.
**Dependencies:** U1-U13
**Files:**
- `README.md` (add `parallel.search`, `parallel.extract`, `parallel.task` to launch endpoints; add `RUN_LIVE_PARALLEL_*` to live-tests notes; reference `PARALLEL_API_KEY`)
- `agents.md` (add a "Parallel decisions" section under the existing per-provider sections covering URL, pricing, AgentKit value, env vars)
- `docs/deployment-hosting.md` (only if new env vars need documenting beyond what's in agents.md)
**Approach:** keep additions short and consistent with the existing per-provider sections.
**Test scenarios:** N/A — `Test expectation: none -- docs-only change`.
**Verification:** read-through; no broken anchors.

---

## System-Wide Impact

| Surface                              | Impact                                                                                  |
|--------------------------------------|-----------------------------------------------------------------------------------------|
| `POST /v1/requests`                  | Adds three new `endpoint_id` values; async-task flow extends to handle `parallel.task`. |
| `GET /v1/endpoints`, `/v1/categories`| New `extract` category appears with `parallel.extract` recommended.                     |
| `GET /v1/status`                     | Three new health-checked endpoints in the status payload.                               |
| `/x402/parallel/{search,extract,task}` | Three new first-party seller routes — boot fails if `PARALLEL_API_KEY` is missing in eager mode. |
| `/v1/parallel/tasks/:id/{status,result}` | New read routes for async task polling.                                          |
| MCP package `@worldcoin/toolrouter`  | New tools and updated `dist/endpoints.json` schema; deterministic codegen.              |
| Dashboard + landing page             | New provider logomark, three new endpoint rows, optional `Extract` category tab.        |
| `MonthlyAgentKitStorage` keyspaces   | Three new per-endpoint counter keyspaces: `parallel.search`, `parallel.extract`, `parallel.task`. |
| Env vars                             | New: `PARALLEL_API_KEY` (required for sellers), `TOOLROUTER_PARALLEL_TASK_PRICE_<PROCESSOR>_USD` (override), `X402_PARALLEL_PAY_TO_ADDRESS` (optional). |
| Supabase `requests` + `endpoint_tasks` | Existing schema accommodates new endpoint ids; no migration required.                 |

---

## Risks and Mitigations

| Risk                                                                 | Mitigation                                                                          |
|----------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| Async-task generalization breaks existing Manus flow                 | Treat U2 as a behavior-preserving refactor; keep all existing Manus tests as regression sentinels; do not change orchestrator semantics. |
| Parallel processor pricing inaccurate for non-ultra tiers            | Default to `ultra` for MVP; expose env-var overrides; document in agents.md that operator must verify before enabling. |
| `createSellerService` does not support `access`/`discount` AgentKit modes | Use `free_trial` (the only currently-supported mode) for all three Parallel endpoints with explicit per-endpoint usage caps; revisit when upstream support lands. |
| Boot fails in production if `PARALLEL_API_KEY` is unset              | Use the existing eager-init opt-in pattern; tests + local dev stay on the lazy path; deployment runbook update required. |
| Logomark asset not available at implementation time                  | Implementation can ship with a placeholder SVG that matches existing logomark dimensions; document the swap in U11. |
| Buyer-side `estimatedUsd` mismatches seller `pricing(input)` output  | Use the same `*PriceUsd` helpers in both `packages/router-core/src/endpoints/builders.ts` and `apps/api/src/sellers/parallel/pricing.ts` (re-export or duplicate carefully and unit-test parity). |
| Free-trial counter race under concurrent requests                    | `MonthlyAgentKitStorage.tryIncrementUsage` already uses atomic `cache.increment`; reuse unchanged. |

---

## Verification Strategy

- `npm run type-check` — clean.
- `npm test` — deterministic suite green; new tests for every Parallel endpoint and the async-task strategy refactor.
- `npm --workspace @toolrouter/web run build` — Next build passes; landing page renders Parallel endpoints.
- `npm --workspace @worldcoin/toolrouter run build-endpoints` — manifest regenerates with the new entries.
- Manual local smoke: start the API with `PARALLEL_API_KEY` set, POST `/v1/requests` with `endpoint_id: "parallel.search"`, observe trace, confirm settlement and credit capture.
- Opt-in `RUN_LIVE_PARALLEL_TESTS=true npm run test:live:endpoints` exercises real Parallel calls bounded by `maxUsd`.

---

## Open Questions Deferred to Implementation

- Exact Parallel logomark SVG asset — user to supply or fallback to a placeholder.
- Whether `parallel_search` should ever surface as the recommended endpoint for `search` (currently `exa.search`). Defer until uptime data is comparable.
- Whether to expose `parallel_task` processors other than `ultra` in MCP `tools/list`. Default: expose enum, but document `ultra` as the validated price.
- Async-task generalization is a refactor; if reviewers want to keep N=1 specialization, the parallel strategy can be implemented inline alongside Manus without the shared abstraction — keep this fallback path in mind during U2 review.
