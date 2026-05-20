// Parallel task lifecycle helpers — peer of `services/manus-tasks.ts` for the
// `parallel.task` async endpoint.

import { createHash, randomUUID } from "node:crypto";

export const PARALLEL_TASK_ENDPOINT_ID = "parallel.task";
export const PARALLEL_TASK_TTL_MS = 24 * 60 * 60 * 1000;
export const PARALLEL_POLL_AFTER_SECONDS = 10;

export const PARALLEL_NEXT_MCP_TOOLS = Object.freeze({
  status: "parallel_task_status",
  result: "parallel_task_result",
});

function firstString(...values: any[]) {
  return values.find((value) => typeof value === "string" && value.trim()) || null;
}

export function normalizedParallelTaskInput(input: any = {}) {
  const rawInput = input.input ?? input.query ?? input.prompt;
  let normalizedInput: string;
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim().replace(/\s+/gu, " ");
    if (!trimmed) {
      throw Object.assign(new Error("input is required"), {
        statusCode: 400,
        code: "invalid_request",
      });
    }
    normalizedInput = trimmed;
  } else if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    normalizedInput = stableJson(rawInput);
  } else {
    throw Object.assign(new Error("input is required"), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return {
    input: normalizedInput,
    processor: String(input.processor || "ultra").trim(),
  };
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value === undefined) return "null";
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

export function parallelDedupeKey(auth: any, input: any) {
  const normalized = normalizedParallelTaskInput(input);
  return createHash("sha256")
    .update(stableJson({
      user_id: auth.user_id,
      endpoint_id: PARALLEL_TASK_ENDPOINT_ID,
      ...normalized,
    }))
    .digest("hex");
}

export function normalizeParallelStatus(value: any, fallback = "running") {
  const raw = String(value || fallback || "running").toLowerCase();
  if (["completed", "complete", "succeeded", "success", "done"].includes(raw)) return "stopped";
  if (["failed", "failure", "error", "errored", "cancelled", "canceled"].includes(raw)) return "error";
  if (["action_required", "awaiting_input", "waiting", "paused", "blocked", "cancelling"].includes(raw)) return "waiting";
  if (["queued", "running", "pending", "starting", "processing", "in_progress"].includes(raw)) return "running";
  return raw || fallback;
}

export function parallelCreatedTaskFromBody(body: any) {
  const task = body?.task && typeof body.task === "object" ? body.task : body;
  const nested = task?.data && typeof task.data === "object" ? task.data : {};
  const providerTaskId = firstString(
    task?.run_id,
    task?.runId,
    task?.task_id,
    task?.id,
    nested?.run_id,
    nested?.runId,
    nested?.task_id,
    nested?.id,
  );
  if (!providerTaskId) return null;
  return {
    provider_task_id: providerTaskId,
    status: firstString(task?.status, task?.state, nested?.status, nested?.state) || "queued",
    task_url: firstString(task?.task_url, task?.taskUrl, task?.url, nested?.task_url, nested?.taskUrl),
    title: firstString(task?.title, task?.task_title, task?.name, nested?.title, nested?.name),
  };
}

export function taskPublicFields(task: any) {
  return {
    task_id: task.provider_task_id || task.id,
    task_url: task.task_url || null,
    status: normalizeParallelStatus(task.status, "running"),
    title: task.title || null,
    created_at: task.created_at || null,
    updated_at: task.updated_at || null,
    last_checked_at: task.last_checked_at || null,
  };
}

export function nextParallelTools() {
  return PARALLEL_NEXT_MCP_TOOLS;
}

export function nextParallelApiRoutes(taskId: string) {
  const encoded = encodeURIComponent(taskId);
  return {
    status: `/v1/parallel/tasks/${encoded}/status`,
    result: `/v1/parallel/tasks/${encoded}/result`,
  };
}

export function nextParallelToolCalls(taskId: string) {
  return {
    status: {
      type: "mcp_tool",
      tool_name: PARALLEL_NEXT_MCP_TOOLS.status,
      arguments: { task_id: taskId },
      api_route: nextParallelApiRoutes(taskId).status,
      note: "MCP tool name, not a ToolRouter endpoint_id.",
    },
    result: {
      type: "mcp_tool",
      tool_name: PARALLEL_NEXT_MCP_TOOLS.result,
      arguments: { task_id: taskId },
      api_route: nextParallelApiRoutes(taskId).result,
      note: "MCP tool name, not a ToolRouter endpoint_id.",
    },
  };
}

export function parallelTaskStartPayload(task: any, { taskCreated, deduped, requestId, traceId }: any) {
  const publicFields = taskPublicFields(task);
  return {
    task_created: Boolean(taskCreated),
    deduped: Boolean(deduped),
    request_id: requestId || task.request_id || null,
    trace_id: traceId || task.trace_id || null,
    ...publicFields,
    poll_after_seconds: PARALLEL_POLL_AFTER_SECONDS,
    next_tools: nextParallelTools(),
    next_mcp_tools: nextParallelTools(),
    next_endpoint_ids: [],
    next_api_routes: nextParallelApiRoutes(publicFields.task_id),
    next_tool_calls: nextParallelToolCalls(publicFields.task_id),
    repeat_for_same_query: false,
  };
}

export function dedupedParallelStartResponse(endpoint: any, task: any, traceId: string) {
  const start = parallelTaskStartPayload(task, {
    taskCreated: false,
    deduped: true,
    requestId: task.request_id,
    traceId: task.trace_id || traceId,
  });
  return {
    id: task.request_id,
    trace_id: task.trace_id || traceId,
    endpoint_id: endpoint.id,
    path: "deduped",
    charged: false,
    status_code: 200,
    credit_reserved_usd: null,
    credit_captured_usd: null,
    credit_released_usd: null,
    ...start,
    body: start,
  };
}

export function endpointTaskBase({
  endpoint,
  auth,
  dedupeKey,
  createdAt = new Date().toISOString(),
  providerTaskId = null,
  requestId = null,
  traceId = null,
  status = "running",
  taskUrl = null,
  title = null,
}: any) {
  return {
    id: `task_${randomUUID()}`,
    endpoint_id: endpoint.id,
    provider: "parallel",
    provider_task_id: providerTaskId,
    request_id: requestId,
    trace_id: traceId,
    user_id: auth.user_id,
    api_key_id: auth.api_key_id,
    caller_id: auth.caller_id,
    dedupe_key: dedupeKey,
    status,
    task_url: taskUrl,
    title,
    created_at: createdAt,
    updated_at: createdAt,
    last_checked_at: null,
    expires_at: new Date(Date.parse(createdAt) + PARALLEL_TASK_TTL_MS).toISOString(),
  };
}

function isConflictError(error: any) {
  return error?.statusCode === 409 || /duplicate key value|unique constraint/u.test(String(error?.message || ""));
}

export async function reserveParallelDedupeTask(store: any, taskRow: any) {
  try {
    return { reserved: true, task: await store.insertEndpointTask(taskRow) };
  } catch (error) {
    if (!isConflictError(error)) throw error;
    const existing = await store.findEndpointTaskByDedupeKey({
      api_key_id: taskRow.api_key_id,
      endpoint_id: taskRow.endpoint_id,
      dedupe_key: taskRow.dedupe_key,
    });
    if (existing) return { reserved: false, task: existing };
    const stale = await store.findStartingEndpointTaskByDedupeKey({
      api_key_id: taskRow.api_key_id,
      endpoint_id: taskRow.endpoint_id,
      dedupe_key: taskRow.dedupe_key,
    });
    if (stale && !stale.provider_task_id) {
      await expireParallelDedupeTask(store, stale);
      try {
        return { reserved: true, task: await store.insertEndpointTask(taskRow) };
      } catch (retryError) {
        if (!isConflictError(retryError)) throw retryError;
        const retryExisting = await store.findEndpointTaskByDedupeKey({
          api_key_id: taskRow.api_key_id,
          endpoint_id: taskRow.endpoint_id,
          dedupe_key: taskRow.dedupe_key,
        });
        if (retryExisting) return { reserved: false, task: retryExisting };
        throw retryError;
      }
    }
    throw error;
  }
}

export async function expireParallelDedupeTask(store: any, task: any, status = "error") {
  if (!task) return null;
  const now = new Date().toISOString();
  return store.updateEndpointTask({
    ...task,
    status,
    updated_at: now,
    expires_at: now,
  });
}

export async function updateEndpointTaskFromDetail(
  store: any,
  task: any,
  detail: any,
  now = new Date().toISOString(),
) {
  const parsed = parallelTaskDetail(detail, task);
  return store.updateEndpointTask({
    ...task,
    status: parsed.status,
    title: parsed.title || task.title || null,
    task_url: parsed.task_url || task.task_url || null,
    last_checked_at: now,
    updated_at: now,
  });
}

export function parallelTaskDetail(detail: any, task: any) {
  const data =
    (detail?.run && typeof detail.run === "object" && detail.run) ||
    (detail?.task && typeof detail.task === "object" && detail.task) ||
    (detail?.data && typeof detail.data === "object" && detail.data) ||
    (detail && typeof detail === "object" ? detail : {});
  const status = normalizeParallelStatus(
    firstString(data.status, data.state, detail?.status, detail?.state),
    task.status || "running",
  );
  return {
    task_id: task.provider_task_id || task.id,
    status,
    title: firstString(data.title, data.task_title, data.name, task.title),
    task_url: firstString(data.task_url, data.taskUrl, data.url, task.task_url),
    error: data.error || data.error_message || null,
  };
}

export function pendingParallelResultPayload(task: any) {
  return {
    task_id: task.provider_task_id || task.id,
    status: normalizeParallelStatus(task.status, "running"),
    final_answer_available: false,
    answer: null,
    attachments: [],
    latest_status_message: "Parallel task is being created.",
    waiting_details: null,
    error: null,
    messages: [],
    poll_after_seconds: PARALLEL_POLL_AFTER_SECONDS,
    isError: false,
  };
}

function extractOutputText(output: any) {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (typeof output.content === "string") return output.content;
  if (output.content && typeof output.content === "object") {
    return JSON.stringify(output.content, null, 2);
  }
  return null;
}

function extractCitations(output: any): any[] {
  if (!output || !Array.isArray(output.basis)) return [];
  const all: any[] = [];
  for (const field of output.basis) {
    if (!field || !Array.isArray(field.citations)) continue;
    for (const citation of field.citations) {
      const url = firstString(citation?.url);
      if (url) {
        all.push({
          url,
          title: firstString(citation?.title),
          excerpts: Array.isArray(citation?.excerpts) ? citation.excerpts : [],
        });
      }
    }
  }
  return all;
}

export function parallelResultPayload({ task, detail, resultBody }: any) {
  const detailPayload = parallelTaskDetail(detail, task);
  const status = detailPayload.status;
  const answer = status === "stopped" ? extractOutputText(resultBody?.output) : null;
  const citations = extractCitations(resultBody?.output);
  const finalAnswerAvailable = Boolean(answer);
  // When the run is marked stopped but the result payload isn't ready yet
  // (e.g. transient 404/408 from /result), keep clients polling instead of
  // letting them treat the run as terminally answerless.
  const stoppedAwaitingResult = status === "stopped" && !finalAnswerAvailable;
  return {
    task_id: task.provider_task_id || task.id,
    status,
    final_answer_available: finalAnswerAvailable,
    answer,
    attachments: citations,
    latest_status_message:
      status === "running"
        ? "Parallel task is running."
        : stoppedAwaitingResult
          ? "Parallel task completed; final answer not yet available."
          : null,
    waiting_details: status === "waiting" ? detailPayload.error || null : null,
    error: status === "error" ? detailPayload.error || "Parallel task failed" : null,
    messages: [],
    poll_after_seconds:
      status === "running" || status === "waiting" || stoppedAwaitingResult
        ? PARALLEL_POLL_AFTER_SECONDS
        : null,
    isError: status === "error",
  };
}
