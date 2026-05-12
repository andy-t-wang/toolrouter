import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { normalizeApiError } = await import("../../../apps/api/src/app.ts");

describe("API error normalization", () => {
  it("turns duplicate API key names into a human-readable conflict", () => {
    for (const constraint of [
      "api_keys_caller_id_key",
      "api_keys_user_caller_active_key",
    ]) {
      const raw = Object.assign(
        new Error(`duplicate key value violates unique constraint "${constraint}"`),
        {
          statusCode: 409,
          code: "supabase_error",
          details: 'Key (caller_id)=(Hermes) already exists.',
        },
      );

      assert.deepEqual(normalizeApiError(raw), {
        statusCode: 409,
        code: "api_key_name_conflict",
        message: "An API key with that name already exists. Choose a different name.",
        details: undefined,
        trace_id: null,
      });
    }
  });

  it("keeps unknown errors intact", () => {
    const raw = Object.assign(new Error("endpoint_id is required"), {
      statusCode: 400,
      code: "invalid_request",
    });

    assert.deepEqual(normalizeApiError(raw), {
      statusCode: 400,
      code: "invalid_request",
      message: "endpoint_id is required",
      details: undefined,
      trace_id: null,
    });
  });

  it("hides unexpected server error messages", () => {
    const raw = Object.assign(new Error("database password leaked in stack"), {
      statusCode: 500,
      code: "supabase_error",
      details: "raw backend details",
      exposeDetails: true,
      trace_id: "trace_123",
    });

    assert.deepEqual(normalizeApiError(raw), {
      statusCode: 500,
      code: "internal_error",
      message: "Internal server error",
      details: undefined,
      trace_id: "trace_123",
    });
  });


  it("hides raw database constraint names for unknown uniqueness errors", () => {
    const raw = Object.assign(
      new Error('duplicate key value violates unique constraint "some_table_slug_key"'),
      {
        statusCode: 409,
        code: "supabase_error",
        details: "Key (slug)=(demo) already exists.",
      },
    );

    assert.deepEqual(normalizeApiError(raw), {
      statusCode: 409,
      code: "conflict",
      message: "That value is already in use. Try a different value.",
      details: undefined,
      trace_id: null,
    });
  });
});
