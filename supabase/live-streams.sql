-- Live video rooms and chat. Run after schema.sql and policies.sql.
create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100),
  topic text not null default 'Community' check (topic in ('Community','Food','Culture','Music','Events','Travel')),
  state text not null check (char_length(state) between 1 and 60),
  channel_name text not null unique check (channel_name ~ '^naija-[a-f0-9]{24}$'),
  status text not null default 'live' check (status in ('live','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint ended_stream_has_end_time check (status <> 'ended' or ended_at is not null)
);

create index if not exists live_streams_live_created_idx
  on public.live_streams (created_at desc) where status = 'live';

create table if not exists public.live_chat_messages (
  id bigint generated always as identity primary key,
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists live_chat_stream_created_idx
  on public.live_chat_messages (stream_id, created_at desc);

alter table public.live_streams enable row level security;
alter table public.live_chat_messages enable row level security;

drop policy if exists "live rooms are discoverable" on public.live_streams;
create policy "live rooms are discoverable" on public.live_streams
  for select using (status = 'live' or owner_id = auth.uid());

drop policy if exists "members start their own live rooms" on public.live_streams;
create policy "members start their own live rooms" on public.live_streams
  for insert with check (auth.uid() = owner_id and status = 'live');

drop policy if exists "owners can end their live rooms" on public.live_streams;
create policy "owners can end their live rooms" on public.live_streams
  for update using (auth.uid() = owner_id and status = 'live')
  with check (auth.uid() = owner_id and status in ('live','ended'));

drop policy if exists "chat is readable while a room is live" on public.live_chat_messages;
create policy "chat is readable while a room is live" on public.live_chat_messages
  for select using (exists (
    select 1 from public.live_streams
    where live_streams.id = live_chat_messages.stream_id
      and live_streams.status = 'live'
  ));

drop policy if exists "members chat in live rooms" on public.live_chat_messages;
create policy "members chat in live rooms" on public.live_chat_messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.live_streams
      where live_streams.id = live_chat_messages.stream_id
        and live_streams.status = 'live'
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.live_streams;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.live_chat_messages;
exception when duplicate_object then
  null;
end $$;
