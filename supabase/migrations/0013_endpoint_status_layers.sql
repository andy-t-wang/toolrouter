-- Per-layer health surfaces (U6).
--
-- Adds four `layer_*_status` columns plus their `*_updated_at` timestamps to
-- `endpoint_status`. Each layer mirrors the attribution module's failure
-- vocabulary (facilitator, agentkit, upstream, transport) and tracks its own
-- freshness so the public DTO can surface a stale layer as `unknown` rather
-- than as a permanently-cached `failing` chip.
--
-- Additive only. Existing `status` / `last_error` / `payment_error` columns
-- remain authoritative for the fleet-level rollup; per-layer columns are an
-- independent denormalized view computed by the health worker at probe time.
-- See docs/plans/2026-05-19-001-refactor-modularity-and-reliability-plan.md.

alter table endpoint_status
  add column if not exists layer_facilitator_status text,
  add column if not exists layer_facilitator_updated_at timestamptz,
  add column if not exists layer_agentkit_status text,
  add column if not exists layer_agentkit_updated_at timestamptz,
  add column if not exists layer_upstream_status text,
  add column if not exists layer_upstream_updated_at timestamptz,
  add column if not exists layer_transport_status text,
  add column if not exists layer_transport_updated_at timestamptz;

comment on column endpoint_status.layer_facilitator_status is
  'Per-layer status for the x402 facilitator (CDP) settlement step. One of healthy | degraded | failing | unknown. Stale entries (older than the public-DTO freshness window) are surfaced as unknown.';
comment on column endpoint_status.layer_agentkit_status is
  'Per-layer status for the AgentKit verification path (free-trial / access / discount realization). One of healthy | degraded | failing | unknown.';
comment on column endpoint_status.layer_upstream_status is
  'Per-layer status for the upstream provider (5xx, 4xx, business-logic errors after settlement succeeded). One of healthy | degraded | failing | unknown.';
comment on column endpoint_status.layer_transport_status is
  'Per-layer status for the network/transport reach (DNS, TCP, TLS, timeouts before any application response). One of healthy | degraded | failing | unknown.';

select pg_notify('pgrst', 'reload schema');
