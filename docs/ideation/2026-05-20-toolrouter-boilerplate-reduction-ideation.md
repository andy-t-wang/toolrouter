---
date: 2026-05-20
topic: toolrouter-boilerplate-reduction
focus: reduce per-tool code volume now that N=2 redundancy exists in search (Exa + Parallel) and research (Manus + Parallel)
mode: repo-grounded
---

# Ideation: Reducing ToolRouter Per-Tool Boilerplate

## Grounding Context

ToolRouter is a TypeScript/Node ESM monorepo (Fastify API, npm workspaces, node:test) routing AgentKit-first x402 endpoint calls through `POST /v1/requests` and a published MCP package. After sprint-2 added Parallel (search, extract, task) the duplication is now measurable across providers — N=2 in two categories means the refactor plan's deferral rationale ("generalizing off N=1 risks baking the wrong abstraction") no longer applies in search and research.

**Empirical duplication (line-count evidence):**

- Endpoint manifest files: **68-76 LOC each, 18 fields identical** across 6 endpoints
- Per-seller manifests: **11 fields identical** across 4 sellers; Parallel cloned 3× internally
- `createManusFacilitatorConfig` is **byte-equivalent** to `createParallelFacilitatorConfig` (29 lines, one error string differs)
- `safeManusError` / `safeParallelError` are 5-line clones
- Three Parallel upstream forwarders share identical shape (the `stripControlFields` 422 fixed on 2026-05-20 hit all three simultaneously because they were copy-pasted)
- `services/manus-tasks.ts` (493 LOC) vs `services/parallel-tasks.ts` (363 LOC) — **60% field overlap, 100% identical control flow** in `reserveDedupeTask` / `expireDedupeTask` / `updateEndpointTaskFromDetail` / `taskPublicFields`
- `apps/api/src/routes/requests.routes.ts`: `requireOwnedManusTask` + status/result routes vs `requireOwnedParallelTask` + status/result routes — function bodies are clones
- `apps/mcp/src/server.ts` (1091 LOC): `manusResearchStartResult` (lines 743-790) vs `parallelTaskStartResult` (lines 661-707) are 45-line near-twins
- `apps/mcp/scripts/build-endpoints.mjs`: `MCP_TOOL_DEFINITIONS` hand-curated per endpoint (~50 LOC); enforced to stay in sync with the registry via a runtime check

**Refactor plan deferrals (`docs/plans/2026-05-19-001-refactor-modularity-and-reliability-plan.md`):**

- **U9 "Async-task lifecycle generalization"** — explicitly deferred until N=2: "generalizing off N=1 (only Manus) risks baking the wrong abstraction." N=2 is now achieved.
- U4 (idempotency-key infrastructure) and U5 (same-request settle retry) — deferred for lack of demand. Stay deferred.

**N=1 vs N=2 status:**

- Categories with ≥2 providers: **search** (Exa + Parallel), **research** (Manus + Parallel)
- Still N=1: **extract** (Parallel only), **browser_usage** (Browserbase only)

**External prior art surveyed** (none cited as `direct:` basis below — included as supporting `external:`):
Zapier resource schema, n8n declarative nodes, Pipedream `common.js` inheritance, FastMCP OpenAPI codegen, Vercel AI SDK `createProviderRegistry`, Composio `toolkits.json`, Inngest 3-primitive model, Trigger.dev polling primitive, Passport.js strategy contract, Kubernetes Operator/CRD pattern, Prisma schema.prisma codegen.

## Topic Axes

1. Manifest layer (endpoint + seller field duplication, validation, registry)
2. Async-task lifecycle (manus-tasks.ts vs parallel-tasks.ts; generalize behind strategy seam)
3. Wrapper plumbing (facilitator config, error mappers, upstream forwarders, request routes)
4. MCP surface generation (result renderers, pricing helpers, dist codegen)
5. Provider onboarding workflow (what does adding provider #4 look like end-to-end)

## Ranked Ideas

### 1. Unblock U9: strategy-driven async-task core
**Description:** Collapse `services/manus-tasks.ts` (493 LOC) and `services/parallel-tasks.ts` (363 LOC) into one `services/asyncTaskCore.ts` parameterized by an `AsyncProviderConfig { id, provider, ttlMs, pollAfterSeconds, mcpToolNames, urlPrefix, normalizeInput, normalizeStatus, extractCreatedTask, parseTaskDetail, parseResultPayload }`. Each provider becomes ~50 LOC of pure mappers. The `AsyncTaskStrategy` seam at `services/execution/async-task.ts` already proved the abstraction; the per-provider files are now the duplication site.
**Axis:** Async-task lifecycle
**Basis:** `direct:` — `manus-tasks.ts:41-49` (`stableJson`), `:396-398` (`isConflictError`), `:400-431` (`endpointTaskBase`), `:433-466` (`reserveManusDedupeTask`), `:468-477` (`expireManusDedupeTask`), `:379-394` (`updateEndpointTaskFromDetail`) are byte-equivalent to `parallel-tasks.ts:45-53`, `:213-215`, `:180-211`, `:217-250`, `:252-261`, `:263-278`. The `nextXApiRoutes` functions differ only by the literal `/v1/manus/` vs `/v1/parallel/` prefix.
**Rationale:** The plan explicitly waited for this. Adding provider #3 today means copying 363+ lines and renaming identifiers; every fix to dedupe (e.g. the stale-row retry on conflict) has to be applied twice and verified twice — a real drift risk now that the two `reserveDedupeTask` implementations could silently diverge.
**Downsides:** Touches the orchestrator's call sites in `services/execution/async-task.ts` and `services/execution/orchestrator.ts`. Migration order matters (Manus first since Parallel followed Manus's shape). Risk of getting the abstraction shape wrong even at N=2.
**Confidence:** 92%
**Complexity:** Medium
**Status:** Unexplored

### 2. MCP surface derives from the EndpointManifest
**Description:** Move `mcp: { tool_name, title, description, input_kind, default_max_usd }` onto `EndpointManifest` (next to `ui`). Delete the hand-curated `MCP_TOOL_DEFINITIONS` table in `apps/mcp/scripts/build-endpoints.mjs` and its synchronization guard. Collapse the clone result renderers in `server.ts` (`manusResearchStartResult` vs `parallelTaskStartResult` — 45-line twins) into one parameterized `renderAsyncTaskStart(taskDescriptor, data)` driven by per-endpoint descriptor. Same for `*StatusResult` / `*FinalResult`.
**Axis:** MCP surface generation
**Basis:** `direct:` — `apps/mcp/scripts/build-endpoints.mjs:39-100` defines `MCP_TOOL_DEFINITIONS` with one frozen literal per endpoint; the file's own comment admits this is "U2-managed per-endpoint metadata that's not yet on the EndpointManifest (deferred to a future manifest extension)." Lines 107-114 throw `build-endpoints: endpoint <id> has no MCP tool wiring` — the guard exists only because data lives in two places. `server.ts:661-707` (`parallelTaskStartResult`) vs `:743-789` (`manusResearchStartResult`) share 27 identical lines of `structuredContent` construction; lines 791-797 are 6-line clones.
**Rationale:** Adding endpoint #7 today means writing the manifest, writing a sibling `MCP_TOOL_DEFINITIONS` entry, regenerating `dist/endpoints.json`, *and* potentially patching `server.ts` for a custom renderer. The manifest already describes everything the MCP table needs except `tool_name` and `input_kind`. Provider #4's first endpoint should add zero lines to `server.ts`.
**Downsides:** `apps/mcp` is intentionally decoupled from `@toolrouter/router-core` (it ships as a standalone npm package). The build-time JSON snapshot is the seam; moving `mcp.*` onto the manifest expands that snapshot but doesn't violate the boundary. Requires care that the snapshot stays the only runtime dep.
**Confidence:** 88%
**Complexity:** Medium
**Status:** Unexplored

### 3. Share facilitator config + upstream forwarder primitive (quick win)
**Description:** Move `createFacilitatorConfig(manifest)` and `safeUpstreamError(status, providerLabel)` into `apps/api/src/x402/facilitator.ts` (or `createSellerService.ts`). Delete `createManusFacilitatorConfig` + `createParallelFacilitatorConfig` (29 LOC × 2). Delete `safeManusError` + `safeParallelError` (5 LOC × 2). The generic `forwardX402Upstream(manifest, ...)` reads URL + headers + body factory + control-field strip from the SellerManifest — per-provider `upstream.ts` files vanish for simple cases.
**Axis:** Wrapper plumbing
**Basis:** `direct:` — `apps/api/src/sellers/manus/upstream.ts:47-75` and `apps/api/src/sellers/parallel/upstream.ts:30-58` are byte-equivalent except for the literal "Manus" vs "Parallel" on the error line. `safeUpstreamError` (manus:115-120) and `safeParallelError` (parallel:60-65) are 5-line clones. The `stripControlFields` bug fixed on 2026-05-20 (422 from Parallel because string `input` was dropped) hit all three Parallel forwarders simultaneously because they were clones.
**Rationale:** Single most-clearly-justified deletion in the codebase — ~58 LOC eliminated for one shared function. PEM validation logic is exactly the kind of code that drifts silently. Last week's bug class is preventable.
**Downsides:** Touches the security-critical facilitator credential path; needs review that the generic version preserves Base-mainnet credential enforcement. Should land before any other refactor that touches these files (low conflict cost).
**Confidence:** 96%
**Complexity:** Low
**Status:** Unexplored

### 4. Promote `provider` to a typed registry object
**Description:** Define `ProviderRegistry.register({ id, name, logoPath, secrets, payToEnvOrder, errorLabel, mcpStorageKeyspace })`. Endpoint and seller manifests reference `provider` by id; the registry supplies the rest. SellerManifest drops `secrets` and `pay_to_env_order` (inherited from provider). `safeXError` collapses to one parameterized function. Dashboard logo lookup, MonthlyAgentKitStorage keyspace, and error labels all become registry reads.
**Axis:** Provider onboarding workflow
**Basis:** `direct:` — `packages/router-core/src/manifest/endpoint.ts:69-72` explicitly anticipates "a future richer `{ id, name, logo_path }` shape." Today "parallel" appears as a magic string across: endpoint manifests, seller manifests, `apps/web/lib/provider-logos.ts`, `MCP_TOOL_DEFINITIONS`, `MonthlyAgentKitStorage` keyspace literals, `PARALLEL_PAY_TO_ENV_ORDER`, `PARALLEL_SECRETS`, and `safeParallelError`. `sellers/parallel/index.ts:32-40` declares `PARALLEL_PAY_TO_ENV_ORDER` + `PARALLEL_SECRETS` at the top *because* they are shared across three seller manifests — i.e. they belong to a *provider*, not an endpoint.
**Rationale:** Provider #4 has to be added in 8+ places today because "provider" is not a thing — it's a string convention. A `ProviderRegistry.register({...})` call collapses that to one place and lets the type system catch typos (no more `"parallel"` vs `"Parallel"` drift).
**Downsides:** Cross-cutting refactor — touches manifests, sellers, MCP codegen, web app. Higher coordination cost than #1-3. Best landed *after* #1 / #3 so the touch points are already minimal.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 5. Unified `ProviderEndpoint` record: kill the buyer/seller manifest split
**Description:** Collapse `packages/router-core/src/manifest/endpoint.ts` (134 LOC, buyer-side) and `packages/router-core/src/manifest/seller.ts` (60 LOC, seller-side) into one `ProviderEndpoint` record with `public` (url, schema, pricing) and `private` (upstream, secrets, headers) sections. Buyer URL derives from seller `route` + base URL. Pricing moves to one place. The split is the largest hidden coupling tax in the codebase — composes with #1-#4 to make "new endpoint = one file" tractable.
**Axis:** Manifest layer
**Basis:** `direct:` — `manusSellerManifest.route = "/x402/manus/research"` and `manusResearchEndpointDefinition.url = "${base}/x402/manus/research"` are the same path, authored twice; they cannot diverge without breaking. `pricing` exists in both (`manusResearchPriceUsd` in sellers, `manusResearchPriceForDepth` in builders.ts). `reasoned:` the only true asymmetry between buyer and seller manifests is *secret material*, which is a tag on a field, not a separate document type.
**Rationale:** Halves per-endpoint config footprint. Removes the "I edited the endpoint and forgot to edit the seller" failure mode. The next sprint's third async provider becomes a 80-LOC unified record instead of editing both manifests + builders + pricing + seller index.
**Downsides:** Highest complexity / blast radius of the seven. Touches the router-core ↔ apps/api seam (the two packages currently have a clean boundary). Should land *after* #1-#4 reduce the touch points.
**Confidence:** 78%
**Complexity:** High
**Status:** Unexplored

### 6. Pricing as a declarative `tiers` table on the manifest
**Description:** Replace `apps/api/src/sellers/<provider>/pricing.ts`, the `MANUS_RESEARCH_DEPTHS` / `PARALLEL_TASK_PROCESSORS` enums in builders.ts, and the hand-keyed `manus_pricing` / `parallel_pricing` blocks in build-endpoints.mjs with one `pricing: { dimension: "depth"|"processor", tiers: { [name]: { defaultUsd, envVarOverride } }, markupUsd? }` field on the manifest. Seller, builder, MCP codegen, and dashboard all read from one source.
**Axis:** Manifest layer
**Basis:** `direct:` — `apps/mcp/scripts/build-endpoints.mjs:147-156` maintains both `enums.manus_depth` and `enums.parallel_processor` plus `manus_pricing` and `parallel_pricing` objects hand-keyed per provider; `apps/api/src/sellers/parallel/index.ts:92` passes `pricing: (input) => parallelTaskPriceUsd(input || {})` which wraps a `parallel/pricing.ts` table duplicating the same shape Manus has. Three synchronized sites; adding a tier requires four PR sites today.
**Rationale:** Pricing is the single most-edited per-provider knob; making it declarative pays off on every price tweak. Orthogonal to #1-5 — can land independently.
**Downsides:** Small surface change; mostly mechanical. No real downside if scoped to the three known sync sites.
**Confidence:** 82%
**Complexity:** Low
**Status:** Unexplored

### 7. `categories.ts` derives from manifests with a `recommended_rank` field
**Description:** Each ProviderEndpoint declares `category` + optional `recommended_rank` (default = last). `categoriesFromRegistry(endpoints)` groups by category and picks the top-ranked endpoint. Optional `recommended_for: ["agentkit_first" | "x402_only" | "lowest_price"]` lets the dashboard recommend per use case. Categories file becomes inert metadata (descriptions only).
**Axis:** Manifest layer
**Basis:** `direct:` — `packages/router-core/src/endpoints/categories.ts` hard-codes `recommended_endpoint_id: "exa.search"`, `"manus.research"`, `"browserbase.session"`, `"parallel.extract"`. With N=2 in search and research, "recommended" is a *ranking* problem now — and there's no policy in the file, just a stale single-string pin that has to be edited manually if Exa goes down or Parallel matures past Manus.
**Rationale:** Fixes a coupling-point bug waiting to happen (stale recommendation when N grows). Every future endpoint participates in category recommendations automatically.
**Downsides:** Tiny risk that the ranking field becomes a bikeshed; keep it scalar (integer) until ranking-policy demand is clear.
**Confidence:** 80%
**Complexity:** Low
**Status:** Unexplored

## Recommended Sequencing

1. **#3** first — low risk, byte-equivalent deletion, ~58 LOC gone, prevents the bug class that produced the 2026-05-20 Parallel `stripControlFields` 422.
2. **#1** next — the deferred U9. N=2 evidence is empirical; this unblocks the deliberate plan deferral.
3. **#6** + **#7** in any order — low complexity, orthogonal, can be standalone PRs.
4. **#2** + **#4** as a pair — both touch the MCP codegen story; #4 enables some of #2's collapse.
5. **#5** last — highest-leverage but highest-blast-radius. Benefits from #1-#4 landing first because the unified record is then a *projection* of work already done, not a green-field design.

## Rejection Summary

| # | Idea | Reason rejected |
|---|------|-----------------|
| 1 | Drop `/v1/<provider>/tasks/...` prefix entirely (one `/v1/tasks/:task_id/...` surface) | Scope overrun — breaks public URL contract; current pain doesn't justify. Auto-registering provider-prefixed routes (folded into #1) gets 90% of the win without the URL break. |
| 2 | One MCP family `task_start(endpoint_id, input)` instead of per-endpoint start/status/result triplets | Regresses agent discoverability — agents currently learn capability from tool name; one `task_start` requires a `list_endpoints` round-trip first. |
| 3 | Builders-as-JSON-templates | Too expensive vs value — builder TS functions are ~30 LOC each and do strict typed validation a JSON DSL would either lose or need a custom language for. |
| 4 | OpenAPI as source of truth (`pnpm gen` from provider spec) | Better handled as brainstorm later — speculative until N≥5 providers; Parallel/Manus don't publish complete-enough specs today. |
| 5 | YAML manifest replaces TS | Duplicates #5 — TS-vs-YAML is secondary to "single declaration"; TS gives builder function references YAML can't. |
| 6 | Emit canonical `openapi.json` from registry | Sequencing — depends on #5 (unified record) landing first; downstream play, not a current win. |
| 7 | x402-is-free flip / payment-mode in middleware | Subject-replacement risk — rearchitects executor payment plumbing, not boilerplate reduction. |
| 8 | Prisma `schema.prisma` DSL → 6 artifacts | Heavyweight codegen pipeline more than N=2 justifies. |
| 9 | GPCR pattern / VST manifest / action.yml / browser-extension manifest | Gestural metaphors without payload beyond what #5 already proposes. |
| 10 | Smoke-matrix macros | Below standalone ambition floor — folds into #5 cleanup. |
| 11 | Stripe Connect capabilities array / Passport.js ProviderStrategy class | Duplicates #4 (provider registry) or #5 (unified record). |
| 12 | `ExecutionResult` shared envelope (HTTP + MCP) | Partially solved — orchestrator already shapes a shared envelope. |
| 13 | Single response-envelope contract (`{ ok, body, async_task? }`) for all seller upstreams | Folds into #1 — the async-task strategy already implies the envelope. |
