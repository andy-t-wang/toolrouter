// Small cross-route / cross-service utilities used by the orchestrator,
// preflight, and route plugins. Lifted from per-file duplicates flagged
// during the simplification pass.

/**
 * Ensure `value` is a plain object; throw an `invalid_request` 400 otherwise.
 * `label` is interpolated into the error message ("request body must be an
 * object", etc.).
 */
export function requireObject(value: any, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object`), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return value;
}

/**
 * Read a positive-integer milliseconds value from `process.env[name]`,
 * falling back to `fallback` when missing/zero/NaN.
 */
export function envMs(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * True when the executor result represents an internal timeout (the executor
 * raises an `error` containing "timed out after" when its `timeoutMs` budget
 * expires).
 */
export function timedOut(result: any) {
  return String(result?.error || "").includes("timed out after");
}
