// First-party seller services (currently: Manus). Mounts each registered
// seller's Fastify route via the shared `registerSellerServices` primitive.
//
// `createApiApp` passes an explicit `services` list so test harnesses can
// inject pre-built stubs. The default factory uses the workspace's
// `registerManusSellerService` with the app's cache + agentBookVerifier.
//
// Boot-time vs lazy initialization:
// - If `services` is provided, every seller is initialized eagerly (boot).
// - If `manusWrapper` is provided, it's wrapped into a SellerService and
//   registered eagerly.
// - If only `createManusWrapper` is provided (the legacy DI shape that
//   integration tests use for the retry-after-failure case), we register a
//   lazy proxy route that defers wrapper construction to the first request.
//   This preserves the integration suite's "retries Manus wrapper
//   initialization after a transient failure" assertion.
// - Default path (no overrides): uses `registerManusSellerService` eagerly —
//   misconfigured deploys fail at boot, per U8 verification.

import { loadAgentBookVerifier } from "../services/agentkit-account.ts";
import { registerSellerServices, type SellerService } from "../sellers/createSellerService.ts";
import { registerManusSellerService } from "../sellers/manus/index.ts";
import {
  registerParallelExtractSellerService,
  registerParallelSearchSellerService,
  registerParallelTaskSellerService,
} from "../sellers/parallel/index.ts";

export interface SellerRoutesOpts {
  /** Override seller list (tests inject pre-built `SellerService` stubs). */
  services?: Array<Promise<SellerService> | SellerService>;
  /**
   * Pre-built Manus wrapper (legacy DI shape preserved for the integration
   * suite). Wrapped into a `SellerService` so the registration path is
   * uniform. Takes precedence over the default Manus factory.
   */
  manusWrapper?: any;
  /** Custom factory matching `registerManusSellerService` signature. */
  createManusWrapper?: typeof registerManusSellerService;
  /**
   * When true (production), default Manus registration runs eagerly at boot
   * so misconfigured deploys (missing `MANUS_API_KEY`, bad CDP credentials)
   * fail synchronously. The plan's R7 + seller-secrets convention promise
   * boot-time validation; this flag is how server.ts opts in without
   * breaking local-dev workflows that start the API without a Manus key.
   * Defaults to false so tests and bare `createApiApp({})` calls keep the
   * existing lazy-first-request behavior.
   */
  eagerSellerInit?: boolean;
  /** Optional Parallel seller factories — `createApiApp` passes the defaults. */
  registerParallelSearchSeller?: typeof registerParallelSearchSellerService;
  registerParallelExtractSeller?: typeof registerParallelExtractSellerService;
  registerParallelTaskSeller?: typeof registerParallelTaskSellerService;
  /** Mirror of `manusFetch` for the Parallel sellers' upstream forwarders. */
  parallelFetch?: typeof fetch;
  /** Skip Parallel seller registration (tests + local dev without a key). */
  disableParallelSellers?: boolean;
}

function manusWrapperToService(wrapper: any): SellerService {
  return {
    manifest: wrapper.manifest,
    register(app: any) {
      if (typeof wrapper.register === "function") {
        wrapper.register(app);
        return;
      }
      app.post("/x402/manus/research", async (request: any, reply: any) =>
        wrapper.handle(request, reply),
      );
    },
    async handle(request: any, reply: any) {
      return wrapper.handle(request, reply);
    },
  };
}

/**
 * Lazy Manus proxy. Defers `createManusWrapper` invocation to the first
 * request. Preserves the integration-test retry semantics where the first
 * request returns 503 and a subsequent one succeeds.
 *
 * Concurrency model: track the in-flight attempt explicitly. If a request
 * arrives while a prior attempt is still resolving, await the same attempt
 * (avoid duplicate factory calls). If the awaited attempt has already
 * rejected by the time we check, start a fresh attempt rather than re-using
 * the stale rejected promise (the failure already propagated to the original
 * caller; the next caller deserves a retry).
 */
function registerLazyManusProxy(
  app: any,
  factory: typeof registerManusSellerService,
) {
  let inFlight: Promise<any> | null = null;
  async function getWrapper() {
    if (inFlight) return inFlight;
    const attempt = factory({
      cache: app.cache,
      agentBook: app.agentBookVerifier || (await loadAgentBookVerifier()),
    });
    inFlight = attempt;
    try {
      return await attempt;
    } catch (error) {
      // Only clear if we're still the active attempt — guards against a
      // racing successful retry that already replaced inFlight.
      if (inFlight === attempt) inFlight = null;
      throw error;
    }
  }
  app.post("/x402/manus/research", async (request: any, reply: any) => {
    const wrapper = await getWrapper();
    return wrapper.handle(request, reply);
  });
}

async function parallelSellerServices(
  app: any,
  opts: SellerRoutesOpts,
): Promise<SellerService[]> {
  if (opts.disableParallelSellers) return [];
  const cache = app.cache;
  const agentBook = app.agentBookVerifier || (await loadAgentBookVerifier());
  const fetchImpl = opts.parallelFetch || fetch;
  const search = (opts.registerParallelSearchSeller || registerParallelSearchSellerService)({
    cache,
    agentBook,
    fetchImpl,
  });
  const extract = (opts.registerParallelExtractSeller || registerParallelExtractSellerService)({
    cache,
    agentBook,
    fetchImpl,
  });
  const task = (opts.registerParallelTaskSeller || registerParallelTaskSellerService)({
    cache,
    agentBook,
    fetchImpl,
  });
  return Promise.all([search, extract, task]);
}

export async function sellersRoutes(app: any, opts: SellerRoutesOpts = {}) {
  if (opts.services) {
    await registerSellerServices(app, opts.services);
    return;
  }
  if (opts.manusWrapper) {
    // Test/integration path: Manus wrapper injected explicitly, Parallel
    // stays lazy so tests that don't set `PARALLEL_API_KEY` keep working.
    await registerSellerServices(app, [manusWrapperToService(opts.manusWrapper)]);
    registerLazyParallelProxies(app, opts);
    return;
  }
  const factory = opts.createManusWrapper || registerManusSellerService;
  if (opts.eagerSellerInit) {
    // Production path: boot-time secret + facilitator validation per the
    // plan's R7 promise. Throws on missing MANUS_API_KEY / bad CDP creds
    // before the API starts listening, so a misconfigured deploy fails
    // synchronously rather than 503ing on first traffic.
    const wrapper = await factory({
      cache: app.cache,
      agentBook: app.agentBookVerifier || (await loadAgentBookVerifier()),
    });
    const sellers: Array<Promise<SellerService> | SellerService> = [
      manusWrapperToService(wrapper),
    ];
    if (!opts.disableParallelSellers) {
      sellers.push(...(await parallelSellerServices(app, opts)));
    }
    await registerSellerServices(app, sellers);
    return;
  }
  // Default (no eager opt-in): lazy first-request construction.
  //
  // Rationale: a) the integration suite's "retries Manus wrapper
  // initialization after a transient failure" test expects the first request
  // to error and a subsequent one to succeed, b) several unit tests construct
  // `createApiApp` without setting MANUS_API_KEY and only exercise non-Manus
  // routes — eager construction would break them.
  registerLazyManusProxy(app, factory);
  // Parallel sellers also follow a lazy proxy when not eagerly initialized
  // so apps that don't set PARALLEL_API_KEY can still boot. Each request
  // builds the seller on first hit and reuses it after that.
  registerLazyParallelProxies(app, opts);
}

function registerLazyParallelProxies(app: any, opts: SellerRoutesOpts) {
  if (opts.disableParallelSellers) return;
  const fetchImpl = opts.parallelFetch || fetch;
  const factories: Array<{
    path: string;
    factory: (deps: any) => Promise<SellerService>;
  }> = [
    {
      path: "/x402/parallel/search",
      factory: opts.registerParallelSearchSeller || registerParallelSearchSellerService,
    },
    {
      path: "/x402/parallel/extract",
      factory: opts.registerParallelExtractSeller || registerParallelExtractSellerService,
    },
    {
      path: "/x402/parallel/task",
      factory: opts.registerParallelTaskSeller || registerParallelTaskSellerService,
    },
  ];
  for (const { path, factory } of factories) {
    let inFlight: Promise<SellerService> | null = null;
    async function getSeller() {
      if (inFlight) return inFlight;
      const attempt = factory({
        cache: app.cache,
        agentBook: app.agentBookVerifier || (await loadAgentBookVerifier()),
        fetchImpl,
      });
      inFlight = attempt;
      try {
        return await attempt;
      } catch (error) {
        if (inFlight === attempt) inFlight = null;
        throw error;
      }
    }
    app.post(path, async (request: any, reply: any) => {
      const seller = await getSeller();
      return seller.handle(request, reply);
    });
  }
}
