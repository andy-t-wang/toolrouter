import assert from "node:assert/strict";

import { isEndpointCategory } from "../endpoints/categories.ts";

const DECIMAL_USD = /^\d+(\.\d{1,6})?$/u;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validUsdString(value) {
  return typeof value === "string" && DECIMAL_USD.test(value) && Number(value) >= 0;
}

export function validateProviderRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) errors.push("request must be an object");
  if (!["GET", "POST"].includes(request?.method)) errors.push("request.method must be GET or POST");
  if (!isHttpsUrl(request?.url)) errors.push("request.url must be an https URL");
  if (!validUsdString(request?.estimatedUsd)) {
    errors.push("request.estimatedUsd must be a decimal USD string");
  }
  if (request?.method === "POST" && !isPlainObject(request?.json)) {
    errors.push("POST request.json must be an object");
  }
  return errors;
}

export function validateEndpointConfig(endpoint) {
  const errors = [];
  if (!isPlainObject(endpoint)) return ["endpoint must be an object"];

  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u.test(endpoint.id || "")) {
    errors.push("id must be provider.name format");
  }
  if (typeof endpoint.provider !== "string" || endpoint.provider.length === 0) {
    errors.push("provider is required");
  }
  if (typeof endpoint.id === "string" && endpoint.provider && !endpoint.id.startsWith(`${endpoint.provider}.`)) {
    errors.push("id must be prefixed by provider");
  }
  if (!isEndpointCategory(endpoint.category)) {
    errors.push(`category must be one of the MVP categories: ${endpoint.category}`);
  }
  if (typeof endpoint.name !== "string" || endpoint.name.length === 0) errors.push("name is required");
  if (typeof endpoint.description !== "string" || endpoint.description.length === 0) {
    errors.push("description is required");
  }
  if (!isHttpsUrl(endpoint.url)) errors.push("url must be an https URL");
  if (!["GET", "POST"].includes(endpoint.method)) errors.push("method must be GET or POST");
  if (endpoint.x402 !== true) errors.push("x402 must be true");
  if (endpoint.agentkit !== true && endpoint.defaultPaymentMode !== "x402_only") {
    errors.push("endpoints without AgentKit must default to x402_only");
  }
  if (!["none", "free_trial", "discount", "access"].includes(endpoint.agentkit_value_type)) {
    errors.push("agentkit_value_type must be none, free_trial, discount, or access");
  }
  if (endpoint.agentkit === true && endpoint.agentkit_value_type === "none") {
    errors.push("AgentKit endpoints must define a concrete AgentKit value type");
  }
  if (endpoint.agentkit !== true && endpoint.agentkit_value_type !== "none") {
    errors.push("x402-only endpoints must use agentkit_value_type none");
  }
  if (typeof endpoint.agentkit_value_label !== "string" || endpoint.agentkit_value_label.length === 0) {
    errors.push("agentkit_value_label is required");
  }
  if (!Number.isFinite(endpoint.estimated_cost_usd) || endpoint.estimated_cost_usd <= 0) {
    errors.push("estimated_cost_usd must be a positive number");
  }
  if (typeof endpoint.buildRequest !== "function") errors.push("buildRequest function is required");

  if (!isPlainObject(endpoint.healthProbe)) {
    errors.push("healthProbe is required");
  } else {
    if (endpoint.healthProbe.mode !== "paid_availability") errors.push("healthProbe.mode must be paid_availability");
    if (!isPlainObject(endpoint.healthProbe.input)) errors.push("healthProbe.input must be an object");
    if (!validUsdString(endpoint.healthProbe.maxUsd)) errors.push("healthProbe.maxUsd must be a USD string");
    if (endpoint.healthProbe.paymentMode !== "x402_only") {
      errors.push("healthProbe.paymentMode must be x402_only");
    }
    if (
      endpoint.healthProbe.latencyBudgetMs !== undefined &&
      (!Number.isFinite(endpoint.healthProbe.latencyBudgetMs) || endpoint.healthProbe.latencyBudgetMs <= 0)
    ) {
      errors.push("healthProbe.latencyBudgetMs must be a positive number");
    }
    if (
      endpoint.healthProbe.timeoutMs !== undefined &&
      (!Number.isFinite(endpoint.healthProbe.timeoutMs) || endpoint.healthProbe.timeoutMs <= 0)
    ) {
      errors.push("healthProbe.timeoutMs must be a positive number");
    }
  }

  if (endpoint.agentkit !== true) {
    if (endpoint.agentkitHealthProbe !== null) {
      errors.push("x402-only endpoints must not define agentkitHealthProbe");
    }
  } else if (!isPlainObject(endpoint.agentkitHealthProbe)) {
    errors.push("agentkitHealthProbe is required");
  } else {
    if (endpoint.agentkitHealthProbe.mode !== "agentkit_benefit") {
      errors.push("agentkitHealthProbe.mode must be agentkit_benefit");
    }
    if (endpoint.agentkitHealthProbe.paymentMode !== "agentkit_first") {
      errors.push("agentkitHealthProbe.paymentMode must be agentkit_first");
    }
    if (
      endpoint.agentkitHealthProbe.timeoutMs !== undefined &&
      (!Number.isFinite(endpoint.agentkitHealthProbe.timeoutMs) || endpoint.agentkitHealthProbe.timeoutMs <= 0)
    ) {
      errors.push("agentkitHealthProbe.timeoutMs must be a positive number");
    }
  }

  if (!isPlainObject(endpoint.fixture)) {
    errors.push("fixture is required");
  } else {
    if (!isPlainObject(endpoint.fixture.input)) errors.push("fixture.input must be an object");
    if (!validUsdString(endpoint.fixture.maxUsd)) errors.push("fixture.maxUsd must be a USD string");
  }

  if (!isPlainObject(endpoint.ui)) {
    errors.push("ui metadata is required");
  } else {
    if (typeof endpoint.ui.displayName !== "string" || endpoint.ui.displayName.length === 0) {
      errors.push("ui.displayName is required");
    }
    if (typeof endpoint.ui.icon !== "string" || endpoint.ui.icon.length === 0) errors.push("ui.icon is required");
    if (typeof endpoint.ui.primaryField !== "string" || endpoint.ui.primaryField.length === 0) {
      errors.push("ui.primaryField is required");
    }
    if (!Array.isArray(endpoint.ui.fieldOrder)) {
      errors.push("ui.fieldOrder must be an array");
    }
  }

  if (!isPlainObject(endpoint.liveSmoke)) {
    errors.push("liveSmoke is required");
  } else {
    for (const key of ["default_path", "paid_path"]) {
      const smoke = endpoint.liveSmoke[key];
      if (!isPlainObject(smoke)) {
        errors.push(`liveSmoke.${key} is required`);
        continue;
      }
      if (!["agentkit_first", "x402_only"].includes(smoke.payment_mode)) {
        errors.push(`liveSmoke.${key}.payment_mode must be agentkit_first or x402_only`);
      }
      if (!isPlainObject(smoke.input)) errors.push(`liveSmoke.${key}.input must be an object`);
      if (!validUsdString(smoke.max_usd)) errors.push(`liveSmoke.${key}.max_usd must be a USD string`);
    }
  }

  return errors;
}

export function validateEndpointRegistry(endpoints) {
  const errors = [];
  if (!Array.isArray(endpoints)) return ["endpoint registry must be an array"];

  const ids = new Set();
  for (const endpoint of endpoints) {
    for (const error of validateEndpointConfig(endpoint)) {
      errors.push(`${endpoint?.id || "unknown"}: ${error}`);
    }
    if (ids.has(endpoint.id)) errors.push(`${endpoint.id}: duplicate endpoint id`);
    ids.add(endpoint.id);
  }
  return errors;
}

export function assertValidEndpointConfig(endpoint) {
  const errors = validateEndpointConfig(endpoint);
  assert.deepEqual(errors, [], `invalid endpoint config:\n${errors.join("\n")}`);
}

export function assertValidEndpointRegistry(endpoints) {
  const errors = validateEndpointRegistry(endpoints);
  assert.deepEqual(errors, [], `invalid endpoint registry:\n${errors.join("\n")}`);
}

export function assertEndpointFixtureBuilds(endpoint) {
  const request = endpoint.buildRequest(endpoint.fixture.input);
  const errors = validateProviderRequest(request);
  assert.deepEqual(errors, [], `invalid fixture request for ${endpoint.id}:\n${errors.join("\n")}`);
  return request;
}

export function assertEndpointHealthProbeBuilds(endpoint) {
  const request = endpoint.buildRequest(endpoint.healthProbe.input);
  const errors = validateProviderRequest(request);
  assert.deepEqual(errors, [], `invalid health probe request for ${endpoint.id}:\n${errors.join("\n")}`);
  return request;
}
