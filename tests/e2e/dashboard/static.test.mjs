import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const landingPage = readFileSync(new URL("../../../apps/web/app/page.tsx", import.meta.url), "utf8");
const agentationDev = readFileSync(new URL("../../../apps/web/app/agentation-dev.tsx", import.meta.url), "utf8");
const setupPage = readFileSync(new URL("../../../apps/web/app/setup/page.tsx", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../../../apps/web/app/dashboard/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../../apps/web/app/globals.css", import.meta.url), "utf8");

describe("web dashboard static wiring", () => {
  it("keeps the public landing page at the root route", () => {
    assert.match(landingPage, /ToolRouter/);
    assert.match(landingPage, /Tools your agent/);
    assert.match(landingPage, /Get an API key/);
    assert.match(landingPage, /View console/);
    assert.match(landingPage, /\/setup/);
    assert.match(landingPage, /\/docs/);
    assert.match(landingPage, /Hermes/);
    assert.match(landingPage, /OpenClaw/);
    assert.match(landingPage, /OpenJarvis/);
    assert.match(landingPage, /ZeroClaw/);
    assert.match(landingPage, /Codex/);
    assert.match(landingPage, /Claude/);
    assert.match(landingPage, /\/dashboard/);
    assert.match(landingPage, /\/v1\/status/);
    assert.match(landingPage, /<AgentationDev \/>/);
    assert.doesNotMatch(landingPage, /Get an MCP key/);
    assert.doesNotMatch(landingPage, /Pricing/);
    assert.doesNotMatch(landingPage, /Changelog/);
  });

  it("mounts Agentation on the public landing page in development", () => {
    assert.match(agentationDev, /"use client"/);
    assert.match(agentationDev, /import \{ Agentation \} from "agentation"/);
    assert.match(agentationDev, /process\.env\.NODE_ENV !== "development"/);
    assert.match(agentationDev, /<Agentation \/>/);
  });

  it("presents setup around generic tool categories before provider-specific endpoints", () => {
    assert.match(setupPage, /Tool categories/);
    assert.match(setupPage, /search/);
    assert.match(setupPage, /browser use/);
    assert.match(setupPage, /toolrouter_list_categories/);
    assert.match(setupPage, /recommended endpoint/);
    assert.doesNotMatch(setupPage, /Available tools/);
  });

  it("keeps the operational dashboard on the dashboard route", () => {
    assert.match(dashboardPage, /Requests/);
    assert.match(dashboardPage, /Total paid/);
    assert.match(dashboardPage, /% using AgentKit/);
    assert.match(dashboardPage, /AgentKit vs x402/);
    assert.match(dashboardPage, /Recent calls/);
    assert.doesNotMatch(dashboardPage, /Endpoint registry/);
    assert.doesNotMatch(dashboardPage, /Supabase monitoring/);
    assert.match(dashboardPage, /Account Verification/);
    assert.match(dashboardPage, /Check the account against AgentKit/);
    assert.match(dashboardPage, /Check Status/);
    assert.match(dashboardPage, /Credit balance/);
    assert.match(dashboardPage, /Credits usually appear within 30-90 seconds after checkout/);
    assert.match(dashboardPage, /ToolRouter retries settlement/);
    assert.match(dashboardPage, /copy-key-button/);
    assert.match(dashboardPage, /Copied/);
    assert.doesNotMatch(dashboardPage, /Payment address/);
    assert.doesNotMatch(dashboardPage, /Base USDC/);
    assert.doesNotMatch(dashboardPage, /Pending/);
    assert.doesNotMatch(dashboardPage, /Reserved/);
    assert.doesNotMatch(dashboardPage, /not verified/);
    assert.doesNotMatch(dashboardPage, /Check wallet/);
    assert.doesNotMatch(dashboardPage, /Check account against AgentKit/);
    assert.doesNotMatch(dashboardPage, /billing wallet/);
    assert.doesNotMatch(dashboardPage, /Endpoint operations/);
  });

  it("uses dashboard session routes and resource-style router endpoints", () => {
    assert.match(dashboardPage, /\/v1\/dashboard\/requests/);
    assert.doesNotMatch(dashboardPage, /\/v1\/dashboard\/endpoints/);
    assert.match(dashboardPage, /\/v1\/api-keys/);
    assert.match(dashboardPage, /\/v1\/balance/);
    assert.match(dashboardPage, /\/v1\/agentkit\/account-verification/);
    assert.match(dashboardPage, /\/v1\/top-ups/);
    assert.match(dashboardPage, /\/v1\/requests/);
    assert.doesNotMatch(dashboardPage, /\/call/);
    assert.doesNotMatch(dashboardPage, /\/fetch/);
    assert.doesNotMatch(dashboardPage, /\/usage/);
  });

  it("keeps the ToolRouter visual system in the Next app", () => {
    assert.match(css, /--bone/);
    assert.match(css, /\.mkt-hero/);
    assert.match(css, /\.topnav/);
    assert.match(css, /\.recent-calls-table/);
    assert.match(css, /\.billing-grid/);
  });
});
