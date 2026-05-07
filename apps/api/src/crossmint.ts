import { createHash, randomUUID } from "node:crypto";

type CrossmintConfig = {
  apiKey?: string;
  environment?: string;
  chain?: string;
  signerSecret?: string;
  treasuryWalletLocator?: string;
  walletDeps?: any;
};

function bool(value: unknown) {
  return value === true || value === "true";
}

function requireServerApiKey(config: CrossmintConfig) {
  const apiKey = config.apiKey || process.env.CROSSMINT_SERVER_SIDE_API_KEY || process.env.CROSSMINT_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("CROSSMINT_SERVER_SIDE_API_KEY is required"), {
      statusCode: 500,
      code: "crossmint_not_configured",
    });
  }
  return apiKey;
}

function requireSignerSecret(config: CrossmintConfig) {
  const signerSecret = config.signerSecret || process.env.CROSSMINT_SIGNER_SECRET;
  if (!signerSecret) {
    throw Object.assign(new Error("CROSSMINT_SIGNER_SECRET is required"), {
      statusCode: 500,
      code: "crossmint_not_configured",
    });
  }
  return signerSecret;
}

function chainIdFor(chain: string) {
  if (chain === "base") return "eip155:8453";
  if (chain === "base-sepolia") return "eip155:84532";
  if (chain === "worldchain") return "eip155:480";
  return chain.startsWith("eip155:") ? chain : `crossmint:${chain}`;
}

function agentAlias(userId: string) {
  const digest = createHash("sha256").update(userId).digest("hex").slice(0, 27);
  return `tr-agent-${digest}`;
}

function agentWalletLocator(userId: string) {
  return `evm:alias:${agentAlias(userId)}`;
}

function defaultTreasuryAlias() {
  return "toolrouter-treasury-base";
}

function defaultTreasuryLocator() {
  return `evm:alias:${defaultTreasuryAlias()}`;
}

function aliasFromLocator(locator: string) {
  return locator.startsWith("evm:alias:") ? locator.slice("evm:alias:".length) : null;
}

function normalizeWallet(wallet: any, walletLocator: string, chain: string, alias?: string | null) {
  return {
    provider: "crossmint",
    wallet_locator: walletLocator,
    address: wallet?.address || null,
    chain_id: chainIdFor(chain),
    asset: "USDC",
    status: "active",
    metadata: {
      alias: alias || null,
      chain,
      source: "crossmint_wallets_sdk",
    },
  };
}

function normalizeFunding(tx: any) {
  const reference =
    tx?.transactionId ||
    tx?.transaction_id ||
    tx?.hash ||
    tx?.txHash ||
    tx?.transactionHash ||
    tx?.id ||
    tx?.explorerLink ||
    `cm_fund_${randomUUID()}`;
  return {
    provider_reference: String(reference),
    transaction_id: tx?.transactionId || tx?.id || null,
    explorer_link: tx?.explorerLink || null,
    raw_present: Boolean(tx),
  };
}

function normalizeSignature(result: any) {
  if (typeof result === "string") return result;
  if (typeof result?.signature === "string") return result.signature;
  if (typeof result?.signedMessage === "string") return result.signedMessage;
  if (typeof result?.outputSignature === "string") return result.outputSignature;
  throw Object.assign(new Error("Crossmint signature response did not include a signature"), {
    statusCode: 502,
    code: "crossmint_signature_missing",
  });
}

async function loadWalletDeps() {
  const module = await import("@crossmint/wallets-sdk");
  return {
    createCrossmint: (module as any).createCrossmint,
    CrossmintWallets: (module as any).CrossmintWallets,
    EVMWallet: (module as any).EVMWallet,
  };
}

export class CrossmintClient {
  config: CrossmintConfig;

  constructor(config: CrossmintConfig = {}) {
    this.config = {
      environment: process.env.CROSSMINT_ENV || "staging",
      chain: process.env.CROSSMINT_CHAIN || "base",
      treasuryWalletLocator: process.env.CROSSMINT_TREASURY_WALLET_LOCATOR || defaultTreasuryLocator(),
      ...config,
    };
  }

  get configured() {
    return Boolean(this.config.apiKey || process.env.CROSSMINT_SERVER_SIDE_API_KEY || process.env.CROSSMINT_API_KEY);
  }

  async wallets() {
    const deps = this.config.walletDeps || (await loadWalletDeps());
    const crossmint = deps.createCrossmint({ apiKey: requireServerApiKey(this.config) });
    return {
      ...deps,
      wallets: deps.CrossmintWallets.from(crossmint),
    };
  }

  async getSignedWallet(walletLocator: string) {
    const signerSecret = requireSignerSecret(this.config);
    const { wallets } = await this.wallets();
    const wallet = await wallets.getWallet(walletLocator, { chain: this.config.chain || "base" });
    await wallet.useSigner({ type: "server", secret: signerSecret });
    return wallet;
  }

  async createServerWallet(alias: string) {
    const signerSecret = requireSignerSecret(this.config);
    const { wallets } = await this.wallets();
    const wallet = await wallets.createWallet({
      chain: this.config.chain || "base",
      recovery: {
        type: "server",
        secret: signerSecret,
      },
      alias,
    });
    await wallet.useSigner({ type: "server", secret: signerSecret });
    return wallet;
  }

  async ensureServerWallet(walletLocator: string, alias: string | null) {
    try {
      return await this.getSignedWallet(walletLocator);
    } catch (error) {
      if (!alias) throw error;
      return this.createServerWallet(alias);
    }
  }

  async ensureWallet(user: { user_id: string; email?: string | null }) {
    if (bool(process.env.ROUTER_DEV_MODE) && !this.configured) {
      return normalizeWallet(
        {
          address: "0x0000000000000000000000000000000000000000",
        },
        agentWalletLocator(user.user_id),
        this.config.chain || "base",
        agentAlias(user.user_id),
      );
    }

    const locator = agentWalletLocator(user.user_id);
    const alias = agentAlias(user.user_id);
    const wallet = await this.ensureServerWallet(locator, alias);
    return normalizeWallet(wallet, locator, this.config.chain || "base", alias);
  }

  async ensureTreasuryWallet() {
    const locator = this.config.treasuryWalletLocator || defaultTreasuryLocator();
    const alias = aliasFromLocator(locator);
    return this.ensureServerWallet(locator, alias);
  }

  async fundAgentWallet({
    toAddress,
    amountUsd,
  }: {
    toAddress: string;
    amountUsd: string;
  }) {
    if (bool(process.env.ROUTER_DEV_MODE) && !this.configured) {
      return normalizeFunding({
        transactionId: `cm_fund_dev_${randomUUID()}`,
        explorerLink: `https://crossmint.local/tx/${randomUUID()}`,
      });
    }

    const treasury = await this.ensureTreasuryWallet();
    const tx = await treasury.send(toAddress, "usdc", amountUsd);
    return normalizeFunding(tx);
  }

  async signMessage({
    walletLocator,
    message,
  }: {
    walletLocator: string;
    message: string;
  }) {
    if (bool(process.env.ROUTER_DEV_MODE) && !this.configured) {
      return `0x${Buffer.from(`dev:${walletLocator}:${message}`).toString("hex").slice(0, 130).padEnd(130, "0")}`;
    }

    const { EVMWallet } = await this.wallets();
    const wallet = await this.getSignedWallet(walletLocator);
    return normalizeSignature(await EVMWallet.from(wallet).signMessage({ message }));
  }
}

export function createCrossmintClient(config: CrossmintConfig = {}) {
  return new CrossmintClient(config);
}
