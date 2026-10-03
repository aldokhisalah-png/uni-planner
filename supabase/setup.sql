-- Uni Planner: tables for your timetable, deadlines, notification settings and phone subscriptions.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
-- Same project as PPL Coach and Nutrition Coach; every table starts with planner_.

-- Weekly class meetings (weekday: 0 = Sunday … 6 = Saturday; times are Kuwait local time).
create table if not exists public.planner_classes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course      text not null,
  kind        text not null default 'Lecture',
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  room        text,
  instructor  text,
  created_at  timestamptz not null default now()
);

-- Dated items: GCAs, exams, quizzes, assignments, homework, graded labs, projects, academic dates.
create table if not exists public.planner_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course      text not null,
  title       text not null,
  kind        text not null,
  due_at      timestamptz not null,
  all_day     boolean not null default false,
  weight      text,
  note        text,
  done        boolean not null default false,
  remind      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists planner_events_due on public.planner_events (user_id, due_at);

-- One row per user: when and what to notify.
create table if not exists public.planner_settings (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tz_offset_min    integer not null default 180,
  class_leads      integer[] not null default '{60,30}',
  day_before_time  time not null default '20:00',
  term_start       date not null default '2026-09-20',
  term_end         date not null default '2027-01-14',
  skip_dates       date[] not null default '{}',
  notify_classes   boolean not null default true,
  notify_events    boolean not null default true,
  event_kinds      text[] not null default '{gca,exam,quiz,assignment,hw,lab,prelab,project}',
  updated_at       timestamptz not null default now()
);

-- Phones and browsers that should receive notifications.
create table if not exists public.planner_push_subs (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  device      text,
  created_at  timestamptz not null default now()
);

-- Notifications already sent, so each one goes out once.
create table if not exists public.planner_sent (
  user_id  uuid not null references auth.users(id) on delete cascade,
  key      text not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, key)
);

-- Row-level security: each signed-in user sees and changes only their own rows.
-- planner_sent has no policies, so only the server-side sender can touch it.
do $$
declare t text;
begin
  foreach t in array array['planner_classes','planner_events','planner_settings','planner_push_subs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;
alter table public.planner_sent enable row level security;

-- Clean out sent-log rows older than 60 days (called by the sender).
create or replace function public.planner_prune_sent() returns void language sql security definer set search_path = public as $$
  delete from public.planner_sent where sent_at < now() - interval '60 days';
$$;
revoke all on function public.planner_prune_sent() from public, anon, authenticated;
