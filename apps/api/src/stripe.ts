import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

type StripeConfig = {
  secretKey?: string;
  webhookSecret?: string;
  apiBase?: string;
  successUrl?: string;
  cancelUrl?: string;
};

function bool(value: unknown) {
  return value === true || value === "true";
}

function requireSecretKey(config: StripeConfig) {
  const key = config.secretKey || process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw Object.assign(new Error("STRIPE_SECRET_KEY is required"), {
      statusCode: 500,
      code: "stripe_not_configured",
    });
  }
  return key;
}

function assertCheckoutKeySafe(config: StripeConfig) {
  const key = config.secretKey || process.env.STRIPE_SECRET_KEY || "";
  if (bool(process.env.ROUTER_DEV_MODE) && key.startsWith("sk_live_") && !bool(process.env.STRIPE_ALLOW_LIVE_CHECKOUT)) {
    throw Object.assign(
      new Error("Refusing to create live Stripe Checkout Sessions while ROUTER_DEV_MODE is enabled"),
      {
        statusCode: 500,
        code: "stripe_live_key_in_dev",
      },
    );
  }
}

function checkoutUrl(value: string | undefined, fallback: string) {
  if (value) return value;
  if (bool(process.env.ROUTER_DEV_MODE)) return fallback;
  throw Object.assign(new Error("Stripe checkout success and cancel URLs are required"), {
    statusCode: 500,
    code: "stripe_not_configured",
  });
}

function amountUsdToCents(amountUsd: string) {
  const normalized = String(amountUsd || "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw Object.assign(new Error("amountUsd must be a positive USD amount in whole cents"), {
      statusCode: 400,
      code: "invalid_amount",
    });
  }
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function stripeSignatureParts(header: string) {
  return header.split(",").reduce(
    (parts, item) => {
      const [key, value] = item.split("=");
      if (key === "t") parts.timestamp = value;
      if (key === "v1" && value) parts.signatures.push(value);
      return parts;
    },
    { timestamp: "", signatures: [] as string[] },
  );
}

export class StripeClient {
  config: StripeConfig;

  constructor(config: StripeConfig = {}) {
    this.config = {
      apiBase: process.env.STRIPE_API_BASE_URL || "https://api.stripe.com",
      successUrl: process.env.TOOLROUTER_CHECKOUT_SUCCESS_URL,
      cancelUrl: process.env.TOOLROUTER_CHECKOUT_CANCEL_URL,
      ...config,
    };
  }

  get configured() {
    return Boolean(this.config.secretKey || process.env.STRIPE_SECRET_KEY);
  }

  assertCheckoutAllowed() {
    assertCheckoutKeySafe(this.config);
  }

  async request(path: string, body: URLSearchParams) {
    const response = await fetch(`${this.config.apiBase}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${requireSecretKey(this.config)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw Object.assign(new Error(data?.error?.message || `Stripe request failed: ${response.status}`), {
        statusCode: response.status >= 500 ? 502 : 400,
        code: "stripe_error",
      });
    }
    return data;
  }

  async createCheckoutSession({
    user,
    amountUsd,
    purchaseId,
  }: {
    user: { user_id: string; email?: string | null };
    amountUsd: string;
    purchaseId: string;
  }) {
    if (bool(process.env.ROUTER_DEV_MODE) && !this.configured) {
      return {
        provider_reference: `cs_dev_${randomUUID()}`,
        checkout_url: `https://checkout.stripe.local/session/${purchaseId}`,
        payment_intent: `pi_dev_${randomUUID()}`,
        raw: { dev: true },
      };
    }
    assertCheckoutKeySafe(this.config);

    const amountCents = amountUsdToCents(amountUsd);
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("client_reference_id", purchaseId);
    params.set("success_url", checkoutUrl(this.config.successUrl, "http://127.0.0.1:3000/dashboard#billing"));
    params.set("cancel_url", checkoutUrl(this.config.cancelUrl, "http://127.0.0.1:3000/dashboard#billing"));
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(amountCents));
    params.set("line_items[0][price_data][product_data][name]", "ToolRouter credits");
    params.set("payment_method_types[0]", "card");
    params.set("metadata[toolrouter_purchase_id]", purchaseId);
    params.set("metadata[toolrouter_user_id]", user.user_id);
    params.set("metadata[amount_usd]", amountUsd);
    if (user.email) params.set("customer_email", user.email);

    const session = await this.request("/v1/checkout/sessions", params);
    return {
      provider_reference: session.id,
      checkout_url: session.url,
      payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
      raw: session,
    };
  }

  constructWebhookEvent(rawBody: string, headers: Record<string, any>) {
    const secret = this.config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      if (bool(process.env.ROUTER_DEV_MODE)) return JSON.parse(rawBody || "{}");
      throw Object.assign(new Error("STRIPE_WEBHOOK_SECRET is required"), {
        statusCode: 500,
        code: "stripe_not_configured",
      });
    }

    const header = String(headers["stripe-signature"] || "").trim();
    const parts = stripeSignatureParts(header);
    if (!parts.timestamp || !parts.signatures.length) {
      throw Object.assign(new Error("missing Stripe webhook signature"), {
        statusCode: 401,
        code: "invalid_webhook_signature",
      });
    }
    const expected = createHmac("sha256", secret).update(`${parts.timestamp}.${rawBody}`).digest("hex");
    if (!parts.signatures.some((candidate) => constantTimeEqual(candidate, expected))) {
      throw Object.assign(new Error("invalid Stripe webhook signature"), {
        statusCode: 401,
        code: "invalid_webhook_signature",
      });
    }
    return JSON.parse(rawBody || "{}");
  }
}

export function createStripeClient(config: StripeConfig = {}) {
  return new StripeClient(config);
}
