import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  agentmailCreateInboxSellerManifest,
  agentmailReplyToMessageSellerManifest,
  agentmailSendMessageSellerManifest,
  AGENTMAIL_CREATE_INBOX_PATH,
  AGENTMAIL_REPLY_TO_MESSAGE_PATH,
  AGENTMAIL_SEND_MESSAGE_PATH,
} from "../../../apps/api/src/sellers/agentmail/index.ts";
import {
  agentmailCreateInboxPriceUsd,
  agentmailReplyToMessagePriceUsd,
  agentmailSendMessagePriceUsd,
  agentmailProviderPriceUsd,
} from "../../../apps/api/src/sellers/agentmail/pricing.ts";
import {
  forwardAgentmailCreateInboxUpstream,
  forwardAgentmailReplyToMessageUpstream,
  forwardAgentmailSendMessageUpstream,
} from "../../../apps/api/src/sellers/agentmail/upstream.ts";

function makeReply() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function paymentSigner() {
  return {
    address: "0x0000000000000000000000000000000000000001",
    signMessage: async () => "0x1",
    signTypedData: async () => "0x1",
  };
}

async function withAllowedHosts(fn) {
  const previousAllowedHosts = process.env.X402_ALLOWED_HOSTS;
  const previousMax = process.env.X402_MAX_USD_PER_REQUEST;
  process.env.X402_ALLOWED_HOSTS = "x402.api.agentmail.to";
  process.env.X402_MAX_USD_PER_REQUEST = "5";
  try {
    return await fn();
  } finally {
    if (previousAllowedHosts === undefined) delete process.env.X402_ALLOWED_HOSTS;
    else process.env.X402_ALLOWED_HOSTS = previousAllowedHosts;
    if (previousMax === undefined) delete process.env.X402_MAX_USD_PER_REQUEST;
    else process.env.X402_MAX_USD_PER_REQUEST = previousMax;
  }
}

describe("AgentMail seller manifests", () => {
  it("mounts x402-only AgentMail manifests at the documented paths", () => {
    assert.equal(agentmailCreateInboxSellerManifest.route, AGENTMAIL_CREATE_INBOX_PATH);
    assert.equal(agentmailSendMessageSellerManifest.route, AGENTMAIL_SEND_MESSAGE_PATH);
    assert.equal(agentmailReplyToMessageSellerManifest.route, AGENTMAIL_REPLY_TO_MESSAGE_PATH);
    for (const manifest of [
      agentmailCreateInboxSellerManifest,
      agentmailSendMessageSellerManifest,
      agentmailReplyToMessageSellerManifest,
    ]) {
      assert.equal(manifest.method, "POST");
      assert.deepEqual([...manifest.secrets], []);
      assert.equal(manifest.agentkit, null);
      assert.ok(manifest.upstream.url.startsWith("https://x402.api.agentmail.to/"));
    }
  });

  it("prices paid AgentMail operations with a one-cent ToolRouter surcharge", () => {
    assert.equal(agentmailProviderPriceUsd("create_inbox"), "2");
    assert.equal(agentmailCreateInboxPriceUsd(), "2.01");
    assert.equal(agentmailProviderPriceUsd("send_message"), "0.01");
    assert.equal(agentmailSendMessagePriceUsd(), "0.02");
    assert.equal(agentmailProviderPriceUsd("reply_to_message"), "0.01");
    assert.equal(agentmailReplyToMessagePriceUsd(), "0.02");
  });

  it("forwards AgentMail paid operations to x402 AgentMail without ToolRouter control fields", async () => {
    await withAllowedHosts(async () => {
      const captured = [];
      const fetchImpl = async (url, init) => {
        const request = url instanceof Request ? url : new Request(url, init);
        const text = await request.clone().text();
        captured.push({ url: request.url, body: text ? JSON.parse(text) : null });
        return new Response('{"ok":true,"message_id":"msg_123","thread_id":"thr_123"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const createReply = makeReply();
      const createResult = await forwardAgentmailCreateInboxUpstream({
        request: {
          body: {
            username: "toolrouter-test",
            client_id: "tr-test",
            endpoint_id: "agentmail.create_inbox",
            maxUsd: "2.01",
          },
        },
        reply: createReply,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });
      assert.equal(createResult.ok, true);
      assert.equal(captured.at(-1).url, "https://x402.api.agentmail.to/v0/inboxes");
      assert.deepEqual(captured.at(-1).body, {
        username: "toolrouter-test",
        client_id: "tr-test",
      });

      const sendReply = makeReply();
      await forwardAgentmailSendMessageUpstream({
        request: {
          body: {
            inbox_id: "agent@agentmail.to",
            to: "recipient@example.com",
            subject: "Hello",
            text: "Body",
            payment_mode: "x402_only",
          },
        },
        reply: sendReply,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });
      assert.equal(
        captured.at(-1).url,
        "https://x402.api.agentmail.to/v0/inboxes/agent@agentmail.to/messages/send",
      );
      assert.deepEqual(captured.at(-1).body, {
        to: "recipient@example.com",
        subject: "Hello",
        text: "Body",
      });

      const reply = makeReply();
      await forwardAgentmailReplyToMessageUpstream({
        request: {
          body: {
            inbox_id: "agent@agentmail.to",
            message_id: "msg_123",
            text: "Thanks",
            force_new: true,
          },
        },
        reply,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });
      assert.equal(
        captured.at(-1).url,
        "https://x402.api.agentmail.to/v0/inboxes/agent@agentmail.to/messages/msg_123/reply",
      );
      assert.deepEqual(captured.at(-1).body, { text: "Thanks" });
    });
  });
});
