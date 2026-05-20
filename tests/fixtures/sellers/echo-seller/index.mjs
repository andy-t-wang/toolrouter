// Echo seller test fixture — proves the R2 modularity claim that registering
// a second first-party seller is a one-file PR.
//
// This module is NOT imported by production code; it lives under tests/fixtures
// and is loaded only by tests that exercise the `createSellerService` primitive
// with a stub manifest. The shape mirrors `apps/api/src/sellers/manus/index.ts`.

import { createSellerService } from "../../../../apps/api/src/sellers/createSellerService.ts";

export const ECHO_SELLER_PATH = "/x402/echo/echo";

/** Frozen SellerManifest-shaped object for the echo seller. */
export const echoSellerManifest = Object.freeze({
  id: "echo.echo",
  route: ECHO_SELLER_PATH,
  method: "POST",
  description: "Echo seller used by tests as a modularity proof-of-life.",
  mime_type: "application/json",
  secrets: Object.freeze(["ECHO_SELLER_KEY"]),
  pricing: (input) => {
    const len = String(input?.text || "").length;
    return (Math.max(1, len) * 0.001).toFixed(6).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
  },
  agentkit: Object.freeze({ type: "free_trial", uses: 1, window: "monthly" }),
  pay_to_env_order: Object.freeze(["ECHO_SELLER_PAY_TO_ADDRESS", "CROSSMINT_LIVE_WALLET_ADDRESS"]),
  upstream: Object.freeze({
    url: "https://echo.example.test/echo",
    headers_factory: (secrets) => ({ "x-echo-key": secrets.ECHO_SELLER_KEY }),
    body_factory: (input) => input,
  }),
  unpaid_response_body: Object.freeze({ error: "echo seller payment required" }),
});

/**
 * Echo seller factory. Same constructor shape as `registerManusSellerService`.
 * Tests can pass stub `cache`, `agentBook`, `facilitatorConfig`, and
 * `forwardUpstream` to drive the seller without real network calls.
 */
export async function registerEchoSellerService({
  cache,
  agentBook,
  facilitatorConfig = { url: "https://x402.org/facilitator" },
  facilitatorClient,
  storage = new EchoStorage(),
  forwardUpstream = defaultForwardUpstream,
}) {
  return createSellerService(echoSellerManifest, {
    cache,
    agentBook,
    facilitatorConfig,
    facilitatorClient,
    storage,
    forwardUpstream,
  });
}

class EchoStorage {
  async tryIncrementUsage() {
    return true;
  }
  async hasUsedNonce() {
    return false;
  }
  async recordNonce() {}
}

async function defaultForwardUpstream({ request, secrets }) {
  return {
    ok: true,
    provider: "echo",
    received: request.body || {},
    secretSeen: Boolean(secrets.ECHO_SELLER_KEY),
  };
}
