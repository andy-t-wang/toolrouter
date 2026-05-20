// Thin re-export of the canonical attribution module from router-core.
//
// Both the health worker (router-core) and the gateway monitoring code
// (apps/api) import the same `attributeFailure` so labels can never diverge.
// API-layer call sites import from here for ergonomic locality.

export {
  agentRequestLabel,
  attributeFailure,
} from "@toolrouter/router-core";
