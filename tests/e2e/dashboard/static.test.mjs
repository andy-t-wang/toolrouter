import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const landingPage = readFileSync(new URL("../../../apps/web/app/page.tsx", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../../../apps/web/app/dashboard/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../../apps/web/app/globals.css", import.meta.url), "utf8");

describe("web dashboard static wiring", () => {
  it("keeps the public landing page at the root route", () => {
    assert.match(landingPage, /ToolRouter/);
    assert.match(landingPage, /AgentKit-first API proxy/);
    assert.match(landingPage, /Open dashboard/);
    assert.match(landingPage, /\/dashboard/);
    assert.match(landingPage, /\/v1\/requests/);
  });

  it("keeps the operational dashboard on the dashboard route", () => {
    assert.match(dashboardPage, /Requests/);
    assert.match(dashboardPage, /Total paid/);
    assert.match(dashboardPage, /% using AgentKit/);
    assert.match(dashboardPage, /AgentKit vs x402/);
    assert.match(dashboardPage, /Recent calls/);
    assert.match(dashboardPage, /Credit balance/);
    assert.doesNotMatch(dashboardPage, /Endpoint operations/);
  });

  it("uses dashboard session routes and resource-style router endpoints", () => {
    assert.match(dashboardPage, /\/v1\/dashboard\/requests/);
    assert.match(dashboardPage, /\/v1\/api-keys/);
    assert.match(dashboardPage, /\/v1\/balance/);
    assert.match(dashboardPage, /\/v1\/top-ups/);
    assert.match(dashboardPage, /\/v1\/requests/);
    assert.doesNotMatch(dashboardPage, /\/call/);
    assert.doesNotMatch(dashboardPage, /\/fetch/);
    assert.doesNotMatch(dashboardPage, /\/usage/);
  });

  it("keeps the ToolRouter visual system in the Next app", () => {
    assert.match(css, /--bone/);
    assert.match(css, /\.landing-hero/);
    assert.match(css, /\.topnav/);
    assert.match(css, /\.recent-calls-table/);
    assert.match(css, /\.billing-grid/);
  });
});
