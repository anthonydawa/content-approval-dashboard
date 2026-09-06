-- Prevent the unrelated Short Clip pipeline from writing its generated clips
-- into the approval app if the two projects are accidentally configured with
-- the same Supabase database again.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'content_items_reject_short_clip_assets'
      and conrelid = 'public.content_items'::regclass
  ) then
    alter table public.content_items
      add constraint content_items_reject_short_clip_assets
      check (
        media_url not like
          'https://pub-156571d06bfe4e518270c38985267577.r2.dev/users/test_user_actual/jobs/%/clips/%'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'schedule_queue_reject_short_clip_assets'
      and conrelid = 'public.schedule_queue'::regclass
  ) then
    alter table public.schedule_queue
      add constraint schedule_queue_reject_short_clip_assets
      check (
        media_url not like
          'https://pub-156571d06bfe4e518270c38985267577.r2.dev/users/test_user_actual/jobs/%/clips/%'
      );
  end if;
end
$$;
