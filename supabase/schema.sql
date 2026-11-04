-- NaijaVibe schema. Run in the Supabase SQL editor, then policies.sql, then seed.sql.
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text, bio text, state text, avatar_url text,
  role text not null default 'member' check (role in ('member','creator','admin')),
  created_at timestamptz default now()
);
create table if not exists posts (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null, body text not null, category text, state text, image_url text, video_url text,
  created_at timestamptz default now()
);
alter table posts add column if not exists video_url text;
create table if not exists comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null, created_at timestamptz default now()
);
create table if not exists likes (
  post_id bigint references posts(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (post_id, user_id)
);
create table if not exists follows (
  follower_id uuid references profiles(id) on delete cascade,
  following_id uuid references profiles(id) on delete cascade,
  primary key (follower_id, following_id)
);
create table if not exists events (
  id bigint generated always as identity primary key,
  title text not null, place text, state text, category text, chip text, month text, day text, starts_on date,
  created_at timestamptz default now()
);
create table if not exists businesses (
  id bigint generated always as identity primary key,
  owner_id uuid references profiles(id) on delete set null,
  name text not null, cat text, state text, description text, image text, rating numeric,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now()
);
create table if not exists products (
  id bigint generated always as identity primary key,
  business_id bigint references businesses(id) on delete cascade,
  name text not null, price integer not null check (price >= 0), image text, seller text,
  created_at timestamptz default now()
);
create table if not exists reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references profiles(id) on delete set null,
  target_type text not null, target_id text not null, reason text,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz default now()
);
-- create a profile automatically when someone signs up
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username) values (new.id, coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
-- storage bucket for photos
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', true) on conflict do nothing;
