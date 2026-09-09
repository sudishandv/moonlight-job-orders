-- Patch 62: Notification bell — activity feed
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste all > Run

create table notifications (
  id uuid default gen_random_uuid() primary key,
  message text not null,
  type text,
  created_by text,
  created_at timestamptz default now()
);

alter table notifications enable row level security;

create policy "auth read notifications" on notifications for select using (auth.role() = 'authenticated');
create policy "auth insert notifications" on notifications for insert with check (auth.role() = 'authenticated');

alter table profiles add column notifications_last_seen_at timestamptz;

-- profiles previously had no update policy at all (nothing in the app ever
-- updated it before now) — needed so the bell can record when a user last
-- opened the notification list.
create policy "auth update profiles" on profiles for update using (auth.role() = 'authenticated');
