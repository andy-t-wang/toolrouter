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
 * @typedef {object} FalImageFastInput
 * @property {string} prompt
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [seed]
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

const FLIGHTAWARE_IDENT_TYPES = Object.freeze(["designator", "registration", "fa_flight_id"]);
const FLIGHTAWARE_TIME_PERIODS = Object.freeze(["today", "yesterday", "last_24_hours", "last_7_days"]);
const TEMPERATURE_UNITS = Object.freeze(["fahrenheit", "celsius"]);

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

function readOptionalInteger(input, names, label, { min, max }) {
  const value = firstDefined(input, names);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer`);
  if (value < min || value > max) throw new RangeError(`${label} must be between ${min} and ${max}`);
  return value;
}

function readNumber(input, names, label, options: any = {}) {
  const { required = false, defaultValue = undefined, min, max } = options;
  const value = firstDefined(input, names);
  const resolved = value === undefined ? defaultValue : value;
  if (resolved === undefined) {
    if (required) throw new TypeError(`${label} is required`);
    return undefined;
  }
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    throw new TypeError(`${label} must be a number`);
  }
  if (min !== undefined && resolved < min) throw new RangeError(`${label} must be at least ${min}`);
  if (max !== undefined && resolved > max) throw new RangeError(`${label} must be at most ${max}`);
  return resolved;
}

function readEnum(input, names, label, values, defaultValue = undefined) {
  const value = readString(input, names, label, { defaultValue });
  if (value === undefined) return undefined;
  if (!values.includes(value)) throw new RangeError(`${label} must be one of: ${values.join(", ")}`);
  return value;
}

function readStringArray(input, names, label, { min = 1, max = 10, url = false } = {}) {
  const value = firstDefined(input, names);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length < min || value.length > max) {
    throw new RangeError(`${label} must contain between ${min} and ${max} values`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new TypeError(`${label}[${index}] must be a string`);
    }
    const trimmed = item.trim();
    return url ? assertHttpUrl(trimmed, `${label}[${index}]`) : trimmed;
  });
}

function assertHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`${label} must use http or https`);
  }
  return parsed.toString();
}

function readUrlArray(input, names, label, { min = 1, max = 10 } = {}) {
  const value = firstDefined(input, names);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length < min || value.length > max) {
    throw new RangeError(`${label} must contain between ${min} and ${max} URLs`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new TypeError(`${label}[${index}] must be a URL string`);
    }
    return assertHttpUrl(item.trim(), `${label}[${index}]`);
  });
}

function toUsdString(value) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
  return String(rounded).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

function providerJsonRequest(endpoint, json, estimatedUsd) {
  return {
    method: endpoint.method,
    url: endpoint.url,
    headers: { ...DEFAULT_HEADERS },
    json,
    estimatedUsd: toUsdString(estimatedUsd),
  };
}

function providerGetRequest(endpoint, url, estimatedUsd) {
  return {
    method: "GET",
    url,
    estimatedUsd: toUsdString(estimatedUsd),
  };
}

function urlWithParams(endpoint, params = {}, path = "") {
  const url = new URL(`${endpoint.url.replace(/\/$/u, "")}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function readAirportCode(input, names, label) {
  const value = readString(input, names, label, { required: true }).toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/u.test(value)) throw new TypeError(`${label} must be an airport code`);
  return value;
}

function readPathSegment(input, names, label) {
  const value = readString(input, names, label, { required: true });
  if (!/^[A-Za-z0-9_.:-]{1,80}$/u.test(value)) {
    throw new TypeError(`${label} contains unsupported characters`);
  }
  return encodeURIComponent(value);
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
  return providerJsonRequest(endpoint, json, EXA_SEARCH_PRICES[searchType] + summaryCost);
}

/**
 * @param {ExaContentsInput} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildExaContentsRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const urls = readUrlArray(data, ["urls"], "urls", { min: 1, max: 10 });
  const includeText = readBoolean(data, ["text", "includeText", "include_text"], "text", true);
  const includeSummary = readBoolean(data, ["summary", "includeSummary", "include_summary"], "summary", false);
  if (!includeText && !includeSummary) {
    throw new RangeError("at least one Exa contents output must be enabled");
  }

  const contents: Record<string, unknown> = {};
  if (includeText) contents.text = true;
  if (includeSummary) contents.summary = true;
  const enabledContentTypes = Object.keys(contents).length;
  return providerJsonRequest(endpoint, { urls, contents }, 0.001 * urls.length * enabledContentTypes);
}

/**
 * @param {BrowserbaseSearchInput} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildBrowserbaseSearchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const query = readString(data, ["query"], "query", { required: true });
  return providerJsonRequest(endpoint, { query }, 0.01);
}

/**
 * @param {BrowserbaseFetchInput} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildBrowserbaseFetchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const url = readString(data, ["url"], "url", { required: true });
  return providerJsonRequest(endpoint, { url: assertHttpUrl(url, "url") }, 0.01);
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
  return providerJsonRequest(endpoint, { estimatedMinutes }, (0.12 * estimatedMinutes) / 60);
}

/**
 * @param {FalImageFastInput} input
 * @param {{ method: "POST", url: string }} endpoint
 * @returns {ProviderRequest}
 */
export function buildFalImageFastRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const json: Record<string, unknown> = {
    prompt: readString(data, ["prompt"], "prompt", { required: true }),
    width: readInteger(data, ["width"], "width", {
      defaultValue: 1024,
      min: 256,
      max: 1536,
    }),
    height: readInteger(data, ["height"], "height", {
      defaultValue: 1024,
      min: 256,
      max: 1536,
    }),
  };
  const seed = firstDefined(data, ["seed"]);
  if (seed !== undefined) {
    if (!Number.isInteger(seed)) throw new TypeError("seed must be an integer");
    json.seed = seed;
  }
  return providerJsonRequest(endpoint, json, 0.015);
}

export function buildRun402PrototypeRequest(input, endpoint) {
  assertInputRecord(input);
  return providerJsonRequest(endpoint, {}, 0.1);
}

export function buildPerplexitySearchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const json: Record<string, unknown> = {
    query: readString(data, ["query"], "query", { required: true }),
  };
  const optionalStrings = [
    "country",
    "search_language_filter",
    "search_domain_filter",
    "search_recency_filter",
    "search_after_date_filter",
    "last_updated_after_filter",
    "search_before_date_filter",
    "last_updated_before_filter",
  ];
  for (const field of optionalStrings) {
    const value = readString(data, [field], field);
    if (value !== undefined) json[field] = value;
  }
  for (const [field, max] of [
    ["max_tokens", 8000],
    ["max_results", 20],
    ["max_tokens_per_page", 4000],
  ]) {
    const value = readOptionalInteger(data, [field], field, { min: 1, max });
    if (value !== undefined) json[field] = value;
  }
  return providerJsonRequest(endpoint, json, 0.01);
}

export function buildParallelSearchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  return providerJsonRequest(
    endpoint,
    { query: readString(data, ["query"], "query", { required: true }) },
    0.01,
  );
}

export function buildFirecrawlScrapeUrlRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const waitTime = readInteger(data, ["wait_time", "waitTime"], "wait_time", {
    defaultValue: 7500,
    min: 0,
    max: 30000,
  });
  return providerJsonRequest(
    endpoint,
    {
      url: assertHttpUrl(readString(data, ["url"], "url", { required: true }), "url"),
      wait_time: waitTime,
      debug: false,
    },
    0.01,
  );
}

export function buildFirecrawlExtractWebDataRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const urls = firstDefined(data, ["urls"]) !== undefined
    ? readStringArray(data, ["urls"], "urls", { min: 1, max: 5, url: true })
    : [assertHttpUrl(readString(data, ["url"], "url", { required: true }), "url")];
  return providerJsonRequest(
    endpoint,
    {
      urls,
      extraction_prompt: readString(data, ["extraction_prompt", "extractionPrompt", "prompt"], "extraction_prompt", {
        required: true,
      }),
      debug: false,
    },
    0.01,
  );
}

export function buildWolframAlphaResultRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const query = readString(data, ["query", "i"], "query", { required: true });
  return providerGetRequest(endpoint, urlWithParams(endpoint, { i: query }), 0.01);
}

export function buildWolframAlphaQueryRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const query = readString(data, ["query", "input"], "query", { required: true });
  return providerGetRequest(endpoint, urlWithParams(endpoint, { input: query, format: "json" }), 0.02);
}

export function buildFlightAwareAirportsRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const maxPages = readInteger(data, ["max_pages", "maxPages"], "max_pages", {
    defaultValue: 1,
    min: 1,
    max: 5,
  });
  return providerGetRequest(endpoint, urlWithParams(endpoint, { max_pages: maxPages }), 0.01);
}

export function buildFlightAwareAirportDelaysRequest(input, endpoint) {
  assertInputRecord(input);
  return providerGetRequest(endpoint, endpoint.url, 0.1);
}

export function buildFlightAwareAirportInfoRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const airport = readAirportCode(data, ["airport_code", "airportCode", "icao"], "airport_code");
  return providerGetRequest(endpoint, urlWithParams(endpoint, {}, `/${airport}`), 0.03);
}

export function buildFlightAwareAirportFlightsRequest(input, endpoint, flightKind, estimatedUsd = 0.01) {
  const data = assertInputRecord(input);
  const airport = readAirportCode(data, ["airport_code", "airportCode", "icao"], "airport_code");
  const maxPages = readInteger(data, ["max_pages", "maxPages"], "max_pages", {
    defaultValue: 1,
    min: 1,
    max: 5,
  });
  return providerGetRequest(
    endpoint,
    urlWithParams(endpoint, { max_pages: maxPages }, `/${airport}/flights/${flightKind}`),
    estimatedUsd,
  );
}

export function buildFlightAwareArrivalsRequest(input, endpoint) {
  return buildFlightAwareAirportFlightsRequest(input, endpoint, "arrivals", 0.01);
}

export function buildFlightAwareDeparturesRequest(input, endpoint) {
  return buildFlightAwareAirportFlightsRequest(input, endpoint, "departures", 0.01);
}

export function buildFlightAwareWeatherObservationsRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const airport = readAirportCode(data, ["airport_code", "airportCode", "icao"], "airport_code");
  const temperatureUnits = readEnum(
    data,
    ["temperature_units", "temperatureUnits"],
    "temperature_units",
    TEMPERATURE_UNITS,
    "fahrenheit",
  );
  return providerGetRequest(
    endpoint,
    urlWithParams(endpoint, { temperature_units: temperatureUnits }, `/${airport}/weather/observations`),
    0.004,
  );
}

export function buildFlightAwareAirportDelayStatusRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const airport = readAirportCode(data, ["airport_code", "airportCode", "icao"], "airport_code");
  return providerGetRequest(endpoint, urlWithParams(endpoint, {}, `/${airport}/delays`), 0.02);
}

export function buildFlightAwareFlightsBetweenAirportsRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const origin = readAirportCode(data, ["origin_airport_code", "originAirportCode", "origin", "from_icao"], "origin_airport_code");
  const destination = readAirportCode(
    data,
    ["destination_airport_code", "destinationAirportCode", "destination", "to_icao"],
    "destination_airport_code",
  );
  const maxPages = readInteger(data, ["max_pages", "maxPages"], "max_pages", {
    defaultValue: 1,
    min: 1,
    max: 5,
  });
  return providerGetRequest(
    endpoint,
    urlWithParams(endpoint, { max_pages: maxPages }, `/${origin}/flights/to/${destination}`),
    0.1,
  );
}

export function buildFlightAwareDisruptionCountsAirlineRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const timePeriod = readEnum(
    data,
    ["time_period", "timePeriod"],
    "time_period",
    FLIGHTAWARE_TIME_PERIODS,
    "today",
  );
  const maxPages = readInteger(data, ["max_pages", "maxPages"], "max_pages", {
    defaultValue: 1,
    min: 1,
    max: 5,
  });
  return providerGetRequest(endpoint, urlWithParams(endpoint, { time_period: timePeriod, max_pages: maxPages }), 0.01);
}

export function buildFlightAwareFlightTrackRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const callsign = readPathSegment(data, ["callsign", "ident", "flight"], "callsign");
  const identType = readEnum(data, ["ident_type", "identType"], "ident_type", FLIGHTAWARE_IDENT_TYPES, "designator");
  const maxPages = readInteger(data, ["max_pages", "maxPages"], "max_pages", {
    defaultValue: 1,
    min: 1,
    max: 5,
  });
  return providerGetRequest(endpoint, urlWithParams(endpoint, { ident_type: identType, max_pages: maxPages }, `/${callsign}`), 0.01);
}

export function buildAmadeusActivitiesSearchRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const latitude = readNumber(data, ["latitude", "lat"], "latitude", { required: true, min: -90, max: 90 });
  const longitude = readNumber(data, ["longitude", "lng", "lon"], "longitude", { required: true, min: -180, max: 180 });
  const radius = readNumber(data, ["radius"], "radius", { defaultValue: 1, min: 0.1, max: 20 });
  const max = readOptionalInteger(data, ["max"], "max", { min: 1, max: 50 });
  return providerGetRequest(endpoint, urlWithParams(endpoint, { latitude, longitude, radius, max }), 0.054);
}

export function buildAmadeusActivitiesBySquareRequest(input, endpoint) {
  const data = assertInputRecord(input);
  const north = readNumber(data, ["north"], "north", { required: true, min: -90, max: 90 });
  const south = readNumber(data, ["south"], "south", { required: true, min: -90, max: 90 });
  const east = readNumber(data, ["east"], "east", { required: true, min: -180, max: 180 });
  const west = readNumber(data, ["west"], "west", { required: true, min: -180, max: 180 });
  if (south >= north) throw new RangeError("south must be less than north");
  const max = readOptionalInteger(data, ["max"], "max", { min: 1, max: 50 });
  return providerGetRequest(endpoint, urlWithParams(endpoint, { north, south, east, west, max }), 0.054);
}

export function buildAgentMailPodsRequest(input, endpoint) {
  const data = assertInputRecord(input);
  return providerJsonRequest(
    endpoint,
    {
      name: readString(data, ["name"], "name", { required: true }),
      client_id: readString(data, ["client_id", "clientId"], "client_id", { required: true }),
    },
    0.01,
  );
}
