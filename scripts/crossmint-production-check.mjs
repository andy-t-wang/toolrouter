#!/usr/bin/env node
import { CrossmintClient } from "../apps/api/src/crossmint.ts";

const originalInfo = console.info;
const originalWarn = console.warn;
console.info = () => undefined;
console.warn = () => undefined;

function redactAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

async function check() {
  const client = new CrossmintClient();
  const result = {
    environment: process.env.CROSSMINT_ENV || "staging",
    chain: process.env.CROSSMINT_CHAIN || "base",
    treasury: { ok: false },
    agent_wallet: { ok: false },
    signing: { ok: false },
  };

  try {
    const wallet = await client.ensureTreasuryWallet();
    result.treasury.ok = Boolean(wallet?.address);
    result.treasury.locator = process.env.CROSSMINT_TREASURY_WALLET_LOCATOR;
    result.treasury.address = redactAddress(wallet?.address);
    try {
      const balances = await wallet.balances(["usdc"]);
      result.treasury.usdc = balances?.usdc?.amount ?? "unknown";
    } catch (error) {
      result.treasury.balance_error = message(error);
    }
  } catch (error) {
    result.treasury.error = message(error);
  }

  try {
    const wallet = await client.ensureWallet({
      user_id: "00000000-0000-4000-8000-0000000000c1",
      email: "crossmint-smoke@toolrouter.local",
    });
    result.agent_wallet.ok = Boolean(wallet?.address);
    result.agent_wallet.locator = wallet.wallet_locator;
    result.agent_wallet.alias_length = wallet.wallet_locator.replace("evm:alias:", "").length;
    result.agent_wallet.address = redactAddress(wallet.address);

    try {
      const signature = await client.signMessage({
        walletLocator: wallet.wallet_locator,
        message: "toolrouter-crossmint-smoke",
      });
      result.signing.ok = typeof signature === "string" && signature.length > 20;
    } catch (error) {
      result.signing.error = message(error);
    }
  } catch (error) {
    result.agent_wallet.error = message(error);
  }

  console.info = originalInfo;
  console.warn = originalWarn;
  console.log(JSON.stringify(result, null, 2));

  if (!result.treasury.ok || !result.agent_wallet.ok || !result.signing.ok) {
    process.exitCode = 1;
  }
}

check().catch((error) => {
  console.info = originalInfo;
  console.warn = originalWarn;
  console.error(message(error));
  process.exit(1);
});
