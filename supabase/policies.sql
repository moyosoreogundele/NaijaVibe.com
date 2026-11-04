-- Row Level Security. The browser only holds the anon key, so these rules ARE the security.
alter table profiles enable row level security; alter table posts enable row level security;
alter table comments enable row level security; alter table likes enable row level security;
alter table follows enable row level security; alter table events enable row level security;
alter table businesses enable row level security; alter table products enable row level security;
alter table reports enable row level security;

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create policy "profiles readable" on profiles for select using (true);
create policy "own profile update" on profiles for update using (auth.uid() = id) with check (auth.uid() = id and role = (select role from profiles where id = auth.uid()));

create policy "posts readable" on posts for select using (true);
create policy "own posts insert" on posts for insert with check (auth.uid() = user_id);
create policy "own posts update" on posts for update using (auth.uid() = user_id);
create policy "own or admin posts delete" on posts for delete using (auth.uid() = user_id or is_admin());

create policy "comments readable" on comments for select using (true);
create policy "own comments insert" on comments for insert with check (auth.uid() = user_id);
create policy "own or admin comments delete" on comments for delete using (auth.uid() = user_id or is_admin());

create policy "likes readable" on likes for select using (true);
create policy "own likes" on likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "follows readable" on follows for select using (true);
create policy "own follows" on follows for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

create policy "events readable" on events for select using (true);
create policy "admin manages events" on events for all using (is_admin()) with check (is_admin());

create policy "approved businesses readable" on businesses for select using (status = 'approved' or owner_id = auth.uid() or is_admin());
create policy "owners register" on businesses for insert with check (auth.uid() = owner_id and status = 'pending');
create policy "admin manages businesses" on businesses for update using (is_admin());
create policy "products readable" on products for select using (true);
create policy "admin manages products" on products for all using (is_admin()) with check (is_admin());

create policy "anyone signed in can report" on reports for insert with check (auth.uid() = reporter_id);
create policy "admins read reports" on reports for select using (is_admin());
create policy "admins resolve reports" on reports for update using (is_admin());

create policy "uploads public read" on storage.objects for select using (bucket_id = 'uploads');
create policy "signed-in upload" on storage.objects for insert with check (bucket_id = 'uploads' and auth.role() = 'authenticated');
