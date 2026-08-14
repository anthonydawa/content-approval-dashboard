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
  channel text not null default 'Instagram',
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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-media', 'content-media', true, 52428800, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do update set public = true;

drop policy if exists "testing media uploads" on storage.objects;
drop policy if exists "testing media updates" on storage.objects;
drop policy if exists "testing media selects" on storage.objects;
drop policy if exists "public media reads" on storage.objects;
create policy "testing media uploads" on storage.objects for insert to anon with check (bucket_id = 'content-media');
create policy "testing media updates" on storage.objects for update to anon using (bucket_id = 'content-media') with check (bucket_id = 'content-media');
create policy "testing media selects" on storage.objects for select to anon using (bucket_id = 'content-media');
create policy "public media reads" on storage.objects for select to public using (bucket_id = 'content-media');

-- Starter content makes the connected app immediately testable.
insert into public.workspaces (id, name, initials, color) values
  ('4a74b334-a49f-4ad1-9733-b735b1e94569', 'Luma Coffee', 'LC', '#cb653d'),
  ('798794c2-b225-4109-9afb-2c67ff6cf012', 'North & Pine', 'NP', '#47665a')
on conflict (id) do nothing;

insert into public.content_items
  (id, workspace_id, title, caption, media_url, media_type, channel, scheduled_for, status, position)
values
  ('0f9b5a74-3895-4238-89a0-d2e03dff4e03', '4a74b334-a49f-4ad1-9733-b735b1e94569', 'Slow mornings, better coffee', E'A little reminder to take your morning slowly. Our house-roasted beans are ready when you are. ☕\n\n#LumaCoffee #SlowMornings #CoffeeRitual', 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1400&q=85', 'image', 'Instagram', 'Aug 18, 9:00 AM', 'pending', 1),
  ('78dbb59a-44f6-4798-9944-66134a3558a2', '4a74b334-a49f-4ad1-9733-b735b1e94569', 'Behind the bar', E'From first pour to final swirl—here’s a tiny look at the care behind every cup. Save this for your next coffee break.\n\n#BehindTheBar #CoffeeCraft', 'https://videos.pexels.com/video-files/2909914/2909914-hd_1920_1080_25fps.mp4', 'video', 'Instagram Reel', 'Aug 20, 5:30 PM', 'changes_requested', 2),
  ('907b749c-0801-45ff-bb5e-7069cb2d1991', '4a74b334-a49f-4ad1-9733-b735b1e94569', 'Weekend table', E'Your weekend table is waiting. Bring a friend, stay for one more cup, and let the afternoon unfold.\n\n#WeekendCoffee #CafeDays', 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=1400&q=85', 'image', 'Facebook', 'Aug 23, 11:00 AM', 'approved', 3),
  ('f5637acd-6d3d-49ac-bfe3-fef7a380a5fd', '798794c2-b225-4109-9afb-2c67ff6cf012', 'Made for the long way home', E'Quiet trails, clean lines, and pieces made to move with you. Meet the new Field Collection.\n\n#NorthAndPine #FieldCollection #EverydayOutside', 'https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=1400&q=85', 'image', 'Instagram', 'Aug 19, 8:00 AM', 'pending', 1),
  ('d098aa9e-6704-460e-98c0-b4eb43d670cf', '798794c2-b225-4109-9afb-2c67ff6cf012', 'Built to wander', 'For early starts and unplanned turns. The Ridge Pack keeps the essentials close without slowing you down.', 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=85', 'image', 'Facebook', 'Aug 22, 4:00 PM', 'pending', 2)
on conflict (id) do nothing;

insert into public.comments (id, content_id, author, body, created_at)
values ('805566fe-9ace-41f6-b8ec-a86c7d5372d5', '78dbb59a-44f6-4798-9944-66134a3558a2', 'Mara', 'Could we use a brighter opening frame? The caption looks good.', '2026-08-14T02:15:00Z')
on conflict (id) do nothing;
