-- Content approval, queue, and calendar schema.
-- The deployment step stores a SHA-256 app API key in private.app_settings
-- and activates private.check_app_request as PostgREST's pre-request hook.
create extension if not exists "pgcrypto";

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  initials text not null,
  color text not null default '#536f62',
  created_at timestamptz not null default now()
);

create table if not exists public.approval_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  approval_batch_id uuid not null references public.approval_batches(id) on delete cascade,
  title text not null,
  caption text not null default '',
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  channel text not null default 'All platforms',
  scheduled_for text not null default 'Not scheduled',
  status text not null default 'pending' check (status in ('pending', 'approved', 'changes_requested')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  author text not null default 'Reviewer',
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.workspaces
  add column if not exists timezone text not null default 'America/Chicago',
  add column if not exists zernio_api_key_encrypted text,
  add column if not exists zernio_accounts jsonb not null default '[]'::jsonb,
  add column if not exists zernio_secondary_api_key_encrypted text,
  add column if not exists zernio_secondary_accounts jsonb not null default '[]'::jsonb,
  add column if not exists pinterest_board_id text not null default '',
  add column if not exists pinterest_board_name text not null default '',
  add column if not exists auto_queue_cadence jsonb not null default
    '{"frequency":"weekdays","weekdays":[1,2,3,4,5],"times":["09:00"],"start_date":""}'::jsonb;

alter table public.workspaces alter column timezone set default 'America/Chicago';

create table if not exists public.schedule_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_content_id uuid references public.content_items(id) on delete set null,
  title text not null default '',
  caption text not null default '',
  media_url text not null default '',
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  channel text not null default 'All platforms',
  scheduled_at timestamptz,
  sync_state text not null default 'not_sent'
    check (sync_state in ('not_sent', 'dirty', 'synced', 'error')),
  zernio_post_id text,
  zernio_status text,
  zernio_last_error text,
  zernio_request_id uuid not null default gen_random_uuid(),
  sent_to_zernio_at timestamptz,
  secondary_sync_state text not null default 'not_sent'
    check (secondary_sync_state in ('not_sent', 'dirty', 'synced', 'error')),
  secondary_zernio_post_id text,
  secondary_zernio_status text,
  secondary_zernio_last_error text,
  secondary_zernio_request_id uuid not null default gen_random_uuid(),
  secondary_sent_to_zernio_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, source_content_id)
);

create index if not exists content_items_workspace_id_idx on public.content_items(workspace_id);
create index if not exists approval_batches_workspace_created_idx
  on public.approval_batches(workspace_id, created_at desc);
create index if not exists content_items_batch_position_idx
  on public.content_items(approval_batch_id, position);
create index if not exists comments_content_id_idx on public.comments(content_id);
create index if not exists schedule_queue_workspace_schedule_idx
  on public.schedule_queue(workspace_id, scheduled_at);
create index if not exists schedule_queue_zernio_post_idx
  on public.schedule_queue(zernio_post_id)
  where zernio_post_id is not null;
create index if not exists schedule_queue_secondary_zernio_post_idx
  on public.schedule_queue(secondary_zernio_post_id)
  where secondary_zernio_post_id is not null;

alter table public.workspaces enable row level security;
alter table public.approval_batches enable row level security;
alter table public.content_items enable row level security;
alter table public.comments enable row level security;
alter table public.schedule_queue enable row level security;

create schema if not exists private;

create table if not exists private.app_settings (
  singleton boolean primary key default true check (singleton),
  data_api_key_sha256 text not null,
  updated_at timestamptz not null default now()
);

revoke all on schema private from public;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function private.app_request_authorized()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.app_settings
    where singleton = true
      and data_api_key_sha256 = encode(
        extensions.digest(
          coalesce(current_setting('request.headers', true)::jsonb ->> 'x-app-api-key', ''),
          'sha256'
        ),
        'hex'
      )
  );
$$;

create or replace function private.check_app_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.app_request_authorized() then
    raise sqlstate 'PGRST' using
      message = '{"code":"APP403","message":"Forbidden"}',
      detail = '{"status":403,"headers":{"Content-Type":"application/json"},"status_text":"Forbidden"}';
  end if;
end;
$$;

revoke all on function private.app_request_authorized() from public;
revoke all on function private.check_app_request() from public;
grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.app_request_authorized() to anon, authenticated, service_role;
grant execute on function private.check_app_request() to anon, authenticated, service_role;

-- New Supabase projects require explicit Data API grants.
revoke all on table public.workspaces, public.approval_batches, public.content_items, public.comments, public.schedule_queue
  from anon, authenticated;
grant select, insert, update, delete on table public.workspaces to anon;
grant select, insert, update, delete on table public.approval_batches to anon;
grant select, insert, update, delete on table public.content_items to anon;
grant select, insert, update, delete on table public.comments to anon;
grant select, insert, update, delete on table public.schedule_queue to anon;

drop policy if exists "testing access workspaces" on public.workspaces;
drop policy if exists "testing access content" on public.content_items;
drop policy if exists "server access approval batches" on public.approval_batches;
drop policy if exists "testing access comments" on public.comments;
drop policy if exists "server access workspaces" on public.workspaces;
drop policy if exists "server access content" on public.content_items;
drop policy if exists "server access comments" on public.comments;
drop policy if exists "server access schedule queue" on public.schedule_queue;
create policy "server access workspaces" on public.workspaces for all to anon
  using ((select private.app_request_authorized()))
  with check ((select private.app_request_authorized()));
create policy "server access approval batches" on public.approval_batches for all to anon
  using ((select private.app_request_authorized()))
  with check ((select private.app_request_authorized()));
create policy "server access content" on public.content_items for all to anon
  using ((select private.app_request_authorized()))
  with check ((select private.app_request_authorized()));
create policy "server access comments" on public.comments for all to anon
  using ((select private.app_request_authorized()))
  with check ((select private.app_request_authorized()));
create policy "server access schedule queue" on public.schedule_queue for all to anon
  using ((select private.app_request_authorized()))
  with check ((select private.app_request_authorized()));

-- Media uploads now use Cloudflare R2. Remove the legacy anonymous Storage
-- policies while keeping the existing public bucket URLs readable.
drop policy if exists "public media reads" on storage.objects;
drop policy if exists "testing media selects" on storage.objects;
drop policy if exists "testing media updates" on storage.objects;
drop policy if exists "testing media uploads" on storage.objects;

-- Existing workspaces use Central Time for the Texas scheduler by default.
update public.workspaces
set timezone = 'America/Chicago'
where timezone is null or timezone = 'Asia/Manila';

-- The deployment applies these three statements with a generated hash:
-- insert into private.app_settings(singleton, data_api_key_sha256)
-- values (true, '<sha256>') on conflict (singleton) do update
-- set data_api_key_sha256 = excluded.data_api_key_sha256, updated_at = now();
-- alter role authenticator set pgrst.db_pre_request = 'private.check_app_request';
-- notify pgrst, 'reload config';
