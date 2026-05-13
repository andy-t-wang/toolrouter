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

  it("sends metric payloads with safe low-cardinality tags", async () => {
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
      endpoint: "exa.search",
      path: "agentkit",
      authorization: "Bearer tr_secret",
      payment_header: "x402_secret",
      request_id: "req_123",
      trace_id: "trace_123",
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
    assert.ok(payloads[0].series[0].tags.includes("endpoint:exa.search"));
    assert.ok(payloads[0].series[0].tags.includes("path:agentkit"));
    assert.ok(!payloads[0].series[0].tags.some((tag) => tag.includes("request_id")));
    assert.ok(!payloads[0].series[0].tags.some((tag) => tag.includes("trace_id")));
    assert.ok(!payloads[0].series[0].tags.some((tag) => tag.includes("authorization")));
    assert.ok(!payloads[0].series[0].tags.some((tag) => tag.includes("payment_header")));
    assert.ok(!payloads[1].series[0].tags.some((tag) => tag.includes("request_time")));
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

  it("keeps request tables low-cardinality", () => {
    assert.match(datadogDashboardScript, /by \{endpoint,status,status_code,path\}/);
    assert.match(datadogDashboardScript, /title: "Requests by endpoint and status"/);
    assert.doesNotMatch(datadogDashboardScript, /max:toolrouter\.requests\.timestamp/);
    assert.doesNotMatch(datadogDashboardScript, /request_id/);
    assert.doesNotMatch(datadogDashboardScript, /trace_id/);
    assert.doesNotMatch(datadogDashboardScript, /request_time/);
  });

  it("keeps the request chart to success and fail only", () => {
    assert.match(datadogDashboardScript, /status:fail,!status_code:402/);
    assert.match(datadogDashboardScript, /THIRTY_MINUTES_SECONDS = 1800/);
    assert.match(datadogDashboardScript, /Requests: success vs fail/);
    assert.match(datadogDashboardScript, /metricFormulaQueries\(\[/);
    assert.match(datadogDashboardScript, /formula: item\.name,\s+alias: item\.alias/);
    assert.match(datadogDashboardScript, /palette_index: item\.paletteIndex \?\? 0/);
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
