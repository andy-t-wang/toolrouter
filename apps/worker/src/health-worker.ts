import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { createCrossmintClient } from "@toolrouter/api/crossmint";
import { createStore } from "@toolrouter/db";
import { createHealthWorker, executeEndpoint } from "@toolrouter/router-core";

function safeHash(value: string | undefined) {
  if (!value) return null;
  return `sha256:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16)}`;
}

function healthPaymentSignerState() {
  const healthLocator = process.env.CROSSMINT_HEALTH_WALLET_LOCATOR;
  const liveLocator = process.env.CROSSMINT_LIVE_WALLET_LOCATOR;
  const healthAddress = process.env.CROSSMINT_HEALTH_WALLET_ADDRESS;
  const liveAddress = process.env.CROSSMINT_LIVE_WALLET_ADDRESS;
  const hasCrossmintAuth = Boolean(
    process.env.CROSSMINT_SIGNER_SECRET &&
      (process.env.CROSSMINT_SERVER_SIDE_API_KEY || process.env.CROSSMINT_API_KEY),
  );
  const selectedWalletLocator = healthLocator || "";
  const selectedAddress = healthAddress || "";
  const locatorSource = healthLocator ? "health" : null;
  const addressSource = healthAddress ? "health" : null;
  let source = "unavailable";
  if (selectedWalletLocator && selectedAddress && hasCrossmintAuth) {
    source = "crossmint_health";
  }
  return {
    source,
    selectedWalletLocator,
    selectedAddress,
    log: {
      source,
      fallback_used: source.endsWith("_fallback"),
      crossmint_auth_configured: hasCrossmintAuth,
      private_key_configured: Boolean(process.env.AGENT_WALLET_PRIVATE_KEY),
      health_locator_configured: Boolean(healthLocator),
      health_address_configured: Boolean(healthAddress),
      live_locator_configured: Boolean(liveLocator),
      live_address_configured: Boolean(liveAddress),
      selected_locator_source: locatorSource,
      selected_address_source: addressSource,
      selected_wallet_locator_hash: safeHash(selectedWalletLocator),
      selected_address_hash: safeHash(selectedAddress),
    },
  };
}

function crossmintHealthPaymentSigner(state = healthPaymentSignerState()) {
  const walletLocator = state.selectedWalletLocator;
  const address = state.selectedAddress;
  if (!walletLocator || !address || !state.log.crossmint_auth_configured) return null;
  const crossmint = createCrossmintClient();
  return {
    address,
    signMessage: async (payload: any) => {
      const message = payload && typeof payload === "object" && "message" in payload ? payload.message : payload;
      return crossmint.signMessage({ walletLocator, message });
    },
    signTypedData: async (payload: any) =>
      crossmint.signTypedData({
        walletLocator,
        domain: payload.domain,
        types: payload.types,
        primaryType: payload.primaryType,
        message: payload.message,
      }),
  };
}

export async function main() {
  const store = createStore();
  const paidIntervalMs = Number(process.env.TOOLROUTER_PAID_HEALTH_INTERVAL_MS || process.env.TOOLROUTER_HEALTH_INTERVAL_MS || 60 * 60 * 1000);
  const agentKitIntervalMs = Number(process.env.TOOLROUTER_AGENTKIT_HEALTH_INTERVAL_MS || 12 * 60 * 60 * 1000);
  const paymentSignerState = healthPaymentSignerState();
  const paymentSigner = crossmintHealthPaymentSigner(paymentSignerState);
  const executeHealthEndpoint = async (payload: any) => {
    try {
      if (!paymentSigner) {
        return {
          ok: false,
          status_code: null,
          path: null,
          charged: false,
          latency_ms: 0,
          payment_error: "health payment signer unavailable",
          error: "health payment signer unavailable",
          health_payment_signer: paymentSignerState.log,
        };
      }
      const result = await executeEndpoint({ ...payload, paymentSigner });
      return {
        ...result,
        health_payment_signer: paymentSignerState.log,
      };
    } catch (error: any) {
      console.error("health endpoint execution failed", {
        endpoint_id: payload?.endpointId || payload?.endpoint?.id || null,
        probe_kind: payload?.probeKind || null,
        payment_mode: payload?.paymentMode || null,
        health_payment_signer: paymentSignerState.log,
        error: error?.message || String(error),
        code: error?.code || null,
      });
      throw error;
    }
  };
  const paidWorker = createHealthWorker({
    db: store,
    executor: executeHealthEndpoint,
    intervalMs: paidIntervalMs,
    probeKind: "availability",
    useRecentRequests: false,
    updateEndpointStatus: true,
    logger: console,
  });
  const agentKitWorker = createHealthWorker({
    db: store,
    executor: executeHealthEndpoint,
    intervalMs: agentKitIntervalMs,
    probeKind: "agentkit",
    useRecentRequests: true,
    updateEndpointStatus: false,
    logger: console,
  });

  if (process.argv.includes("--once")) {
    const force = process.argv.includes("--force");
    const paidResults = await paidWorker.runOnce({ force, useRecentRequests: false });
    const agentKitResults = await agentKitWorker.runOnce({ force, useRecentRequests: !force });
    console.log(JSON.stringify({ ok: true, checked: paidResults.length + agentKitResults.length, paidResults, agentKitResults }, null, 2));
  } else {
    console.info("health worker payment signer configured", {
      health_payment_signer: paymentSignerState.log,
    });
    await paidWorker.runOnce();
    await agentKitWorker.runOnce();
    paidWorker.start();
    agentKitWorker.start();
    const port = Number(process.env.PORT || process.env.TOOLROUTER_WORKER_HEALTH_PORT || "8080");
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "toolrouter-worker" }));
    });
    server.listen(port, "0.0.0.0");
    console.log(JSON.stringify({ service: "toolrouter-worker", paidIntervalMs, agentKitIntervalMs, healthPort: port, health_payment_signer: paymentSignerState.log }));
    process.stdin.resume();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
