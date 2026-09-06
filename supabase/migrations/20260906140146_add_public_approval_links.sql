create table if not exists public.approval_batch_links (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique references public.approval_batches(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  token_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approval_batch_links_token_hash_idx
  on public.approval_batch_links(token_hash);

alter table public.approval_batch_links enable row level security;

revoke all on table public.approval_batch_links from anon, authenticated;
grant select, insert, update, delete on table public.approval_batch_links to anon;

drop policy if exists "server access approval batch links" on public.approval_batch_links;
create policy "server access approval batch links" on public.approval_batch_links for all to anon
  using ((select private.app_request_authorized()))
  with check ((select private.app_request_authorized()));
