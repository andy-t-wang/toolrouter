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
    id: "compute",
    name: "Compute",
    description: "Run bounded remote compute, transformations, and job execution.",
    recommended_endpoint_id: null,
    use_cases: ["batch jobs", "transforms", "sandboxed execution"],
  },
  {
    id: "productivity",
    name: "Productivity",
    description: "Email, calendar, documents, task, and workspace actions.",
    recommended_endpoint_id: null,
    use_cases: ["calendar", "email", "documents"],
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
    recommended_endpoint_id: null,
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
