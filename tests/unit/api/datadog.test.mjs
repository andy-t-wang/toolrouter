import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { createDatadogClient, datadogTags } = await import("../../../apps/api/src/datadog.ts");
const datadogDashboardScript = readFileSync(
  new URL("../../../scripts/datadog-dashboard.mjs", import.meta.url),
  "utf8",
);

describe("Datadog metrics helper", () => {
  it("is a no-op when Datadog is not configured", async () => {
    let called = false;
    const client = createDatadogClient({
      env: {},
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 202 });
      },
    });

    assert.equal(client.configured, false);
    assert.deepEqual(await client.increment("toolrouter.requests.count"), {
      sent: false,
      skipped: true,
    });
    assert.deepEqual(await client.gauge("toolrouter.requests.timestamp", 1), {
      sent: false,
      skipped: true,
    });
    assert.equal(called, false);
  });

  it("sends count and gauge metric payloads with safe tags", async () => {
    const payloads = [];
    const client = createDatadogClient({
      env: {
        DD_API_KEY: "dd_test",
        DD_ENV: "production",
        DD_SERVICE: "toolrouter-api",
        DD_SOURCE: "toolrouter",
      },
      now: () => Date.parse("2026-05-11T08:00:00.000Z"),
      fetchImpl: async (_url, init) => {
        payloads.push(JSON.parse(init.body));
        return new Response("{}", { status: 202 });
      },
    });

    await client.increment("toolrouter.requests.count", {
      status: "success",
      request_id: "req_123",
      authorization: "",
      payment_header: undefined,
    });
    await client.gauge("toolrouter.requests.timestamp", 1_746_950_400, {
      status: "success",
      request_time: "2026-05-11T08:00:00Z",
    });

    assert.equal(payloads.length, 2);
    assert.equal(payloads[0].series[0].metric, "toolrouter.requests.count");
    assert.equal(payloads[0].series[0].type, 1);
    assert.equal(payloads[0].series[0].points[0].value, 1);
    assert.equal(payloads[1].series[0].metric, "toolrouter.requests.timestamp");
    assert.equal(payloads[1].series[0].type, 3);
    assert.equal(payloads[1].series[0].points[0].value, 1_746_950_400);
    assert.ok(payloads[0].series[0].tags.includes("request_id:req_123"));
    assert.ok(payloads[1].series[0].tags.includes("request_time:2026-05-11t08:00:00z"));
    assert.ok(!payloads[0].series[0].tags.some((tag) => tag.includes("authorization")));
    assert.ok(!payloads[0].series[0].tags.some((tag) => tag.includes("payment_header")));
  });

  it("keeps base tags stable", () => {
    assert.deepEqual(
      datadogTags({ endpoint: "exa.search" }, { DD_ENV: "production" }),
      [
        "env:production",
        "service:toolrouter-api",
        "source:toolrouter",
        "endpoint:exa.search",
      ],
    );
  });

  it("sorts the recent requests table by request timestamp", () => {
    assert.match(datadogDashboardScript, /by \{request_time,request_id,trace_id,endpoint,status,status_code,path\}/);
    assert.match(datadogDashboardScript, /title: "Recent requests by time"/);
    assert.doesNotMatch(datadogDashboardScript, /max:toolrouter\.requests\.timestamp/);
    assert.match(datadogDashboardScript, /type: "group",\s+name: "request_time",\s+order: "desc"/);
  });

  it("keeps the request chart to success and fail only", () => {
    assert.match(datadogDashboardScript, /status:fail,!status_code:402/);
    assert.match(datadogDashboardScript, /THIRTY_MINUTES_SECONDS = 1800/);
    assert.match(datadogDashboardScript, /Requests: success vs fail/);
    assert.match(datadogDashboardScript, /metricFormulaQuery\("success"[\s\S]+"Success"/);
    assert.match(datadogDashboardScript, /metricFormulaQuery\("fail"[\s\S]+"Fail"/);
    assert.match(datadogDashboardScript, /formula: name,\s+alias/);
    assert.match(datadogDashboardScript, /status:success[\s\S]+palette: "green"/);
    assert.match(datadogDashboardScript, /status:fail,!status_code:402[\s\S]+palette: "red"/);
    assert.doesNotMatch(datadogDashboardScript, /status_code:402[\s\S]+palette: "gray"/);
    assert.doesNotMatch(datadogDashboardScript, /rollup\(sum, 3600\)/);
    assert.doesNotMatch(
      datadogDashboardScript,
      /toolrouter\.requests\.count\{env:production,source:toolrouter\} by \{status\}/,
    );
  });
});
