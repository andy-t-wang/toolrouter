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

const MANUS_RESEARCH_DEPTH_ENV = Object.freeze({
  quick: "TOOLROUTER_MANUS_RESEARCH_PRICE_QUICK_USD",
  standard: "TOOLROUTER_MANUS_RESEARCH_PRICE_STANDARD_USD",
  deep: "TOOLROUTER_MANUS_RESEARCH_PRICE_DEEP_USD",
});

// Parallel markup added on top of Parallel's own per-call price, charged by
// the ToolRouter x402 seller wrapper. Per the sprint-2 directive.
export const PARALLEL_MARKUP_USD = 0.01;
// Base Parallel prices (pre-markup), USD per call.
export const PARALLEL_SEARCH_BASE_USD = 0.01;
export const PARALLEL_EXTRACT_PER_URL_USD = 0.01;
export const PARALLEL_TASK_PROCESSORS = Object.freeze({
  lite: 0.005,
  base: 0.01,
  core: 0.025,
  pro: 0.1,
  ultra: 0.3,
});

const PARALLEL_TASK_PROCESSOR_ENV = Object.freeze({
  lite: "TOOLROUTER_PARALLEL_TASK_PRICE_LITE_USD",
  base: "TOOLROUTER_PARALLEL_TASK_PRICE_BASE_USD",
  core: "TOOLROUTER_PARALLEL_TASK_PRICE_CORE_USD",
  pro: "TOOLROUTER_PARALLEL_TASK_PRICE_PRO_USD",
  ultra: "TOOLROUTER_PARALLEL_TASK_PRICE_ULTRA_USD",
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

function readHttpsUrlArray(input, names, label, options = {}) {
  return readStringArray(input, names, label, options).map((item, index) => {
    let url;
    try {
      url = new URL(item);
    } catch {
      throw new TypeError(`${label}[${index}] must be a valid URL`);
    }
    if (url.protocol !== "https:") {
      throw new TypeError(`${label}[${index}] must use https`);
    }
    return url.toString();
  });
}

function toUsdString(value) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
  return String(rounded).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

function configuredUsd(envValue, fallback) {
  const raw = String(envValue || fallback).trim();
  return /^\d+(\.\d+)?$/u.test(raw) ? raw : toUsdString(fallback);
}

export function manusResearchPriceForDepth(depth) {
  if (!Object.hasOwn(MANUS_RESEARCH_DEPTHS, depth)) {
    throw new RangeError(`unsupported Manus research depth: ${depth}`);
  }
  return configuredUsd(
    process.env[MANUS_RESEARCH_DEPTH_ENV[depth]],
    MANUS_RESEARCH_DEPTHS[depth],
  );
}

export function parallelTaskBasePriceForProcessor(processor) {
  if (!Object.hasOwn(PARALLEL_TASK_PROCESSORS, processor)) {
    throw new RangeError(`unsupported Parallel task processor: ${processor}`);
  }
  return Number(configuredUsd(
    process.env[PARALLEL_TASK_PROCESSOR_ENV[processor]],
    PARALLEL_TASK_PROCESSORS[processor],
  ));
}

export function parallelTaskPriceForProcessor(processor) {
  return toUsdString(parallelTaskBasePriceForProcessor(processor) + PARALLEL_MARKUP_USD);
}

export function parallelSearchPriceUsd() {
  return toUsdString(PARALLEL_SEARCH_BASE_USD + PARALLEL_MARKUP_USD);
}

export function parallelExtractPriceUsd(urlCount) {
  const count = Number.isInteger(urlCount) && urlCount > 0 ? urlCount : 1;
  return toUsdString(PARALLEL_EXTRACT_PER_URL_USD * count + PARALLEL_MARKUP_USD);
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
    defaultValue: "fast",
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
  const urls = readHttpsUrlArray(data, ["urls"], "urls", { max: 10 });
  const images = readHttpsUrlArray(data, ["images", "image_urls"], "images", { max: 5 });
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
    Number(manusResearchPriceForDepth(depth)),
  );
}

// Parallel's Search and Extract APIs cap each search query at 200 chars.
const PARALLEL_SEARCH_QUERY_MAX_CHARS = 200;

function readStringMatrix(input, names, label, { min = 1, max = 5, itemMaxChars }) {
  const value = firstDefined(input, names);
  if (value === undefined || value === null) {
    throw new TypeError(`${label} is required`);
  }
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length < min) throw new RangeError(`${label} must include at least ${min} item(s)`);
  if (value.length > max) throw new RangeError(`${label} must include at most ${max} items`);
  return value.map((item, index) => {
    if (typeof item !== "string") throw new TypeError(`${label}[${index}] must be a string`);
    const trimmed = item.trim();
    if (!trimmed) throw new TypeError(`${label}[${index}] must be non-empty`);
    if (itemMaxChars && trimmed.length > itemMaxChars) {
      throw new RangeError(`${label}[${index}] must be at most ${itemMaxChars} characters`);
    }
    return trimmed;
  });
}

/**
 * Parallel Search input — keyword-driven web search.
 *
 * @param {object} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildParallelSearchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const searchQueries = readStringMatrix(
    data,
    ["search_queries", "searchQueries", "queries"],
    "search_queries",
    { min: 1, max: 5, itemMaxChars: PARALLEL_SEARCH_QUERY_MAX_CHARS },
  );
  const objective = readString(data, ["objective"], "objective", { defaultValue: undefined });
  const mode = readString(data, ["mode"], "mode", { defaultValue: "advanced" });
  if (!["basic", "advanced"].includes(mode)) {
    throw new RangeError(`unsupported Parallel search mode: ${mode}`);
  }
  const json: Record<string, unknown> = {
    search_queries: searchQueries,
    mode,
  };
  if (objective) json.objective = objective;
  return providerRequest(endpoint, json, Number(parallelSearchPriceUsd()));
}

/**
 * Parallel Extract input — pull structured excerpts from one or more URLs.
 *
 * @param {object} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildParallelExtractRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const urls = readHttpsUrlArray(data, ["urls"], "urls", { max: 20 });
  if (urls.length < 1) {
    throw new RangeError("urls must include at least 1 item");
  }
  const objective = readString(data, ["objective"], "objective", { defaultValue: undefined });
  const searchQueries = firstDefined(data, ["search_queries", "searchQueries"]);
  let validatedQueries: string[] | undefined;
  if (searchQueries !== undefined) {
    if (!Array.isArray(searchQueries)) throw new TypeError("search_queries must be an array");
    if (searchQueries.length > 5) {
      throw new RangeError("search_queries must include at most 5 items");
    }
    validatedQueries = searchQueries.map((item, index) => {
      if (typeof item !== "string") throw new TypeError(`search_queries[${index}] must be a string`);
      const trimmed = item.trim();
      if (!trimmed) throw new TypeError(`search_queries[${index}] must be non-empty`);
      if (trimmed.length > PARALLEL_SEARCH_QUERY_MAX_CHARS) {
        throw new RangeError(
          `search_queries[${index}] must be at most ${PARALLEL_SEARCH_QUERY_MAX_CHARS} characters`,
        );
      }
      return trimmed;
    });
  }
  const fullContent = readBoolean(data, ["full_content", "fullContent"], "full_content", false);
  const json: Record<string, unknown> = { urls };
  if (objective) json.objective = objective;
  if (validatedQueries) json.search_queries = validatedQueries;
  if (fullContent) json.advanced_settings = { full_content: true };
  return providerRequest(endpoint, json, Number(parallelExtractPriceUsd(urls.length)));
}

/**
 * Parallel Task input — async deep-research task created against a chosen
 * processor tier. Mirrors the Manus depth-based pricing pattern.
 *
 * @param {object} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildParallelTaskRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const processor = readString(data, ["processor"], "processor", { defaultValue: "ultra" });
  if (!Object.hasOwn(PARALLEL_TASK_PROCESSORS, processor)) {
    throw new RangeError(`unsupported Parallel task processor: ${processor}`);
  }
  const inputValue = firstDefined(data, ["input", "query", "prompt"]);
  if (inputValue === undefined || inputValue === null) {
    throw new TypeError("input is required");
  }
  if (typeof inputValue !== "string" && (typeof inputValue !== "object" || Array.isArray(inputValue))) {
    throw new TypeError("input must be a string or object");
  }
  if (typeof inputValue === "string" && !inputValue.trim()) {
    throw new TypeError("input is required");
  }
  const metadata = firstDefined(data, ["metadata"]);
  if (metadata !== undefined && (typeof metadata !== "object" || Array.isArray(metadata))) {
    throw new TypeError("metadata must be an object");
  }
  const taskSpec = firstDefined(data, ["task_spec", "taskSpec"]);
  if (taskSpec !== undefined && (typeof taskSpec !== "object" || Array.isArray(taskSpec))) {
    throw new TypeError("task_spec must be an object");
  }
  const sourcePolicy = firstDefined(data, ["source_policy", "sourcePolicy"]);
  if (sourcePolicy !== undefined && (typeof sourcePolicy !== "object" || Array.isArray(sourcePolicy))) {
    throw new TypeError("source_policy must be an object");
  }
  const webhook = firstDefined(data, ["webhook"]);
  if (webhook !== undefined && (typeof webhook !== "object" || Array.isArray(webhook))) {
    throw new TypeError("webhook must be an object");
  }
  const json: Record<string, unknown> = {
    processor,
    input: typeof inputValue === "string" ? inputValue.trim() : inputValue,
  };
  if (metadata) json.metadata = metadata;
  if (taskSpec) json.task_spec = taskSpec;
  if (sourcePolicy) json.source_policy = sourcePolicy;
  if (webhook) json.webhook = webhook;
  return providerRequest(endpoint, json, Number(parallelTaskPriceForProcessor(processor)));
}
