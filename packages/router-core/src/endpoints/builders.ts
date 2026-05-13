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

/**
 * @typedef {object} ManusResearchInput
 * @property {string} [query]
 * @property {string} [prompt]
 * @property {"quick" | "standard" | "deep"} [depth]
 * @property {string} [taskType]
 * @property {string} [task_type]
 * @property {string[]} [urls]
 * @property {string[]} [images]
 * @property {string} [title]
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

export const MANUS_RESEARCH_DEPTHS = Object.freeze({
  quick: 0.03,
  standard: 0.05,
  deep: 0.1,
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

function readStringArray(input, names, label, { defaultValue = [], max = 10 } = {}) {
  const value = firstDefined(input, names);
  if (value === undefined) return defaultValue;
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > max) throw new RangeError(`${label} must include at most ${max} items`);
  return value.map((item, index) => {
    if (typeof item !== "string") throw new TypeError(`${label}[${index}] must be a string`);
    const trimmed = item.trim();
    if (!trimmed) throw new TypeError(`${label}[${index}] must be non-empty`);
    return trimmed;
  });
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

/**
 * @param {ManusResearchInput} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildManusResearchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const query = readString(data, ["query", "prompt"], "query", { required: true });
  const depth = readString(data, ["depth"], "depth", { defaultValue: "standard" });
  if (!Object.hasOwn(MANUS_RESEARCH_DEPTHS, depth)) {
    throw new RangeError(`unsupported Manus research depth: ${depth}`);
  }
  const taskType = readString(data, ["taskType", "task_type"], "taskType", {
    defaultValue: "general_research",
  });
  const title = readString(data, ["title"], "title", { defaultValue: undefined });
  const urls = readStringArray(data, ["urls"], "urls", { max: 10 });
  const images = readStringArray(data, ["images", "image_urls"], "images", { max: 5 });
  return providerRequest(
    endpoint,
    {
      query,
      depth,
      task_type: taskType,
      urls,
      images,
      ...(title ? { title } : {}),
    },
    MANUS_RESEARCH_DEPTHS[depth],
  );
}
