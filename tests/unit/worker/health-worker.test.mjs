import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createHealthEndpointExecutor,
  createWorkerLogger,
  healthPaymentSignerState,
  resolveCrossmintHealthPaymentSigner,
} from "../../../apps/worker/src/health-worker.ts";

function createLogger() {
  const entries = [];
  return {
    entries,
    error(message, fields) {
      entries.push({ level: "error", message, fields });
    },
    warn(message, fields) {
      entries.push({ level: "warn", message, fields });
    },
  };
}

describe("health worker runtime logging", () => {
  it("resolves the health wallet address from the health wallet locator", async () => {
    const signerState = healthPaymentSignerState({
      CROSSMINT_HEALTH_WALLET_LOCATOR: "evm:alias:toolrouter-health-base",
      CROSSMINT_SIGNER_SECRET: "secret",
      CROSSMINT_SERVER_SIDE_API_KEY: "key",
    });
    const calls = [];
    const crossmint = {
      async getSignedWallet(walletLocator) {
        calls.push(["getSignedWallet", walletLocator]);
        return { address: "0x00000000000000000000000000000000000000AA" };
      },
      async signMessage({ walletLocator, message }) {
        calls.push(["signMessage", walletLocator, message]);
        return "0xsigned";
      },
      async signTypedData({ walletLocator, primaryType }) {
        calls.push(["signTypedData", walletLocator, primaryType]);
        return "0xtyped";
      },
    };

    const signer = await resolveCrossmintHealthPaymentSigner(signerState, crossmint);

    assert.equal(signerState.source, "crossmint_health");
    assert.equal(signerState.log.health_address_configured, false);
    assert.equal(signer.address, "0x00000000000000000000000000000000000000AA");
    assert.equal(await signer.signMessage({ message: "probe" }), "0xsigned");
    assert.equal(await signer.signTypedData({ primaryType: "TransferWithAuthorization" }), "0xtyped");
    assert.deepEqual(calls, [
      ["getSignedWallet", "evm:alias:toolrouter-health-base"],
      ["signMessage", "evm:alias:toolrouter-health-base", "probe"],
      ["signTypedData", "evm:alias:toolrouter-health-base", "TransferWithAuthorization"],
    ]);
  });

  it("returns an explicit signer initialization failure when address resolution fails", async () => {
    const logger = createLogger();
    const signerState = healthPaymentSignerState({
      CROSSMINT_HEALTH_WALLET_LOCATOR: "evm:alias:toolrouter-health-base",
      CROSSMINT_SIGNER_SECRET: "secret",
      CROSSMINT_SERVER_SIDE_API_KEY: "key",
    });
    const executeHealthEndpoint = createHealthEndpointExecutor({
      paymentSignerState: signerState,
      paymentSigner: null,
      paymentSignerFactory: async () => {
        throw Object.assign(new Error("Crossmint wallet not found"), {
          code: "crossmint_wallet_missing",
          statusCode: 404,
        });
      },
      logger,
      executeEndpointImpl: async () => {
        throw new Error("must not execute without a signer");
      },
    });

    const result = await executeHealthEndpoint({
      endpointId: "stabletravel.google_flights_search",
      probeKind: "availability",
      paymentMode: "x402_only",
      traceId: "health_trace_init_failure",
    });

    assert.equal(result.ok, false);
    assert.equal(result.payment_error, "health payment signer initialization failed");
    assert.equal(logger.entries[0].message, "health payment signer initialization failed");
    assert.equal(logger.entries[0].fields.error.message, "Crossmint wallet not found");
    assert.equal(logger.entries[0].fields.error.code, "crossmint_wallet_missing");
    assert.equal(logger.entries[0].fields.error.status_code, 404);
    assert.equal(logger.entries[0].fields.health_payment_signer.source, "crossmint_health");
  });

  it("mirrors worker logs to console and Datadog", async () => {
    const consoleEntries = [];
    const datadogEntries = [];
    const logger = createWorkerLogger({
      consoleLogger: {
        error(message, fields) {
          consoleEntries.push({ level: "error", message, fields });
        },
      },
      datadog: {
        async log(level, message, fields) {
          datadogEntries.push({ level, message, fields });
          return { sent: true };
        },
      },
    });

    logger.error("health payment signer unavailable", {
      endpoint_id: "agentmail.list_messages",
      health_payment_signer: { source: "unavailable" },
    });

    assert.deepEqual(consoleEntries, [
      {
        level: "error",
        message: "health payment signer unavailable",
        fields: {
          endpoint_id: "agentmail.list_messages",
          health_payment_signer: { source: "unavailable" },
        },
      },
    ]);
    assert.deepEqual(datadogEntries, [
      {
        level: "error",
        message: "health payment signer unavailable",
        fields: {
          endpoint_id: "agentmail.list_messages",
          health_payment_signer: { source: "unavailable" },
        },
      },
    ]);
  });

  it("logs redacted signer context when Crossmint message signing fails", async () => {
    const logger = createLogger();
    const signerState = healthPaymentSignerState({
      CROSSMINT_HEALTH_WALLET_LOCATOR: "evm:alias:toolrouter-health-base",
      CROSSMINT_HEALTH_WALLET_ADDRESS: "0x00000000000000000000000000000000000000AA",
      CROSSMINT_SIGNER_SECRET: "secret",
      CROSSMINT_SERVER_SIDE_API_KEY: "key",
    });
    const paymentSigner = {
      address: "0x00000000000000000000000000000000000000AA",
      async signMessage() {
        throw Object.assign(new Error("Crossmint authorization invalid"), {
          code: "crossmint_auth_invalid",
          statusCode: 401,
        });
      },
    };
    const executeHealthEndpoint = createHealthEndpointExecutor({
      paymentSignerState: signerState,
      paymentSigner,
      logger,
      executeEndpointImpl: async ({ paymentSigner }) => {
        await paymentSigner.signMessage({ message: "probe" });
      },
    });

    await assert.rejects(
      () =>
        executeHealthEndpoint({
          endpointId: "agentmail.send_message",
          probeKind: "availability",
          paymentMode: "x402_only",
          traceId: "health_trace_1",
        }),
      /Crossmint authorization invalid/,
    );

    const signerLog = logger.entries.find(
      (entry) => entry.message === "health payment signer signMessage failed",
    );
    assert.ok(signerLog, "must log the signer method failure before the probe fails");
    assert.equal(signerLog.fields.endpoint_id, "agentmail.send_message");
    assert.equal(signerLog.fields.probe_kind, "availability");
    assert.equal(signerLog.fields.payment_mode, "x402_only");
    assert.equal(signerLog.fields.trace_id, "health_trace_1");
    assert.equal(signerLog.fields.error.message, "Crossmint authorization invalid");
    assert.equal(signerLog.fields.error.code, "crossmint_auth_invalid");
    assert.equal(signerLog.fields.error.status_code, 401);
    assert.equal(signerLog.fields.health_payment_signer.source, "crossmint_health");
    assert.equal(signerLog.fields.health_payment_signer.selected_address_hash, "sha256:3050256b10b10558");
    assert.equal(signerLog.fields.health_payment_signer.selected_wallet_locator_hash, "sha256:ac97f2ad34b7dea1");
    const serialized = JSON.stringify(signerLog);
    assert.equal(serialized.includes("toolrouter-health-base"), false, "must not log raw locator");
    assert.equal(serialized.includes("00000000000000000000000000000000000000AA"), false, "must not log raw address");
  });

  it("logs an explicit unavailable signer event when no signer source is configured", async () => {
    const logger = createLogger();
    const signerState = healthPaymentSignerState({});
    const executeHealthEndpoint = createHealthEndpointExecutor({
      paymentSignerState: signerState,
      paymentSigner: null,
      logger,
      executeEndpointImpl: async () => {
        throw new Error("must not execute without a signer");
      },
    });

    const result = await executeHealthEndpoint({
      endpointId: "agentmail.list_messages",
      probeKind: "availability",
      paymentMode: "x402_only",
      traceId: "health_trace_2",
    });

    assert.equal(result.ok, false);
    assert.equal(result.payment_error, "health payment signer unavailable");
    assert.equal(logger.entries[0].message, "health payment signer unavailable");
    assert.equal(logger.entries[0].fields.endpoint_id, "agentmail.list_messages");
    assert.equal(logger.entries[0].fields.health_payment_signer.source, "unavailable");
    assert.equal(logger.entries[0].fields.health_payment_signer.private_key_configured, false);
  });
});
