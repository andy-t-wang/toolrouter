// POST /webhooks/stripe — Stripe checkout webhook receiver.
//
// IMPORTANT: this plugin MUST be registered AFTER the raw-body content-type
// parser in `createApiApp`. The webhook signature verification reads
// `request.rawBody` (set by the parser) and re-derives the HMAC from the
// original bytes. Registering before the parser breaks signature verification.

import {
  checkoutSessionFromEvent,
  processStripeCheckoutCompleted,
  processStripeCheckoutFailed,
} from "../services/stripe-webhook.ts";

function rawBodyFrom(request: any) {
  if (typeof request.rawBody === "string") return request.rawBody;
  if (request.body === undefined) return "";
  return JSON.stringify(request.body);
}

function recordStripeSessionMetric(datadog: any, status: string) {
  datadog?.increment?.("toolrouter.stripe.sessions.count", {
    status,
  }).catch(() => undefined);
}

export async function stripeRoutes(app: any) {
  const { store, crossmint, stripe, alerts, datadog } = app;

  app.post("/webhooks/stripe", async (request: any, reply: any) => {
    const rawBody = rawBodyFrom(request);
    const event = stripe.constructWebhookEvent(rawBody, request.headers);
    const session = checkoutSessionFromEvent(event);

    if (
      event?.type === "checkout.session.completed" ||
      event?.type === "checkout.session.async_payment_succeeded"
    ) {
      const result = await processStripeCheckoutCompleted({
        store,
        crossmint,
        alerts,
        session,
        event,
      });
      recordStripeSessionMetric(
        datadog,
        result?.ok === false ? "failed" : "completed",
      );
      if (result?.ok === false) reply.status(500);
      return result;
    }

    if (
      event?.type === "checkout.session.expired" ||
      event?.type === "checkout.session.async_payment_failed"
    ) {
      const result = await processStripeCheckoutFailed({
        store,
        session,
        event,
      });
      recordStripeSessionMetric(
        datadog,
        event?.type === "checkout.session.expired" ? "expired" : "failed",
      );
      return result;
    }

    return {
      ok: true,
      ignored: true,
      type: event?.type || null,
    };
  });
}
