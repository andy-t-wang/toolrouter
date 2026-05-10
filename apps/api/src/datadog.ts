type DatadogEnv = Record<string, string | undefined>;

type DatadogClientConfig = {
  env?: DatadogEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type MetricTags = Record<string, string | number | boolean | null | undefined>;

const METRIC_TYPE_COUNT = 1;

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
    .filter(([_key, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${tagValue(key)}:${tagValue(value)}`);
}

export function createDatadogClient({
  env = process.env,
  fetchImpl = fetch,
  now = () => Date.now(),
}: DatadogClientConfig = {}) {
  const apiKey = env.DD_API_KEY || env.DATADOG_API_KEY;
  const configured = Boolean(apiKey);

  async function increment(metric: string, tags: MetricTags = {}, value = 1) {
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
            type: METRIC_TYPE_COUNT,
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
      const text = await response.text().catch(() => "");
      throw Object.assign(new Error(`Datadog metric submit failed: ${response.status}`), {
        statusCode: response.status >= 500 ? 502 : 400,
        code: "datadog_metric_error",
        details: text.slice(0, 300),
      });
    }
    return { sent: true, skipped: false };
  }

  return {
    configured,
    increment,
  };
}
