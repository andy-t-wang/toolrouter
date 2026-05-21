// Single source of provider logo paths for the web app. Both the landing
// page and the dashboard read from here so adding a new provider doesn't
// need parallel edits to two files. The path values point at SVGs in
// `apps/web/public/<provider>-logomark.svg`.
//
// We keep the map here (web-side) rather than on the EndpointManifest until
// router-core grows a richer `provider: { id, name, logo_path }` shape — the
// U2 plan explicitly deferred that refinement. Adding a new provider:
// 1. Drop the logomark SVG in apps/web/public/.
// 2. Add the provider id → path mapping below.
// 3. Update the endpoint manifest in packages/router-core/src/endpoints/.

const PROVIDER_LOGOS: Readonly<Record<string, string>> = Object.freeze({
  browserbase: "/browserbase-logomark.svg",
  agentmail: "/agentmail-logomark.svg",
  exa: "/exa-logomark.svg",
  manus: "/manus-logomark.svg",
  parallel: "/parallel-logomark.svg",
});

export function providerLogoPath(provider: string | null | undefined): string {
  if (!provider) return "";
  return PROVIDER_LOGOS[provider] || "";
}

export function providerLogoMap(): Readonly<Record<string, string>> {
  return PROVIDER_LOGOS;
}
