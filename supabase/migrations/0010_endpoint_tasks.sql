create table if not exists public.endpoint_tasks (
  id text primary key,
  endpoint_id text not null,
  provider text not null,
  provider_task_id text,
  request_id text references public.requests(id) on delete set null,
  trace_id text,
  user_id uuid not null references auth.users(id) on delete cascade,
  api_key_id text not null references public.api_keys(id) on delete cascade,
  caller_id text not null,
  dedupe_key text not null,
  status text not null,
  task_url text,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz,
  expires_at timestamptz not null
);

create unique index if not exists endpoint_tasks_api_key_provider_task_key
  on public.endpoint_tasks(api_key_id, endpoint_id, provider_task_id)
  where provider_task_id is not null;

create unique index if not exists endpoint_tasks_starting_dedupe_key
  on public.endpoint_tasks(api_key_id, endpoint_id, dedupe_key)
  where provider_task_id is null and status <> 'error';

create index if not exists endpoint_tasks_api_key_dedupe_idx
  on public.endpoint_tasks(api_key_id, endpoint_id, dedupe_key, expires_at desc);

create index if not exists endpoint_tasks_user_created_idx
  on public.endpoint_tasks(user_id, created_at desc);

alter table public.endpoint_tasks enable row level security;

revoke all on public.endpoint_tasks from anon, authenticated;
drop policy if exists endpoint_tasks_select_own on public.endpoint_tasks;

comment on table public.endpoint_tasks is
  'Durable task handles for async endpoint workflows such as Manus research.';

select pg_notify('pgrst', 'reload schema');
