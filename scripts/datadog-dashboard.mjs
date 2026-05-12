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

function queryTable(title, queryString) {
  return {
    definition: {
      type: "query_table",
      title,
      requests: [
        {
          response_format: "scalar",
          queries: [
            {
              data_source: "metrics",
              name: "request_count",
              query: queryString,
              aggregator: "sum",
            },
          ],
          formulas: [
            {
              formula: "request_count",
            },
          ],
          sort: {
            count: 100,
            order_by: [
              {
                type: "formula",
                index: 0,
                order: "desc",
              },
            ],
          },
        },
      ],
    },
  };
}

function recentRequestsTable() {
  return {
    definition: {
      type: "query_table",
      title: "Recent requests by time",
      requests: [
        {
          response_format: "scalar",
          queries: [
            {
              data_source: "metrics",
              name: "request_count",
              query: "sum:toolrouter.requests.count{env:production,source:toolrouter} by {request_time,request_id,trace_id,endpoint,status,status_code,path}.as_count().rollup(sum, 60)",
              aggregator: "sum",
            },
          ],
          formulas: [
            {
              formula: "request_count",
              alias: "Requests",
            },
          ],
          sort: {
            count: 100,
            order_by: [
              {
                type: "group",
                name: "request_time",
                order: "desc",
              },
            ],
          },
        },
      ],
    },
  };
}

function query(q, displayType = "bars", options = {}) {
  const request = {
    display_type: displayType,
    q,
  };
  if (options.alias) {
    request.metadata = [
      {
        expression: q,
        alias_name: options.alias,
      },
    ];
  }
  if (options.palette) {
    request.style = {
      palette: options.palette,
    };
  }
  return request;
}

function metricFormulaQuery(name, q, alias, displayType = "bars", options = {}) {
  const request = {
    display_type: displayType,
    response_format: "timeseries",
    queries: [
      {
        data_source: "metrics",
        name,
        query: q,
      },
    ],
    formulas: [
      {
        formula: name,
        alias,
      },
    ],
  };
  if (options.palette) {
    request.style = {
      palette: options.palette,
    };
  }
  return request;
}

const THIRTY_MINUTES_SECONDS = 1800;

const dashboard = {
  title: dashboardTitle,
  description: "Product-wide ToolRouter operations metrics from API-emitted Datadog count metrics.",
  layout_type: "ordered",
  widgets: [
    timeseries("Requests: success vs fail", [
      metricFormulaQuery("success", `sum:toolrouter.requests.count{env:production,source:toolrouter,status:success}.as_count().rollup(sum, ${THIRTY_MINUTES_SECONDS})`, "Success", "bars", { palette: "green" }),
      metricFormulaQuery("fail", `sum:toolrouter.requests.count{env:production,source:toolrouter,status:fail,!status_code:402}.as_count().rollup(sum, ${THIRTY_MINUTES_SECONDS})`, "Fail", "bars", { palette: "red" }),
    ]),
    recentRequestsTable(),
    timeseries("AgentKit uses per 30 min", [
      query(`sum:toolrouter.agentkit.uses.count{env:production,source:toolrouter}.as_count().rollup(sum, ${THIRTY_MINUTES_SECONDS})`),
    ]),
    timeseries("AgentKit registrations per 30 min", [
      query(`sum:toolrouter.agentkit.registrations.count{env:production,source:toolrouter,status:completed}.as_count().rollup(sum, ${THIRTY_MINUTES_SECONDS})`),
    ]),
    timeseries("Stripe sessions per 30 min", [
      query(`sum:toolrouter.stripe.sessions.count{env:production,source:toolrouter} by {status}.as_count().rollup(sum, ${THIRTY_MINUTES_SECONDS})`),
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
