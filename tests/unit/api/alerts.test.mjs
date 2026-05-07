import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { createAlertClient } from "../../../apps/api/src/alerts.ts";

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.TOOLROUTER_ALERT_EMAIL;
  delete process.env.TOOLROUTER_ALERT_FROM;
});

describe("operational alerts", () => {
  it("skips email delivery when Resend is not configured", async () => {
    const alert = createAlertClient();
    const result = await alert.sendOperationalAlert({
      subject: "Funding failed",
      text: "test",
    });

    assert.equal(result.sent, false);
    assert.equal(result.skipped, true);
  });

  it("sends alerts through Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.TOOLROUTER_ALERT_EMAIL = "andy.wang@toolsforhumanity.com";
    const calls = [];
    const alert = createAlertClient({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      },
    });

    const result = await alert.sendOperationalAlert({
      subject: "Funding failed",
      text: "test",
    });

    assert.equal(result.sent, true);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(calls[0].init.headers.authorization, "Bearer re_test");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.to, "andy.wang@toolsforhumanity.com");
    assert.equal(body.subject, "Funding failed");
  });
});
