// Fastify error-handling plugin. Wires `normalizeApiError` into
// `app.setErrorHandler` so any thrown error inside a route gets a sanitized
// HTTP shape with stable codes for the dashboard and partner integrations.

const CONSTRAINT_ERROR_MESSAGES: Record<
  string,
  { code: string; message: string; statusCode?: number }
> = {
  api_keys_user_caller_active_key: {
    code: "api_key_name_conflict",
    message: "An API key with that name already exists. Choose a different name.",
    statusCode: 409,
  },
  api_keys_key_hash_key: {
    code: "api_key_generation_conflict",
    message: "We could not generate a unique API key. Please try again.",
    statusCode: 409,
  },
};

function isEndpointTaskProviderTaskNotNullError(error: any) {
  const message = error instanceof Error ? error.message : String(error);
  return /null value in column "provider_task_id" of relation "endpoint_tasks" violates not-null constraint/u.test(
    message,
  );
}

function constraintNameFrom(error: any) {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/unique constraint "([^"]+)"/)?.[1] || null;
}

export function normalizeApiError(error: any) {
  const constraint = constraintNameFrom(error);
  const knownConstraint = constraint
    ? CONSTRAINT_ERROR_MESSAGES[constraint]
    : null;
  const endpointTaskProviderTaskNotNull =
    isEndpointTaskProviderTaskNotNullError(error);
  const statusCode =
    (endpointTaskProviderTaskNotNull ? 500 : null) ||
    knownConstraint?.statusCode ||
    (constraint ? 409 : error.statusCode || error.status || 500);
  const fallbackCode =
    statusCode >= 500
      ? "internal_error"
      : statusCode === 409
        ? "conflict"
        : "bad_request";
  const publicCode =
    (endpointTaskProviderTaskNotNull ? "database_schema_mismatch" : null) ||
    knownConstraint?.code ||
    (constraint ? "conflict" : statusCode >= 500 ? fallbackCode : error.code || fallbackCode);
  const publicMessage =
    (endpointTaskProviderTaskNotNull
      ? "Database schema is missing nullable Manus task reservations. Apply Supabase migrations."
      : null) ||
    knownConstraint?.message ||
    (constraint ? "That value is already in use. Try a different value." : null) ||
    (statusCode >= 500
      ? "Internal server error"
      : error instanceof Error
        ? error.message
        : String(error));
  return {
    statusCode,
    code: publicCode,
    message: publicMessage,
    details:
      statusCode < 500 && !constraint && error.exposeDetails === true
        ? error.details || undefined
        : undefined,
    trace_id: error.trace_id || null,
  };
}

/**
 * Inline error-handler installer. Plain Fastify plugins are encapsulated, so
 * `setErrorHandler` inside `app.register(errorsPlugin)` would only catch
 * errors from that plugin. Calling `applyErrorHandler(app)` directly on the
 * root instance ensures every route plugin inherits the same handler.
 */
export function applyErrorHandler(app: any) {
  app.setErrorHandler((error: any, request: any, reply: any) => {
    const normalized = normalizeApiError(error);
    if (normalized.statusCode >= 500) {
      request.log.error(
        { code: normalized.code, trace_id: normalized.trace_id },
        normalized.message,
      );
    }
    reply.status(normalized.statusCode).send({
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
      },
      trace_id: normalized.trace_id,
    });
  });
}
