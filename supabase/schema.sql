-- Run this once in the Supabase SQL Editor for the testing version.
create extension if not exists "pgcrypto";

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  initials text not null,
  color text not null default '#536f62',
  created_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
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

create index if not exists content_items_workspace_id_idx on public.content_items(workspace_id);
create index if not exists comments_content_id_idx on public.comments(content_id);

alter table public.workspaces enable row level security;
alter table public.content_items enable row level security;
alter table public.comments enable row level security;

-- New Supabase projects require explicit Data API grants.
grant select, insert, update on table public.workspaces to anon;
grant select, insert, update on table public.content_items to anon;
grant select, insert on table public.comments to anon;

-- TESTING ONLY: no login was requested, so anonymous visitors can read/write.
drop policy if exists "testing access workspaces" on public.workspaces;
drop policy if exists "testing access content" on public.content_items;
drop policy if exists "testing access comments" on public.comments;
create policy "testing access workspaces" on public.workspaces for all to anon using (true) with check (true);
create policy "testing access content" on public.content_items for all to anon using (true) with check (true);
create policy "testing access comments" on public.comments for all to anon using (true) with check (true);
