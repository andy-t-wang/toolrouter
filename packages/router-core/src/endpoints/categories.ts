export const ENDPOINT_CATEGORIES = Object.freeze([
  "ai_ml",
  "search",
  "maps",
  "data",
  "compute",
  "productivity",
  "browser_usage",
  "travel",
  "commerce",
]);

export const ENDPOINT_CATEGORY_SET = new Set(ENDPOINT_CATEGORIES);

export function isEndpointCategory(value) {
  return ENDPOINT_CATEGORY_SET.has(value);
}
