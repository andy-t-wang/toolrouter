import { agentmailPriceUsd } from "../../builders.ts";

export const AGENTMAIL_PROVIDER = "agentmail";
export const AGENTMAIL_CATEGORY = "email";

export function wrapperBaseUrl() {
  return (process.env.TOOLROUTER_X402_PROVIDER_URL || "https://toolrouter.world").replace(/\/$/u, "");
}

export function envFixture(name: string, fallback: string) {
  return process.env[name] || fallback;
}

export const AGENTMAIL_CREATE_PRICE = agentmailPriceUsd("create_inbox");
export const AGENTMAIL_LIST_PRICE = agentmailPriceUsd("list_messages");
export const AGENTMAIL_GET_PRICE = agentmailPriceUsd("get_message");
export const AGENTMAIL_SEND_PRICE = agentmailPriceUsd("send_message");
export const AGENTMAIL_REPLY_PRICE = agentmailPriceUsd("reply_to_message");
