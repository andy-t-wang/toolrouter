// Declarative endpoint manifest — single source of truth for endpoint metadata.
//
// Each endpoint module exports a frozen object satisfying `EndpointManifest`.
// `materializeEndpoint` in registry.ts derives the runtime `MaterializedEndpoint`
// shape (with normalized field names + buildRequest closure) from the manifest;
// the executor and health worker consume the materialized form.
//
// The published MCP package gets a derived JSON snapshot at prepack time (U2).
// The dashboard and landing page read from the same source.

export type AgentkitValueType = "free_trial" | "discount" | "access";
export type PaymentMode = "agentkit_first" | "agentkit_only" | "x402_only";

export type EndpointMethod = "GET" | "POST";

// Runtime validators (`packages/router-core/src/testing/endpointHarness.ts`)
// enforce the discriminated values for `mode` and `payment_mode`. The TS
// types use widened strings so `Object.freeze({...})` literals satisfy the
// type without forcing every nested field through `as const`.

export interface EndpointHealthProbe {
  mode: string;
  payment_mode: string;
  max_usd: string;
  interval_ms?: number;
  intervalMs?: number;
  latency_budget_ms?: number;
  timeout_ms?: number;
  required_env?: readonly string[];
  input: Record<string, unknown>;
}

export interface EndpointAgentkitHealthProbe {
  mode: string;
  payment_mode: string;
  max_usd: string;
  latency_budget_ms?: number;
  timeout_ms?: number;
  input: Record<string, unknown>;
}

export interface EndpointLiveSmokePath {
  payment_mode: string;
  max_usd: string;
  input: Record<string, unknown>;
}

export interface EndpointLiveSmoke {
  default_path: EndpointLiveSmokePath;
  paid_path: EndpointLiveSmokePath;
}

export interface EndpointUiMetadata {
  badge: string;
  fixture_label?: string;
  primaryField?: string;
  fieldOrder?: readonly string[];
}

/**
 * The builder is provided per-endpoint and returns a normalized provider
 * request object (`{ method, url, json, headers?, estimatedUsd }`). The
 * declarative manifest stores the function reference; the runtime form
 * exposes `buildRequest(input)` that calls the builder with the manifest as
 * context.
 */
export type EndpointBuilder = (input: any, manifest: EndpointManifest) => unknown;

export interface EndpointManifest {
  /** Stable provider-prefixed identifier (e.g., `exa.search`). */
  readonly id: string;
  /** Provider identifier — string for backwards compat with the existing
   *  modules; a future richer `{ id, name, logo_path }` shape may also be
   *  accepted by readers. */
  readonly provider: string;
  /** Endpoint category — one of the MVP categories declared in
   *  `packages/router-core/src/endpoints/categories.ts`. */
  readonly category: string;
  readonly name: string;
  readonly description: string;
  /** HTTPS URL of the upstream endpoint. */
  readonly url: string;
  /** HTTP method for the provider request. */
  readonly method: EndpointMethod;
  /** Whether the provider endpoint supports AgentKit. */
  readonly agentkit: boolean;
  /** Whether the provider endpoint supports x402. */
  readonly x402: boolean;
  /** Whether the endpoint requires an `agentkit` SIWE header alongside x402
   *  payment (Browserbase = true). */
  readonly agentkit_proof_header?: boolean;
  /** Cost estimate in USD (used for spend caps and UI). */
  readonly estimated_cost_usd: number;
  readonly agentkit_value_type: AgentkitValueType | null;
  readonly agentkit_value_label: string | null;
  readonly default_payment_mode?: string;
  readonly ui: EndpointUiMetadata;
  readonly fixture_input: Record<string, unknown>;
  readonly health_probe: EndpointHealthProbe;
  readonly agentkit_health_probe?: EndpointAgentkitHealthProbe;
  readonly live_smoke: EndpointLiveSmoke;
  readonly builder: EndpointBuilder;
}

/**
 * The runtime form of an endpoint, produced by `materializeEndpoint`. The
 * executor and health worker consume this shape. Field names use camelCase
 * (`healthProbe`, `agentkitHealthProbe`, `liveSmoke`, `fixtureInput`,
 * `defaultPaymentMode`, `buildRequest`) regardless of the manifest's snake_case.
 *
 * Materialization is one-way: an `EndpointManifest` derives exactly one
 * `MaterializedEndpoint`. The materialized form is what tests and downstream
 * consumers should rely on; the manifest is the authoring surface.
 */
export interface MaterializedEndpoint extends EndpointManifest {
  readonly enabled: true;
  readonly defaultPaymentMode: string;
  readonly fixture: {
    readonly input: Record<string, unknown>;
    readonly maxUsd: string;
  };
  readonly fixtureInput: Record<string, unknown>;
  readonly healthProbe: EndpointHealthProbe & {
    readonly maxUsd: string;
    readonly paymentMode: string;
    readonly intervalMs?: number;
    readonly latencyBudgetMs?: number;
    readonly timeoutMs?: number;
  };
  readonly agentkitHealthProbe: (EndpointAgentkitHealthProbe & {
    readonly maxUsd: string;
    readonly paymentMode: string;
    readonly latencyBudgetMs?: number;
    readonly timeoutMs?: number;
  }) | null;
  readonly liveSmoke: EndpointLiveSmoke;
  readonly buildRequest: (input: Record<string, unknown>) => unknown;
}
