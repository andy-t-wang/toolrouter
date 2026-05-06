import { isEndpointCategory } from "./categories.ts";
import { browserbaseSessionEndpointDefinition } from "./browser_usage/browserbase/session.ts";
import { browserbaseFetchEndpointDefinition } from "./data/browserbase/fetch.ts";
import { browserbaseSearchEndpointDefinition } from "./search/browserbase/search.ts";
import { exaSearchEndpointDefinition } from "./search/exa/search.ts";

const ENDPOINT_DEFINITIONS = Object.freeze([
  browserbaseFetchEndpointDefinition,
  browserbaseSearchEndpointDefinition,
  browserbaseSessionEndpointDefinition,
  exaSearchEndpointDefinition,
]);

function assertHttpUrl(value, fieldName) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${fieldName} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") throw new TypeError(`${fieldName} must use https`);
  return parsed.toString();
}

export function validateEndpoint(endpoint) {
  const required = ["id", "provider", "category", "name", "url", "method"];
  for (const field of required) {
    if (!endpoint[field]) throw new TypeError(`endpoint ${endpoint.id || "(unknown)"} missing ${field}`);
  }
  if (!isEndpointCategory(endpoint.category)) {
    throw new RangeError(`endpoint ${endpoint.id} has unsupported category: ${endpoint.category}`);
  }
  assertHttpUrl(endpoint.url, `${endpoint.id}.url`);
  if (endpoint.method !== "POST") throw new RangeError(`endpoint ${endpoint.id} must use POST for MVP`);
  if (!endpoint.agentkit || !endpoint.x402) {
    throw new Error(`endpoint ${endpoint.id} must support AgentKit and x402`);
  }
  if (!["free_trial", "discount", "access"].includes(endpoint.agentkit_value_type)) {
    throw new Error(`endpoint ${endpoint.id} must define agentkit_value_type`);
  }
  if (!endpoint.fixture_input) throw new Error(`endpoint ${endpoint.id} missing fixture_input`);
  if (!endpoint.health_probe) throw new Error(`endpoint ${endpoint.id} missing health_probe`);
  if (!endpoint.live_smoke) throw new Error(`endpoint ${endpoint.id} missing live_smoke`);
  if (typeof endpoint.builder !== "function") throw new Error(`endpoint ${endpoint.id} missing builder`);
  return true;
}

function materializeEndpoint(definition) {
  validateEndpoint(definition);
  const fieldOrder = Object.keys(definition.fixture_input || {});
  const maxUsd = definition.health_probe.max_usd || definition.health_probe.maxUsd || "0.02";
  const ui = Object.freeze({
    displayName: definition.name,
    icon: definition.provider,
    primaryField: fieldOrder[0] || "input",
    fieldOrder,
    ...definition.ui,
  });
  return Object.freeze({
    ...definition,
    enabled: true,
    ui,
    defaultPaymentMode: definition.default_payment_mode || "agentkit_first",
    fixture: Object.freeze({
      input: definition.fixture_input,
      maxUsd,
    }),
    fixtureInput: definition.fixture_input,
    healthProbe: Object.freeze({
      ...definition.health_probe,
      maxUsd,
      paymentMode: definition.health_probe.payment_mode || definition.default_payment_mode || "agentkit_first",
    }),
    liveSmoke: Object.freeze({
      ...definition.live_smoke,
    }),
    buildRequest(input) {
      return definition.builder(input, definition);
    },
  });
}

export const endpointRegistry = Object.freeze(ENDPOINT_DEFINITIONS.map(materializeEndpoint));

export function endpointToJSON(endpoint) {
  return {
    id: endpoint.id,
    provider: endpoint.provider,
    category: endpoint.category,
    name: endpoint.name,
    description: endpoint.description,
    url_host: new URL(endpoint.url).hostname,
    method: endpoint.method,
    agentkit: endpoint.agentkit,
    x402: endpoint.x402,
    estimated_cost_usd: endpoint.estimated_cost_usd,
    agentkit_value_type: endpoint.agentkit_value_type,
    agentkit_value_label: endpoint.agentkit_value_label,
    ui: endpoint.ui,
    fixture_input: endpoint.fixtureInput,
    health_probe: endpoint.healthProbe,
    default_payment_mode: endpoint.defaultPaymentMode,
    enabled: endpoint.enabled,
  };
}

export function listEndpoints({ category }: any = {}) {
  const endpoints = category
    ? endpointRegistry.filter((endpoint) => endpoint.category === category)
    : endpointRegistry;
  return endpoints.map(endpointToJSON);
}

export function listEndpointMetadata(options = {}) {
  return listEndpoints(options);
}

export function getEndpoint(endpointId) {
  const endpoint = endpointRegistry.find((candidate) => candidate.id === endpointId);
  if (!endpoint) throw new Error(`unknown endpoint_id: ${endpointId}`);
  return endpoint;
}

export function buildEndpointRequest(endpointOrId, input = {}) {
  const endpoint = typeof endpointOrId === "string" ? getEndpoint(endpointOrId) : endpointOrId;
  return endpoint.buildRequest(input);
}

export function buildEndpointFixtureRequest(endpointOrId) {
  const endpoint = typeof endpointOrId === "string" ? getEndpoint(endpointOrId) : endpointOrId;
  return endpoint.buildRequest(endpoint.fixtureInput);
}

export function buildEndpointHealthProbeRequest(endpointOrId) {
  const endpoint = typeof endpointOrId === "string" ? getEndpoint(endpointOrId) : endpointOrId;
  return {
    request: endpoint.buildRequest(endpoint.healthProbe.input),
    maxUsd: endpoint.healthProbe.max_usd || endpoint.healthProbe.maxUsd,
  };
}

export function validateRegistry() {
  for (const endpoint of endpointRegistry) validateEndpoint(endpoint);
  return true;
}
