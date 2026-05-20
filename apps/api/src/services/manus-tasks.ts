// Manus task lifecycle helpers (dedupe key, task row construction, normalized
// status, response shapes for the `/v1/manus/tasks/:task_id/*` and Manus-aware
// `/v1/requests` flows). Pure functions and small DB helpers — no Fastify.

import { createHash, randomUUID } from "node:crypto";

export const MANUS_RESEARCH_ENDPOINT_ID = "manus.research";
export const MANUS_TASK_TTL_MS = 24 * 60 * 60 * 1000;
export const MANUS_POLL_AFTER_SECONDS = 30;

export const MANUS_NEXT_MCP_TOOLS = Object.freeze({
  status: "manus_research_status",
  result: "manus_research_result",
});

function stringArray(value: any, max: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, max)
    .map((item) => item.trim());
}

export function normalizedManusTaskInput(input: any = {}) {
  const query = String(input.query ?? input.prompt ?? "").trim().replace(/\s+/gu, " ");
  if (!query) {
    throw Object.assign(new Error("query is required"), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return {
    query,
    task_type: String(input.task_type || input.taskType || "general_research").trim(),
    depth: String(input.depth || "standard").trim(),
    urls: stringArray(input.urls, 10),
    images: stringArray(input.images || input.image_urls, 5),
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

export function manusDedupeKey(auth: any, endpointId: string, input: any) {
  const normalized = normalizedManusTaskInput(input);
  return createHash("sha256")
    .update(stableJson({
      user_id: auth.user_id,
      endpoint_id: endpointId,
      ...normalized,
    }))
    .digest("hex");
}

export function forceNewTask(body: any, input: any = {}) {
  return body.force_new === true || body.forceNew === true || input.force_new === true || input.forceNew === true;
}

export function firstString(...values: any[]) {
  return values.find((value) => typeof value === "string" && value.trim()) || null;
}

export function normalizeManusStatus(value: any, fallback = "running") {
  const raw = String(value || fallback || "running").toLowerCase();
  if (["done", "complete", "completed", "finished", "success", "succeeded", "stopped"].includes(raw)) return "stopped";
  if (["failed", "failure", "errored", "error", "cancelled", "canceled"].includes(raw)) return "error";
  if (["waiting", "input_required", "requires_action", "paused", "blocked"].includes(raw)) return "waiting";
  if (["queued", "pending", "created", "starting", "in_progress", "processing", "running"].includes(raw)) return "running";
  return raw || fallback;
}

export function manusCreatedTaskFromBody(body: any) {
  const task = body?.task && typeof body.task === "object" ? body.task : body;
  const nested = task?.data && typeof task.data === "object" ? task.data : {};
  const providerTaskId = firstString(
    task?.task_id,
    task?.id,
    task?.taskId,
    nested?.task_id,
    nested?.id,
    nested?.taskId,
    task?.task?.task_id,
    task?.task?.id,
  );
  if (!providerTaskId) return null;
  return {
    provider_task_id: providerTaskId,
    status: firstString(
      task?.status,
      task?.state,
      nested?.status,
      nested?.state,
      task?.task?.status,
    ) || "running",
    task_url: firstString(
      task?.task_url,
      task?.taskUrl,
      task?.url,
      nested?.task_url,
      nested?.taskUrl,
      nested?.url,
      task?.task?.task_url,
    ),
    title: firstString(
      task?.task_title,
      task?.title,
      task?.name,
      nested?.task_title,
      nested?.title,
      nested?.name,
      task?.task?.title,
    ),
  };
}

export function taskPublicFields(task: any) {
  return {
    task_id: task.provider_task_id || task.id,
    task_url: task.task_url || null,
    status: normalizeManusStatus(task.status, "running"),
    title: task.title || null,
    created_at: task.created_at || null,
    updated_at: task.updated_at || null,
    last_checked_at: task.last_checked_at || null,
  };
}

export function nextManusTools() {
  return MANUS_NEXT_MCP_TOOLS;
}

export function nextManusApiRoutes(taskId: string) {
  const encodedTaskId = encodeURIComponent(taskId);
  return {
    status: `/v1/manus/tasks/${encodedTaskId}/status`,
    result: `/v1/manus/tasks/${encodedTaskId}/result`,
  };
}

export function nextManusToolCalls(taskId: string) {
  return {
    status: {
      type: "mcp_tool",
      tool_name: MANUS_NEXT_MCP_TOOLS.status,
      arguments: { task_id: taskId },
      api_route: nextManusApiRoutes(taskId).status,
      note: "MCP tool name, not a ToolRouter endpoint_id.",
    },
    result: {
      type: "mcp_tool",
      tool_name: MANUS_NEXT_MCP_TOOLS.result,
      arguments: { task_id: taskId },
      api_route: nextManusApiRoutes(taskId).result,
      note: "MCP tool name, not a ToolRouter endpoint_id.",
    },
  };
}

export function manusTaskStartPayload(task: any, { taskCreated, deduped, requestId, traceId }: any) {
  const publicFields = taskPublicFields(task);
  return {
    task_created: Boolean(taskCreated),
    deduped: Boolean(deduped),
    request_id: requestId || task.request_id || null,
    trace_id: traceId || task.trace_id || null,
    ...publicFields,
    poll_after_seconds: MANUS_POLL_AFTER_SECONDS,
    next_tools: nextManusTools(),
    next_mcp_tools: nextManusTools(),
    next_endpoint_ids: [],
    next_api_routes: nextManusApiRoutes(publicFields.task_id),
    next_tool_calls: nextManusToolCalls(publicFields.task_id),
    repeat_for_same_query: false,
  };
}

export function dedupedManusStartResponse(endpoint: any, task: any, traceId: string) {
  const start = manusTaskStartPayload(task, {
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

export function manusTaskDetail(detail: any, task: any) {
  const data =
    (detail?.data && typeof detail.data === "object" && detail.data) ||
    (detail?.task && typeof detail.task === "object" && detail.task) ||
    (detail?.result && typeof detail.result === "object" && detail.result) ||
    (detail && typeof detail === "object" ? detail : {});
  const status = normalizeManusStatus(
    firstString(data.status, data.state, detail?.status, detail?.state),
    task.status || "running",
  );
  return {
    task_id: task.provider_task_id || task.id,
    status,
    title: firstString(data.title, data.task_title, data.name, task.title),
    task_url: firstString(data.task_url, data.taskUrl, data.url, task.task_url),
    waiting_details: data.waiting_details || data.waitingDetails || data.input_request || null,
    error: data.error || data.error_message || null,
  };
}

function messageArray(payload: any) {
  const candidates = [
    payload?.messages,
    payload?.data?.messages,
    payload?.data,
    payload?.items,
    payload?.result?.messages,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function messageContent(content: any) {
  const attachments: any[] = [];
  if (typeof content === "string") return { text: content, attachments };
  if (!Array.isArray(content)) {
    const text = firstString(content?.text, content?.value, content?.content) || "";
    const url = firstString(content?.file_url, content?.url, content?.source_url);
    if (url) attachments.push({ url, type: content?.type || "file", name: content?.name || null });
    return { text, attachments };
  }
  const textParts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      textParts.push(part);
      continue;
    }
    const text = firstString(part?.text, part?.value, part?.content);
    if (text) textParts.push(text);
    const url = firstString(part?.file_url, part?.url, part?.source_url);
    if (url) attachments.push({ url, type: part?.type || "file", name: part?.name || null });
  }
  return { text: textParts.join("\n").trim(), attachments };
}

function manusAttachmentArray(value: any) {
  if (!Array.isArray(value)) return [];
  return value
    .map((attachment) => ({
      url: firstString(attachment?.url, attachment?.file_url, attachment?.source_url),
      type: attachment?.type || "file",
      name: firstString(attachment?.filename, attachment?.name),
      content_type: attachment?.content_type || attachment?.contentType || null,
    }))
    .filter((attachment) => attachment.url);
}

function manusMessagePayload(message: any) {
  const type = String(message?.type || "").toLowerCase();
  if (message?.assistant_message) {
    const content = messageContent(message.assistant_message.content || "");
    return {
      role: "assistant",
      type: type || "assistant_message",
      text: content.text,
      attachments: [...content.attachments, ...manusAttachmentArray(message.assistant_message.attachments)],
    };
  }
  if (message?.user_message) {
    const content = messageContent(message.user_message.content || "");
    return {
      role: "user",
      type: type || "user_message",
      text: content.text,
      attachments: [...content.attachments, ...manusAttachmentArray(message.user_message.attachments)],
    };
  }
  if (message?.error_message) {
    return {
      role: "error",
      type: type || "error_message",
      text: firstString(message.error_message.content, message.error_message.error_type),
      attachments: [],
    };
  }
  if (message?.status_update) {
    const detail = message.status_update.status_detail || {};
    return {
      role: "status",
      type: type || "status_update",
      text: firstString(
        detail.waiting_description,
        message.status_update.brief,
        message.status_update.description,
        message.status_update.agent_status,
      ),
      attachments: [],
    };
  }
  if (message?.tool_used) {
    return {
      role: "tool",
      type: type || "tool_used",
      text: firstString(message.tool_used.brief, message.tool_used.description, message.tool_used.tool),
      attachments: [],
    };
  }
  const content = messageContent(message?.content ?? message?.message ?? message?.text ?? "");
  return {
    role: firstString(message?.role, message?.sender, message?.sender_type, message?.author),
    type: firstString(message?.type, message?.kind),
    text: content.text,
    attachments: content.attachments,
  };
}

export function publicManusMessages(payload: any) {
  return messageArray(payload).map((message: any, index: number) => {
    const parsed = manusMessagePayload(message);
    return {
      id: firstString(message?.id, message?.message_id, message?.messageId) || `message_${index}`,
      role: parsed.role || null,
      type: parsed.type || null,
      text: parsed.text || null,
      attachments: parsed.attachments,
      created_at: firstString(message?.created_at, message?.createdAt, message?.timestamp) || null,
    };
  });
}

function messageRole(message: any) {
  return String(message?.role || message?.sender || message?.type || "").toLowerCase();
}

function latestText(messages: any[], predicate: (message: any) => boolean) {
  return [...messages].reverse().find((message) => predicate(message) && message.text)?.text || null;
}

export function manusResultPayload({ task, detail, messagesBody }: any) {
  const detailPayload = manusTaskDetail(detail, task);
  const messages = publicManusMessages(messagesBody);
  const status = detailPayload.status;
  const answer = status === "stopped"
    ? latestText(messages, (message) => /assistant|agent|message/u.test(messageRole(message))) || latestText(messages, () => true)
    : null;
  const latestStatusMessage =
    latestText(messages, (message) => /status|system|progress/u.test(messageRole(message))) ||
    (typeof detailPayload.waiting_details === "string" ? detailPayload.waiting_details : null);
  const attachments = messages.flatMap((message) => message.attachments || []);
  return {
    task_id: task.provider_task_id || task.id,
    status,
    final_answer_available: Boolean(answer),
    answer,
    attachments,
    latest_status_message: latestStatusMessage,
    waiting_details: status === "waiting" ? detailPayload.waiting_details || latestStatusMessage : null,
    error: status === "error" ? detailPayload.error || "Manus task failed" : null,
    messages,
    poll_after_seconds: status === "running" || status === "waiting" ? MANUS_POLL_AFTER_SECONDS : null,
    isError: status === "error",
  };
}

export async function updateEndpointTaskFromDetail(
  store: any,
  task: any,
  detail: any,
  now = new Date().toISOString(),
) {
  const parsed = manusTaskDetail(detail, task);
  return store.updateEndpointTask({
    ...task,
    status: parsed.status,
    title: parsed.title || task.title || null,
    task_url: parsed.task_url || task.task_url || null,
    last_checked_at: now,
    updated_at: now,
  });
}

function isConflictError(error: any) {
  return error?.statusCode === 409 || /duplicate key value|unique constraint/u.test(String(error?.message || ""));
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
    provider: "manus",
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
    expires_at: new Date(Date.parse(createdAt) + MANUS_TASK_TTL_MS).toISOString(),
  };
}

export async function reserveManusDedupeTask(store: any, taskRow: any) {
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
      await expireManusDedupeTask(store, stale);
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

export async function expireManusDedupeTask(store: any, task: any, status = "error") {
  if (!task) return null;
  const now = new Date().toISOString();
  return store.updateEndpointTask({
    ...task,
    status,
    updated_at: now,
    expires_at: now,
  });
}

export function pendingManusResultPayload(task: any) {
  return {
    task_id: task.provider_task_id || task.id,
    status: normalizeManusStatus(task.status, "running"),
    final_answer_available: false,
    answer: null,
    attachments: [],
    latest_status_message: "Manus task is being created.",
    waiting_details: null,
    error: null,
    messages: [],
    poll_after_seconds: MANUS_POLL_AFTER_SECONDS,
    isError: false,
  };
}
