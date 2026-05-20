// Manus-specific async-task lifecycle hooks for the execution orchestrator.
//
// Lift-and-shift from app.ts:2187-2338 keeping the Manus-specific shape. U9
// (async-task generalization) was explicitly deferred — generalizing off N=1
// would bake the wrong abstraction. When a second async endpoint joins the
// roadmap, replace this with a `runAsyncTaskFlow(strategy, ...)` and validate
// against both concrete cases.
//
// Flow:
// - `prepareManusAsyncTask`: called before executor. If the request has a
//   dedupe key and isn't `force_new`, looks up an existing task — returns
//   `{ dedupedResponse }` for the orchestrator to short-circuit on. Otherwise
//   reserves a task row with a null `provider_task_id` so duplicate concurrent
//   requests are blocked by the partial unique index.
// - `finalizeManusAsyncTask`: called after a successful executor run. Extracts
//   the upstream Manus task fields from the response body and either updates
//   the reserved row or inserts a fresh one. Returns the `manusStart` payload
//   to merge into the orchestrator's response.
// - `abandonManusAsyncTask`: cleanup path called on executor failure or
//   uncaught error so the reserved row doesn't permanently block the dedupe
//   key.

import {
  MANUS_RESEARCH_ENDPOINT_ID,
  MANUS_TASK_TTL_MS,
  dedupedManusStartResponse,
  endpointTaskBase,
  expireManusDedupeTask,
  forceNewTask,
  manusCreatedTaskFromBody,
  manusDedupeKey,
  manusTaskStartPayload,
  normalizeManusStatus,
  reserveManusDedupeTask,
} from "../manus-tasks.ts";

export { MANUS_RESEARCH_ENDPOINT_ID };

export type ManusAsyncPrepareResult =
  | { type: "passthrough"; dedupeKey: string | null }
  | { type: "deduped"; response: any }
  | { type: "reserved"; reservedTask: any; dedupeKey: string };

/**
 * Inspect the incoming request. If the endpoint is Manus research and not a
 * force-new, either return a `deduped` response (caller should short-circuit
 * and return it directly) or reserve a row that the executor will later
 * resolve via `finalizeManusAsyncTask`.
 */
export async function prepareManusAsyncTask({
  store,
  endpoint,
  endpointInput,
  body,
  auth,
  traceId,
}: {
  store: any;
  endpoint: any;
  endpointInput: any;
  body: any;
  auth: any;
  traceId: string;
}): Promise<ManusAsyncPrepareResult> {
  if (endpoint.id !== MANUS_RESEARCH_ENDPOINT_ID) {
    return { type: "passthrough", dedupeKey: null };
  }
  const dedupeKey = manusDedupeKey(auth, endpoint.id, endpointInput);
  // Even on force_new, the dedupeKey is computed so the eventual task row
  // carries it and a later non-force_new call can dedupe against it. The
  // dedupe LOOKUP is skipped — but the key flows through.
  if (!dedupeKey || forceNewTask(body, endpointInput)) {
    return { type: "passthrough", dedupeKey };
  }
  const existingTask = await store.findEndpointTaskByDedupeKey({
    api_key_id: auth.api_key_id,
    endpoint_id: endpoint.id,
    dedupe_key: dedupeKey,
  });
  if (existingTask) {
    return {
      type: "deduped",
      response: dedupedManusStartResponse(endpoint, existingTask, traceId),
    };
  }
  const reserved = await reserveManusDedupeTask(
    store,
    endpointTaskBase({
      endpoint,
      auth,
      dedupeKey,
      traceId,
    }),
  );
  if (!reserved.reserved) {
    return {
      type: "deduped",
      response: dedupedManusStartResponse(endpoint, reserved.task, traceId),
    };
  }
  return {
    type: "reserved",
    reservedTask: reserved.task,
    dedupeKey,
  };
}

/**
 * Called after a successful executor run for a Manus-research endpoint when
 * the orchestrator has a `prepareManusAsyncTask` reservation outstanding (or
 * a `passthrough` for a force-new request that still produced a task body).
 * Returns the `manusStart` payload to merge into the response (or `null` if
 * the upstream body didn't include a task id).
 */
export async function finalizeManusAsyncTask({
  store,
  endpoint,
  auth,
  result,
  reservedTask,
  dedupeKey,
  requestId,
  traceId,
  createdAt,
}: {
  store: any;
  endpoint: any;
  auth: any;
  result: any;
  reservedTask: any;
  dedupeKey: string | null;
  requestId: string;
  traceId: string;
  createdAt: string;
}): Promise<any | null> {
  if (endpoint.id !== MANUS_RESEARCH_ENDPOINT_ID) return null;
  const createdManusTask =
    result?.ok === true ? manusCreatedTaskFromBody(result.body) : null;
  if (!createdManusTask || !dedupeKey) {
    if (reservedTask) {
      await expireManusDedupeTask(store, reservedTask).catch(() => undefined);
    }
    return null;
  }
  const taskRow = {
    ...(reservedTask || endpointTaskBase({ endpoint, auth, dedupeKey, createdAt })),
    provider_task_id: createdManusTask.provider_task_id,
    request_id: requestId,
    trace_id: traceId,
    status: normalizeManusStatus(createdManusTask.status, "running"),
    task_url: createdManusTask.task_url || null,
    title: createdManusTask.title || null,
    updated_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + MANUS_TASK_TTL_MS).toISOString(),
  };
  const task = reservedTask
    ? await store.updateEndpointTask(taskRow)
    : await store.insertEndpointTask(taskRow);
  return manusTaskStartPayload(task, {
    taskCreated: true,
    deduped: false,
    requestId,
    traceId,
  });
}

/**
 * Best-effort cleanup of a reserved Manus task row on the error path. Never
 * throws — the caller is already propagating the original error.
 */
export async function abandonManusAsyncTask(store: any, reservedTask: any) {
  if (!reservedTask) return;
  await expireManusDedupeTask(store, reservedTask).catch(() => undefined);
}
