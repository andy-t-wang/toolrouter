#!/usr/bin/env node
// E2E smoke for the Parallel x402 wrappers. Two phases:
//
//   1) Hit the local API's /x402/parallel/{search,extract,task} routes with no
//      payment header and verify the 402 challenge body — confirms the seller
//      is wired, prices are correct, and AgentKit free-trial extension is
//      announced.
//
//   2) Call the wrapper's upstream forwarder directly (the code path that
//      runs after settlement) against Parallel's real API to prove the
//      forwarder + PARALLEL_API_KEY + response shape are correct end-to-end.
//      We can't exercise the full buyer→seller settlement locally because
//      the buyer-side executor enforces https; the production wrapper at
//      toolrouter.world is the place to run that smoke.
//
// Usage: node --env-file-if-exists=.env --import tsx scripts/smoke-parallel.mjs

import { Buffer } from "node:buffer";

if (!process.env.PARALLEL_API_KEY) {
  console.error("PARALLEL_API_KEY is required");
  process.exit(2);
}

const apiBase = process.env.SMOKE_API_BASE || "http://127.0.0.1:9402";
const secrets = { PARALLEL_API_KEY: process.env.PARALLEL_API_KEY };

function makeReply() {
  const reply = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  return reply;
}

function decodeChallenge(headers) {
  const raw = headers.get("payment-required");
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
}

async function phase1Challenge(label, path, body) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 402) {
    console.log(`  ${label}: ❌ expected 402, got ${res.status}`);
    return false;
  }
  const challenge = decodeChallenge(res.headers);
  if (!challenge) {
    console.log(`  ${label}: ❌ no payment-required header`);
    return false;
  }
  const accept = challenge.accepts[0];
  const amountUsd = (Number(accept.amount) / 1_000_000).toFixed(3);
  const freeTrial = challenge.extensions?.agentkit?.mode;
  console.log(
    `  ${label}: ✅ 402  $${amountUsd} on ${accept.network} (asset ${accept.asset.slice(0, 10)}...)  ` +
      `agentkit=${freeTrial?.type}/${freeTrial?.uses}`,
  );
  return true;
}

async function phase2Forward(label, forwarderName, inputBody) {
  const { [forwarderName]: forward } = await import(
    "../apps/api/src/sellers/parallel/upstream.ts"
  );
  const reply = makeReply();
  const result = await forward({
    request: { body: inputBody },
    reply,
    secrets,
    fetchImpl: fetch,
  });
  if (result.ok === false) {
    console.log(`  ${label}: ❌ ${result.error} (status ${reply.statusCode})`);
    return false;
  }
  const body = result.result || result.task;
  if (!body) {
    console.log(`  ${label}: ❌ unexpected wrapper shape: ${Object.keys(result).join(",")}`);
    return false;
  }
  console.log(
    `  ${label}: ✅ forwarded; provider=${result.provider}, ` +
      `keys=${Object.keys(body).slice(0, 6).join(",")}`,
  );
  return body;
}

console.log("\n--- Phase 1: x402 challenge format ---");
const p1 = [
  await phase1Challenge("parallel.search        ", "/x402/parallel/search", {
    search_queries: ["top sushi places San Francisco"],
  }),
  await phase1Challenge("parallel.extract (1 url)", "/x402/parallel/extract", {
    urls: ["https://example.com"],
  }),
  await phase1Challenge("parallel.extract (3 urls)", "/x402/parallel/extract", {
    urls: ["https://example.com", "https://example.org", "https://example.net"],
  }),
  await phase1Challenge("parallel.task (core)    ", "/x402/parallel/task", {
    input: "test",
    processor: "core",
  }),
];

console.log("\n--- Phase 2: post-settlement forwarders → Parallel API ---");
const searchBody = await phase2Forward(
  "parallel.search forwarder",
  "forwardParallelSearchUpstream",
  { search_queries: ["top sushi places San Francisco"], mode: "basic" },
);
if (searchBody && Array.isArray(searchBody.results)) {
  console.log(
    `      → ${searchBody.results.length} results; first url: ${searchBody.results[0]?.url?.slice(0, 90)}`,
  );
}

const extractBody = await phase2Forward(
  "parallel.extract forwarder",
  "forwardParallelExtractUpstream",
  { urls: ["https://example.com"] },
);
if (extractBody && Array.isArray(extractBody.results)) {
  console.log(`      → ${extractBody.results.length} extract row(s)`);
}

const taskBody = await phase2Forward(
  "parallel.task forwarder   ",
  "forwardParallelTaskUpstream",
  { input: "Return one sentence about Parallel.ai", processor: "core" },
);
const runId = taskBody?.run_id || taskBody?.runId;
if (runId) {
  console.log(`      → run_id=${runId}, status=${taskBody.status}`);
}

console.log("\n--- Phase 3: read-only Parallel task helpers ---");
if (runId) {
  const { getParallelTaskRun } = await import("../apps/api/src/sellers/parallel/tasks.ts");
  const run = await getParallelTaskRun(runId);
  console.log(`  getParallelTaskRun(${runId}): ✅ status=${run?.status || run?.run?.status}`);
}

const allOk = p1.every(Boolean) && searchBody && extractBody && taskBody;
console.log(allOk ? "\n✅ all parallel surfaces healthy" : "\n❌ smoke failed");
process.exit(allOk ? 0 : 1);
