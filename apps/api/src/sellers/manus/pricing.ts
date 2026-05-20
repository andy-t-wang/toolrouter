// Manus pricing helpers and request-body construction.
//
// Pulled out of the original `apps/api/src/manus.ts` so the seller manifest
// (`./index.ts`) can reference a small, focused pricing function and so
// `createSellerService` can stay provider-agnostic.

const DEFAULT_MANUS_PRICE_USD = "0.05";
const DEFAULT_MANUS_PRICE_BY_DEPTH: Record<string, string> = Object.freeze({
  quick: "0.03",
  standard: "0.05",
  deep: "0.10",
});

function optionalUsd(value: string | undefined, fallback: string) {
  const raw = String(value || fallback).trim();
  if (!/^\d+(\.\d+)?$/u.test(raw)) return fallback;
  return raw;
}

function usdNumber(value: string | undefined, fallback = "0") {
  return Number(optionalUsd(value, fallback));
}

function priceByDepth(depth: string) {
  const normalized = ["quick", "standard", "deep"].includes(depth) ? depth : "standard";
  const envKey = `TOOLROUTER_MANUS_RESEARCH_PRICE_${normalized.toUpperCase()}_USD`;
  return usdNumber(
    process.env[envKey],
    process.env.TOOLROUTER_MANUS_RESEARCH_PRICE_USD ||
      DEFAULT_MANUS_PRICE_BY_DEPTH[normalized] ||
      DEFAULT_MANUS_PRICE_USD,
  );
}

function formatUsd(value: number) {
  return value.toFixed(6).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

export function readStringArray(value: any, max: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, max)
    .map((item) => item.trim());
}

function readRequiredResearchQuery(input: any) {
  const value = input?.query ?? input?.prompt;
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error("query is required"), {
      statusCode: 400,
      code: "invalid_request",
    });
  }
  return value.trim();
}

function normalizeResearchInput(input: any = {}) {
  return {
    ...input,
    query: readRequiredResearchQuery(input),
  };
}

export function manusResearchPriceUsd(input: any = {}) {
  const depth = String(input.depth || "standard");
  const urls = readStringArray(input.urls, 10);
  const images = readStringArray(input.images || input.image_urls, 5);
  const total =
    priceByDepth(depth) +
    urls.length * usdNumber(process.env.TOOLROUTER_MANUS_RESEARCH_URL_PRICE_USD, "0") +
    images.length * usdNumber(process.env.TOOLROUTER_MANUS_RESEARCH_IMAGE_PRICE_USD, "0");
  return formatUsd(total);
}

function buildResearchPrompt(input: any) {
  const lines = [
    String(input.query || input.prompt || "").trim(),
    "",
    `Task type: ${String(input.task_type || input.taskType || "general_research")}`,
    `Depth: ${String(input.depth || "standard")}`,
  ];
  const urls = readStringArray(input.urls, 10);
  const images = readStringArray(input.images || input.image_urls, 5);
  if (urls.length) lines.push("", "URLs to inspect:", ...urls.map((url) => `- ${url}`));
  if (images.length) lines.push("", "Images to identify or use as evidence:", ...images.map((url) => `- ${url}`));
  lines.push(
    "",
    "Return concise findings with sources when possible. If the answer is uncertain, say what remains unverified.",
  );
  return lines.join("\n");
}

export function buildManusTaskBody(input: any) {
  const normalizedInput = normalizeResearchInput(input);
  const prompt = buildResearchPrompt(normalizedInput);
  const images = readStringArray(normalizedInput.images || normalizedInput.image_urls, 5);
  return {
    title: normalizedInput.title || `ToolRouter research: ${String(normalizedInput.query).slice(0, 80)}`,
    message: {
      content: [
        { type: "text", text: prompt },
        ...images.map((image) => ({ type: "file", file_url: image })),
      ],
    },
  };
}
