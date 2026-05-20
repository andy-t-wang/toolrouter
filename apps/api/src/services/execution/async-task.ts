// Async-task lifecycle hooks for the execution orchestrator.
//
// Originally Manus-only; generalized for sprint-2 when Parallel's task
// endpoint became the second async surface. Each provider supplies a small
// `AsyncTaskStrategy` describing how to derive the dedupe key, extract the
// upstream task row, and shape the orchestrator's start payload.

import {
  MANUS_RESEARCH_ENDPOINT_ID,
  MANUS_TASK_TTL_MS,
  dedupedManusStartResponse,
  endpointTaskBase as manusEndpointTaskBase,
  expireManusDedupeTask,
  forceNewTask,
  manusCreatedTaskFromBody,
  manusDedupeKey,
  manusTaskStartPayload,
  normalizeManusStatus,
  reserveManusDedupeTask,
} from "../manus-tasks.ts";
import {
  PARALLEL_TASK_ENDPOINT_ID,
  PARALLEL_TASK_TTL_MS,
  dedupedParallelStartResponse,
  endpointTaskBase as parallelEndpointTaskBase,
  expireParallelDedupeTask,
  normalizeParallelStatus,
  parallelCreatedTaskFromBody,
  parallelDedupeKey,
  parallelTaskStartPayload,
  reserveParallelDedupeTask,
} from "../parallel-tasks.ts";

export { MANUS_RESEARCH_ENDPOINT_ID, PARALLEL_TASK_ENDPOINT_ID };

export interface AsyncTaskStrategy {
  /** Stable endpoint id the strategy is responsible for. */
  readonly endpointId: string;
  /** Provider id (e.g. `manus`, `parallel`). */
  readonly provider: string;
  /** TTL for reserved/created task rows, in milliseconds. */
  readonly taskTtlMs: number;
  /** Build the dedupe key for an incoming request. Returns null when the
   *  input is not eligible for dedupe. */
  dedupeKey(auth: any, input: any): string | null;
  /** Pull `{ provider_task_id, status, task_url, title }` out of an upstream
   *  response body. Returns null when the upstream did not actually create a
   *  task. */
  extractCreatedTask(body: any): {
    provider_task_id: string;
    status: string;
    task_url: string | null;
    title: string | null;
  } | null;
  /** Build the base `endpoint_task` row for reservation. */
  endpointTaskBase(args: any): any;
  /** Persist a reservation row, returning whether it was newly reserved or
   *  matched an existing one. */
  reserveDedupeTask(store: any, taskRow: any): Promise<{ reserved: boolean; task: any }>;
  /** Best-effort cleanup for a reserved row on the error path. */
  expireDedupeTask(store: any, task: any): Promise<any>;
  /** Normalize an upstream status string into ToolRouter's lifecycle enum. */
  normalizeStatus(value: any, fallback?: string): string;
  /** Build the response body merged into the orchestrator output. */
  startPayload(task: any, ctx: any): any;
  /** Build the short-circuit response when an existing task matches the
   *  dedupe key. */
  dedupedResponse(endpoint: any, existingTask: any, traceId: string): any;
}

const manusStrategy: AsyncTaskStrategy = Object.freeze({
  endpointId: MANUS_RESEARCH_ENDPOINT_ID,
  provider: "manus",
  taskTtlMs: MANUS_TASK_TTL_MS,
  dedupeKey: (auth: any, input: any) => manusDedupeKey(auth, MANUS_RESEARCH_ENDPOINT_ID, input),
  extractCreatedTask: manusCreatedTaskFromBody,
  endpointTaskBase: manusEndpointTaskBase,
  reserveDedupeTask: reserveManusDedupeTask,
  expireDedupeTask: expireManusDedupeTask,
  normalizeStatus: normalizeManusStatus,
  startPayload: manusTaskStartPayload,
  dedupedResponse: dedupedManusStartResponse,
});

const parallelStrategy: AsyncTaskStrategy = Object.freeze({
  endpointId: PARALLEL_TASK_ENDPOINT_ID,
  provider: "parallel",
  taskTtlMs: PARALLEL_TASK_TTL_MS,
  dedupeKey: parallelDedupeKey,
  extractCreatedTask: parallelCreatedTaskFromBody,
  endpointTaskBase: parallelEndpointTaskBase,
  reserveDedupeTask: reserveParallelDedupeTask,
  expireDedupeTask: expireParallelDedupeTask,
  normalizeStatus: normalizeParallelStatus,
  startPayload: parallelTaskStartPayload,
  dedupedResponse: dedupedParallelStartResponse,
});

const STRATEGIES: Readonly<Record<string, AsyncTaskStrategy>> = Object.freeze({
  [MANUS_RESEARCH_ENDPOINT_ID]: manusStrategy,
  [PARALLEL_TASK_ENDPOINT_ID]: parallelStrategy,
});

export function getAsyncTaskStrategyForEndpoint(endpoint: any): AsyncTaskStrategy | null {
  if (!endpoint || !endpoint.id) return null;
  return STRATEGIES[endpoint.id] || null;
}

export type AsyncTaskPrepareResult =
  | { type: "passthrough"; dedupeKey: string | null; strategy: AsyncTaskStrategy | null }
  | { type: "deduped"; response: any; strategy: AsyncTaskStrategy }
  | { type: "reserved"; reservedTask: any; dedupeKey: string; strategy: AsyncTaskStrategy };

export async function prepareAsyncTask({
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
}): Promise<AsyncTaskPrepareResult> {
  const strategy = getAsyncTaskStrategyForEndpoint(endpoint);
  if (!strategy) return { type: "passthrough", dedupeKey: null, strategy: null };
  const dedupeKey = strategy.dedupeKey(auth, endpointInput);
  if (!dedupeKey || forceNewTask(body, endpointInput)) {
    return { type: "passthrough", dedupeKey, strategy };
  }
  const existingTask = await store.findEndpointTaskByDedupeKey({
    api_key_id: auth.api_key_id,
    endpoint_id: endpoint.id,
    dedupe_key: dedupeKey,
  });
  if (existingTask) {
    return {
      type: "deduped",
      response: strategy.dedupedResponse(endpoint, existingTask, traceId),
      strategy,
    };
  }
  const reserved = await strategy.reserveDedupeTask(
    store,
    strategy.endpointTaskBase({ endpoint, auth, dedupeKey, traceId }),
  );
  if (!reserved.reserved) {
    return {
      type: "deduped",
      response: strategy.dedupedResponse(endpoint, reserved.task, traceId),
      strategy,
    };
  }
  return {
    type: "reserved",
    reservedTask: reserved.task,
    dedupeKey,
    strategy,
  };
}

export async function finalizeAsyncTask({
  store,
  strategy,
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
  strategy: AsyncTaskStrategy | null;
  endpoint: any;
  auth: any;
  result: any;
  reservedTask: any;
  dedupeKey: string | null;
  requestId: string;
  traceId: string;
  createdAt: string;
}): Promise<any | null> {
  if (!strategy) return null;
  if (endpoint.id !== strategy.endpointId) return null;
  const createdTask = result?.ok === true ? strategy.extractCreatedTask(result.body) : null;
  if (!createdTask || !dedupeKey) {
    if (reservedTask) {
      await strategy.expireDedupeTask(store, reservedTask).catch(() => undefined);
    }
    return null;
  }
  const taskRow = {
    ...(reservedTask || strategy.endpointTaskBase({ endpoint, auth, dedupeKey, createdAt })),
    provider_task_id: createdTask.provider_task_id,
    request_id: requestId,
    trace_id: traceId,
    status: strategy.normalizeStatus(createdTask.status, "running"),
    task_url: createdTask.task_url || null,
    title: createdTask.title || null,
    updated_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + strategy.taskTtlMs).toISOString(),
  };
  const task = reservedTask
    ? await store.updateEndpointTask(taskRow)
    : await store.insertEndpointTask(taskRow);
  return strategy.startPayload(task, {
    taskCreated: true,
    deduped: false,
    requestId,
    traceId,
  });
}

export async function abandonAsyncTask(
  store: any,
  strategy: AsyncTaskStrategy | null,
  reservedTask: any,
) {
  if (!strategy || !reservedTask) return;
  await strategy.expireDedupeTask(store, reservedTask).catch(() => undefined);
}

// --- Legacy named exports (Manus-specific) preserved for orchestrator/tests
// that haven't migrated to the strategy-aware names. These delegate to the
// generic flow with the Manus strategy.

export type ManusAsyncPrepareResult =
  | { type: "passthrough"; dedupeKey: string | null }
  | { type: "deduped"; response: any }
  | { type: "reserved"; reservedTask: any; dedupeKey: string };

export async function prepareManusAsyncTask(args: {
  store: any;
  endpoint: any;
  endpointInput: any;
  body: any;
  auth: any;
  traceId: string;
}): Promise<ManusAsyncPrepareResult> {
  if (args.endpoint?.id !== MANUS_RESEARCH_ENDPOINT_ID) {
    return { type: "passthrough", dedupeKey: null };
  }
  const result = await prepareAsyncTask(args);
  if (result.type === "deduped") return { type: "deduped", response: result.response };
  if (result.type === "reserved")
    return { type: "reserved", reservedTask: result.reservedTask, dedupeKey: result.dedupeKey };
  return { type: "passthrough", dedupeKey: result.dedupeKey };
}

export async function finalizeManusAsyncTask(args: {
  store: any;
  endpoint: any;
  auth: any;
  result: any;
  reservedTask: any;
  dedupeKey: string | null;
  requestId: string;
  traceId: string;
  createdAt: string;
}) {
  return finalizeAsyncTask({ ...args, strategy: manusStrategy });
}

export async function abandonManusAsyncTask(store: any, reservedTask: any) {
  return abandonAsyncTask(store, manusStrategy, reservedTask);
}
