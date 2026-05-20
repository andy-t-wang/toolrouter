// Buyer-side Manus task helpers used by `/v1/manus/tasks/:task_id/{status,result}`
// in `app.ts`. These are reads against upstream Manus state — not part of the
// seller route registration — so they live alongside the seller module but are
// consumed directly from the gateway routes that own those endpoints.

import { readJsonResponse, safeUpstreamError } from "./upstream.ts";

function manusApiKey() {
  const key = process.env.MANUS_API_KEY;
  if (!key) {
    throw Object.assign(new Error("MANUS_API_KEY is required"), {
      statusCode: 503,
      code: "manus_not_configured",
    });
  }
  return key;
}

async function fetchManusJson({
  path,
  taskId,
  params = {},
  fetchImpl = fetch,
}: {
  path: string;
  taskId: string;
  params?: Record<string, string>;
  fetchImpl?: typeof fetch;
}) {
  const id = String(taskId || "").trim();
  if (!id) {
    throw Object.assign(new Error("task_id is required"), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  const url = new URL(`https://api.manus.ai/v2/${path}`);
  url.searchParams.set("task_id", id);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const upstream = await fetchImpl(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-manus-api-key": manusApiKey(),
    },
  });
  const body = await readJsonResponse(upstream);
  if (!upstream.ok) {
    throw Object.assign(new Error(safeUpstreamError(upstream.status)), {
      statusCode: upstream.status >= 500 ? 502 : upstream.status,
      code: "manus_upstream_error",
      details: body,
    });
  }
  return body;
}

export async function getManusTaskDetail(
  taskId: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
) {
  return fetchManusJson({ path: "task.detail", taskId, fetchImpl });
}

export async function listManusTaskMessages(
  taskId: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
) {
  return fetchManusJson({
    path: "task.listMessages",
    taskId,
    params: { order: "asc", limit: "200" },
    fetchImpl,
  });
}
