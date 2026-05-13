type CounterResult = {
  value: number;
  limit: number;
  remaining: number;
  resetAt: Date;
};

type LimitOptions = {
  key: string;
  limit: number;
  windowSeconds: number;
  amount?: number;
};

type KeyTtlOptions = {
  key: string;
  windowSeconds: number;
};

export class MemoryCache {
  counters = new Map<string, { value: number; expiresAt: number }>();

  async increment({ key, limit, windowSeconds, amount = 1 }: LimitOptions): Promise<CounterResult> {
    const now = Date.now();
    const current = this.counters.get(key);
    const record = current && current.expiresAt > now ? current : { value: 0, expiresAt: now + windowSeconds * 1000 };
    record.value += amount;
    this.counters.set(key, record);
    return {
      value: record.value,
      limit,
      remaining: Math.max(0, limit - record.value),
      resetAt: new Date(record.expiresAt),
    };
  }

  async has({ key }: Pick<KeyTtlOptions, "key">) {
    const current = this.counters.get(key);
    return Boolean(current && current.expiresAt > Date.now());
  }

  async set({ key, windowSeconds }: KeyTtlOptions) {
    this.counters.set(key, { value: 1, expiresAt: Date.now() + windowSeconds * 1000 });
  }
}

export class RedisCache {
  clientPromise: Promise<any>;

  constructor({ url = process.env.VALKEY_URL || process.env.REDIS_URL } = {}) {
    if (!url) throw new Error("VALKEY_URL or REDIS_URL is required");
    this.clientPromise = import("ioredis").then((module: any) => new module.default(url, { lazyConnect: true }));
  }

  async client() {
    const client = await this.clientPromise;
    if (client.status === "wait") await client.connect();
    return client;
  }

  async increment({ key, limit, windowSeconds, amount = 1 }: LimitOptions): Promise<CounterResult> {
    const client = await this.client();
    const value = Number(await client.incrbyfloat(key, amount));
    const ttl = await client.ttl(key);
    if (ttl < 0) await client.expire(key, windowSeconds);
    const resetSeconds = ttl > 0 ? ttl : windowSeconds;
    return {
      value,
      limit,
      remaining: Math.max(0, limit - value),
      resetAt: new Date(Date.now() + resetSeconds * 1000),
    };
  }

  async has({ key }: Pick<KeyTtlOptions, "key">) {
    const client = await this.client();
    return Boolean(await client.exists(key));
  }

  async set({ key, windowSeconds }: KeyTtlOptions) {
    const client = await this.client();
    await client.set(key, "1", "EX", windowSeconds);
  }
}

export function createCache() {
  if (process.env.VALKEY_URL || process.env.REDIS_URL) return new RedisCache();
  return new MemoryCache();
}

function optionalDecimal(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw Object.assign(new Error(`${label} must be a decimal USD amount`), {
      statusCode: 400,
      code: "invalid_amount",
    });
  }
  return Number(raw);
}

function limitError(message: string, details: Record<string, unknown>) {
  return Object.assign(new Error(message), {
    statusCode: 429,
    code: "policy_limit_exceeded",
    details,
  });
}

export async function enforceRequestPolicy({
  cache,
  auth,
  ip,
  estimatedUsd,
  maxUsd,
}: {
  cache: MemoryCache | RedisCache;
  auth: { api_key_id: string; user_id: string };
  ip?: string;
  estimatedUsd?: string | number | null;
  maxUsd?: string | number | null;
}) {
  const perKeyLimit = Number(process.env.TOOLROUTER_RATE_LIMIT_PER_MINUTE || 60);
  const perIpLimit = Number(process.env.TOOLROUTER_IP_RATE_LIMIT_PER_MINUTE || 120);
  const requestedMax = optionalDecimal(maxUsd, "maxUsd");
  const estimated = optionalDecimal(estimatedUsd, "estimatedUsd") || 0;

  if (requestedMax !== null && estimated > requestedMax) {
    throw Object.assign(new Error(`estimated endpoint cost ${estimated} exceeds maxUsd ${requestedMax}`), {
      statusCode: 400,
      code: "budget_exceeded",
    });
  }

  const keyRate = await cache.increment({
    key: `rl:key:${auth.api_key_id}:${Math.floor(Date.now() / 60000)}`,
    limit: perKeyLimit,
    windowSeconds: 60,
  });
  if (keyRate.value > perKeyLimit) throw limitError("API key rate limit exceeded", keyRate);

  if (ip) {
    const ipRate = await cache.increment({
      key: `rl:ip:${ip}:${Math.floor(Date.now() / 60000)}`,
      limit: perIpLimit,
      windowSeconds: 60,
    });
    if (ipRate.value > perIpLimit) throw limitError("IP rate limit exceeded", ipRate);
  }

  return {
    estimated_usd: estimated,
    rate: keyRate,
    requested_max_usd: requestedMax,
  };
}
