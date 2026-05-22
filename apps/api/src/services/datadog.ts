type DatadogEnv = Record<string, string | undefined>;

type DatadogClientConfig = {
  env?: DatadogEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type MetricTags = Record<string, string | number | boolean | null | undefined>;

const METRIC_TYPE_COUNT = 1;
const METRIC_TYPE_GAUGE = 3;
const BLOCKED_TAG_KEYS = new Set([
  "api_key",
  "authorization",
  "payment_header",
  "request_id",
  "request_time",
  "signature",
  "trace_id",
  "wallet_address",
]);

function trimSlash(value: string) {
  return value.replace(/\/$/u, "");
}

function datadogBaseUrl(env: DatadogEnv) {
  const site = env.DD_SITE || env.DATADOG_SITE || "datadoghq.com";
  if (/^https?:\/\//u.test(site)) return trimSlash(site);
  return `https://api.${trimSlash(site)}`;
}

function tagValue(value: unknown) {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_.:/-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 200) || "unknown";
}

export function datadogTags(tags: MetricTags = {}, env: DatadogEnv = process.env) {
  const baseTags = {
    env: env.DD_ENV || env.DATADOG_ENV || env.NODE_ENV || "production",
    service: env.DD_SERVICE || env.DATADOG_SERVICE || "toolrouter-api",
    source: env.DD_SOURCE || env.DATADOG_SOURCE || "toolrouter",
    ...tags,
  };
  return Object.entries(baseTags)
    .filter(([key, value]) => {
      if (value === undefined || value === null || value === "") return false;
      return !BLOCKED_TAG_KEYS.has(tagValue(key));
    })
    .map(([key, value]) => `${tagValue(key)}:${tagValue(value)}`);
}

export function createDatadogClient({
  env = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
}: DatadogClientConfig = {}) {
  const apiKey = env.DD_API_KEY || env.DATADOG_API_KEY;
  const configured = Boolean(apiKey);

  async function submit(metric: string, type: number, tags: MetricTags = {}, value = 1) {
    if (!configured) return { sent: false, skipped: true };
    const response = await fetchImpl(`${datadogBaseUrl(env)}/api/v2/series`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "DD-API-KEY": apiKey as string,
      },
      body: JSON.stringify({
        series: [
          {
            metric,
            type,
            points: [
              {
                timestamp: Math.floor(now() / 1000),
                value,
              },
            ],
            tags: datadogTags(tags, env),
          },
        ],
      }),
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Datadog metric submit failed: ${response.status}`), {
        statusCode: response.status >= 500 ? 502 : 400,
        code: "datadog_metric_error",
      });
    }
    return { sent: true, skipped: false };
  }

  async function increment(metric: string, tags: MetricTags = {}, value = 1) {
    return submit(metric, METRIC_TYPE_COUNT, tags, value);
  }

  async function gauge(metric: string, value: number, tags: MetricTags = {}) {
    return submit(metric, METRIC_TYPE_GAUGE, tags, value);
  }

  return {
    configured,
    gauge,
    increment,
  };
}
