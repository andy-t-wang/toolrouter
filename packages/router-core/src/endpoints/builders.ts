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

export const AGENTMAIL_X402_API_BASE = "https://x402.api.agentmail.to";
export const AGENTMAIL_MARKUP_USD = 0.01;
export const AGENTMAIL_BASE_PRICES_USD = Object.freeze({
  create_inbox: 2,
  list_messages: 0,
  get_message: 0,
  send_message: 0.01,
  reply_to_message: 0.01,
});

export const STABLETRAVEL_API_BASE = "https://stabletravel.dev";
export const STABLETRAVEL_PRICES_USD = Object.freeze({
  locations: 0.0054,
  google_flights_search: 0.02,
  hotels_list: 0.0324,
  hotels_search: 0.0324,
  flightaware_flights: 0.01,
});

export const STABLETRAVEL_MAX_USD = Object.freeze({
  locations: 0.007,
  google_flights_search: 0.025,
  hotels_list: 0.04,
  hotels_search: 0.04,
  flightaware_flights: 0.012,
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

function readOptionalBoolean(input, names, label) {
  const value = firstDefined(input, names);
  if (value === undefined) return undefined;
  return readBoolean(input, names, label, false);
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

function readOptionalInteger(input, names, label, { min, max }) {
  const value = firstDefined(input, names);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  if (value < min || value > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

function readOptionalNumber(input, names, label, { min, max }) {
  const value = firstDefined(input, names);
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a number`);
  }
  if (value < min || value > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}`);
  }
  return value;
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

function readCsvString(input, names, label, { max = 20 } = {}) {
  const value = firstDefined(input, names);
  if (value === undefined) return undefined;
  const rawItems = typeof value === "string" ? [value] : value;
  if (!Array.isArray(rawItems)) throw new TypeError(`${label} must be a string or array`);
  const items = rawItems.flatMap((item, index) => {
    if (typeof item !== "string") throw new TypeError(`${label}[${index}] must be a string`);
    return item.split(",").map((part) => part.trim());
  });
  if (items.length > max) throw new RangeError(`${label} must include at most ${max} items`);
  items.forEach((item, index) => {
    if (!item) throw new TypeError(`${label}[${index}] must be non-empty`);
  });
  return items.join(",");
}

function readStringOrArray(input, names, label, { required = false, max = 50 } = {}) {
  const value = firstDefined(input, names);
  if (value === undefined) {
    if (required) throw new TypeError(`${label} is required`);
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) throw new TypeError(`${label} must be non-empty`);
    return trimmed;
  }
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a string or array`);
  if (value.length > max) throw new RangeError(`${label} must include at most ${max} items`);
  return value.map((item, index) => {
    if (typeof item !== "string") throw new TypeError(`${label}[${index}] must be a string`);
    const trimmed = item.trim();
    if (!trimmed) throw new TypeError(`${label}[${index}] must be non-empty`);
    return trimmed;
  });
}

function recipientCount(value) {
  if (value === undefined) return 0;
  return Array.isArray(value) ? value.length : 1;
}

function readPlainObject(input, names, label) {
  const value = firstDefined(input, names);
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function readObjectArray(input, names, label, { max = 10 } = {}) {
  const value = firstDefined(input, names);
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > max) throw new RangeError(`${label} must include at most ${max} items`);
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(`${label}[${index}] must be an object`);
    }
  }
  return value;
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

function readDate(input, names, label, { required = false, defaultValue = undefined } = {}) {
  const value = readString(input, names, label, { required, defaultValue });
  if (value === undefined) return undefined;
  const rollingMatch = /^today\+(\d{1,4})d$/u.exec(value);
  if (rollingMatch) {
    const offsetDays = Number(rollingMatch[1]);
    const today = new Date();
    const date = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + offsetDays,
    ));
    return date.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new TypeError(`${label} must use YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`${label} must be a valid calendar date`);
  }
  return value;
}

function assertDateOrder(startDate, endDate, { allowSameDay = false, startLabel, endLabel }) {
  if (!startDate || !endDate) return;
  const valid = allowSameDay ? endDate >= startDate : endDate > startDate;
  if (!valid) {
    throw new RangeError(`${endLabel} must be ${allowSameDay ? "on or after" : "after"} ${startLabel}`);
  }
}

function readEnum(input, names, label, values, { required = false, defaultValue = undefined } = {}) {
  const value = readString(input, names, label, { required, defaultValue });
  if (value === undefined) return undefined;
  if (!values.includes(value)) {
    throw new RangeError(`${label} must be one of ${values.join(", ")}`);
  }
  return value;
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

export function agentmailPriceUsd(kind) {
  if (!Object.hasOwn(AGENTMAIL_BASE_PRICES_USD, kind)) {
    throw new RangeError(`unsupported AgentMail price kind: ${kind}`);
  }
  const base = AGENTMAIL_BASE_PRICES_USD[kind];
  return toUsdString(base + AGENTMAIL_MARKUP_USD);
}

export function stabletravelPriceUsd(kind) {
  if (!Object.hasOwn(STABLETRAVEL_PRICES_USD, kind)) {
    throw new RangeError(`unsupported StableTravel price kind: ${kind}`);
  }
  return toUsdString(STABLETRAVEL_PRICES_USD[kind]);
}

export function stabletravelMaxUsd(kind) {
  if (!Object.hasOwn(STABLETRAVEL_MAX_USD, kind)) {
    throw new RangeError(`unsupported StableTravel maxUsd kind: ${kind}`);
  }
  return toUsdString(STABLETRAVEL_MAX_USD[kind]);
}

export function stabletravelCostLabel(kind) {
  return `costs $${stabletravelPriceUsd(kind)} with a $${stabletravelMaxUsd(kind)} default cap`;
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

function stabletravelGetRequest(endpoint, query, estimatedUsd, pathSuffix = "") {
  const url = new URL(`${endpoint.url.replace(/\/$/u, "")}${pathSuffix}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return {
    method: "GET",
    url: url.toString(),
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

function agentmailMessageBody(data, { requireSubject = false } = {}) {
  const to = readStringOrArray(data, ["to"], "to", { required: false, max: 50 });
  const cc = readStringOrArray(data, ["cc"], "cc", { max: 50 });
  const bcc = readStringOrArray(data, ["bcc"], "bcc", { max: 50 });
  const replyTo = readStringOrArray(data, ["reply_to", "replyTo"], "reply_to", { max: 50 });
  const recipientTotal = recipientCount(to) + recipientCount(cc) + recipientCount(bcc);
  if (recipientTotal > 50) throw new RangeError("to, cc, and bcc must include at most 50 total recipients");

  const subject = readString(data, ["subject"], "subject", { required: requireSubject });
  const text = readString(data, ["text"], "text", { defaultValue: undefined });
  const html = readString(data, ["html"], "html", { defaultValue: undefined });
  if (!text && !html) throw new TypeError("text or html is required");

  const labels = readStringArray(data, ["labels"], "labels", { max: 20 });
  const attachments = readObjectArray(data, ["attachments"], "attachments", { max: 10 });
  const headers = readPlainObject(data, ["headers"], "headers");
  const body: Record<string, unknown> = {};
  if (to !== undefined) body.to = to;
  if (cc !== undefined) body.cc = cc;
  if (bcc !== undefined) body.bcc = bcc;
  if (replyTo !== undefined) body.reply_to = replyTo;
  if (subject) body.subject = subject;
  if (text) body.text = text;
  if (html) body.html = html;
  if (labels.length > 0) body.labels = labels;
  if (attachments) body.attachments = attachments;
  if (headers) body.headers = headers;
  return body;
}

/**
 * @param {object} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildAgentmailCreateInboxRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const username = readString(data, ["username"], "username", { defaultValue: undefined });
  const domain = readString(data, ["domain"], "domain", { defaultValue: undefined });
  const displayName = readString(data, ["display_name", "displayName"], "display_name", {
    defaultValue: undefined,
  });
  const clientId = readString(data, ["client_id", "clientId"], "client_id", {
    defaultValue: undefined,
  });
  const json: Record<string, unknown> = {};
  if (username) json.username = username;
  if (domain) json.domain = domain;
  if (displayName) json.display_name = displayName;
  if (clientId) json.client_id = clientId;
  return providerRequest(endpoint, json, Number(agentmailPriceUsd("create_inbox")));
}

/**
 * @param {object} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildAgentmailListMessagesRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const inboxId = readString(data, ["inbox_id", "inboxId"], "inbox_id", { required: true });
  const limit = readInteger(data, ["limit"], "limit", { defaultValue: 10, min: 1, max: 100 });
  const pageToken = readString(data, ["page_token", "pageToken"], "page_token", {
    defaultValue: undefined,
  });
  const labels = readStringArray(data, ["labels"], "labels", { max: 20 });
  const before = readString(data, ["before"], "before", { defaultValue: undefined });
  const after = readString(data, ["after"], "after", { defaultValue: undefined });
  const ascending = readOptionalBoolean(data, ["ascending"], "ascending");
  const includeSpam = readOptionalBoolean(data, ["include_spam", "includeSpam"], "include_spam");
  const includeBlocked = readOptionalBoolean(data, ["include_blocked", "includeBlocked"], "include_blocked");
  const includeUnauthenticated = readOptionalBoolean(
    data,
    ["include_unauthenticated", "includeUnauthenticated"],
    "include_unauthenticated",
  );
  const includeTrash = readOptionalBoolean(data, ["include_trash", "includeTrash"], "include_trash");
  const json: Record<string, unknown> = {
    inbox_id: inboxId,
    limit,
  };
  if (pageToken) json.page_token = pageToken;
  if (labels.length > 0) json.labels = labels;
  if (before) json.before = before;
  if (after) json.after = after;
  if (ascending !== undefined) json.ascending = ascending;
  if (includeSpam !== undefined) json.include_spam = includeSpam;
  if (includeBlocked !== undefined) json.include_blocked = includeBlocked;
  if (includeUnauthenticated !== undefined) json.include_unauthenticated = includeUnauthenticated;
  if (includeTrash !== undefined) json.include_trash = includeTrash;
  return providerRequest(
    endpoint,
    json,
    Number(agentmailPriceUsd("list_messages")),
  );
}

/**
 * @param {object} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildAgentmailGetMessageRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const inboxId = readString(data, ["inbox_id", "inboxId"], "inbox_id", { required: true });
  const messageId = readString(data, ["message_id", "messageId"], "message_id", { required: true });
  return providerRequest(
    endpoint,
    {
      inbox_id: inboxId,
      message_id: messageId,
    },
    Number(agentmailPriceUsd("get_message")),
  );
}

/**
 * @param {object} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildAgentmailSendMessageRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const inboxId = readString(data, ["inbox_id", "inboxId"], "inbox_id", { required: true });
  const body = agentmailMessageBody(data);
  if (recipientCount(body.to) < 1) throw new TypeError("to is required");
  return providerRequest(
    endpoint,
    { inbox_id: inboxId, ...body },
    Number(agentmailPriceUsd("send_message")),
  );
}

/**
 * @param {object} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildAgentmailReplyToMessageRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const inboxId = readString(data, ["inbox_id", "inboxId"], "inbox_id", { required: true });
  const messageId = readString(data, ["message_id", "messageId"], "message_id", { required: true });
  const replyAll = readBoolean(data, ["reply_all", "replyAll"], "reply_all", false);
  return providerRequest(
    endpoint,
    {
      inbox_id: inboxId,
      message_id: messageId,
      ...agentmailMessageBody(data),
      ...(replyAll ? { reply_all: true } : {}),
    },
    Number(agentmailPriceUsd("reply_to_message")),
  );
}

export function buildStabletravelLocationsRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const keyword = readString(data, ["keyword", "query"], "keyword", { required: true });
  const subType = readEnum(data, ["subType", "sub_type"], "subType", ["AIRPORT", "CITY", "AIRPORT,CITY"], {
    defaultValue: "AIRPORT,CITY",
  });
  const countryCode = readString(data, ["countryCode", "country_code"], "countryCode", {
    defaultValue: undefined,
  });
  const pageLimit = readInteger(data, ["page_limit", "pageLimit", "limit"], "page_limit", {
    defaultValue: 5,
    min: 1,
    max: 20,
  });
  const pageOffset = readOptionalInteger(data, ["page_offset", "pageOffset", "offset"], "page_offset", {
    min: 0,
    max: 500,
  });
  const sort = readEnum(data, ["sort"], "sort", ["analytics.travelers.score"], { defaultValue: undefined });
  const view = readEnum(data, ["view"], "view", ["FULL", "LIGHT"], { defaultValue: "LIGHT" });
  return stabletravelGetRequest(
    endpoint,
    {
      subType,
      keyword,
      countryCode,
      "page[limit]": pageLimit,
      "page[offset]": pageOffset,
      sort,
      view,
    },
    Number(stabletravelPriceUsd("locations")),
  );
}

export function buildStabletravelGoogleFlightsSearchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const departureId = readString(data, ["departure_id", "departureId"], "departure_id", { required: true });
  const arrivalId = readString(data, ["arrival_id", "arrivalId"], "arrival_id", { required: true });
  const outboundDate = readDate(data, ["outbound_date", "outboundDate"], "outbound_date", { required: true });
  const returnDate = readDate(data, ["return_date", "returnDate"], "return_date");
  const type = readEnum(data, ["type", "trip_type", "tripType"], "type", ["1", "2"], {
    defaultValue: returnDate ? "1" : "2",
  });
  if (type === "1" && !returnDate) throw new TypeError("return_date is required for round trip searches");
  assertDateOrder(outboundDate, returnDate, {
    allowSameDay: true,
    startLabel: "outbound_date",
    endLabel: "return_date",
  });
  const travelClass = readEnum(
    data,
    ["travel_class", "travelClass"],
    "travel_class",
    ["1", "2", "3", "4"],
    { defaultValue: undefined },
  );
  const adults = readInteger(data, ["adults"], "adults", { defaultValue: 1, min: 1, max: 9 });
  const children = readInteger(data, ["children"], "children", { defaultValue: 0, min: 0, max: 9 });
  const infantsInSeat = readInteger(data, ["infants_in_seat", "infantsInSeat"], "infants_in_seat", {
    defaultValue: 0,
    min: 0,
    max: 9,
  });
  const infantsOnLap = readInteger(data, ["infants_on_lap", "infantsOnLap"], "infants_on_lap", {
    defaultValue: 0,
    min: 0,
    max: 9,
  });
  const stops = readEnum(data, ["stops"], "stops", ["0", "1", "2", "3"], { defaultValue: undefined });
  const maxPrice = readOptionalInteger(data, ["max_price", "maxPrice"], "max_price", {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  const excludeAirlines = readCsvString(data, ["exclude_airlines", "excludeAirlines"], "exclude_airlines");
  const includeAirlines = readCsvString(data, ["include_airlines", "includeAirlines"], "include_airlines");
  const currency = readString(data, ["currency"], "currency", { defaultValue: "USD" }).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw new TypeError("currency must be a 3-letter code");
  const hl = readString(data, ["hl", "language"], "hl", { defaultValue: "en" });
  const gl = readString(data, ["gl", "country"], "gl", { defaultValue: undefined });
  return stabletravelGetRequest(
    endpoint,
    {
      departure_id: departureId,
      arrival_id: arrivalId,
      outbound_date: outboundDate,
      return_date: returnDate,
      type,
      travel_class: travelClass,
      adults,
      children,
      infants_in_seat: infantsInSeat,
      infants_on_lap: infantsOnLap,
      stops,
      max_price: maxPrice,
      exclude_airlines: excludeAirlines,
      include_airlines: includeAirlines,
      currency,
      hl,
      gl,
    },
    Number(stabletravelPriceUsd("google_flights_search")),
  );
}

export function buildStabletravelHotelsListRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const cityCode = readString(data, ["cityCode", "city_code"], "cityCode", { required: true }).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(cityCode)) throw new TypeError("cityCode must be a 3-letter IATA city code");
  const radius = readOptionalNumber(data, ["radius"], "radius", { min: 0, max: 300 });
  const radiusUnit = readEnum(data, ["radiusUnit", "radius_unit"], "radiusUnit", ["KM", "MILE"], {
    defaultValue: undefined,
  });
  const chainCodes = readCsvString(data, ["chainCodes", "chain_codes"], "chainCodes");
  const amenities = readCsvString(data, ["amenities"], "amenities");
  const ratings = readCsvString(data, ["ratings"], "ratings", { max: 5 });
  const hotelScore = readEnum(data, ["hotelScore", "hotel_score"], "hotelScore", ["BEDBANK", "DIRECTCHAIN", "ALL"], {
    defaultValue: undefined,
  });
  const max = readInteger(data, ["max", "limit"], "max", { defaultValue: 20, min: 1, max: 100 });
  return stabletravelGetRequest(
    endpoint,
    {
      cityCode,
      radius,
      radiusUnit,
      chainCodes,
      amenities,
      ratings,
      hotelScore,
      max,
    },
    Number(stabletravelPriceUsd("hotels_list")),
  );
}

export function buildStabletravelHotelsSearchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const hotelIds = readCsvString(data, ["hotelIds", "hotel_ids"], "hotelIds", { max: 20 });
  if (!hotelIds) throw new TypeError("hotelIds is required");
  const adults = readOptionalInteger(data, ["adults"], "adults", { min: 1, max: 9 }) ?? 1;
  const checkInDate = readDate(data, ["checkInDate", "check_in_date"], "checkInDate");
  const checkOutDate = readDate(data, ["checkOutDate", "check_out_date"], "checkOutDate");
  assertDateOrder(checkInDate, checkOutDate, {
    startLabel: "checkInDate",
    endLabel: "checkOutDate",
  });
  const countryOfResidence = readString(
    data,
    ["countryOfResidence", "country_of_residence"],
    "countryOfResidence",
    { defaultValue: undefined },
  );
  const priceRange = readString(data, ["priceRange", "price_range"], "priceRange", { defaultValue: undefined });
  const currencyCode = readString(data, ["currencyCode", "currency_code"], "currencyCode", {
    defaultValue: "USD",
  }).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currencyCode)) throw new TypeError("currencyCode must be a 3-letter code");
  const paymentPolicy = readEnum(data, ["paymentPolicy", "payment_policy"], "paymentPolicy", [
    "GUARANTEE",
    "DEPOSIT",
    "NONE",
  ], { defaultValue: undefined });
  const boardType = readEnum(data, ["boardType", "board_type"], "boardType", [
    "ROOM_ONLY",
    "BREAKFAST",
    "HALF_BOARD",
    "FULL_BOARD",
    "ALL_INCLUSIVE",
  ], { defaultValue: undefined });
  const includeClosed = readOptionalBoolean(data, ["includeClosed", "include_closed"], "includeClosed");
  const bestRateOnly = readOptionalBoolean(data, ["bestRateOnly", "best_rate_only"], "bestRateOnly");
  const lang = readString(data, ["lang", "language"], "lang", { defaultValue: undefined });
  return stabletravelGetRequest(
    endpoint,
    {
      hotelIds,
      adults,
      checkInDate,
      checkOutDate,
      countryOfResidence,
      priceRange,
      currencyCode,
      paymentPolicy,
      boardType,
      includeClosed,
      bestRateOnly,
      lang,
    },
    Number(stabletravelPriceUsd("hotels_search")),
  );
}

export function buildStabletravelFlightawareFlightsRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const ident = readString(data, ["ident", "flight", "flight_number"], "ident", { required: true });
  if (!/^[A-Za-z0-9._:-]{2,80}$/u.test(ident)) {
    throw new TypeError("ident must be a flight designator, registration, or fa_flight_id");
  }
  const identType = readEnum(data, ["ident_type", "identType"], "ident_type", [
    "fa_flight_id",
    "designator",
    "registration",
  ], { defaultValue: "designator" });
  const start = readString(data, ["start"], "start", { defaultValue: undefined });
  const end = readString(data, ["end"], "end", { defaultValue: undefined });
  const maxPages = readInteger(data, ["max_pages", "maxPages"], "max_pages", {
    defaultValue: 1,
    min: 1,
    max: 5,
  });
  const cursor = readString(data, ["cursor"], "cursor", { defaultValue: undefined });
  return stabletravelGetRequest(
    endpoint,
    {
      ident_type: identType,
      start,
      end,
      max_pages: maxPages,
      cursor,
    },
    Number(stabletravelPriceUsd("flightaware_flights")),
    `/${encodeURIComponent(ident)}`,
  );
}
