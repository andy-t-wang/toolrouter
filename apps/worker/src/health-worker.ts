import { createServer } from "node:http";

import { createCrossmintClient } from "@toolrouter/api/crossmint";
import { createStore } from "@toolrouter/db";
import { createHealthWorker, executeEndpoint } from "@toolrouter/router-core";

const store = createStore();
const paidIntervalMs = Number(process.env.TOOLROUTER_PAID_HEALTH_INTERVAL_MS || process.env.TOOLROUTER_HEALTH_INTERVAL_MS || 60 * 60 * 1000);
const agentKitIntervalMs = Number(process.env.TOOLROUTER_AGENTKIT_HEALTH_INTERVAL_MS || 12 * 60 * 60 * 1000);

function crossmintHealthPaymentSigner() {
  const walletLocator = process.env.CROSSMINT_HEALTH_WALLET_LOCATOR || process.env.CROSSMINT_LIVE_WALLET_LOCATOR;
  const address = process.env.CROSSMINT_HEALTH_WALLET_ADDRESS || process.env.CROSSMINT_LIVE_WALLET_ADDRESS;
  if (!walletLocator || !address || !process.env.CROSSMINT_SIGNER_SECRET) return null;
  if (!process.env.CROSSMINT_SERVER_SIDE_API_KEY && !process.env.CROSSMINT_API_KEY) return null;
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

const paymentSigner = crossmintHealthPaymentSigner();
const executeHealthEndpoint = (payload: any) => executeEndpoint({ ...payload, paymentSigner });
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
  console.log(JSON.stringify({ service: "toolrouter-worker", paidIntervalMs, agentKitIntervalMs, healthPort: port }));
  process.stdin.resume();
}
