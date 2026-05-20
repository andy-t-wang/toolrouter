-- Drop the unused `body` column from `requests`.
--
-- The column was reserved for the raw user request body but has always been
-- written as NULL by the orchestrator (`createRequestRow` in
-- apps/api/src/services/execution/orchestrator.ts). Removing it eliminates
-- the footgun of a future writer silently persisting user prompts into the
-- table.

alter table requests
  drop column if exists body;

select pg_notify('pgrst', 'reload schema');
