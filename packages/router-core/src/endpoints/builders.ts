/**
 * @typedef {object} ProviderRequest
 * @property {"GET" | "POST"} method
 * @property {string} url
 * @property {Record<string, string>} [headers]
 * @property {Record<string, unknown>} [json]
 * @property {string} estimatedUsd
 */

/**
 * @typedef {object} ExaSearchInput
 * @property {string} query
 * @property {keyof typeof EXA_SEARCH_PRICES} [searchType]
 * @property {keyof typeof EXA_SEARCH_PRICES} [search_type]
 * @property {keyof typeof EXA_SEARCH_PRICES} [type]
 * @property {number} [numResults]
 * @property {number} [num_results]
 * @property {boolean} [includeText]
 * @property {boolean} [include_text]
 * @property {boolean} [includeSummary]
 * @property {boolean} [include_summary]
 */

/**
 * @typedef {object} BrowserbaseSessionInput
 * @property {number} [estimatedMinutes]
 * @property {number} [estimated_minutes]
 */

export const EXA_SEARCH_PRICES = Object.freeze({
  instant: 0.007,
  auto: 0.007,
  fast: 0.007,
  "deep-lite": 0.01,
  deep: 0.012,
  "deep-reasoning": 0.015,
  "deep-max": 0.03,
});

const DEFAULT_HEADERS = Object.freeze({
  "content-type": "application/json",
});

function assertInputRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("endpoint input must be an object");
  }
  return input;
}

function firstDefined(input, names) {
  for (const name of names) {
    if (input[name] !== undefined) return input[name];
  }
  return undefined;
}

function readString(input, names, label, { required = false, defaultValue = undefined } = {}) {
  const value = firstDefined(input, names);
  if (value === undefined) {
    if (required) throw new TypeError(`${label} is required`);
    return defaultValue;
  }
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new TypeError(`${label} is required`);
  return trimmed || defaultValue;
}

function readBoolean(input, names, label, defaultValue = false) {
  const value = firstDefined(input, names);
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError(`${label} must be a boolean`);
}

function readInteger(input, names, label, { defaultValue, min, max }) {
  const value = firstDefined(input, names);
  const resolved = value === undefined ? defaultValue : value;
  if (!Number.isInteger(resolved)) throw new TypeError(`${label} must be an integer`);
  if (resolved < min || resolved > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}`);
  }
  return resolved;
}

function toUsdString(value) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
  return String(rounded).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

function providerRequest(endpoint, json, estimatedUsd) {
  return {
    method: endpoint.method,
    url: endpoint.url,
    headers: { ...DEFAULT_HEADERS },
    json,
    estimatedUsd: toUsdString(estimatedUsd),
  };
}

/**
 * @param {ExaSearchInput} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildExaSearchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const query = readString(data, ["query"], "query", { required: true });
  const searchType = readString(data, ["searchType", "search_type", "type"], "searchType", {
    defaultValue: "auto",
  });
  if (!Object.hasOwn(EXA_SEARCH_PRICES, searchType)) {
    throw new RangeError(`unsupported Exa searchType: ${searchType}`);
  }

  const numResults = readInteger(data, ["numResults", "num_results"], "numResults", {
    defaultValue: 5,
    min: 1,
    max: 10,
  });
  const includeText = readBoolean(data, ["includeText", "include_text", "text"], "includeText", false);
  const includeSummary = readBoolean(
    data,
    ["includeSummary", "include_summary", "summary"],
    "includeSummary",
    false,
  );

  const json: Record<string, unknown> = {
    query,
    type: searchType,
    numResults,
  };
  const contents: Record<string, unknown> = {};
  if (includeText) contents.text = true;
  if (includeSummary) contents.summary = true;
  if (Object.keys(contents).length > 0) json.contents = contents;

  const summaryCost = includeSummary ? 0.001 * numResults : 0;
  return providerRequest(endpoint, json, EXA_SEARCH_PRICES[searchType] + summaryCost);
}

/**
 * @param {BrowserbaseSessionInput} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildBrowserbaseSessionRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const estimatedMinutes = readInteger(data, ["estimatedMinutes", "estimated_minutes"], "estimatedMinutes", {
    defaultValue: 5,
    min: 5,
    max: 120,
  });
  return providerRequest(endpoint, { estimatedMinutes }, (0.12 * estimatedMinutes) / 60);
}
