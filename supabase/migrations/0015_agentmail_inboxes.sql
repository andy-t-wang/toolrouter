create table if not exists agentmail_inboxes (
  id text primary key,
  inbox_id text not null unique,
  email text,
  owner_address text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agentmail_inboxes_owner_address_idx
  on agentmail_inboxes(owner_address);

create index if not exists agentmail_inboxes_email_idx
  on agentmail_inboxes(email)
  where email is not null;

alter table agentmail_inboxes enable row level security;

revoke all on table agentmail_inboxes from anon, authenticated;

comment on table agentmail_inboxes is
  'Server-only ownership map for AgentMail inboxes created through ToolRouter x402 wrappers.';
