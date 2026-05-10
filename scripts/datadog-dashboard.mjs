const apiKey = process.env.DD_API_KEY || process.env.DATADOG_API_KEY;
const appKey = process.env.DD_APP_KEY || process.env.DATADOG_APP_KEY;
const site = process.env.DD_SITE || process.env.DATADOG_SITE || "datadoghq.com";
const dashboardTitle = process.env.DD_TOOLROUTER_DASHBOARD_TITLE || "ToolRouter Product Ops";

if (!apiKey || !appKey) {
  console.error("Missing DD_API_KEY or DD_APP_KEY.");
  process.exit(1);
}

function trimSlash(value) {
  return value.replace(/\/$/u, "");
}

function apiBase() {
  if (/^https?:\/\//u.test(site)) return trimSlash(site);
  return `https://api.${trimSlash(site)}`;
}

function appBase() {
  if (/^https?:\/\//u.test(site)) return trimSlash(site).replace("://api.", "://app.");
  return `https://app.${trimSlash(site)}`;
}

async function datadog(path, { method = "GET", body, allowForbidden = false } = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "DD-API-KEY": apiKey,
      "DD-APPLICATION-KEY": appKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (allowForbidden && response.status === 403) return { forbidden: true };
  if (!response.ok) {
    throw new Error(`Datadog ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return data;
}

function timeseries(title, requests) {
  return {
    definition: {
      type: "timeseries",
      title,
      show_legend: true,
      requests,
    },
  };
}

function query(q, displayType = "bars") {
  return {
    display_type: displayType,
    q,
  };
}

const dashboard = {
  title: dashboardTitle,
  description: "Product-wide ToolRouter operations metrics from API-emitted Datadog count metrics.",
  layout_type: "ordered",
  widgets: [
    timeseries("Requests per day by status", [
      query("sum:toolrouter.requests.count{env:production,source:toolrouter} by {status}.as_count().rollup(sum, 86400)"),
    ]),
    timeseries("AgentKit uses per day", [
      query("sum:toolrouter.agentkit.uses.count{env:production,source:toolrouter}.as_count().rollup(sum, 86400)"),
    ]),
    timeseries("AgentKit registrations per day", [
      query("sum:toolrouter.agentkit.registrations.count{env:production,source:toolrouter,status:completed}.as_count().rollup(sum, 86400)"),
    ]),
    timeseries("Stripe sessions per day", [
      query("sum:toolrouter.stripe.sessions.count{env:production,source:toolrouter} by {status}.as_count().rollup(sum, 86400)"),
    ]),
  ],
};

const configuredDashboardId = process.env.DD_TOOLROUTER_DASHBOARD_ID;
const existing = configuredDashboardId
  ? null
  : await datadog("/api/v1/dashboard", { allowForbidden: true });
const match = configuredDashboardId
  ? { id: configuredDashboardId, title: dashboardTitle }
  : (existing?.dashboards || []).find((item) => item.title === dashboardTitle);
if (existing?.forbidden && !configuredDashboardId) {
  console.warn("Datadog app key cannot list dashboards; creating a new dashboard instead.");
}
const saved = match
  ? await datadog(`/api/v1/dashboard/${encodeURIComponent(match.id)}`, {
      method: "PUT",
      body: dashboard,
    })
  : await datadog("/api/v1/dashboard", {
      method: "POST",
      body: dashboard,
    });

const id = saved?.id || match?.id;
console.log(`Datadog dashboard ${match ? "updated" : "created"}: ${appBase()}/dashboard/${id}`);
