import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

type CrossmintConfig = {
  apiKey?: string;
  clientApiKey?: string;
  webhookSecret?: string;
  environment?: string;
  baseUrl?: string;
  tokenLocator?: string;
  chain?: string;
  signerSecret?: string;
};

function bool(value: unknown) {
  return value === true || value === "true";
}

function apiBase(environment = process.env.CROSSMINT_ENV || "staging") {
  if (process.env.CROSSMINT_API_BASE_URL) return process.env.CROSSMINT_API_BASE_URL.replace(/\/$/u, "");
  return environment === "production" ? "https://www.crossmint.com" : "https://staging.crossmint.com";
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

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signatureCandidates(rawBody: string, secret: string) {
  const hex = createHmac("sha256", secret).update(rawBody).digest("hex");
  return [hex, `sha256=${hex}`];
}

function walletOwner(user: { user_id: string; email?: string | null }) {
  return user.email ? `email:${user.email}` : `userId:${user.user_id}`;
}

function walletLocator(user: { user_id: string; email?: string | null }) {
  return `${walletOwner(user)}:evm:smart`;
}

function normalizeWallet(wallet: any, fallbackLocator: string) {
  return {
    provider: "crossmint",
    wallet_locator: wallet?.locator || wallet?.walletLocator || fallbackLocator,
    address: wallet?.address || wallet?.walletAddress || null,
    chain_id: "eip155:8453",
    asset: "USDC",
    status: wallet?.status || "active",
    metadata: wallet || {},
  };
}

function normalizeOrder(order: any) {
  const data = order?.order || order;
  return {
    provider_reference: data?.orderId || data?.id || `cm_order_${randomUUID()}`,
    checkout_url: data?.checkoutUrl || data?.hostedCheckoutUrl || data?.payment?.checkoutUrl || null,
    client_secret: order?.clientSecret || data?.clientSecret || null,
    raw: order,
  };
}

export class CrossmintClient {
  config: CrossmintConfig;

  constructor(config: CrossmintConfig = {}) {
    this.config = {
      environment: process.env.CROSSMINT_ENV || "staging",
      tokenLocator: process.env.CROSSMINT_USDC_TOKEN_LOCATOR || "base:usdc",
      chain: process.env.CROSSMINT_CHAIN || "base",
      ...config,
    };
  }

  get configured() {
    return Boolean(this.config.apiKey || process.env.CROSSMINT_SERVER_SIDE_API_KEY || process.env.CROSSMINT_API_KEY);
  }

  async request(path: string, { method = "GET", body, idempotencyKey }: any = {}) {
    const response = await fetch(`${apiBase(this.config.environment)}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-api-key": requireServerApiKey(this.config),
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw Object.assign(new Error(data?.message || `Crossmint request failed: ${response.status}`), {
        statusCode: response.status >= 500 ? 502 : 400,
        code: "crossmint_error",
        details: data,
      });
    }
    return data;
  }

  async ensureWallet(user: { user_id: string; email?: string | null }) {
    if (bool(process.env.ROUTER_DEV_MODE) && !this.configured) {
      return normalizeWallet(
        {
          address: "0x0000000000000000000000000000000000000000",
          status: "dev_stub",
        },
        walletLocator(user),
      );
    }

    const owner = walletOwner(user);
    const locator = walletLocator(user);
    const body: any = {
      chainType: "evm",
      type: "smart",
      owner,
      config: {},
    };

    if (process.env.CROSSMINT_SERVER_SIGNER_ADDRESS) {
      body.config.adminSigner = {
        type: "server",
        address: process.env.CROSSMINT_SERVER_SIGNER_ADDRESS,
      };
    } else if (user.email) {
      body.config.adminSigner = {
        type: "email",
        email: user.email,
      };
    } else {
      throw Object.assign(new Error("CROSSMINT_SERVER_SIGNER_ADDRESS or user email is required to create a Crossmint wallet"), {
        statusCode: 500,
        code: "crossmint_not_configured",
      });
    }

    const wallet = await this.request("/api/2025-06-09/wallets", {
      method: "POST",
      body,
      idempotencyKey: `toolrouter-wallet-${user.user_id}`,
    });
    return normalizeWallet(wallet, locator);
  }

  async createTopUpOrder({
    user,
    walletAddress,
    amountUsd,
  }: {
    user: { user_id: string; email?: string | null };
    walletAddress: string;
    amountUsd: string;
  }) {
    if (bool(process.env.ROUTER_DEV_MODE) && !this.configured) {
      return normalizeOrder({
        order: {
          orderId: `cm_dev_${randomUUID()}`,
          checkoutUrl: `https://crossmint.local/checkout/${user.user_id}`,
        },
        clientSecret: `dev_secret_${randomUUID()}`,
      });
    }

    const order = await this.request("/api/2022-06-09/orders", {
      method: "POST",
      body: {
        lineItems: [
          {
            tokenLocator: this.config.tokenLocator,
            executionParameters: {
              mode: "exact-in",
              amount: amountUsd,
            },
          },
        ],
        payment: {
          method: "card",
          receiptEmail: user.email || `${user.user_id}@toolrouter.local`,
        },
        recipient: {
          walletAddress,
        },
        metadata: {
          toolrouter_user_id: user.user_id,
        },
      },
      idempotencyKey: `toolrouter-top-up-${user.user_id}-${amountUsd}-${Date.now()}`,
    });
    return normalizeOrder(order);
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

    const signerSecret = this.config.signerSecret || process.env.CROSSMINT_SIGNER_SECRET;
    if (!signerSecret) {
      throw Object.assign(
        new Error("CROSSMINT_SIGNER_SECRET is required for automated Crossmint wallet signing"),
        { statusCode: 500, code: "crossmint_not_configured" },
      );
    }

    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const module = await dynamicImport("@crossmint/wallets-sdk");
    const { createCrossmint, CrossmintWallets, EVMWallet } = module as any;
    const crossmint = createCrossmint({ apiKey: requireServerApiKey(this.config) });
    const wallets = CrossmintWallets.from(crossmint);
    const wallet = await wallets.getWallet(walletLocator, { chain: this.config.chain || "base" });
    await wallet.useSigner({ type: "server", secret: signerSecret });
    return EVMWallet.from(wallet).signMessage({ message });
  }

  verifyWebhook(rawBody: string, headers: Record<string, any>) {
    const secret = this.config.webhookSecret || process.env.CROSSMINT_WEBHOOK_SECRET;
    if (!secret) {
      if (bool(process.env.ROUTER_DEV_MODE)) return true;
      throw Object.assign(new Error("CROSSMINT_WEBHOOK_SECRET is required"), {
        statusCode: 500,
        code: "crossmint_not_configured",
      });
    }
    const header = String(
      headers["crossmint-signature"] ||
        headers["x-crossmint-signature"] ||
        headers["x-webhook-signature"] ||
        "",
    ).trim();
    if (!header) {
      throw Object.assign(new Error("missing Crossmint webhook signature"), {
        statusCode: 401,
        code: "invalid_webhook_signature",
      });
    }
    if (!signatureCandidates(rawBody, secret).some((candidate) => constantTimeEqual(candidate, header))) {
      throw Object.assign(new Error("invalid Crossmint webhook signature"), {
        statusCode: 401,
        code: "invalid_webhook_signature",
      });
    }
    return true;
  }

  normalizeWebhook(payload: any) {
    const data = payload?.data || payload?.order || payload;
    const status = String(data?.status || payload?.status || "").toLowerCase();
    const provider_reference = data?.orderId || data?.order_id || data?.id || payload?.orderId || payload?.id;
    const success = ["success", "succeeded", "completed", "complete", "delivered", "paid"].includes(status);
    const failed = ["failed", "canceled", "cancelled", "expired", "rejected"].includes(status);
    return {
      provider_reference,
      status: success ? "success" : failed ? "failed" : "pending",
      raw_status: status || null,
      event_id: payload?.id || payload?.eventId || payload?.event_id || provider_reference || null,
      raw: payload,
    };
  }
}

export function createCrossmintClient(config: CrossmintConfig = {}) {
  return new CrossmintClient(config);
}
