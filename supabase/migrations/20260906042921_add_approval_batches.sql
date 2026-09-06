create table if not exists public.approval_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create index if not exists approval_batches_workspace_created_idx
  on public.approval_batches(workspace_id, created_at desc);

insert into public.approval_batches (workspace_id, name)
select workspace.id, 'Batch 1'
from public.workspaces as workspace
where not exists (
  select 1
  from public.approval_batches as batch
  where batch.workspace_id = workspace.id
);

alter table public.content_items
  add column if not exists approval_batch_id uuid
    references public.approval_batches(id) on delete cascade;

update public.content_items as content
set approval_batch_id = (
  select id
  from public.approval_batches
  where workspace_id = content.workspace_id
  order by created_at, id
  limit 1
)
where content.approval_batch_id is null;

alter table public.content_items
  alter column approval_batch_id set not null;

create index if not exists content_items_batch_position_idx
  on public.content_items(approval_batch_id, position);

alter table public.approval_batches enable row level security;

revoke all on table public.approval_batches from anon, authenticated;
grant select, insert, update, delete on table public.approval_batches to anon;

drop policy if exists "server access approval batches" on public.approval_batches;
create policy "server access approval batches" on public.approval_batches for all to anon
  using ((select private.app_request_authorized()))
  with check ((select private.app_request_authorized()));
