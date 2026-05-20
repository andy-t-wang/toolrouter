// /v1/requests reads + /v1/manus/tasks/:task_id/{status,result}.
//
// API-key-authed (caller-side). Writes (`POST /v1/requests`) live in
// `execution.routes.ts` so the orchestrator and its Manus async-task glue
// stay focused on the write path.

import { authenticateApiKey } from "@toolrouter/auth";

import {
  apiTraceDto,
  requestFilters,
  requestPage,
} from "../services/monitoring.ts";
import {
  MANUS_POLL_AFTER_SECONDS,
  MANUS_RESEARCH_ENDPOINT_ID,
  manusResultPayload,
  pendingManusResultPayload,
  taskPublicFields,
  updateEndpointTaskFromDetail,
} from "../services/manus-tasks.ts";
import {
  getManusTaskDetail,
  listManusTaskMessages,
} from "../sellers/manus/tasks.ts";

export async function requestsRoutes(app: any) {
  const { store, manusFetch } = app;

  app.get("/v1/requests", async (request: any) => {
    const auth = await authenticateApiKey(request.headers, store);
    const filters = requestFilters(request.query || {});
    filters.api_key_id = auth.api_key_id;
    return requestPage(store, filters, apiTraceDto);
  });

  app.get("/v1/requests/:id", async (request: any) => {
    const auth = await authenticateApiKey(request.headers, store);
    const row = await store.getRequest(decodeURIComponent(request.params.id));
    if (!row || row.api_key_id !== auth.api_key_id) {
      throw Object.assign(new Error("request not found"), {
        statusCode: 404,
        code: "not_found",
      });
    }
    return { request: apiTraceDto(row) };
  });

  async function requireOwnedManusTask(request: any) {
    const auth = await authenticateApiKey(request.headers, store);
    const taskId = decodeURIComponent(request.params.task_id || "");
    const task = await store.findEndpointTaskByTaskId({
      api_key_id: auth.api_key_id,
      endpoint_id: MANUS_RESEARCH_ENDPOINT_ID,
      task_id: taskId,
    });
    if (!task) {
      throw Object.assign(new Error("task not found"), {
        statusCode: 404,
        code: "not_found",
      });
    }
    return task;
  }

  app.get("/v1/manus/tasks/:task_id/status", async (request: any) => {
    const task = await requireOwnedManusTask(request);
    if (!task.provider_task_id) {
      return {
        ...taskPublicFields(task),
        poll_after_seconds: MANUS_POLL_AFTER_SECONDS,
      };
    }
    const detail = await getManusTaskDetail(task.provider_task_id, { fetchImpl: manusFetch });
    const updated = await updateEndpointTaskFromDetail(store, task, detail);
    return {
      ...taskPublicFields(updated),
      poll_after_seconds: ["running", "waiting"].includes(String(updated.status))
        ? MANUS_POLL_AFTER_SECONDS
        : null,
    };
  });

  app.get("/v1/manus/tasks/:task_id/result", async (request: any) => {
    const task = await requireOwnedManusTask(request);
    if (!task.provider_task_id) return pendingManusResultPayload(task);
    const detail = await getManusTaskDetail(task.provider_task_id, { fetchImpl: manusFetch });
    const updated = await updateEndpointTaskFromDetail(store, task, detail);
    const messagesBody = await listManusTaskMessages(task.provider_task_id, { fetchImpl: manusFetch });
    return manusResultPayload({ task: updated, detail, messagesBody });
  });
}
