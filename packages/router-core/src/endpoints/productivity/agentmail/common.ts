import {
  agentmailPriceUsd,
  AGENTMAIL_X402_API_BASE,
} from "../../builders.ts";

export const AGENTMAIL_PROVIDER = "agentmail";
export const AGENTMAIL_CATEGORY = "productivity";
export const AGENTMAIL_READ_URL = `${AGENTMAIL_X402_API_BASE}/v0`;

export function wrapperBaseUrl() {
  return (process.env.TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world").replace(/\/$/u, "");
}

export function envFixture(name: string, fallback: string) {
  return process.env[name] || fallback;
}

export const AGENTMAIL_CREATE_PRICE = agentmailPriceUsd("create_inbox");
export const AGENTMAIL_SEND_PRICE = agentmailPriceUsd("send_message");
export const AGENTMAIL_REPLY_PRICE = agentmailPriceUsd("reply_to_message");

