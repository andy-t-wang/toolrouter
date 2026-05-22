#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

import { createStore } from "../packages/db/src/index.ts";
import {
  createAgentmailUpstreamPaymentSigner,
  forwardAgentmailCreateInboxUpstream,
  forwardAgentmailGetMessageUpstream,
  forwardAgentmailListMessagesUpstream,
  forwardAgentmailReplyToMessageUpstream,
  forwardAgentmailSendMessageUpstream,
} from "../apps/api/src/sellers/agentmail/upstream.ts";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = {
    envFile: process.env.AGENTMAIL_PROVISION_ENV_FILE || "",
    writeEnv: false,
    inboxId: "",
    inboxEmail: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env-file") {
      args.envFile = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--write-env") {
      args.writeEnv = true;
    } else if (arg === "--inbox-id") {
      args.inboxId = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--inbox-email") {
      args.inboxEmail = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

function unquote(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(path) {
  if (!path) return;
  if (!existsSync(path)) throw new Error(`env file not found: ${path}`);
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) process.env[key] = unquote(rawValue);
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function ensureRuntimeEnv() {
  process.env.ROUTER_DEV_MODE = "false";
  process.env.AGENTMAIL_X402_API_BASE ||= "https://x402.ws.agentmail.to";
  const hosts = new Set(
    String(process.env.X402_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  );
  hosts.add("x402.api.agentmail.to");
  hosts.add("x402.ws.agentmail.to");
  process.env.X402_ALLOWED_HOSTS = [...hosts].join(",");

  const currentMax = Number(process.env.X402_MAX_USD_PER_REQUEST || "0");
  if (!Number.isFinite(currentMax) || currentMax < 2.01) {
    process.env.X402_MAX_USD_PER_REQUEST = "2.01";
  }
}

async function curlFetch(input, init = {}) {
  const request = input instanceof Request ? input : new Request(input, init);
  const body = await request.clone().text();
  const args = ["-sS", "-i", "-X", request.method];
  for (const [key, value] of request.headers.entries()) {
    args.push("-H", `${key}: ${value}`);
  }
  if (body) args.push("--data-binary", body);
  args.push("-w", "\n__CURL_STATUS__:%{http_code}", request.url);

  const { stdout } = await execFileAsync("curl", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const marker = "\n__CURL_STATUS__:";
  const markerIndex = stdout.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error("curl response did not include status marker");
  const status = Number(stdout.slice(markerIndex + marker.length).trim());
  const rawResponse = stdout.slice(0, markerIndex).replace(/\r\n/gu, "\n");
  const splitIndex = rawResponse.lastIndexOf("\n\n");
  const rawHeaders = splitIndex >= 0 ? rawResponse.slice(0, splitIndex) : "";
  const responseBody = splitIndex >= 0 ? rawResponse.slice(splitIndex + 2) : rawResponse;
  const headerBlocks = rawHeaders.split(/\n\n/u).filter(Boolean);
  const headerLines = (headerBlocks.at(-1) || "").split("\n").slice(1);
  const headers = new Headers();
  for (const line of headerLines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return new Response(responseBody, { status, headers });
}

function createReply() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function assertOk(step, result) {
  if (result?.ok) return result;
  const error = new Error(`${step} failed`);
  error.details = result;
  throw error;
}

function payload(result) {
  return result?.result ?? result?.body ?? result?.data ?? result;
}

function firstString(value, keys) {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function extractInbox(result, fallback = {}) {
  const root = payload(result);
  const nested = root?.inbox ?? root?.data?.inbox ?? root?.data ?? {};
  const id = firstString(root, ["id", "inbox_id", "inboxId"]) ||
    firstString(nested, ["id", "inbox_id", "inboxId", "inboxID"]) ||
    fallback.inbox_id ||
    fallback.email;
  const email = firstString(root, ["email", "address", "inbox_email", "inboxEmail"]) ||
    firstString(nested, ["email", "address", "inbox_email", "inboxEmail"]) ||
    fallback.email;
  if (!id && !email) throw new Error("create inbox response did not include an inbox id or email");
  return {
    inbox_id: id || email,
    email: email || id,
  };
}

function collectObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output);
    return output;
  }
  output.push(value);
  for (const item of Object.values(value)) collectObjects(item, output);
  return output;
}

function extractMessageId(...results) {
  const keys = ["id", "message_id", "messageId", "email_id", "emailId"];
  for (const result of results) {
    for (const item of collectObjects(payload(result))) {
      const id = firstString(item, keys);
      if (id) return id;
    }
  }
  throw new Error("could not find a message id in AgentMail responses");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debugPayload(value) {
  const text = JSON.stringify(payload(value), null, 2);
  return text.length > 6000 ? `${text.slice(0, 6000)}...` : text;
}

function updateEnvText(text, updates) {
  let next = text;
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(next)) next = next.replace(pattern, line);
    else next += `${next.endsWith("\n") ? "" : "\n"}${line}\n`;
  }
  return next;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(args.envFile);
  ensureRuntimeEnv();

  const healthAddress = requireEnv("CROSSMINT_HEALTH_WALLET_ADDRESS").toLowerCase();
  const store = createStore();
  const paymentSigner = createAgentmailUpstreamPaymentSigner();
  const payment = { payer: healthAddress };
  const baseDeps = {
    store,
    payment,
    fetchImpl: curlFetch,
    paymentSigner,
  };
  let inbox;
  if (args.inboxId) {
    inbox = {
      inbox_id: args.inboxId,
      email: args.inboxEmail || args.inboxId,
    };
    await store.upsertAgentmailInbox({
      inbox_id: inbox.inbox_id,
      email: inbox.email,
      owner_address: healthAddress,
      metadata: { provider: "agentmail" },
    });
  } else {
    const stamp = Date.now().toString(36);
    const username = `toolrouter-health-${stamp}`;
    const domain = "agentmail.to";
    const fallbackInbox = {
      inbox_id: `${username}@${domain}`,
      email: `${username}@${domain}`,
    };
    const create = assertOk(
      "create inbox",
      await forwardAgentmailCreateInboxUpstream({
        ...baseDeps,
        reply: createReply(),
        request: {
          body: {
            username,
            display_name: "ToolRouter Health",
            client_id: `toolrouter-agentmail-health-${stamp}`,
          },
        },
      }),
    );
    inbox = extractInbox(create, fallbackInbox);
  }

  const send = assertOk(
    "send seed message",
    await forwardAgentmailSendMessageUpstream({
      ...baseDeps,
      reply: createReply(),
      request: {
        body: {
          inbox_id: inbox.inbox_id,
          to: inbox.email,
          subject: "ToolRouter AgentMail health seed",
          text: "ToolRouter AgentMail health seed message.",
          labels: ["toolrouter-health"],
        },
      },
    }),
  );

  let list = null;
  let messageId = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    list = assertOk(
      "list seed messages",
      await forwardAgentmailListMessagesUpstream({
        ...baseDeps,
        reply: createReply(),
        request: {
          body: {
            inbox_id: inbox.inbox_id,
            limit: 20,
            include_trash: true,
          },
        },
      }),
    );
    try {
      messageId = extractMessageId(send, list);
      break;
    } catch {
      if (attempt === 8) {
        const error = new Error("could not find a message id in AgentMail responses after retries");
        error.details = {
          send: debugPayload(send),
          list: debugPayload(list),
        };
        throw error;
      }
      await sleep(2500);
    }
  }

  assertOk(
    "get seed message",
    await forwardAgentmailGetMessageUpstream({
      ...baseDeps,
      reply: createReply(),
      request: {
        body: {
          inbox_id: inbox.inbox_id,
          message_id: messageId,
        },
      },
    }),
  );

  assertOk(
    "reply to seed message",
    await forwardAgentmailReplyToMessageUpstream({
      ...baseDeps,
      reply: createReply(),
      request: {
        body: {
          inbox_id: inbox.inbox_id,
          message_id: messageId,
          text: "ToolRouter AgentMail reply health seed.",
          labels: ["toolrouter-health"],
        },
      },
    }),
  );

  const updates = {
    AGENTMAIL_HEALTH_INBOX_ID: inbox.inbox_id,
    AGENTMAIL_HEALTH_INBOX_EMAIL: inbox.email,
    AGENTMAIL_HEALTH_MESSAGE_ID: messageId,
    AGENTMAIL_HEALTH_REPLY_MESSAGE_ID: messageId,
  };

  if (args.writeEnv) {
    if (!args.envFile) throw new Error("--write-env requires --env-file");
    const current = readFileSync(args.envFile, "utf8");
    writeFileSync(args.envFile, updateEnvText(current, updates), "utf8");
  }

  console.log(JSON.stringify({
    ok: true,
    owner_address: healthAddress,
    env_file_updated: Boolean(args.writeEnv),
    ...updates,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    cause: error.cause
      ? {
          message: error.cause.message,
          code: error.cause.code,
          hostname: error.cause.hostname,
        }
      : null,
    details: error.details || null,
  }, null, 2));
  process.exitCode = 1;
});
