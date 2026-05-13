#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = "2025-11-25";
const SERVER_INFO = Object.freeze({ name: "toolrouter-mcp", version: "0.1.1" });
const CANONICAL_API_BASE = "https://toolrouter.world";
const API_BASE_ALIASES = new Map([
  ["https://api.toolrouter.com", CANONICAL_API_BASE],
]);

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: any;
};

function envValue(env: any, names: string[]) {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return "";
}

function normalizeApiBase(value: string) {
  const raw = String(value || CANONICAL_API_BASE).trim();
  const withoutTrailingSlash = raw.replace(/\/+$/u, "");
  return API_BASE_ALIASES.get(withoutTrailingSlash) || withoutTrailingSlash;
}

function apiConfig(env: any) {
  return {
    apiBase: normalizeApiBase(envValue(env, ["TOOLROUTER_API_URL", "NEXT_PUBLIC_TOOLROUTER_API_URL"])),
    apiKey: envValue(env, ["TOOLROUTER_API_KEY", "AGENTKIT_ROUTER_API_KEY", "AGENTKIT_ROUTER_DEV_API_KEY"]),
  };
}

function jsonSchema(properties: Record<string, any>, required: string[] = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

const paymentOptions = {
  maxUsd: { type: "string" },
  payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
};

function withPaymentOptions(properties: Record<string, any>) {
  return { ...properties, ...paymentOptions };
}

const endpointToolSpecs: McpTool[] = [
  {
    name: "fal_image_fast",
    title: "Fal image fast",
    description: "Generate an image through ToolRouter's Fal-backed pure x402 image endpoint.",
    inputSchema: jsonSchema({
      prompt: { type: "string" },
      width: { type: "integer", minimum: 256, maximum: 1536 },
      height: { type: "integer", minimum: 256, maximum: 1536 },
      seed: { type: "integer" },
      maxUsd: { type: "string" },
    }, ["prompt"]),
  },
  {
    name: "run402_prototype",
    title: "Run402 prototype tier",
    description: "Lease the Run402 prototype API tier through x402.",
    inputSchema: jsonSchema(withPaymentOptions({})),
  },
  {
    name: "exa_contents",
    title: "Exa contents",
    description: "Fetch clean text or summaries for URLs through ToolRouter's Exa contents endpoint.",
    inputSchema: jsonSchema(withPaymentOptions({
      urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
      text: { type: "boolean" },
      summary: { type: "boolean" },
    }), ["urls"]),
  },
  {
    name: "perplexity_search",
    title: "Perplexity search",
    description: "Run AI-synthesized web search through Perplexity over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      query: { type: "string" },
      country: { type: "string" },
      max_results: { type: "integer", minimum: 1, maximum: 20 },
    }), ["query"]),
  },
  {
    name: "parallel_search",
    title: "Parallel search",
    description: "Run web search through Parallel over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      query: { type: "string" },
    }), ["query"]),
  },
  {
    name: "firecrawl_scrape_url",
    title: "Firecrawl scrape URL",
    description: "Scrape a URL to clean content through Firecrawl over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      url: { type: "string" },
      wait_time: { type: "integer", minimum: 0, maximum: 30000 },
    }), ["url"]),
  },
  {
    name: "firecrawl_extract_web_data",
    title: "Firecrawl extract web data",
    description: "Extract structured data from URLs through Firecrawl over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      url: { type: "string" },
      extraction_prompt: { type: "string" },
    }), ["extraction_prompt"]),
  },
  {
    name: "wolframalpha_result",
    title: "WolframAlpha result",
    description: "Get a short WolframAlpha plaintext answer through x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      query: { type: "string" },
    }), ["query"]),
  },
  {
    name: "wolframalpha_query",
    title: "WolframAlpha query",
    description: "Get a structured WolframAlpha JSON result through x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      query: { type: "string" },
    }), ["query"]),
  },
  {
    name: "flightaware_airports",
    title: "FlightAware airports",
    description: "List airports through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      max_pages: { type: "integer", minimum: 1, maximum: 5 },
    })),
  },
  {
    name: "flightaware_airport_delays",
    title: "FlightAware airport delays",
    description: "Get the global airport delay map through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({})),
  },
  {
    name: "flightaware_airport_info",
    title: "FlightAware airport info",
    description: "Look up airport information through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      airport_code: { type: "string" },
    }), ["airport_code"]),
  },
  {
    name: "flightaware_arrivals",
    title: "FlightAware arrivals",
    description: "List airport arrivals through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      airport_code: { type: "string" },
      max_pages: { type: "integer", minimum: 1, maximum: 5 },
    }), ["airport_code"]),
  },
  {
    name: "flightaware_departures",
    title: "FlightAware departures",
    description: "List airport departures through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      airport_code: { type: "string" },
      max_pages: { type: "integer", minimum: 1, maximum: 5 },
    }), ["airport_code"]),
  },
  {
    name: "flightaware_weather_observations",
    title: "FlightAware weather observations",
    description: "Get airport weather observations through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      airport_code: { type: "string" },
      temperature_units: { type: "string", enum: ["fahrenheit", "celsius"] },
    }), ["airport_code"]),
  },
  {
    name: "flightaware_airport_delay_status",
    title: "FlightAware airport delay status",
    description: "Get delay status for one airport through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      airport_code: { type: "string" },
    }), ["airport_code"]),
  },
  {
    name: "flightaware_flights_between_airports",
    title: "FlightAware flights between airports",
    description: "Find live flights between two airports through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      origin_airport_code: { type: "string" },
      destination_airport_code: { type: "string" },
      max_pages: { type: "integer", minimum: 1, maximum: 5 },
    }), ["origin_airport_code", "destination_airport_code"]),
  },
  {
    name: "flightaware_disruption_counts_airline",
    title: "FlightAware airline disruption counts",
    description: "Get airline disruption statistics through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      time_period: { type: "string", enum: ["today", "yesterday", "last_24_hours", "last_7_days"] },
      max_pages: { type: "integer", minimum: 1, maximum: 5 },
    })),
  },
  {
    name: "flightaware_flight_track",
    title: "FlightAware flight track",
    description: "Track a flight through FlightAware over x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      callsign: { type: "string" },
      ident_type: { type: "string", enum: ["designator", "registration", "fa_flight_id"] },
      max_pages: { type: "integer", minimum: 1, maximum: 5 },
    }), ["callsign"]),
  },
  {
    name: "amadeus_activities_search",
    title: "Amadeus activities search",
    description: "Search tours and activities near coordinates through x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      latitude: { type: "number", minimum: -90, maximum: 90 },
      longitude: { type: "number", minimum: -180, maximum: 180 },
      radius: { type: "number", minimum: 0.1, maximum: 20 },
      max: { type: "integer", minimum: 1, maximum: 50 },
    }), ["latitude", "longitude"]),
  },
  {
    name: "amadeus_activities_by_square",
    title: "Amadeus activities by square",
    description: "Search tours and activities inside a bounding box through x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      north: { type: "number", minimum: -90, maximum: 90 },
      south: { type: "number", minimum: -90, maximum: 90 },
      east: { type: "number", minimum: -180, maximum: 180 },
      west: { type: "number", minimum: -180, maximum: 180 },
      max: { type: "integer", minimum: 1, maximum: 50 },
    }), ["north", "south", "east", "west"]),
  },
  {
    name: "agentmail_pods",
    title: "AgentMail pods",
    description: "Create a programmable AgentMail inbox through x402.",
    inputSchema: jsonSchema(withPaymentOptions({
      name: { type: "string" },
      client_id: { type: "string" },
    }), ["name", "client_id"]),
  },
];

export function tools(): McpTool[] {
  return [
    {
      name: "toolrouter_list_endpoints",
      title: "List ToolRouter endpoints",
      description: "List verified ToolRouter endpoints available to this API key.",
      inputSchema: jsonSchema({
        category: { type: "string", description: "Optional endpoint category filter, such as ai_ml, search, or browser_usage." },
      }),
    },
    {
      name: "toolrouter_list_categories",
      title: "List ToolRouter categories",
      description: "List generic tool categories, recommended endpoints, and available provider tools.",
      inputSchema: jsonSchema({
        include_empty: { type: "boolean", description: "Include categories that do not have a listed endpoint yet." },
      }),
    },
    {
      name: "toolrouter_recommend_endpoint",
      title: "Recommend endpoint",
      description: "Pick the recommended concrete endpoint for a generic category such as ai_ml, search, or browser_usage.",
      inputSchema: jsonSchema({
        category: { type: "string", description: "Tool category, such as ai_ml, search, data, or browser_usage." },
      }, ["category"]),
    },
    {
      name: "toolrouter_call_endpoint",
      title: "Call ToolRouter endpoint",
      description: "Call any named ToolRouter endpoint through POST /v1/requests.",
      inputSchema: jsonSchema({
        endpoint_id: { type: "string", description: "Endpoint id, such as exa.search or browserbase.session." },
        input: { type: "object", description: "Endpoint-specific input object." },
        maxUsd: { type: "string", description: "Optional caller spend cap in USD decimal form." },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"], description: "Optional execution path override for explicit smoke tests." },
      }, ["endpoint_id", "input"]),
    },
    {
      name: "toolrouter_search",
      title: "Search",
      description: "Run a search through ToolRouter's recommended search endpoint. Launch recommendation: exa.search.",
      inputSchema: jsonSchema({
        query: { type: "string" },
        search_type: { type: "string", enum: ["fast", "auto", "instant", "deep-lite", "deep", "deep-reasoning", "deep-max"] },
        num_results: { type: "integer", minimum: 1, maximum: 10 },
        include_summary: { type: "boolean" },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }, ["query"]),
    },
    {
      name: "toolrouter_browser_use",
      title: "Browser use",
      description: "Start a browser session through ToolRouter's recommended browser-use endpoint.",
      inputSchema: jsonSchema({
        estimated_minutes: { type: "integer", minimum: 5, maximum: 120 },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }),
    },
    {
      name: "toolrouter_image_generate",
      title: "Image generation",
      description: "Generate an image through ToolRouter's recommended AI / ML endpoint. Launch recommendation: fal.image_fast.",
      inputSchema: jsonSchema({
        prompt: { type: "string" },
        width: { type: "integer", minimum: 256, maximum: 1536 },
        height: { type: "integer", minimum: 256, maximum: 1536 },
        seed: { type: "integer" },
        maxUsd: { type: "string" },
      }, ["prompt"]),
    },
    {
      name: "toolrouter_fetch_content",
      title: "Fetch content",
      description: "Fetch URL content through ToolRouter's recommended data endpoint. Launch recommendation: exa.contents.",
      inputSchema: jsonSchema(withPaymentOptions({
        urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
        text: { type: "boolean" },
        summary: { type: "boolean" },
      }), ["urls"]),
    },
    {
      name: "toolrouter_answer",
      title: "Answer",
      description: "Get a computed factual answer through ToolRouter's recommended knowledge endpoint. Launch recommendation: wolframalpha.result.",
      inputSchema: jsonSchema(withPaymentOptions({
        query: { type: "string" },
      }), ["query"]),
    },
    {
      name: "toolrouter_track_flight",
      title: "Track flight",
      description: "Track a flight through ToolRouter's recommended travel endpoint. Launch recommendation: flightaware.flight_track.",
      inputSchema: jsonSchema(withPaymentOptions({
        callsign: { type: "string" },
        ident_type: { type: "string", enum: ["designator", "registration", "fa_flight_id"] },
        max_pages: { type: "integer", minimum: 1, maximum: 5 },
      }), ["callsign"]),
    },
    {
      name: "toolrouter_create_inbox",
      title: "Create inbox",
      description: "Create a programmable email inbox through ToolRouter's recommended productivity endpoint. Launch recommendation: agentmail.pods.",
      inputSchema: jsonSchema(withPaymentOptions({
        name: { type: "string" },
        client_id: { type: "string" },
      }), ["name", "client_id"]),
    },
    {
      name: "toolrouter_get_request",
      title: "Get ToolRouter request",
      description: "Fetch one request trace created by this API key.",
      inputSchema: jsonSchema({
        id: { type: "string", description: "ToolRouter request id." },
      }, ["id"]),
    },
    {
      name: "exa_search",
      title: "Exa search",
      description: "Run Exa search through ToolRouter with AgentKit first and x402 fallback.",
      inputSchema: jsonSchema({
        query: { type: "string" },
        search_type: { type: "string", enum: ["fast", "auto", "instant", "deep-lite", "deep", "deep-reasoning", "deep-max"] },
        num_results: { type: "integer", minimum: 1, maximum: 10 },
        include_summary: { type: "boolean" },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }, ["query"]),
    },
    {
      name: "browserbase_session_create",
      title: "Browserbase session",
      description: "Create a paid Browserbase browser session through ToolRouter.",
      inputSchema: jsonSchema({
        estimated_minutes: { type: "integer", minimum: 5, maximum: 120 },
        maxUsd: { type: "string" },
        payment_mode: { type: "string", enum: ["agentkit_first", "x402_only"] },
      }),
    },
    ...endpointToolSpecs,
  ];
}

function textResult(text: string, structuredContent?: any, isError = false) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError,
  };
}

function paymentPayload(args: any, maxUsd: string) {
  const paymentMode = args.payment_mode || args.paymentMode;
  return {
    maxUsd: args.maxUsd || maxUsd,
    ...(paymentMode ? { payment_mode: paymentMode } : {}),
  };
}

const endpointPayloadBuilders: Record<string, (args: any) => any> = {
  fal_image_fast: (args) => ({
    endpoint_id: "fal.image_fast",
    input: {
      prompt: args.prompt,
      width: args.width || 1024,
      height: args.height || 1024,
      ...(args.seed !== undefined ? { seed: args.seed } : {}),
    },
    maxUsd: args.maxUsd || "0.02",
    payment_mode: "x402_only",
  }),
  run402_prototype: (args) => ({
    endpoint_id: "run402.prototype",
    input: {},
    ...paymentPayload(args, "0.11"),
  }),
  exa_contents: (args) => ({
    endpoint_id: "exa.contents",
    input: {
      urls: args.urls,
      text: args.text ?? true,
      summary: Boolean(args.summary),
    },
    ...paymentPayload(args, "0.01"),
  }),
  perplexity_search: (args) => ({
    endpoint_id: "perplexity.search",
    input: {
      query: args.query,
      ...(args.country ? { country: args.country } : {}),
      ...(args.max_results ? { max_results: args.max_results } : {}),
    },
    ...paymentPayload(args, "0.02"),
  }),
  parallel_search: (args) => ({
    endpoint_id: "parallel.search",
    input: { query: args.query },
    ...paymentPayload(args, "0.02"),
  }),
  firecrawl_scrape_url: (args) => ({
    endpoint_id: "firecrawl.scrape_url",
    input: {
      url: args.url,
      wait_time: args.wait_time || 7500,
    },
    ...paymentPayload(args, "0.02"),
  }),
  firecrawl_extract_web_data: (args) => ({
    endpoint_id: "firecrawl.extract_web_data",
    input: {
      ...(args.urls ? { urls: args.urls } : { url: args.url }),
      extraction_prompt: args.extraction_prompt,
    },
    ...paymentPayload(args, "0.02"),
  }),
  wolframalpha_result: (args) => ({
    endpoint_id: "wolframalpha.result",
    input: { query: args.query },
    ...paymentPayload(args, "0.02"),
  }),
  wolframalpha_query: (args) => ({
    endpoint_id: "wolframalpha.query",
    input: { query: args.query },
    ...paymentPayload(args, "0.03"),
  }),
  flightaware_airports: (args) => ({
    endpoint_id: "flightaware.airports",
    input: { max_pages: args.max_pages || 1 },
    ...paymentPayload(args, "0.02"),
  }),
  flightaware_airport_delays: (args) => ({
    endpoint_id: "flightaware.airport_delays",
    input: {},
    ...paymentPayload(args, "0.11"),
  }),
  flightaware_airport_info: (args) => ({
    endpoint_id: "flightaware.airport_info",
    input: { airport_code: args.airport_code },
    ...paymentPayload(args, "0.04"),
  }),
  flightaware_arrivals: (args) => ({
    endpoint_id: "flightaware.arrivals",
    input: { airport_code: args.airport_code, max_pages: args.max_pages || 1 },
    ...paymentPayload(args, "0.02"),
  }),
  flightaware_departures: (args) => ({
    endpoint_id: "flightaware.departures",
    input: { airport_code: args.airport_code, max_pages: args.max_pages || 1 },
    ...paymentPayload(args, "0.02"),
  }),
  flightaware_weather_observations: (args) => ({
    endpoint_id: "flightaware.weather_observations",
    input: {
      airport_code: args.airport_code,
      temperature_units: args.temperature_units || "fahrenheit",
    },
    ...paymentPayload(args, "0.01"),
  }),
  flightaware_airport_delay_status: (args) => ({
    endpoint_id: "flightaware.airport_delay_status",
    input: { airport_code: args.airport_code },
    ...paymentPayload(args, "0.03"),
  }),
  flightaware_flights_between_airports: (args) => ({
    endpoint_id: "flightaware.flights_between_airports",
    input: {
      origin_airport_code: args.origin_airport_code,
      destination_airport_code: args.destination_airport_code,
      max_pages: args.max_pages || 1,
    },
    ...paymentPayload(args, "0.11"),
  }),
  flightaware_disruption_counts_airline: (args) => ({
    endpoint_id: "flightaware.disruption_counts_airline",
    input: {
      time_period: args.time_period || "today",
      max_pages: args.max_pages || 1,
    },
    ...paymentPayload(args, "0.02"),
  }),
  flightaware_flight_track: (args) => ({
    endpoint_id: "flightaware.flight_track",
    input: {
      callsign: args.callsign,
      ident_type: args.ident_type || "designator",
      max_pages: args.max_pages || 1,
    },
    ...paymentPayload(args, "0.02"),
  }),
  amadeus_activities_search: (args) => ({
    endpoint_id: "amadeus.activities_search",
    input: {
      latitude: args.latitude,
      longitude: args.longitude,
      radius: args.radius || 1,
      ...(args.max ? { max: args.max } : {}),
    },
    ...paymentPayload(args, "0.06"),
  }),
  amadeus_activities_by_square: (args) => ({
    endpoint_id: "amadeus.activities_by_square",
    input: {
      north: args.north,
      south: args.south,
      east: args.east,
      west: args.west,
      ...(args.max ? { max: args.max } : {}),
    },
    ...paymentPayload(args, "0.06"),
  }),
  agentmail_pods: (args) => ({
    endpoint_id: "agentmail.pods",
    input: {
      name: args.name,
      client_id: args.client_id || args.clientId,
    },
    ...paymentPayload(args, "0.02"),
  }),
};

function endpointPayload(name: string, args: any) {
  const paymentMode = args.payment_mode || args.paymentMode;
  if (name === "toolrouter_search" || name === "exa_search") {
    return {
      endpoint_id: "exa.search",
      input: {
        query: args.query,
        search_type: args.search_type || "fast",
        num_results: args.num_results || 5,
        include_summary: Boolean(args.include_summary),
      },
      maxUsd: args.maxUsd || "0.01",
      ...(paymentMode ? { payment_mode: paymentMode } : {}),
    };
  }
  if (name === "toolrouter_browser_use" || name === "browserbase_session_create") {
    const minutes = args.estimated_minutes || args.estimatedMinutes || 5;
    return {
      endpoint_id: "browserbase.session",
      input: { estimated_minutes: minutes },
      maxUsd: args.maxUsd || "0.02",
      ...(paymentMode ? { payment_mode: paymentMode } : {}),
    };
  }
  if (name === "toolrouter_fetch_content") return endpointPayloadBuilders.exa_contents(args);
  if (name === "toolrouter_image_generate") return endpointPayloadBuilders.fal_image_fast(args);
  if (name === "toolrouter_answer") return endpointPayloadBuilders.wolframalpha_result(args);
  if (name === "toolrouter_track_flight") return endpointPayloadBuilders.flightaware_flight_track(args);
  if (name === "toolrouter_create_inbox") return endpointPayloadBuilders.agentmail_pods(args);
  const namedBuilder = endpointPayloadBuilders[name];
  if (namedBuilder) return namedBuilder(args);
  return null;
}

async function routerFetch(path: string, { env, fetchImpl, method = "GET", body }: any) {
  const { apiBase, apiKey } = apiConfig(env);
  if (!apiKey) {
    throw new Error("TOOLROUTER_API_KEY is required for MCP tool calls");
  }
  const response = await fetchImpl(`${apiBase.replace(/\/$/u, "")}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `ToolRouter request failed with ${response.status}`);
  }
  return data;
}

export async function callTool(name: string, args: any = {}, options: any = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  try {
    if (name === "toolrouter_list_endpoints") {
      const category = args.category ? `?category=${encodeURIComponent(args.category)}` : "";
      const data = await routerFetch(`/v1/endpoints${category}`, { env, fetchImpl });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_list_categories") {
      const includeEmpty = args.include_empty || args.includeEmpty ? "?include_empty=true" : "";
      const data = await routerFetch(`/v1/categories${includeEmpty}`, { env, fetchImpl });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    if (name === "toolrouter_recommend_endpoint") {
      const data = await routerFetch("/v1/categories?include_empty=true", { env, fetchImpl });
      const category = data.categories.find((candidate: any) => candidate.id === args.category);
      if (!category) throw new Error(`unknown category: ${args.category}`);
      if (!category.recommended_endpoint) throw new Error(`category has no recommended endpoint yet: ${args.category}`);
      return textResult(JSON.stringify(category.recommended_endpoint, null, 2), {
        category: {
          id: category.id,
          name: category.name,
          description: category.description,
        },
        recommended_endpoint: category.recommended_endpoint,
      });
    }
    if (name === "toolrouter_get_request") {
      const data = await routerFetch(`/v1/requests/${encodeURIComponent(args.id)}`, { env, fetchImpl });
      return textResult(JSON.stringify(data, null, 2), data);
    }
    const payload = name === "toolrouter_call_endpoint" ? args : endpointPayload(name, args);
    if (!payload) throw new Error(`unknown tool: ${name}`);
    const data = await routerFetch("/v1/requests", { env, fetchImpl, method: "POST", body: payload });
    return textResult(JSON.stringify(data, null, 2), data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(message, { error: message }, true);
  }
}

function response(id: JsonRpcRequest["id"], result: any) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function handleJsonRpcMessage(message: JsonRpcRequest, options: any = {}) {
  if (!message || message.jsonrpc !== "2.0") {
    return errorResponse(message?.id ?? null, -32600, "Invalid JSON-RPC request");
  }
  if (message.id === undefined || message.id === null) return null;
  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    return response(message.id, {
      protocolVersion: requestedVersion === PROTOCOL_VERSION ? requestedVersion : PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: SERVER_INFO,
      instructions: "Use ToolRouter tools with TOOLROUTER_API_KEY and TOOLROUTER_API_URL set in the MCP server environment.",
    });
  }
  if (message.method === "ping") return response(message.id, {});
  if (message.method === "tools/list") return response(message.id, { tools: tools() });
  if (message.method === "tools/call") {
    const result = await callTool(message.params?.name, message.params?.arguments || {}, options);
    return response(message.id, result);
  }
  return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
}

function encodeLineMessage(payload: any) {
  return `${JSON.stringify(payload)}\n`;
}

function encodeFramedMessage(payload: any) {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function frameHeaderEnd(buffer: Buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, length: 4 };
  }
  return { index: lf, length: 2 };
}

function startsWithFrameHeader(buffer: Buffer) {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 32)).toString("utf8");
  return /^Content-Length:/iu.test(prefix);
}

export function startStdioServer({ input = stdin, output = stdout, env = process.env, fetchImpl = fetch }: any = {}) {
  let buffer = Buffer.alloc(0);
  let mode: "frame" | "line" | null = null;

  const writePayload = (payload: any, format: "frame" | "line") => {
    if (!payload) return;
    output.write(format === "frame" ? encodeFramedMessage(payload) : encodeLineMessage(payload));
  };

  const handleBody = (body: string, format: "frame" | "line") => {
    Promise.resolve()
      .then(async () => handleJsonRpcMessage(JSON.parse(body), { env, fetchImpl }))
      .then((payload) => writePayload(payload, format))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        writePayload(errorResponse(null, -32603, message), format);
      });
  };

  const drain = () => {
    while (buffer.length) {
      if (mode === "frame" || (mode === null && startsWithFrameHeader(buffer))) {
        const headerEnd = frameHeaderEnd(buffer);
        if (!headerEnd) return;
        const header = buffer.subarray(0, headerEnd.index).toString("utf8");
        const match = header.match(/^Content-Length:\s*(\d+)\s*$/imu);
        if (!match) {
          buffer = Buffer.alloc(0);
          writePayload(errorResponse(null, -32600, "Invalid MCP frame"), "frame");
          return;
        }
        const contentLength = Number(match[1]);
        const bodyStart = headerEnd.index + headerEnd.length;
        const bodyEnd = bodyStart + contentLength;
        if (buffer.length < bodyEnd) return;
        const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
        buffer = buffer.subarray(bodyEnd);
        mode = "frame";
        if (body.trim()) handleBody(body, "frame");
        continue;
      }

      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.subarray(0, newline).toString("utf8").replace(/\r$/u, "").trim();
      buffer = buffer.subarray(newline + 1);
      mode = "line";
      if (line) handleBody(line, "line");
    }
  };

  input.on("data", (chunk: Buffer | string) => {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    buffer = Buffer.concat([buffer, next]);
    drain();
  });
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isCliEntrypoint()) {
  if (process.env.TOOLROUTER_MCP_LOG === "true") {
    process.stderr.write("ToolRouter MCP ready\n");
  }
  startStdioServer();
}
