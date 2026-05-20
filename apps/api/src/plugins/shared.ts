// Shared dependency-injection plugin. Decorates the Fastify instance with the
// DI bag passed to `createApiApp(deps)` so route plugins read shared deps off
// `app.store`, `app.executor`, etc. — no closure-over-deps, no
// `fastify-plugin` dependency. Each route plugin is a plain
// `async function plugin(app, opts)` registration.

export interface SharedDeps {
  store: any;
  executor: any;
  cache: any;
  crossmint: any;
  stripe: any;
  alerts: any;
  datadog: any;
  agentBookVerifier: any;
  agentBookRegistration: any;
  manusFetch: typeof fetch;
}

declare module "fastify" {
  interface FastifyInstance {
    store: any;
    executor: any;
    cache: any;
    crossmint: any;
    stripe: any;
    alerts: any;
    datadog: any;
    agentBookVerifier: any;
    agentBookRegistration: any;
    manusFetch: typeof fetch;
  }
}

export async function sharedPlugin(app: any, opts: SharedDeps) {
  app.decorate("store", opts.store);
  app.decorate("executor", opts.executor);
  app.decorate("cache", opts.cache);
  app.decorate("crossmint", opts.crossmint);
  app.decorate("stripe", opts.stripe);
  app.decorate("alerts", opts.alerts);
  app.decorate("datadog", opts.datadog);
  app.decorate("agentBookVerifier", opts.agentBookVerifier);
  app.decorate("agentBookRegistration", opts.agentBookRegistration);
  app.decorate("manusFetch", opts.manusFetch);
}
