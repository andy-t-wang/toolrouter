// Declarative seller-service manifest — the second template ToolRouter ships
// alongside the buyer-side endpoint manifest.
//
// Consumed by `apps/api/src/sellers/createSellerService.ts` (U7) to register a
// first-party x402 seller route. Manus is the first instance; the structure is
// sized to host future first-party services as peers.
//
// The `secrets: string[]` field declares required env vars validated at boot
// (not at request time) so a misconfigured production deploy fails fast instead
// of accepting payments and then 503ing on the upstream call.

import type { AgentkitValueType } from "./endpoint.ts";

export interface SellerAgentkitMode {
  readonly type: AgentkitValueType;
  /** Maximum free uses per window. Honored only when `type === "free_trial"`. */
  readonly uses?: number;
  /** Window for the `uses` counter (e.g., `"monthly"`). */
  readonly window?: "monthly" | "daily" | "weekly";
}

export interface SellerUpstream {
  /** Upstream HTTPS URL to forward to after settlement. */
  readonly url: string;
  /** Factory called per-request with resolved secrets, returning request
   *  headers for the upstream call (typically the upstream auth header). */
  readonly headers_factory: (secrets: Record<string, string>, requestContext: SellerRequestContext) => Record<string, string>;
  /** Factory that builds the upstream request body from the x402 caller's
   *  validated input. */
  readonly body_factory: (input: any) => unknown;
}

export interface SellerRequestContext {
  readonly input: any;
  readonly payer: string;
  readonly paymentReference: string | null;
}

export interface SellerManifest {
  /** Stable provider-prefixed identifier (e.g., `manus.research`). */
  readonly id: string;
  /** Mount point on the API gateway (e.g., `/x402/manus/research`). */
  readonly route: string;
  readonly method: "POST";
  readonly description: string;
  readonly mime_type: string;
  readonly upstream: SellerUpstream;
  /** Required env var names. Validated at registration time (boot) — missing
   *  secrets throw `<seller>_<env_var>_required` synchronously. Resolved
   *  values are passed into `upstream.headers_factory` per-request. */
  readonly secrets: readonly string[];
  /** Pricing function: `(input) => USD decimal string`. */
  readonly pricing: (input: any) => string;
  readonly agentkit: SellerAgentkitMode;
  /** Env var name precedence for the seller's payTo wallet address. Resolved
   *  at registration. */
  readonly pay_to_env_order: readonly string[];
  /** Body returned to clients on the initial unpaid 402 challenge. */
  readonly unpaid_response_body?: unknown;
}
