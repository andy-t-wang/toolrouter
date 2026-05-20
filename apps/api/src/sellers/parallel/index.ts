// Parallel seller services — three first-party x402 wrappers (search,
// extract, task) that settle on Base and forward to Parallel's standard API.
//
// Each manifest mirrors the Manus seller structure so adding the second
// provider proves the declarative seller pattern. Three separate
// `MonthlyAgentKitStorage` keyspaces keep AgentKit free-trial counters
// scoped per endpoint.

import type { SellerManifest } from "@toolrouter/router-core";

import {
  createSellerService,
  type SellerService,
} from "../createSellerService.ts";
import { MonthlyAgentKitStorage } from "../agentkit-storage.ts";
import {
  parallelExtractPriceUsd,
  parallelSearchPriceUsd,
  parallelTaskPriceUsd,
} from "./pricing.ts";
import {
  createParallelFacilitatorConfig,
  forwardParallelExtractUpstream,
  forwardParallelSearchUpstream,
  forwardParallelTaskUpstream,
} from "./upstream.ts";

export const PARALLEL_SEARCH_PATH = "/x402/parallel/search";
export const PARALLEL_EXTRACT_PATH = "/x402/parallel/extract";
export const PARALLEL_TASK_PATH = "/x402/parallel/task";

const PARALLEL_PAY_TO_ENV_ORDER = Object.freeze([
  "X402_PARALLEL_PAY_TO_ADDRESS",
  "X402_PAY_TO_ADDRESS",
  "CROSSMINT_TREASURY_WALLET_ADDRESS",
  "CROSSMINT_HEALTH_WALLET_ADDRESS",
  "CROSSMINT_LIVE_WALLET_ADDRESS",
]) as readonly string[];

const PARALLEL_SECRETS = Object.freeze(["PARALLEL_API_KEY"]) as readonly string[];

export const parallelSearchSellerManifest: SellerManifest = Object.freeze({
  id: "parallel.search",
  route: PARALLEL_SEARCH_PATH,
  method: "POST",
  description: "Parallel keyword search",
  mime_type: "application/json",
  secrets: PARALLEL_SECRETS,
  pricing: () => parallelSearchPriceUsd(),
  agentkit: Object.freeze({ type: "free_trial", uses: 5, window: "monthly" }),
  pay_to_env_order: PARALLEL_PAY_TO_ENV_ORDER,
  upstream: Object.freeze({
    url: "https://api.parallel.ai/v1/search",
    headers_factory: (secrets: Record<string, string>) => ({
      "content-type": "application/json",
      "x-api-key": secrets.PARALLEL_API_KEY,
    }),
    body_factory: (input: any) => input,
  }),
  unpaid_response_body: Object.freeze({ error: "x402 payment or AgentKit verification required" }),
}) as SellerManifest;

export const parallelExtractSellerManifest: SellerManifest = Object.freeze({
  id: "parallel.extract",
  route: PARALLEL_EXTRACT_PATH,
  method: "POST",
  description: "Parallel URL content extraction",
  mime_type: "application/json",
  secrets: PARALLEL_SECRETS,
  pricing: (input: any) => parallelExtractPriceUsd(input || {}),
  agentkit: Object.freeze({ type: "free_trial", uses: 5, window: "monthly" }),
  pay_to_env_order: PARALLEL_PAY_TO_ENV_ORDER,
  upstream: Object.freeze({
    url: "https://api.parallel.ai/v1/extract",
    headers_factory: (secrets: Record<string, string>) => ({
      "content-type": "application/json",
      "x-api-key": secrets.PARALLEL_API_KEY,
    }),
    body_factory: (input: any) => input,
  }),
  unpaid_response_body: Object.freeze({ error: "x402 payment or AgentKit verification required" }),
}) as SellerManifest;

export const parallelTaskSellerManifest: SellerManifest = Object.freeze({
  id: "parallel.task",
  route: PARALLEL_TASK_PATH,
  method: "POST",
  description: "Parallel async deep-research task",
  mime_type: "application/json",
  secrets: PARALLEL_SECRETS,
  pricing: (input: any) => parallelTaskPriceUsd(input || {}),
  agentkit: Object.freeze({ type: "free_trial", uses: 1, window: "monthly" }),
  pay_to_env_order: PARALLEL_PAY_TO_ENV_ORDER,
  upstream: Object.freeze({
    url: "https://api.parallel.ai/v1/tasks/runs",
    headers_factory: (secrets: Record<string, string>) => ({
      "content-type": "application/json",
      "x-api-key": secrets.PARALLEL_API_KEY,
    }),
    body_factory: (input: any) => input,
  }),
  unpaid_response_body: Object.freeze({ error: "x402 payment or AgentKit verification required" }),
}) as SellerManifest;

export interface RegisterParallelSellerDeps {
  cache: any;
  agentBook: any;
  fetchImpl?: typeof fetch;
  facilitatorClient?: any;
}

function buildSeller(
  manifest: SellerManifest,
  forwardUpstream: (args: {
    request: any;
    reply: any;
    secrets: Record<string, string>;
    fetchImpl: typeof fetch;
  }) => Promise<unknown>,
  keyspace: string,
  { cache, agentBook, fetchImpl = fetch, facilitatorClient }: RegisterParallelSellerDeps,
) {
  const storage = new MonthlyAgentKitStorage(cache, keyspace);
  return createSellerService(manifest, {
    cache,
    agentBook,
    facilitatorConfig: facilitatorClient ? undefined : createParallelFacilitatorConfig(),
    facilitatorClient,
    storage,
    forwardUpstream: async ({ request, reply, secrets }) =>
      forwardUpstream({ request, reply, secrets, fetchImpl }),
  });
}

export async function registerParallelSearchSellerService(
  deps: RegisterParallelSellerDeps,
): Promise<SellerService> {
  return buildSeller(parallelSearchSellerManifest, forwardParallelSearchUpstream, "parallel.search", deps);
}

export async function registerParallelExtractSellerService(
  deps: RegisterParallelSellerDeps,
): Promise<SellerService> {
  return buildSeller(parallelExtractSellerManifest, forwardParallelExtractUpstream, "parallel.extract", deps);
}

export async function registerParallelTaskSellerService(
  deps: RegisterParallelSellerDeps,
): Promise<SellerService> {
  return buildSeller(parallelTaskSellerManifest, forwardParallelTaskUpstream, "parallel.task", deps);
}
