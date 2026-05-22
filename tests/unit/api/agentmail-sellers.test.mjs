import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  agentmailCreateInboxSellerManifest,
  agentmailGetMessageSellerManifest,
  agentmailListMessagesSellerManifest,
  agentmailReplyToMessageSellerManifest,
  agentmailSendMessageSellerManifest,
  AGENTMAIL_CREATE_INBOX_PATH,
  AGENTMAIL_GET_MESSAGE_PATH,
  AGENTMAIL_LIST_MESSAGES_PATH,
  AGENTMAIL_REPLY_TO_MESSAGE_PATH,
  AGENTMAIL_SEND_MESSAGE_PATH,
} from "../../../apps/api/src/sellers/agentmail/index.ts";
import {
  agentmailCreateInboxPriceUsd,
  agentmailGetMessagePriceUsd,
  agentmailListMessagesPriceUsd,
  agentmailReplyToMessagePriceUsd,
  agentmailSendMessagePriceUsd,
  agentmailProviderPriceUsd,
} from "../../../apps/api/src/sellers/agentmail/pricing.ts";
import {
  forwardAgentmailCreateInboxUpstream,
  forwardAgentmailGetMessageUpstream,
  forwardAgentmailListMessagesUpstream,
  forwardAgentmailReplyToMessageUpstream,
  forwardAgentmailSendMessageUpstream,
} from "../../../apps/api/src/sellers/agentmail/upstream.ts";

const OWNER_A = "0x00000000000000000000000000000000000000a1";
const OWNER_B = "0x00000000000000000000000000000000000000b2";

function makeReply() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function paymentContext(owner = OWNER_A) {
  return {
    type: "payment-verified",
    paymentPayload: {
      x402Version: 2,
      payload: {
        authorization: {
          from: owner,
        },
      },
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

function makeAgentmailStore() {
  const rows = [];
  return {
    rows,
    async upsertAgentmailInbox(row) {
      const next = { ...row, owner_address: row.owner_address.toLowerCase() };
      const index = rows.findIndex((item) => item.inbox_id === next.inbox_id);
      if (index >= 0) rows[index] = { ...rows[index], ...next };
      else rows.unshift(next);
      return rows.find((item) => item.inbox_id === next.inbox_id);
    },
    async findAgentmailInboxByIdentifier({ identifier }) {
      return rows.find((row) => row.inbox_id === identifier || row.email === identifier) || null;
    },
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
    assert.equal(agentmailListMessagesSellerManifest.route, AGENTMAIL_LIST_MESSAGES_PATH);
    assert.equal(agentmailGetMessageSellerManifest.route, AGENTMAIL_GET_MESSAGE_PATH);
    assert.equal(agentmailSendMessageSellerManifest.route, AGENTMAIL_SEND_MESSAGE_PATH);
    assert.equal(agentmailReplyToMessageSellerManifest.route, AGENTMAIL_REPLY_TO_MESSAGE_PATH);
    for (const manifest of [
      agentmailCreateInboxSellerManifest,
      agentmailListMessagesSellerManifest,
      agentmailGetMessageSellerManifest,
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
    assert.equal(agentmailProviderPriceUsd("list_messages"), "0");
    assert.equal(agentmailListMessagesPriceUsd(), "0");
    assert.equal(agentmailProviderPriceUsd("get_message"), "0");
    assert.equal(agentmailGetMessagePriceUsd(), "0");
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
        captured.push({ method: request.method, url: request.url, body: text ? JSON.parse(text) : null });
        if (request.url.endsWith("/v0/inboxes")) {
          return new Response('{"id":"inbox_123","email":"agent@agentmail.to"}', {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response('{"ok":true,"message_id":"msg_123","thread_id":"thr_123"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
      const store = makeAgentmailStore();

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
        payment: paymentContext(),
        store,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });
      assert.equal(createResult.ok, true);
      assert.equal(captured.at(-1).url, "https://x402.api.agentmail.to/v0/inboxes");
      assert.deepEqual(captured.at(-1).body, {
        username: "toolrouter-test",
        client_id: "tr-test",
      });
      assert.deepEqual(store.rows.at(0), {
        inbox_id: "inbox_123",
        email: "agent@agentmail.to",
        owner_address: OWNER_A.toLowerCase(),
        metadata: { provider: "agentmail" },
      });

      const listReply = makeReply();
      await forwardAgentmailListMessagesUpstream({
        request: {
          body: {
            inbox_id: "agent@agentmail.to",
            limit: 5,
            labels: ["toolrouter"],
            include_trash: true,
          },
        },
        reply: listReply,
        payment: paymentContext(),
        store,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });
      assert.equal(captured.at(-1).method, "GET");
      assert.equal(
        captured.at(-1).url,
        "https://x402.api.agentmail.to/v0/inboxes/agent@agentmail.to/messages?limit=5&labels=toolrouter&include_trash=true",
      );

      const getReply = makeReply();
      await forwardAgentmailGetMessageUpstream({
        request: {
          body: {
            inbox_id: "agent@agentmail.to",
            message_id: "msg_123",
          },
        },
        reply: getReply,
        payment: paymentContext(),
        store,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });
      assert.equal(captured.at(-1).method, "GET");
      assert.equal(
        captured.at(-1).url,
        "https://x402.api.agentmail.to/v0/inboxes/agent@agentmail.to/messages/msg_123",
      );

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
        payment: paymentContext(),
        store,
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
        payment: paymentContext(),
        store,
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

  it("rejects AgentMail inbox operations when the payer did not create the inbox through ToolRouter", async () => {
    await withAllowedHosts(async () => {
      let upstreamCalls = 0;
      const store = makeAgentmailStore();
      await store.upsertAgentmailInbox({
        inbox_id: "inbox_123",
        email: "agent@agentmail.to",
        owner_address: OWNER_A,
      });
      const fetchImpl = async () => {
        upstreamCalls += 1;
        return new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const listReply = makeReply();
      const listResult = await forwardAgentmailListMessagesUpstream({
        request: {
          body: {
            inbox_id: "agent@agentmail.to",
            limit: 10,
          },
        },
        reply: listReply,
        payment: paymentContext(OWNER_B),
        store,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });

      assert.equal(listReply.statusCode, 403);
      assert.equal(listResult.code, "agentmail_inbox_not_owned");

      const getReply = makeReply();
      const getResult = await forwardAgentmailGetMessageUpstream({
        request: {
          body: {
            inbox_id: "agent@agentmail.to",
            message_id: "msg_123",
          },
        },
        reply: getReply,
        payment: paymentContext(OWNER_B),
        store,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });

      assert.equal(getReply.statusCode, 403);
      assert.equal(getResult.code, "agentmail_inbox_not_owned");

      const sendReply = makeReply();
      const sendResult = await forwardAgentmailSendMessageUpstream({
        request: {
          body: {
            inbox_id: "agent@agentmail.to",
            to: "recipient@example.com",
            subject: "Hello",
            text: "Body",
          },
        },
        reply: sendReply,
        payment: paymentContext(OWNER_B),
        store,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });

      assert.equal(sendReply.statusCode, 403);
      assert.equal(sendResult.code, "agentmail_inbox_not_owned");

      const reply = makeReply();
      const replyResult = await forwardAgentmailReplyToMessageUpstream({
        request: {
          body: {
            inbox_id: "agent@agentmail.to",
            message_id: "msg_123",
            text: "Thanks",
          },
        },
        reply,
        payment: paymentContext(OWNER_B),
        store,
        fetchImpl,
        paymentSigner: paymentSigner(),
      });

      assert.equal(reply.statusCode, 403);
      assert.equal(replyResult.code, "agentmail_inbox_not_owned");
      assert.equal(upstreamCalls, 0, "must not forward unauthorized AgentMail operations upstream");
    });
  });

  it("does not let create-inbox responses transfer an existing inbox to another payer", async () => {
    await withAllowedHosts(async () => {
      const store = makeAgentmailStore();
      await store.upsertAgentmailInbox({
        inbox_id: "inbox_123",
        email: "agent@agentmail.to",
        owner_address: OWNER_A,
      });
      const createReply = makeReply();
      const result = await forwardAgentmailCreateInboxUpstream({
        request: {
          body: {
            username: "toolrouter-test",
          },
        },
        reply: createReply,
        payment: paymentContext(OWNER_B),
        store,
        fetchImpl: async () =>
          new Response('{"id":"inbox_123","email":"agent@agentmail.to"}', {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        paymentSigner: paymentSigner(),
      });

      assert.equal(createReply.statusCode, 403);
      assert.equal(result.code, "agentmail_inbox_not_owned");
      assert.equal(store.rows.at(0).owner_address, OWNER_A.toLowerCase());
    });
  });
});
