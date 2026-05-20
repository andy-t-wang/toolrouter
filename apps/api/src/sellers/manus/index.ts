// Manus seller service — declarative manifest + factory.
//
// This is the first instance of the `createSellerService` primitive. Adding a
// second first-party seller is a peer to this directory: drop
// `apps/api/src/sellers/<next>/index.ts` exporting a `SellerManifest` plus a
// `register<Name>SellerService` factory, and add it to the seller list passed
// to `registerSellerServices(app, [...])` in `createApiApp`.

import type { SellerManifest } from "@toolrouter/router-core";

import {
  createSellerService,
  type SellerService,
} from "../createSellerService.ts";
import { manusResearchPriceUsd } from "./pricing.ts";
import {
  createManusFacilitatorConfig,
  forwardManusUpstream,
  MonthlyAgentKitStorage,
} from "./upstream.ts";

export const MANUS_RESEARCH_PATH = "/x402/manus/research";

/**
 * Manus seller manifest. Declarative — every operational knob is a field, not
 * a closure variable. The `secrets` list is enforced at registration time by
 * `createSellerService`; the `pay_to_env_order` precedence chain mirrors the
 * legacy `payToAddress()` resolution.
 */
export const manusSellerManifest: SellerManifest = Object.freeze({
  id: "manus.research",
  route: MANUS_RESEARCH_PATH,
  method: "POST",
  description: "Manus research task creation",
  mime_type: "application/json",
  secrets: Object.freeze(["MANUS_API_KEY"]) as readonly string[],
  pricing: (input: any) => manusResearchPriceUsd(input || {}),
  agentkit: Object.freeze({
    type: "free_trial",
    uses: 2,
    window: "monthly",
  }),
  pay_to_env_order: Object.freeze([
    "X402_MANUS_PAY_TO_ADDRESS",
    "X402_PAY_TO_ADDRESS",
    "CROSSMINT_TREASURY_WALLET_ADDRESS",
    "CROSSMINT_HEALTH_WALLET_ADDRESS",
    "CROSSMINT_LIVE_WALLET_ADDRESS",
  ]) as readonly string[],
  upstream: Object.freeze({
    url: "https://api.manus.ai/v2/task.create",
    headers_factory: (secrets: Record<string, string>) => ({
      "content-type": "application/json",
      "x-manus-api-key": secrets.MANUS_API_KEY,
    }),
    body_factory: (input: any) => input,
  }),
  unpaid_response_body: Object.freeze({ error: "x402 payment or AgentKit verification required" }),
}) as SellerManifest;

/**
 * Build the Manus seller service. Honors the same constructor surface as the
 * legacy `createManusX402Wrapper`: callers pass `cache` + `agentBook` + an
 * optional `fetchImpl` override. The returned object also exposes `register(app)`
 * for the new declarative path.
 */
export async function registerManusSellerService({
  cache,
  agentBook,
  fetchImpl = fetch,
  facilitatorClient,
}: {
  cache: any;
  agentBook: any;
  fetchImpl?: typeof fetch;
  /** Optional pre-built FacilitatorClient (tests inject a stub to avoid
   *  reaching the network during boot). */
  facilitatorClient?: any;
}): Promise<SellerService & { handle: (request: any, reply: any) => Promise<unknown> }> {
  const storage = new MonthlyAgentKitStorage(cache, "manus");
  return createSellerService(manusSellerManifest, {
    cache,
    agentBook,
    facilitatorConfig: facilitatorClient ? undefined : createManusFacilitatorConfig(),
    facilitatorClient,
    storage,
    forwardUpstream: async ({ request, reply, secrets }) =>
      forwardManusUpstream({ request, reply, secrets, fetchImpl }),
  });
}
