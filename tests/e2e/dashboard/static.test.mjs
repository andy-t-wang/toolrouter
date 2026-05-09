import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const landingPage = readFileSync(new URL("../../../apps/web/app/page.tsx", import.meta.url), "utf8");
const agentationDev = readFileSync(new URL("../../../apps/web/app/agentation-dev.tsx", import.meta.url), "utf8");
const setupPage = readFileSync(new URL("../../../apps/web/app/setup/page.tsx", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../../../apps/web/app/dashboard/page.tsx", import.meta.url), "utf8");
const authConfirmRoute = readFileSync(new URL("../../../apps/web/app/auth/confirm/route.ts", import.meta.url), "utf8");
const confirmationTemplate = readFileSync(new URL("../../../supabase/email-templates/confirmation.html", import.meta.url), "utf8");
const magicLinkTemplate = readFileSync(new URL("../../../supabase/email-templates/magic-link.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../../apps/web/app/globals.css", import.meta.url), "utf8");

describe("web dashboard static wiring", () => {
  it("keeps the public landing page at the root route", () => {
    assert.match(landingPage, /ToolRouter/);
    assert.match(landingPage, /\/toolrouter-mark\.svg/);
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
    assert.doesNotMatch(landingPage, /http:\/\/127\.0\.0\.1:9402/);
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
    assert.match(setupPage, /https:\/\/toolrouter\.world/);
    assert.doesNotMatch(setupPage, /localhost/);
    assert.doesNotMatch(setupPage, /127\.0\.0\.1/);
    assert.doesNotMatch(setupPage, /127\.0\.0\.1:9402/);
    assert.match(setupPage, /Codex/);
    assert.match(setupPage, /Claude Code/);
    assert.match(setupPage, /Cursor/);
    assert.match(setupPage, /Hermes Agent/);
    assert.match(setupPage, /OpenClaw/);
    assert.match(setupPage, /start:mcp/);
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
    assert.match(dashboardPage, /Verify this account with AgentKit through World App/);
    assert.match(dashboardPage, /Verify with AgentKit/);
    assert.match(dashboardPage, /QRCodeSVG/);
    assert.match(dashboardPage, /Scan with World App/);
    assert.match(dashboardPage, /Open verification link/);
    assert.match(dashboardPage, /ToolRouter returned an unexpected response/);
    assert.match(dashboardPage, /World App verification returned an unexpected response/);
    assert.match(dashboardPage, /\/v1\/agentkit\/registration/);
    assert.match(dashboardPage, /\/v1\/agentkit\/registration\/complete/);
    assert.match(dashboardPage, /\/human\.svg/);
    assert.match(dashboardPage, /request sent with agentkit/);
    assert.match(dashboardPage, /Credit balance/);
    assert.match(dashboardPage, /\/v1\/top-ups\?limit=10/);
    assert.match(dashboardPage, /activeTopUps\.length \? \(/);
    assert.match(dashboardPage, /status === "funding_pending"/);
    assert.doesNotMatch(dashboardPage, /funding_failed[\s\S]*billing-notice/);
    assert.match(dashboardPage, /Credits usually appear within 30-90 seconds after\s+checkout/);
    assert.match(dashboardPage, /ToolRouter retries settlement/);
    assert.match(dashboardPage, /top_up_settled: "Credits added"/);
    assert.match(dashboardPage, /ledgerTypeLabel\(entry\.type\)/);
    assert.match(dashboardPage, /copy-key-button/);
    assert.match(dashboardPage, /Copied/);
    assert.doesNotMatch(dashboardPage, /Payment address/);
    assert.doesNotMatch(dashboardPage, /Checkout created:/);
    assert.doesNotMatch(dashboardPage, /checkout_url\}`/);
    assert.doesNotMatch(dashboardPage, /Base USDC/);
    assert.doesNotMatch(dashboardPage, /Pending/);
    assert.doesNotMatch(dashboardPage, /Reserved/);
    assert.doesNotMatch(dashboardPage, /not verified/);
    assert.doesNotMatch(dashboardPage, /Not Verified/);
    assert.doesNotMatch(dashboardPage, /Check wallet/);
    assert.doesNotMatch(dashboardPage, /Check account against AgentKit/);
    assert.doesNotMatch(dashboardPage, /billing wallet/);
    assert.doesNotMatch(dashboardPage, /Endpoint operations/);
    assert.doesNotMatch(dashboardPage, /99\.4% \/ 24h/);
    assert.doesNotMatch(dashboardPage, /className="avatar"/);
  });

  it("uses dashboard session routes and resource-style router endpoints", () => {
    assert.match(dashboardPage, /NEXT_PUBLIC_TOOLROUTER_APP_URL/);
    assert.match(dashboardPage, /emailRedirectTo/);
    assert.match(dashboardPage, /\/v1\/dashboard\/requests/);
    assert.doesNotMatch(dashboardPage, /\/v1\/dashboard\/endpoints/);
    assert.match(dashboardPage, /\/v1\/api-keys/);
    assert.match(dashboardPage, /\/v1\/balance/);
    assert.match(dashboardPage, /\/v1\/agentkit\/account-verification/);
    assert.match(dashboardPage, /\/v1\/top-ups/);
    assert.match(dashboardPage, /https:\/\/toolrouter\.world/);
    assert.match(dashboardPage, /quickstartMcpConfig/);
    assert.match(dashboardPage, /Set up MCP/);
    assert.match(dashboardPage, /First query/);
    assert.match(dashboardPage, /toolrouter_search/);
    assert.doesNotMatch(dashboardPage, /AgentKit examples/);
    assert.doesNotMatch(dashboardPage, /endpoint_id: "exa\.search"/);
    assert.doesNotMatch(dashboardPage, /\/call/);
    assert.doesNotMatch(dashboardPage, /\/fetch/);
    assert.doesNotMatch(dashboardPage, /\/usage/);
  });

  it("keeps auth confirmation links on the ToolRouter domain", () => {
    assert.match(confirmationTemplate, /\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}/);
    assert.match(confirmationTemplate, /type=signup/);
    assert.match(magicLinkTemplate, /\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}/);
    assert.match(magicLinkTemplate, /type=magiclink/);
    assert.match(authConfirmRoute, /verifyOtp/);
    assert.match(authConfirmRoute, /token_hash/);
    assert.match(authConfirmRoute, /access_token/);
    assert.doesNotMatch(confirmationTemplate, /\.ConfirmationURL/);
    assert.doesNotMatch(magicLinkTemplate, /\.ConfirmationURL/);
    assert.doesNotMatch(magicLinkTemplate, /Your Magic Link/);
  });

  it("keeps the ToolRouter visual system in the Next app", () => {
    assert.match(css, /--bone/);
    assert.match(css, /\.mkt-hero/);
    assert.match(css, /\.topnav/);
    assert.match(css, /\.recent-calls-table/);
    assert.match(css, /\.billing-grid/);
  });
});
