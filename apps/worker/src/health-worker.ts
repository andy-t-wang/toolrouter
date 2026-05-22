import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { createCrossmintClient } from "@toolrouter/api/crossmint";
import { createDatadogClient } from "@toolrouter/api/datadog";
import { createStore } from "@toolrouter/db";
import { createHealthWorker, executeEndpoint } from "@toolrouter/router-core";

export function safeHash(value: string | undefined) {
  if (!value) return null;
  return `sha256:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16)}`;
}

export function healthPaymentSignerState(env: any = process.env) {
  const healthLocator = env.CROSSMINT_HEALTH_WALLET_LOCATOR;
  const liveLocator = env.CROSSMINT_LIVE_WALLET_LOCATOR;
  const healthAddress = env.CROSSMINT_HEALTH_WALLET_ADDRESS;
  const liveAddress = env.CROSSMINT_LIVE_WALLET_ADDRESS;
  const hasCrossmintAuth = Boolean(
    env.CROSSMINT_SIGNER_SECRET &&
      (env.CROSSMINT_SERVER_SIDE_API_KEY || env.CROSSMINT_API_KEY),
  );
  const selectedWalletLocator = healthLocator || "";
  const selectedAddress = healthAddress || "";
  const locatorSource = healthLocator ? "health" : null;
  const addressSource = healthAddress ? "health" : null;
  let source = "unavailable";
  if (selectedWalletLocator && hasCrossmintAuth) {
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
      private_key_configured: Boolean(env.AGENT_WALLET_PRIVATE_KEY),
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

export function crossmintHealthPaymentSigner(state = healthPaymentSignerState()) {
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

export async function resolveCrossmintHealthPaymentSigner(
  state = healthPaymentSignerState(),
  crossmint = createCrossmintClient(),
) {
  const walletLocator = state.selectedWalletLocator;
  if (!walletLocator || !state.log.crossmint_auth_configured) return null;
  let address = state.selectedAddress;
  if (!address) {
    const wallet = await crossmint.getSignedWallet(walletLocator);
    address = wallet?.address || "";
  }
  if (!address) return null;
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

function healthProbeContext(payload: any) {
  return {
    endpoint_id: payload?.endpointId || payload?.endpoint?.id || null,
    probe_kind: payload?.probeKind || null,
    payment_mode: payload?.paymentMode || null,
    trace_id: payload?.traceId || null,
  };
}

function safeErrorLog(error: any) {
  return {
    message: error?.message || String(error),
    code: error?.code || null,
    status_code: error?.statusCode || error?.status_code || null,
    name: error?.name || null,
  };
}

export function createWorkerLogger({
  consoleLogger = console,
  datadog = createDatadogClient({
    env: {
      ...process.env,
      DD_SERVICE: process.env.DD_SERVICE || process.env.DATADOG_SERVICE || "toolrouter-worker",
      DD_SOURCE: process.env.DD_SOURCE || process.env.DATADOG_SOURCE || "toolrouter",
    },
  }),
}: any = {}) {
  function write(level: string, message: string, fields: any = {}) {
    consoleLogger[level]?.(message, fields);
    datadog?.log?.(level, message, fields).catch((error: any) => {
      consoleLogger.warn?.("datadog log submit failed", safeErrorLog(error));
    });
  }
  return {
    error(message: string, fields?: any) {
      write("error", message, fields);
    },
    info(message: string, fields?: any) {
      write("info", message, fields);
    },
    warn(message: string, fields?: any) {
      write("warn", message, fields);
    },
  };
}

export function contextualHealthPaymentSigner({
  paymentSigner,
  paymentSignerState,
  payload,
  logger = console,
}: any) {
  if (!paymentSigner) return null;
  const context = healthProbeContext(payload);
  const logSignerFailure = (method: string, error: any) => {
    logger.error?.(`health payment signer ${method} failed`, {
      ...context,
      health_payment_signer: paymentSignerState.log,
      error: safeErrorLog(error),
    });
  };
  return {
    ...paymentSigner,
    signMessage: async (payload: any) => {
      try {
        return await paymentSigner.signMessage(payload);
      } catch (error) {
        logSignerFailure("signMessage", error);
        throw error;
      }
    },
    ...(typeof paymentSigner.signTypedData === "function"
      ? {
          signTypedData: async (payload: any) => {
            try {
              return await paymentSigner.signTypedData(payload);
            } catch (error) {
              logSignerFailure("signTypedData", error);
              throw error;
            }
          },
        }
      : {}),
  };
}

export function createHealthEndpointExecutor({
  paymentSignerState = healthPaymentSignerState(),
  paymentSigner = crossmintHealthPaymentSigner(paymentSignerState),
  paymentSignerFactory = null,
  executeEndpointImpl = executeEndpoint,
  logger = console,
}: any = {}) {
  return async (payload: any) => {
    const context = healthProbeContext(payload);
    try {
      let resolvedPaymentSigner = paymentSigner;
      if (!resolvedPaymentSigner && typeof paymentSignerFactory === "function") {
        try {
          resolvedPaymentSigner = await paymentSignerFactory();
        } catch (error: any) {
          logger.error?.("health payment signer initialization failed", {
            ...context,
            health_payment_signer: paymentSignerState.log,
            error: safeErrorLog(error),
          });
          return {
            ok: false,
            status_code: null,
            path: null,
            charged: false,
            latency_ms: 0,
            payment_error: "health payment signer initialization failed",
            error: "health payment signer initialization failed",
            health_payment_signer: paymentSignerState.log,
          };
        }
      }
      if (!resolvedPaymentSigner) {
        logger.error?.("health payment signer unavailable", {
          ...context,
          health_payment_signer: paymentSignerState.log,
        });
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
      const contextualSigner = contextualHealthPaymentSigner({
        paymentSigner: resolvedPaymentSigner,
        paymentSignerState,
        payload,
        logger,
      });
      const result = await executeEndpointImpl({ ...payload, paymentSigner: contextualSigner });
      if (!result?.ok || result?.payment_error || result?.paymentError) {
        logger.warn?.("health endpoint execution returned failure", {
          ...context,
          status_code: result?.status_code ?? result?.statusCode ?? null,
          path: result?.path ?? null,
          charged: Boolean(result?.charged),
          payment_error: result?.payment_error ?? result?.paymentError ?? null,
          error: result?.error ?? null,
          health_payment_signer: paymentSignerState.log,
          diagnostics: result?.diagnostics ?? result?.body?.diagnostics ?? null,
        });
      }
      return {
        ...result,
        health_payment_signer: paymentSignerState.log,
      };
    } catch (error: any) {
      logger.error?.("health endpoint execution failed", {
        ...context,
        health_payment_signer: paymentSignerState.log,
        error: safeErrorLog(error),
      });
      throw error;
    }
  };
}

export async function main() {
  const store = createStore();
  const paidIntervalMs = Number(process.env.TOOLROUTER_PAID_HEALTH_INTERVAL_MS || process.env.TOOLROUTER_HEALTH_INTERVAL_MS || 60 * 60 * 1000);
  const agentKitIntervalMs = Number(process.env.TOOLROUTER_AGENTKIT_HEALTH_INTERVAL_MS || 12 * 60 * 60 * 1000);
  const logger = createWorkerLogger();
  const paymentSignerState = healthPaymentSignerState();
  const paymentSignerPromise = resolveCrossmintHealthPaymentSigner(paymentSignerState);
  const executeHealthEndpoint = createHealthEndpointExecutor({
    paymentSignerState,
    paymentSigner: null,
    paymentSignerFactory: () => paymentSignerPromise,
    logger,
  });
  const paidWorker = createHealthWorker({
    db: store,
    executor: executeHealthEndpoint,
    intervalMs: paidIntervalMs,
    probeKind: "availability",
    useRecentRequests: false,
    updateEndpointStatus: true,
    logger,
  });
  const agentKitWorker = createHealthWorker({
    db: store,
    executor: executeHealthEndpoint,
    intervalMs: agentKitIntervalMs,
    probeKind: "agentkit",
    useRecentRequests: true,
    updateEndpointStatus: false,
    logger,
  });

  if (process.argv.includes("--once")) {
    const force = process.argv.includes("--force");
    const paidResults = await paidWorker.runOnce({ force, useRecentRequests: false });
    const agentKitResults = await agentKitWorker.runOnce({ force, useRecentRequests: !force });
    console.log(JSON.stringify({ ok: true, checked: paidResults.length + agentKitResults.length, paidResults, agentKitResults }, null, 2));
  } else {
    logger.info("health worker payment signer configured", {
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
