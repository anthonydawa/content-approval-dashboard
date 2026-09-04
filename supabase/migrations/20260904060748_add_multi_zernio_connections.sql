alter table public.workspaces
  add column if not exists zernio_secondary_api_key_encrypted text,
  add column if not exists zernio_secondary_accounts jsonb not null default '[]'::jsonb,
  add column if not exists pinterest_board_id text not null default '',
  add column if not exists pinterest_board_name text not null default '';

alter table public.schedule_queue
  add column if not exists secondary_sync_state text not null default 'not_sent'
    check (secondary_sync_state in ('not_sent', 'dirty', 'synced', 'error')),
  add column if not exists secondary_zernio_post_id text,
  add column if not exists secondary_zernio_status text,
  add column if not exists secondary_zernio_last_error text,
  add column if not exists secondary_zernio_request_id uuid not null default gen_random_uuid(),
  add column if not exists secondary_sent_to_zernio_at timestamptz;

create index if not exists schedule_queue_secondary_zernio_post_idx
  on public.schedule_queue(secondary_zernio_post_id)
  where secondary_zernio_post_id is not null;
