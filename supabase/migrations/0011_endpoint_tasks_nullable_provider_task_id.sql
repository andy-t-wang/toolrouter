alter table public.endpoint_tasks
  alter column provider_task_id drop not null;

comment on column public.endpoint_tasks.provider_task_id is
  'Nullable while ToolRouter reserves and dedupes an async Manus task start, then filled after the provider creates a task.';

select pg_notify('pgrst', 'reload schema');
