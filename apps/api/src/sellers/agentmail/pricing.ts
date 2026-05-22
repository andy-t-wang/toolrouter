import {
  agentmailPriceUsd,
  AGENTMAIL_BASE_PRICES_USD,
} from "@toolrouter/router-core";

export function agentmailCreateInboxPriceUsd() {
  return agentmailPriceUsd("create_inbox");
}

export function agentmailListMessagesPriceUsd() {
  return agentmailPriceUsd("list_messages");
}

export function agentmailGetMessagePriceUsd() {
  return agentmailPriceUsd("get_message");
}

export function agentmailSendMessagePriceUsd() {
  return agentmailPriceUsd("send_message");
}

export function agentmailReplyToMessagePriceUsd() {
  return agentmailPriceUsd("reply_to_message");
}

export function agentmailProviderPriceUsd(kind: keyof typeof AGENTMAIL_BASE_PRICES_USD) {
  return String(AGENTMAIL_BASE_PRICES_USD[kind]);
}
