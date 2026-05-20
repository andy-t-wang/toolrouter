// Parallel pricing helpers — the seller-side mirror of the buyer-side helpers
// in `packages/router-core/src/endpoints/builders.ts`. Importing from
// router-core directly is fine since this file runs in the API server.

import {
  parallelExtractPriceUsd as routerCoreExtractPrice,
  parallelSearchPriceUsd as routerCoreSearchPrice,
  parallelTaskBasePriceForProcessor,
  PARALLEL_MARKUP_USD,
  PARALLEL_TASK_PROCESSORS,
} from "@toolrouter/router-core";

export function parallelSearchPriceUsd() {
  return routerCoreSearchPrice();
}

export function parallelExtractPriceUsd(input: any = {}) {
  const urls = Array.isArray(input.urls) ? input.urls : [];
  return routerCoreExtractPrice(urls.length || 1);
}

function formatUsd(value: number) {
  return value.toFixed(6).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

export function parallelTaskPriceUsd(input: any = {}) {
  const processor = String(input.processor || "ultra");
  if (!Object.hasOwn(PARALLEL_TASK_PROCESSORS, processor)) {
    throw Object.assign(new Error(`unsupported Parallel task processor: ${processor}`), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return formatUsd(parallelTaskBasePriceForProcessor(processor) + PARALLEL_MARKUP_USD);
}
