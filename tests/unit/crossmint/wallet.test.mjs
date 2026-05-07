import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { CrossmintClient } from "../../../apps/api/src/crossmint.ts";

afterEach(() => {
  delete process.env.CROSSMINT_TREASURY_WALLET_LOCATOR;
});

function fakeDeps({ getWallet, createWallet }) {
  return {
    createCrossmint: () => ({}),
    CrossmintWallets: {
      from: () => ({
        getWallet,
        createWallet,
      }),
    },
    EVMWallet: {
      from: (wallet) => ({
        signMessage: wallet.signMessage,
      }),
    },
  };
}

describe("Crossmint agent wallets", () => {
  it("creates a server-signer wallet with a stable per-user alias", async () => {
    const created = [];
    const client = new CrossmintClient({
      apiKey: "cm_test",
      signerSecret: "signer_secret",
      chain: "base",
      walletDeps: fakeDeps({
        getWallet: async () => {
          throw new Error("not found");
        },
        createWallet: async (args) => {
          created.push(args);
          return {
            address: "0x00000000000000000000000000000000000000c2",
            useSigner: async () => undefined,
          };
        },
      }),
    });

    const wallet = await client.ensureWallet({
      user_id: "00000000-0000-4000-8000-000000000001",
      email: "agent@example.com",
    });

    assert.equal(wallet.address, "0x00000000000000000000000000000000000000c2");
    assert.match(wallet.wallet_locator, /^evm:alias:tr-agent-[a-f0-9]{27}$/u);
    assert.equal(wallet.wallet_locator.length, "evm:alias:".length + 36);
    assert.equal(created[0].alias, wallet.wallet_locator.slice("evm:alias:".length));
    assert.deepEqual(created[0].recovery, {
      type: "server",
      secret: "signer_secret",
    });
  });

  it("funds an agent wallet from the Crossmint treasury wallet with USDC", async () => {
    const sends = [];
    const treasuryWallet = {
      address: "0x00000000000000000000000000000000000000aa",
      useSigner: async () => undefined,
      send: async (to, token, amount) => {
        sends.push({ to, token, amount });
        return { transactionId: "tx_fund_1", explorerLink: "https://explorer.test/tx_fund_1" };
      },
    };
    const client = new CrossmintClient({
      apiKey: "cm_test",
      signerSecret: "signer_secret",
      chain: "base",
      walletDeps: fakeDeps({
        getWallet: async () => treasuryWallet,
        createWallet: async () => {
          throw new Error("should not create treasury");
        },
      }),
    });

    const funding = await client.fundAgentWallet({
      toAddress: "0x00000000000000000000000000000000000000bb",
      amountUsd: "10",
    });

    assert.deepEqual(sends, [
      {
        to: "0x00000000000000000000000000000000000000bb",
        token: "usdc",
        amount: "10",
      },
    ]);
    assert.equal(funding.provider_reference, "tx_fund_1");
  });

  it("normalizes Crossmint object signature responses", async () => {
    const wallet = {
      address: "0x00000000000000000000000000000000000000cc",
      useSigner: async () => undefined,
      signMessage: async () => ({ signature: "0xsigned", signatureId: "sig_1" }),
    };
    const client = new CrossmintClient({
      apiKey: "cm_test",
      signerSecret: "signer_secret",
      chain: "base",
      walletDeps: fakeDeps({
        getWallet: async () => wallet,
        createWallet: async () => {
          throw new Error("should not create wallet");
        },
      }),
    });

    const signature = await client.signMessage({
      walletLocator: "evm:alias:tr-agent-test",
      message: "hello",
    });

    assert.equal(signature, "0xsigned");
  });
});
