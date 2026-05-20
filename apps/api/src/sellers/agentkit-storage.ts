// AgentKit free-trial counter + replay-nonce storage shared across all
// first-party sellers. The constructor takes a `keyspace` so each seller (or
// each endpoint within a multi-endpoint seller like Parallel) can scope its
// monthly use counters and nonce records independently:
//
//   new MonthlyAgentKitStorage(cache, "manus.research")
//   new MonthlyAgentKitStorage(cache, "parallel.task")
//
// The monthly window resets on UTC month boundaries; nonces TTL out per
// `AGENTKIT_NONCE_TTL_SECONDS` (default 10 minutes).

import { createHash } from "node:crypto";

function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

function secondsUntilNextMonth(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

function hashHumanId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class MonthlyAgentKitStorage {
  cache: any;
  keyspace: string;

  constructor(cache: any, keyspace: string) {
    this.cache = cache;
    this.keyspace = keyspace;
  }

  async tryIncrementUsage(endpoint: string, humanId: string, limit: number) {
    const key = `agentkit:${this.keyspace}:${endpoint}:${monthKey()}:${hashHumanId(humanId)}`;
    const result = await this.cache.increment({
      key,
      limit,
      windowSeconds: secondsUntilNextMonth(),
    });
    return result.value <= limit;
  }

  async hasUsedNonce(nonce: string) {
    if (typeof this.cache.has !== "function") return false;
    return this.cache.has({ key: `agentkit:${this.keyspace}:nonce:${hashHumanId(nonce)}` });
  }

  async recordNonce(nonce: string) {
    if (typeof this.cache.set !== "function") return;
    await this.cache.set({
      key: `agentkit:${this.keyspace}:nonce:${hashHumanId(nonce)}`,
      windowSeconds: Number(process.env.AGENTKIT_NONCE_TTL_SECONDS || 10 * 60),
    });
  }
}
