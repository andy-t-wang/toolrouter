// Shared primitive for first-party x402 seller services.
//
// Adding a new seller is a one-file PR: drop a manifest plus a small register
// function (see `apps/api/src/sellers/manus/index.ts` and the
// `tests/fixtures/sellers/echo-seller/` test fixture) and call
// `registerSellerServices(app, [yourSellerService])` from `createApiApp`.
//
// Secrets convention: the manifest declares required env-var names in
// `secrets: string[]`. We validate them at registration time (boot) and pass
// the resolved values into `upstream.headers_factory(secrets, requestContext)`
// per-request — preventing the closure-capture-of-secret pattern the legacy
// Manus wrapper used.

import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import {
  agentkitResourceServerExtension,
  createAgentkitHooks,
  declareAgentkitExtension,
} from "@worldcoin/agentkit";
import type { SellerManifest } from "@toolrouter/router-core";

type NetworkId = `${string}:${string}`;

function defaultPublicBaseUrl() {
  return (process.env.TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world").replace(
    /\/$/u,
    "",
  );
}

function defaultX402Network(): NetworkId {
  return (process.env.X402_DEFAULT_CHAIN_ID || "eip155:8453") as NetworkId;
}

function defaultAgentkitNetwork(): NetworkId {
  return (process.env.AGENTKIT_CHAIN_ID || "eip155:480") as NetworkId;
}

/**
 * Validate `manifest.secrets` against `process.env` synchronously. Throws a
 * clear `<seller>_<env_var>_required` error on first missing key.
 */
export function resolveSellerSecrets(manifest: SellerManifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of manifest.secrets) {
    const value = process.env[name];
    if (!value) {
      const sellerKey = manifest.id.replace(/\W+/gu, "_").toLowerCase();
      const envKey = name.toLowerCase();
      throw Object.assign(new Error(`${name} is required for seller ${manifest.id}`), {
        statusCode: 503,
        code: `${sellerKey}_${envKey}_required`,
      });
    }
    out[name] = value;
  }
  return out;
}

/**
 * Walk `manifest.pay_to_env_order` in declared precedence and return the first
 * env-var value that is set. Throws if nothing resolves — the seller will not
 * be able to accept payments.
 */
export function resolveSellerPayTo(manifest: SellerManifest): string {
  for (const name of manifest.pay_to_env_order) {
    const value = process.env[name];
    if (value) return value;
  }
  const sellerKey = manifest.id.replace(/\W+/gu, "_").toLowerCase();
  const firstName = manifest.pay_to_env_order[0] || "PAY_TO_ADDRESS";
  throw Object.assign(new Error(`${firstName} is required for seller ${manifest.id}`), {
    statusCode: 503,
    code: `${sellerKey}_pay_to_missing`,
  });
}

class FastifyX402Adapter {
  request: any;

  constructor(request: any) {
    this.request = request;
  }

  getHeader(name: string) {
    return this.request.headers[String(name).toLowerCase()];
  }

  getMethod() {
    return this.request.method;
  }

  getPath() {
    return new URL(this.getUrl()).pathname;
  }

  getUrl() {
    const host = this.request.headers.host || "toolrouter.world";
    const base = process.env.TOOLROUTER_X402_PROVIDER_URL || `https://${host}`;
    return `${base.replace(/\/$/u, "")}${this.request.url}`;
  }

  getAcceptHeader() {
    return String(this.request.headers.accept || "application/json");
  }

  getUserAgent() {
    return String(this.request.headers["user-agent"] || "");
  }

  getBody() {
    return this.request.body || {};
  }
}

function sendX402Instructions(reply: any, instructions: any) {
  for (const [key, value] of Object.entries(instructions.headers || {})) {
    reply.header(key, value as any);
  }
  reply.status(instructions.status);
  return reply.send(instructions.body ?? null);
}

function mapAgentkitMode(manifest: SellerManifest) {
  const mode = manifest.agentkit;
  if (mode.type === "free_trial") {
    return { type: "free-trial" as const, uses: mode.uses ?? 0 };
  }
  // Future modes (access, discount) require additional manifest fields
  // (e.g., `percent` for discount). When a seller needs them, extend
  // `SellerAgentkitMode` and map them here.
  throw Object.assign(new Error(`Unsupported seller agentkit mode: ${mode.type}`), {
    statusCode: 500,
    code: "seller_agentkit_mode_unsupported",
  });
}

export interface SellerServiceDeps {
  /** Cache used for per-month free-trial counters + replay-nonce storage. */
  cache: any;
  /** AgentBook verifier (loaded lazily by callers if not provided). */
  agentBook: any;
  /** Override x402 facilitator config. Required unless `facilitatorClient`
   *  is provided. */
  facilitatorConfig?: any;
  /** Pre-built facilitator client (test injection point). When provided,
   *  bypasses `HTTPFacilitatorClient(facilitatorConfig)` construction. */
  facilitatorClient?: any;
  /** Storage class for the AgentKit free-trial counters + replay nonces. */
  storage: any;
  /**
   * Upstream forwarder. Called after the x402 protocol layer accepts the
   * request (paid or AgentKit-verified). Receives the resolved secrets and
   * must produce the response body that the route will return.
   */
  forwardUpstream: (args: {
    request: any;
    reply: any;
    secrets: Record<string, string>;
  }) => Promise<unknown>;
  /** Fetch implementation override (unused by the primitive itself — passed
   *  through to `forwardUpstream` callers that close over it). */
  fetchImpl?: typeof fetch;
}

export interface SellerService {
  readonly manifest: SellerManifest;
  /** Register the seller route on a Fastify app. */
  register(app: any): void;
  /** Direct request handler — useful in tests. */
  handle(request: any, reply: any): Promise<unknown>;
}

/**
 * Build a seller service from a manifest. Validates `secrets` and `pay_to_env_order`
 * synchronously so a misconfigured deploy fails at boot instead of at first
 * request. Returns a `register(app)` function plus a direct `handle(...)` for
 * tests.
 *
 * The x402 server itself initializes when the factory is awaited — that
 * matches the legacy Manus wrapper, which also initialized at construction.
 */
export async function createSellerService(
  manifest: SellerManifest,
  deps: SellerServiceDeps,
): Promise<SellerService> {
  // Boot-time validation. Throws clear errors before we hand back a handler.
  const secrets = resolveSellerSecrets(manifest);
  const payTo = resolveSellerPayTo(manifest);

  const network = defaultX402Network();
  const agentkitNetwork = defaultAgentkitNetwork();

  const facilitatorClient =
    deps.facilitatorClient || new HTTPFacilitatorClient(deps.facilitatorConfig);
  const resourceServer = new x402ResourceServer(facilitatorClient);
  registerExactEvmScheme(resourceServer, { networks: [network] });
  resourceServer.registerExtension(agentkitResourceServerExtension);

  const agentkitMode = mapAgentkitMode(manifest);
  const hooks = createAgentkitHooks({
    agentBook: deps.agentBook,
    mode: agentkitMode,
    storage: deps.storage,
    rpcUrl: process.env.AGENTKIT_WORLDCHAIN_RPC_URL || undefined,
  });
  if (hooks.verifyFailureHook) {
    resourceServer.onVerifyFailure(hooks.verifyFailureHook as any);
  }

  const routeUrl = `${defaultPublicBaseUrl()}${manifest.route}`;
  const server = new x402HTTPResourceServer(resourceServer, {
    [`${manifest.method} ${manifest.route}`]: {
      accepts: {
        scheme: "exact",
        network,
        payTo,
        price: (context: any) => `$${manifest.pricing(context.adapter.getBody?.() || {})}`,
      },
      description: manifest.description,
      mimeType: manifest.mime_type,
      extensions: declareAgentkitExtension({
        domain: new URL(routeUrl).host,
        resourceUri: routeUrl,
        statement: `Verify your agent for free uses of ${manifest.id}.`,
        network: agentkitNetwork,
        mode: agentkitMode,
      }),
      unpaidResponseBody: () => ({
        contentType: manifest.mime_type,
        body: manifest.unpaid_response_body ?? {
          error: "x402 payment or AgentKit verification required",
        },
      }),
    },
  });
  server.onProtectedRequest(hooks.requestHook);
  await server.initialize();

  async function handle(request: any, reply: any) {
    const adapter = new FastifyX402Adapter(request);
    const processResult = await server.processHTTPRequest({
      adapter,
      path: adapter.getPath(),
      method: adapter.getMethod(),
    });
    if (processResult.type === "payment-error") {
      return sendX402Instructions(reply, processResult.response);
    }

    const body = await deps.forwardUpstream({ request, reply, secrets });
    // If the forwarder set a non-2xx status, surface its body unchanged.
    const replyStatus = typeof reply.statusCode === "number" ? reply.statusCode : 200;
    if (replyStatus >= 400) return body;

    if (processResult.type === "payment-verified") {
      // Serialize the response body ONCE and reply with the exact same bytes
      // we HMAC for settlement. Returning `body` would let Fastify re-serialize
      // with its own JSON.stringify (key order, replacer plugins, BigInt
      // handling), which would diverge from the settlement receipt and break
      // buyer-side verification. The bytes that get HMAC'd must equal the
      // bytes Fastify writes — capture once, ship the buffer.
      const responseBuffer = Buffer.from(JSON.stringify(body));
      const settleResult = await server.processSettlement(
        processResult.paymentPayload,
        processResult.paymentRequirements,
        processResult.declaredExtensions,
        {
          request: {
            adapter,
            path: adapter.getPath(),
            method: adapter.getMethod(),
          },
          responseBody: responseBuffer,
          responseHeaders: { "content-type": manifest.mime_type },
        },
      );
      if (settleResult.success === false) {
        return sendX402Instructions(reply, settleResult.response);
      }
      for (const [key, value] of Object.entries(settleResult.headers || {})) {
        reply.header(key, value as any);
      }
      reply.type(manifest.mime_type);
      reply.send(responseBuffer);
      return reply;
    }
    return body;
  }

  function register(app: any) {
    if (manifest.method !== "POST") {
      throw Object.assign(new Error(`Unsupported seller method ${manifest.method}`), {
        statusCode: 500,
        code: "seller_method_unsupported",
      });
    }
    app.post(manifest.route, async (request: any, reply: any) => handle(request, reply));
  }

  return { manifest, register, handle };
}

/**
 * Register a list of seller services on a Fastify app. Awaits each
 * `createSellerService(...)` factory in sequence so boot-time secret/PayTo
 * validation surfaces synchronously (in the createApiApp setup path).
 */
export async function registerSellerServices(
  app: any,
  services: Array<Promise<SellerService> | SellerService>,
) {
  for (const candidate of services) {
    const service = await candidate;
    service.register(app);
  }
}
