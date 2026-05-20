import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import {
  createSellerService,
  resolveSellerPayTo,
  resolveSellerSecrets,
} from "../../../apps/api/src/sellers/createSellerService.ts";
import { manusSellerManifest } from "../../../apps/api/src/sellers/manus/index.ts";
import {
  echoSellerManifest,
  registerEchoSellerService,
} from "../../fixtures/sellers/echo-seller/index.mjs";
import { MemoryCache } from "../../../packages/cache/src/index.ts";

const ENV_KEYS = [
  "MANUS_API_KEY",
  "ECHO_SELLER_KEY",
  "X402_MANUS_PAY_TO_ADDRESS",
  "X402_PAY_TO_ADDRESS",
  "CROSSMINT_TREASURY_WALLET_ADDRESS",
  "CROSSMINT_HEALTH_WALLET_ADDRESS",
  "CROSSMINT_LIVE_WALLET_ADDRESS",
  "ECHO_SELLER_PAY_TO_ADDRESS",
  "X402_DEFAULT_CHAIN_ID",
  "X402_FACILITATOR_URL",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function clearSellerEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function fakeAgentBook() {
  return {
    lookupHuman: async () => null,
    nextNonce: async () => 1n,
  };
}

/** Stub FacilitatorClient that satisfies the @x402/core `FacilitatorClient`
 *  interface used by `x402ResourceServer.initialize()`. Tests inject this so
 *  we don't reach the network during boot. */
function stubFacilitatorClient(network = "eip155:84532") {
  return {
    url: "https://stub.facilitator.local",
    async getSupported() {
      return {
        kinds: [
          { x402Version: 1, scheme: "exact", network },
          { x402Version: 2, scheme: "exact", network },
        ],
        extensions: [],
        signers: {},
      };
    },
    async verify() {
      return { isValid: false, invalidReason: "stubbed", payer: null };
    },
    async settle() {
      return { success: false, errorReason: "stubbed", transaction: null, payer: null, network };
    },
  };
}

function createMockReply() {
  const reply = {
    statusCode: 200,
    headers: {},
    body: undefined,
    sent: false,
    header(key, value) {
      this.headers[String(key).toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      this.sent = true;
      return this;
    },
  };
  return reply;
}

function buildRequest({ headers = {}, body = {}, url = "/x402/echo/echo", method = "POST" } = {}) {
  return {
    method,
    url,
    headers: { host: "toolrouter.test", "content-type": "application/json", ...headers },
    body,
  };
}

describe("createSellerService boot-time validation", () => {
  it("resolveSellerSecrets throws <seller>_<env>_required when an env var is missing", () => {
    const snapshot = snapshotEnv();
    try {
      clearSellerEnv();
      assert.throws(
        () => resolveSellerSecrets(manusSellerManifest),
        (error) => {
          assert.equal(error.statusCode, 503);
          assert.equal(error.code, "manus_research_manus_api_key_required");
          assert.match(error.message, /MANUS_API_KEY is required for seller manus.research/u);
          return true;
        },
      );
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("resolveSellerSecrets returns resolved values when all envs are present", () => {
    const snapshot = snapshotEnv();
    try {
      clearSellerEnv();
      process.env.MANUS_API_KEY = "test_manus_key";
      assert.deepEqual(resolveSellerSecrets(manusSellerManifest), {
        MANUS_API_KEY: "test_manus_key",
      });
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("resolveSellerPayTo honors pay_to_env_order precedence", () => {
    const snapshot = snapshotEnv();
    try {
      clearSellerEnv();
      process.env.CROSSMINT_LIVE_WALLET_ADDRESS = "0xfallback";
      process.env.CROSSMINT_HEALTH_WALLET_ADDRESS = "0xhealth";
      process.env.CROSSMINT_TREASURY_WALLET_ADDRESS = "0xtreasury";
      process.env.X402_PAY_TO_ADDRESS = "0xgeneric";
      process.env.X402_MANUS_PAY_TO_ADDRESS = "0xmanus";
      assert.equal(resolveSellerPayTo(manusSellerManifest), "0xmanus");

      delete process.env.X402_MANUS_PAY_TO_ADDRESS;
      assert.equal(resolveSellerPayTo(manusSellerManifest), "0xgeneric");

      delete process.env.X402_PAY_TO_ADDRESS;
      assert.equal(resolveSellerPayTo(manusSellerManifest), "0xtreasury");

      delete process.env.CROSSMINT_TREASURY_WALLET_ADDRESS;
      assert.equal(resolveSellerPayTo(manusSellerManifest), "0xhealth");

      delete process.env.CROSSMINT_HEALTH_WALLET_ADDRESS;
      assert.equal(resolveSellerPayTo(manusSellerManifest), "0xfallback");
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("resolveSellerPayTo throws <seller>_pay_to_missing when nothing in chain resolves", () => {
    const snapshot = snapshotEnv();
    try {
      clearSellerEnv();
      assert.throws(
        () => resolveSellerPayTo(manusSellerManifest),
        (error) => {
          assert.equal(error.statusCode, 503);
          assert.equal(error.code, "manus_research_pay_to_missing");
          return true;
        },
      );
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("createSellerService rejects manifests with missing secrets at registration time, NOT at first request", async () => {
    const snapshot = snapshotEnv();
    try {
      clearSellerEnv();
      // Ensure payTo resolves so we know the failure is specifically secrets validation.
      process.env.CROSSMINT_LIVE_WALLET_ADDRESS = "0xfallback";
      process.env.X402_DEFAULT_CHAIN_ID = "eip155:84532";
      let threw = null;
      try {
        await registerEchoSellerService({
          cache: new MemoryCache(),
          agentBook: fakeAgentBook(),
        });
      } catch (error) {
        threw = error;
      }
      assert.ok(threw, "expected createSellerService to throw synchronously when secrets are missing");
      assert.equal(threw.statusCode, 503);
      assert.equal(threw.code, "echo_echo_echo_seller_key_required");
    } finally {
      restoreEnv(snapshot);
    }
  });
});

describe("createSellerService primitive — echo seller (R2 modularity proof)", () => {
  it("registers a new seller from a single fixture file and serves its route on Fastify", async () => {
    const snapshot = snapshotEnv();
    try {
      clearSellerEnv();
      process.env.ECHO_SELLER_KEY = "echo_test_key";
      process.env.ECHO_SELLER_PAY_TO_ADDRESS = "0xecho_pay_to";
      process.env.X402_DEFAULT_CHAIN_ID = "eip155:84532";
      process.env.X402_FACILITATOR_URL = "https://facilitator.example.test";

      const service = await registerEchoSellerService({
        cache: new MemoryCache(),
        agentBook: fakeAgentBook(),
        facilitatorClient: stubFacilitatorClient(),
      });

      assert.equal(service.manifest.id, "echo.echo");
      assert.equal(service.manifest.route, "/x402/echo/echo");

      // Register on a real Fastify instance to prove the registration shape works end-to-end.
      const app = Fastify({ logger: false });
      service.register(app);
      const ready = await app.ready();
      assert.ok(ready);

      // Hit the route with no payment header → expect a 402 with the x402 challenge envelope.
      const result = await app.inject({
        method: "POST",
        url: "/x402/echo/echo",
        payload: { text: "hello" },
      });
      assert.equal(
        result.statusCode,
        402,
        `expected 402, got ${result.statusCode}: ${result.payload}`,
      );
      // The unpaid response body matches the manifest's `unpaid_response_body`.
      assert.deepEqual(result.json(), { error: "echo seller payment required" });
      // The x402 challenge envelope is base64-encoded in the `payment-required` header.
      assert.ok(result.headers["payment-required"], "payment-required header must be set");
      const challenge = JSON.parse(
        Buffer.from(result.headers["payment-required"], "base64").toString("utf8"),
      );
      assert.equal(challenge.x402Version, 2);
      assert.ok(Array.isArray(challenge.accepts), "challenge envelope must include accepts[]");
      assert.equal(challenge.accepts[0].scheme, "exact");
      assert.equal(challenge.accepts[0].payTo, "0xecho_pay_to");

      await app.close();
    } finally {
      restoreEnv(snapshot);
    }
  });
});

describe("Manus seller — response-shape equivalence", () => {
  it("unpaid 402 challenge envelope preserves the legacy response shape", async () => {
    const snapshot = snapshotEnv();
    try {
      clearSellerEnv();
      process.env.MANUS_API_KEY = "test_manus_key";
      process.env.X402_MANUS_PAY_TO_ADDRESS = "0xmanus_pay_to";
      process.env.X402_DEFAULT_CHAIN_ID = "eip155:84532";
      process.env.X402_FACILITATOR_URL = "https://facilitator.example.test";

      const { registerManusSellerService } = await import(
        "../../../apps/api/src/sellers/manus/index.ts"
      );
      const service = await registerManusSellerService({
        cache: new MemoryCache(),
        agentBook: fakeAgentBook(),
        facilitatorClient: stubFacilitatorClient("eip155:84532"),
      });

      const app = Fastify({ logger: false });
      service.register(app);
      await app.ready();

      const result = await app.inject({
        method: "POST",
        url: "/x402/manus/research",
        payload: { query: "byte-equivalence check", depth: "quick" },
      });
      assert.equal(result.statusCode, 402);
      // Body matches the legacy `unpaidResponseBody` from `createManusX402Wrapper`.
      assert.deepEqual(result.json(), {
        error: "x402 payment or AgentKit verification required",
      });
      // The x402 challenge envelope (with `accepts[]`, payment requirements,
      // and the AgentKit extension) is base64-encoded in the `payment-required`
      // response header — same place the legacy wrapper put it.
      assert.ok(result.headers["payment-required"], "payment-required header must be set");
      const challenge = JSON.parse(
        Buffer.from(result.headers["payment-required"], "base64").toString("utf8"),
      );
      assert.equal(challenge.x402Version, 2);
      assert.ok(Array.isArray(challenge.accepts));
      const accept = challenge.accepts[0];
      assert.equal(accept.scheme, "exact");
      assert.equal(accept.network, "eip155:84532");
      assert.equal(accept.payTo, "0xmanus_pay_to");
      assert.equal(challenge.resource.url, "https://localhost:80/x402/manus/research");
      assert.equal(challenge.resource.description, "Manus research task creation");
      assert.equal(challenge.resource.mimeType, "application/json");
      // Price is dynamic: quick depth + no urls/images = $0.03 → 30_000 atomic units (USDC, 6 decimals).
      assert.equal(accept.amount, "30000");
      // AgentKit extension must still be declared.
      assert.ok(challenge.extensions?.agentkit, "AgentKit extension must be present");
      assert.equal(challenge.extensions.agentkit.mode.type, "free-trial");
      assert.equal(challenge.extensions.agentkit.mode.uses, 2);

      await app.close();
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("upstream-error response surfaces { ok:false, error } byte-identical to the legacy wrapper", async () => {
    const snapshot = snapshotEnv();
    try {
      clearSellerEnv();
      process.env.MANUS_API_KEY = "test_manus_key";
      process.env.X402_MANUS_PAY_TO_ADDRESS = "0xmanus_pay_to";
      process.env.X402_DEFAULT_CHAIN_ID = "eip155:84532";
      process.env.X402_FACILITATOR_URL = "https://facilitator.example.test";

      // Directly exercise `forwardManusUpstream` with a stubbed fetch returning 503.
      const { forwardManusUpstream } = await import(
        "../../../apps/api/src/sellers/manus/upstream.ts"
      );
      const reply = createMockReply();
      const result = await forwardManusUpstream({
        request: buildRequest({
          url: "/x402/manus/research",
          body: { query: "trigger upstream error" },
        }),
        reply,
        secrets: { MANUS_API_KEY: "test_manus_key" },
        fetchImpl: async () =>
          new Response("Manus is down", { status: 503, headers: { "content-type": "text/plain" } }),
      });
      // The legacy `createManusX402Wrapper` returned exactly this shape on upstream errors
      // (see the pre-extraction body in apps/api/src/manus.ts: `{ ok: false, error: <label> }`)
      // and set reply.status to 502 for 5xx upstream and the raw status otherwise.
      assert.equal(reply.statusCode, 502);
      assert.deepEqual(result, { ok: false, error: "Manus provider error" });
    } finally {
      restoreEnv(snapshot);
    }
  });

  it("paid happy-path body still shapes as { ok:true, provider:'manus', task: <upstream> }", async () => {
    const snapshot = snapshotEnv();
    try {
      clearSellerEnv();
      process.env.MANUS_API_KEY = "test_manus_key";
      const { forwardManusUpstream } = await import(
        "../../../apps/api/src/sellers/manus/upstream.ts"
      );
      const reply = createMockReply();
      const upstreamTask = { id: "task_ok", status: "running" };
      const result = await forwardManusUpstream({
        request: buildRequest({ body: { query: "byte-equivalence happy path" } }),
        reply,
        secrets: { MANUS_API_KEY: "test_manus_key" },
        fetchImpl: async () =>
          new Response(JSON.stringify(upstreamTask), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });
      assert.equal(reply.statusCode, 200);
      assert.deepEqual(result, { ok: true, provider: "manus", task: upstreamTask });
    } finally {
      restoreEnv(snapshot);
    }
  });
});
