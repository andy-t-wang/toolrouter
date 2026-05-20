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
 */
function registerLazyManusProxy(
  app: any,
  factory: typeof registerManusSellerService,
) {
  let wrapperPromise: Promise<any> | null = null;
  async function getWrapper() {
    if (!wrapperPromise) {
      wrapperPromise = factory({
        cache: app.cache,
        agentBook: app.agentBookVerifier || (await loadAgentBookVerifier()),
      }).catch((error: unknown) => {
        wrapperPromise = null;
        throw error;
      });
    }
    return wrapperPromise;
  }
  app.post("/x402/manus/research", async (request: any, reply: any) => {
    const wrapper = await getWrapper();
    return wrapper.handle(request, reply);
  });
}

export async function sellersRoutes(app: any, opts: SellerRoutesOpts = {}) {
  if (opts.services) {
    await registerSellerServices(app, opts.services);
    return;
  }
  if (opts.manusWrapper) {
    await registerSellerServices(app, [manusWrapperToService(opts.manusWrapper)]);
    return;
  }
  const factory = opts.createManusWrapper || registerManusSellerService;
  if (opts.eagerSellerInit && !opts.createManusWrapper) {
    // Production path: boot-time secret + facilitator validation per the
    // plan's R7 promise. Throws on missing MANUS_API_KEY / bad CDP creds
    // before the API starts listening, so a misconfigured deploy fails
    // synchronously rather than 503ing on first traffic.
    const wrapper = await factory({
      cache: app.cache,
      agentBook: app.agentBookVerifier || (await loadAgentBookVerifier()),
    });
    await registerSellerServices(app, [manusWrapperToService(wrapper)]);
    return;
  }
  // Default + legacy `createManusWrapper`: lazy first-request construction.
  //
  // Rationale: a) the integration suite's "retries Manus wrapper
  // initialization after a transient failure" test expects the first request
  // to error and a subsequent one to succeed, b) several unit tests construct
  // `createApiApp` without setting MANUS_API_KEY and only exercise non-Manus
  // routes — eager construction would break them. Boot-time validation is
  // available to callers via `services: [...]`, `manusWrapper: ...`, or the
  // `eagerSellerInit: true` opt-in used by server.ts in production.
  registerLazyManusProxy(app, factory);
}
