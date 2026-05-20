// Buyer-side helpers for `/v1/parallel/tasks/:run_id/{status,result}`. Read
// against Parallel's public API with the server-side API key. Polling and
// result fetches are free on Parallel's side — no x402 settlement needed.

import { readJsonResponse } from "../manus/upstream.ts";
import { safeParallelError } from "./upstream.ts";

const PARALLEL_API_BASE = "https://api.parallel.ai";

function parallelApiKey() {
  const key = process.env.PARALLEL_API_KEY;
  if (!key) {
    throw Object.assign(new Error("PARALLEL_API_KEY is required"), {
      statusCode: 503,
      code: "parallel_not_configured",
    });
  }
  return key;
}

async function fetchParallelJson({
  path,
  runId,
  params = {},
  fetchImpl = fetch,
}: {
  path: string;
  runId: string;
  params?: Record<string, string>;
  fetchImpl?: typeof fetch;
}) {
  const id = String(runId || "").trim();
  if (!id) {
    throw Object.assign(new Error("run_id is required"), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  const url = new URL(`${PARALLEL_API_BASE}${path.replace("{run_id}", encodeURIComponent(id))}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const upstream = await fetchImpl(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-api-key": parallelApiKey(),
    },
  });
  const body = await readJsonResponse(upstream);
  if (!upstream.ok) {
    throw Object.assign(new Error(safeParallelError(upstream.status)), {
      statusCode: upstream.status >= 500 ? 502 : upstream.status,
      code: "parallel_upstream_error",
      details: body,
    });
  }
  return body;
}

export async function getParallelTaskRun(
  runId: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
) {
  return fetchParallelJson({ path: "/v1/tasks/runs/{run_id}", runId, fetchImpl });
}

export async function getParallelTaskResult(
  runId: string,
  { fetchImpl = fetch, timeoutSeconds = 600 }: { fetchImpl?: typeof fetch; timeoutSeconds?: number } = {},
) {
  return fetchParallelJson({
    path: "/v1/tasks/runs/{run_id}/result",
    runId,
    params: { timeout: String(timeoutSeconds) },
    fetchImpl,
  });
}
