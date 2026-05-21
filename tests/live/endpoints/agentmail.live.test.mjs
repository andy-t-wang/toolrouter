import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCrossmintClient } from "../../../apps/api/src/services/crossmint.ts";
import { executeEndpoint, getEndpoint } from "../../../packages/router-core/src/index.ts";

const hasCrossmintSigner = Boolean(
  process.env.CROSSMINT_SERVER_SIDE_API_KEY &&
    process.env.CROSSMINT_SIGNER_SECRET &&
    process.env.CROSSMINT_LIVE_WALLET_LOCATOR &&
    process.env.CROSSMINT_LIVE_WALLET_ADDRESS,
);
const hasWallet = Boolean(process.env.AGENT_WALLET_PRIVATE_KEY) || hasCrossmintSigner;
const hasMessageFixtures = Boolean(
  process.env.AGENTMAIL_HEALTH_INBOX_ID &&
    process.env.AGENTMAIL_HEALTH_INBOX_EMAIL &&
    process.env.AGENTMAIL_HEALTH_MESSAGE_ID &&
    process.env.AGENTMAIL_HEALTH_REPLY_MESSAGE_ID,
);
const runLive = process.env.RUN_LIVE_AGENTMAIL_TESTS === "true" && hasWallet && hasMessageFixtures;
const runCreateInbox = process.env.RUN_LIVE_AGENTMAIL_CREATE_INBOX_SMOKE === "true" && hasWallet;

function configureLiveDefaults(maxUsd) {
  process.env.ROUTER_DEV_MODE = "false";
  const allowedHosts = new Set(
    String(process.env.X402_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  );
  allowedHosts.add("x402.api.agentmail.to");
  allowedHosts.add("toolrouter.world");
  process.env.X402_ALLOWED_HOSTS = [...allowedHosts].join(",");
  process.env.X402_ALLOWED_CHAINS ||= "eip155:8453,eip155:480";
  process.env.X402_MAX_USD_PER_REQUEST = maxUsd;
}

function livePaymentSigner() {
  if (!hasCrossmintSigner) return null;
  const crossmint = createCrossmintClient();
  return {
    address: process.env.CROSSMINT_LIVE_WALLET_ADDRESS,
    signMessage: async (payload) => {
      const message = payload && typeof payload === "object" && "message" in payload ? payload.message : payload;
      return crossmint.signMessage({
        walletLocator: process.env.CROSSMINT_LIVE_WALLET_LOCATOR,
        message,
      });
    },
    signTypedData: async (payload) =>
      crossmint.signTypedData({
        walletLocator: process.env.CROSSMINT_LIVE_WALLET_LOCATOR,
        domain: payload.domain,
        types: payload.types,
        primaryType: payload.primaryType,
        message: payload.message,
      }),
  };
}

async function runSmoke({ endpoint, input, maxUsd, traceId }) {
  configureLiveDefaults(maxUsd);
  const request = endpoint.buildRequest(input);
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers["x-api-key"], undefined);
  assert.ok(Number(request.estimatedUsd) <= Number(maxUsd));

  return executeEndpoint({
    endpoint,
    request,
    maxUsd,
    paymentMode: "x402_only",
    traceId,
    paymentSigner: livePaymentSigner(),
    timeoutMs: endpoint.healthProbe?.timeoutMs || 30_000,
  });
}

describe("AgentMail live x402 smoke", () => {
  it("can list and get from the configured AgentMail health inbox for zero dollars", { skip: runLive ? false : "live AgentMail smoke disabled" }, async () => {
    const list = await runSmoke({
      endpoint: getEndpoint("agentmail.list_messages"),
      input: {
        inbox_id: process.env.AGENTMAIL_HEALTH_INBOX_ID,
        limit: 5,
      },
      maxUsd: "0",
      traceId: `live_agentmail_list_${Date.now()}`,
    });
    assert.equal(list.ok, true);
    assert.equal(list.status_code, 200);
    assert.equal(list.charged, false);
    assert.ok(list.body);

    const message = await runSmoke({
      endpoint: getEndpoint("agentmail.get_message"),
      input: {
        inbox_id: process.env.AGENTMAIL_HEALTH_INBOX_ID,
        message_id: process.env.AGENTMAIL_HEALTH_MESSAGE_ID,
      },
      maxUsd: "0",
      traceId: `live_agentmail_get_${Date.now()}`,
    });
    assert.equal(message.ok, true);
    assert.equal(message.status_code, 200);
    assert.equal(message.charged, false);
    assert.ok(message.body);
  });

  it("can send and reply through ToolRouter's AgentMail surcharge wrappers", { skip: runLive ? false : "live AgentMail smoke disabled" }, async () => {
    const send = await runSmoke({
      endpoint: getEndpoint("agentmail.send_message"),
      input: {
        inbox_id: process.env.AGENTMAIL_HEALTH_INBOX_ID,
        to: process.env.AGENTMAIL_HEALTH_INBOX_EMAIL,
        subject: "ToolRouter AgentMail live smoke",
        text: "ToolRouter AgentMail send live smoke.",
        labels: ["toolrouter-live-smoke"],
      },
      maxUsd: "0.02",
      traceId: `live_agentmail_send_${Date.now()}`,
    });
    assert.equal(send.ok, true);
    assert.equal(send.status_code, 200);
    assert.equal(send.path, "x402");
    assert.equal(send.charged, true);
    assert.ok(send.body);

    const reply = await runSmoke({
      endpoint: getEndpoint("agentmail.reply_to_message"),
      input: {
        inbox_id: process.env.AGENTMAIL_HEALTH_INBOX_ID,
        message_id: process.env.AGENTMAIL_HEALTH_REPLY_MESSAGE_ID,
        text: "ToolRouter AgentMail reply live smoke.",
        labels: ["toolrouter-live-smoke"],
      },
      maxUsd: "0.02",
      traceId: `live_agentmail_reply_${Date.now()}`,
    });
    assert.equal(reply.ok, true);
    assert.equal(reply.status_code, 200);
    assert.equal(reply.path, "x402");
    assert.equal(reply.charged, true);
    assert.ok(reply.body);
  });

  it("can create an AgentMail inbox only when the expensive smoke is explicitly enabled", { skip: runCreateInbox ? false : "live AgentMail create-inbox smoke disabled" }, async () => {
    const endpoint = getEndpoint("agentmail.create_inbox");
    const result = await runSmoke({
      endpoint,
      input: {
        username: `toolrouter-smoke-${Date.now()}`,
        display_name: "ToolRouter AgentMail Smoke",
        client_id: `toolrouter-agentmail-smoke-${Date.now()}`,
      },
      maxUsd: "2.01",
      traceId: `live_agentmail_create_${Date.now()}`,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status_code, 200);
    assert.equal(result.path, "x402");
    assert.equal(result.charged, true);
    assert.ok(result.body);
  });
});
