// Fastify wiring for the ToolRouter API. This module's only job is to
// register plugins in the documented order and hand back a Fastify instance.
// Domain logic lives in `services/` (Fastify-free) and route handlers live in
// `routes/<concern>.routes.ts` (plain async plugin functions).
//
// Plugin registration order (matters):
//   1. shared dep decorations (so route plugins can read app.store etc.)
//   2. raw-body content-type parser (Stripe webhook signature verification
//      depends on the original bytes)
//   3. cors plugin (onRequest hook for CORS + OPTIONS short-circuit)
//   4. errors plugin (setErrorHandler before any route handler is registered)
//   5. route plugins (each is `async function plugin(app, opts)`)
//   6. seller services LAST (their factories validate secrets/payTo at boot)

import Fastify from "fastify";

import { createCache } from "@toolrouter/cache";
import { createStore } from "@toolrouter/db";
import { executeEndpoint, validateRegistry } from "@toolrouter/router-core";

import "./plugins/shared.ts"; // typescript module-augmentation for FastifyInstance
import { applyCors } from "./plugins/cors.ts";
import { applyErrorHandler, normalizeApiError } from "./plugins/errors.ts";
import { agentKitRoutes } from "./routes/agentkit.routes.ts";
import { authKeysRoutes } from "./routes/auth-keys.routes.ts";
import { dashboardRoutes } from "./routes/dashboard.routes.ts";
import { executionRoutes } from "./routes/execution.routes.ts";
import { ledgerRoutes } from "./routes/ledger.routes.ts";
import { requestsRoutes } from "./routes/requests.routes.ts";
import { sellersRoutes, type SellerRoutesOpts } from "./routes/sellers.routes.ts";
import { statusRoutes } from "./routes/status.routes.ts";
import { stripeRoutes } from "./routes/stripe.routes.ts";
import { createAlertClient } from "./services/alerts.ts";
import { createCrossmintClient } from "./services/crossmint.ts";
import { createDatadogClient } from "./services/datadog.ts";
import { createStripeClient } from "./services/stripe-checkout.ts";
import { registerManusSellerService } from "./sellers/manus/index.ts";
import {
  registerParallelExtractSellerService,
  registerParallelSearchSellerService,
  registerParallelTaskSellerService,
} from "./sellers/parallel/index.ts";

// Re-export for code paths that import the normalizer directly (tests, etc.).
export { normalizeApiError };

export interface CreateApiAppDeps {
  store?: any;
  executor?: any;
  cache?: any;
  crossmint?: any;
  stripe?: any;
  alerts?: any;
  datadog?: any;
  agentBookVerifier?: any;
  agentBookRegistration?: any;
  /** Pre-built Manus seller (test injection). Bypasses default factory. */
  manusWrapper?: any;
  /** Custom factory matching `registerManusSellerService` shape. */
  createManusWrapper?: typeof registerManusSellerService;
  /** Pre-built seller list. Overrides both `manusWrapper` and
   *  `createManusWrapper`. */
  sellerServices?: SellerRoutesOpts["services"];
  /**
   * When true, register the default Manus seller eagerly at boot so missing
   * `MANUS_API_KEY` / bad CDP credentials fail synchronously. server.ts opts
   * in for production; tests + bare `createApiApp({})` keep the lazy default.
   */
  eagerSellerInit?: SellerRoutesOpts["eagerSellerInit"];
  manusFetch?: typeof fetch;
  /**
   * Override fetch implementation used by the Parallel seller wrappers and
   * `/v1/parallel/tasks/...` polling routes. Mirrors `manusFetch` for tests.
   */
  parallelFetch?: typeof fetch;
  /** Optional override for the Parallel seller factories (test injection). */
  registerParallelSearchSeller?: typeof registerParallelSearchSellerService;
  registerParallelExtractSeller?: typeof registerParallelExtractSellerService;
  registerParallelTaskSeller?: typeof registerParallelTaskSellerService;
  /**
   * Skip Parallel seller registration entirely. Tests that don't set
   * `PARALLEL_API_KEY` use this to keep the API app bootable.
   */
  disableParallelSellers?: boolean;
  logger?: any;
}

export function createApiApp(deps: CreateApiAppDeps = {}) {
  validateRegistry();
  const {
    store = createStore(),
    executor = executeEndpoint,
    cache = createCache(),
    crossmint = createCrossmintClient(),
    stripe = createStripeClient(),
    alerts = createAlertClient(),
    datadog = createDatadogClient(),
    agentBookVerifier = null,
    agentBookRegistration = null,
    manusWrapper = null,
    createManusWrapper = registerManusSellerService,
    sellerServices,
    eagerSellerInit = false,
    manusFetch = fetch,
    parallelFetch = fetch,
    registerParallelSearchSeller = registerParallelSearchSellerService,
    registerParallelExtractSeller = registerParallelExtractSellerService,
    registerParallelTaskSeller = registerParallelTaskSellerService,
    disableParallelSellers = false,
    logger = true,
  } = deps;

  const app = Fastify({ logger });

  // 2. Raw-body content-type parser. MUST register before the Stripe route
  //    plugin or webhook signature verification breaks.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request: any, body: string, done: any) => {
      try {
        (_request as any).rawBody = body;
        done(null, body ? JSON.parse(body) : {});
      } catch (error) {
        done(error);
      }
    },
  );

  // 1. Shared decorations. Inline (not `app.register(sharedPlugin)`) because
  //    plain Fastify plugins are encapsulated by default — decorations set in
  //    a child plugin do NOT propagate to sibling plugins. Inline decoration
  //    on the root instance is visible to every plugin registered below
  //    without needing `fastify-plugin`.
  app.decorate("store", store);
  app.decorate("executor", executor);
  app.decorate("cache", cache);
  app.decorate("crossmint", crossmint);
  app.decorate("stripe", stripe);
  app.decorate("alerts", alerts);
  app.decorate("datadog", datadog);
  app.decorate("agentBookVerifier", agentBookVerifier);
  app.decorate("agentBookRegistration", agentBookRegistration);
  app.decorate("manusFetch", manusFetch);
  app.decorate("parallelFetch", parallelFetch);

  // 3. CORS — onRequest hook + OPTIONS short-circuit. Inline so the hook
  //    propagates to sibling plugins (Fastify plugins are encapsulated by
  //    default; no `fastify-plugin` dependency).
  applyCors(app);

  // 4. Error handler — inline for the same reason. Must be set before route
  //    plugins register handlers.
  applyErrorHandler(app);

  // 5. Route plugins. Each is a plain async function reading from app.* decs.
  app.get("/health", async () => ({
    ok: true,
    service: "toolrouter-api",
    version: "0.1.0",
  }));
  app.register(statusRoutes);
  app.register(authKeysRoutes);
  app.register(agentKitRoutes);
  app.register(ledgerRoutes);
  app.register(dashboardRoutes);
  app.register(requestsRoutes);
  app.register(executionRoutes);
  app.register(stripeRoutes);

  // 6. Seller services LAST — `createSellerService(...)` validates manifest
  //    secrets + payTo synchronously, so misconfiguration surfaces at boot
  //    rather than at first request.
  app.register(sellersRoutes, {
    services: sellerServices,
    manusWrapper,
    createManusWrapper,
    eagerSellerInit,
    parallelFetch,
    registerParallelSearchSeller,
    registerParallelExtractSeller,
    registerParallelTaskSeller,
    disableParallelSellers,
  });

  return app;
}
