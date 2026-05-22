export const ENDPOINT_CATEGORY_DEFINITIONS = Object.freeze([
  {
    id: "ai_ml",
    name: "AI / ML",
    description: "Model, embedding, transcription, image, and other AI-native endpoints.",
    recommended_endpoint_id: null,
    use_cases: ["model inference", "embeddings", "media generation"],
  },
  {
    id: "search",
    name: "Search",
    description: "Find fresh web results, research sources, and answer discovery queries.",
    recommended_endpoint_id: "exa.search",
    use_cases: ["web research", "source discovery", "competitive research"],
  },
  {
    id: "research",
    name: "Research",
    description: "Run agentic investigations that need synthesis, visual lookup, or messy source work.",
    recommended_endpoint_id: "manus.research",
    use_cases: ["visual lookup", "tool discovery", "esoteric research", "vendor investigation"],
  },
  {
    id: "maps",
    name: "Maps",
    description: "Place search, routing, geocoding, and saved-location workflows.",
    recommended_endpoint_id: null,
    use_cases: ["place research", "trip planning", "geocoding"],
  },
  {
    id: "data",
    name: "Data fetch",
    description: "Fetch and normalize page, document, API, or structured data content.",
    recommended_endpoint_id: null,
    use_cases: ["page fetch", "metadata extraction", "content ingestion"],
  },
  {
    id: "extract",
    name: "Extract",
    description: "Extract structured content and excerpts from one or more URLs.",
    recommended_endpoint_id: "parallel.extract",
    use_cases: ["URL content extraction", "structured page excerpts", "research source ingestion"],
  },
  {
    id: "compute",
    name: "Compute",
    description: "Run bounded remote compute, transformations, and job execution.",
    recommended_endpoint_id: null,
    use_cases: ["batch jobs", "transforms", "sandboxed execution"],
  },
  {
    id: "email",
    name: "Email",
    description: "Send, receive, list, and reply to email through agent-owned inboxes.",
    recommended_endpoint_id: "agentmail.send_message",
    use_cases: ["send email", "read inbox", "reply to messages"],
  },
  {
    id: "browser_usage",
    name: "Browser use",
    description: "Use a real browser session for sites that require rendering or interaction.",
    recommended_endpoint_id: "browserbase.session",
    use_cases: ["browser automation", "interactive pages", "logged-in workflows"],
  },
  {
    id: "travel",
    name: "Travel",
    description: "Flights, hotels, itinerary, and destination planning endpoints.",
    recommended_endpoint_id: "stabletravel.google_flights_search",
    use_cases: ["flight search", "hotel search", "itineraries"],
  },
  {
    id: "commerce",
    name: "Commerce",
    description: "Product search, checkout, price tracking, and commerce workflows.",
    recommended_endpoint_id: null,
    use_cases: ["product search", "price tracking", "checkout"],
  },
]);

export const ENDPOINT_CATEGORIES = Object.freeze(ENDPOINT_CATEGORY_DEFINITIONS.map((category) => category.id));

export const ENDPOINT_CATEGORY_SET = new Set(ENDPOINT_CATEGORIES);

export function isEndpointCategory(value) {
  return ENDPOINT_CATEGORY_SET.has(value);
}

export function getEndpointCategoryDefinition(categoryId) {
  return ENDPOINT_CATEGORY_DEFINITIONS.find((category) => category.id === categoryId) || null;
}
