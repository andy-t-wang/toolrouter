type AlertPayload = {
  subject: string;
  text: string;
  metadata?: Record<string, unknown>;
};

function configuredRecipient() {
  return process.env.TOOLROUTER_ALERT_EMAIL || "ops@toolrouter.world";
}

function configuredSender() {
  return process.env.TOOLROUTER_ALERT_FROM || "ToolRouter <alerts@toolrouter.world>";
}

export function createAlertClient({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  return {
    async sendOperationalAlert(payload: AlertPayload) {
      const apiKey = process.env.RESEND_API_KEY;
      const to = configuredRecipient();
      const from = configuredSender();
      if (!apiKey) {
        console.warn(
          JSON.stringify({
            service: "toolrouter-alerts",
            skipped: true,
            reason: "RESEND_API_KEY missing",
            to,
            subject: payload.subject,
          }),
        );
        return { sent: false, skipped: true, reason: "RESEND_API_KEY missing" };
      }

      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          subject: payload.subject,
          text: payload.text,
          headers: {
            "X-ToolRouter-Alert": "operational",
          },
          tags: [{ name: "kind", value: "funding_failure" }],
        }),
      });
      if (!response.ok) {
        throw Object.assign(new Error(`alert email failed: ${response.status}`), {
          statusCode: 502,
          code: "alert_email_failed",
        });
      }
      return { sent: true, skipped: false };
    },
  };
}
