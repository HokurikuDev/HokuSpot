-- ============================================================================
-- Hokuriku Spots — Row-Level Security Policies
-- ============================================================================
-- IMPORTANT: Because this app has no backend server, Postgres Row-Level
-- Security (RLS) IS the access-control layer. The anon/public key used in
-- the frontend JS is, by design, visible to anyone — RLS is what stops a
-- visitor from reading other users' pending submissions or writing rows
-- they shouldn't be able to. Every table below has RLS enabled; there is
-- no table in this app that is intentionally left open without policies.
-- ============================================================================

alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.tags          enable row level security;
alter table public.places        enable row level security;
alter table public.place_tags    enable row level security;
alter table public.place_photos  enable row level security;
alter table public.place_reports enable row level security;

-- ----------------------------------------------------------------------------
-- Helper: is the current user a moderator or admin?
-- security definer + stable lets this be used inside policies cheaply
-- without each policy re-deriving the role logic.
-- ----------------------------------------------------------------------------
create function public.is_moderator()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('moderator', 'admin')
  );
$$;

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
create policy "Profiles are publicly readable"
  on public.profiles for select
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- No insert/delete policy: profile rows are created only by the
-- handle_new_user trigger (security definer), and deleted via cascade
-- when the auth.users row is deleted. This prevents profile spoofing.

-- ----------------------------------------------------------------------------
-- categories / tags — public reference data, readable by everyone,
-- writable only by moderators (categories are meant to stay a fixed,
-- curated list per your requirement; tags can grow more freely).
-- ----------------------------------------------------------------------------
create policy "Categories are publicly readable"
  on public.categories for select
  using (true);

create policy "Only moderators manage categories"
  on public.categories for all
  using (public.is_moderator())
  with check (public.is_moderator());

create policy "Tags are publicly readable"
  on public.tags for select
  using (true);

create policy "Authenticated users can create tags"
  on public.tags for insert
  to authenticated
  with check (true);

-- ----------------------------------------------------------------------------
-- places — the core moderation logic.
--
-- Read:
--   - Anyone (including anonymous visitors) can read APPROVED places.
--   - A submitter can read their OWN pending/rejected places (to see status).
--   - Moderators/admins can read everything (to review the queue).
-- Write:
--   - Any authenticated (logged-in) user can submit a new place; it is
--     forced to status='pending' regardless of what the client sends.
--   - A submitter can edit their own place ONLY while it's still pending
--     (so people can fix typos before review, but can't silently edit
--     something already approved and live).
--   - Only moderators/admins can change status (approve/reject) or set
--     featured=true.
-- ----------------------------------------------------------------------------
create policy "Approved places are publicly readable"
  on public.places for select
  using (status = 'approved');

create policy "Users can read their own submissions"
  on public.places for select
  using (auth.uid() = created_by);

create policy "Moderators can read all places"
  on public.places for select
  using (public.is_moderator());

create policy "Authenticated users can submit places"
  on public.places for insert
  to authenticated
  with check (
    auth.uid() = created_by
    and status = 'pending'        -- can't self-approve on insert
    and featured = false          -- can't self-feature on insert
  );

create policy "Owners can edit their own pending submissions"
  on public.places for update
  using (auth.uid() = created_by and status = 'pending')
  with check (
    auth.uid() = created_by
    and status = 'pending'        -- can't flip their own status
    and featured = false          -- can't flip their own featured flag
  );

create policy "Moderators can update any place"
  on public.places for update
  using (public.is_moderator())
  with check (public.is_moderator());

create policy "Owners can delete their own pending submissions"
  on public.places for delete
  using (auth.uid() = created_by and status = 'pending');

create policy "Moderators can delete any place"
  on public.places for delete
  using (public.is_moderator());

-- ----------------------------------------------------------------------------
-- place_tags — follows the visibility of the parent place.
-- ----------------------------------------------------------------------------
create policy "Place tags readable when parent place is readable"
  on public.place_tags for select
  using (
    exists (
      select 1 from public.places p
      where p.id = place_id
        and (p.status = 'approved' or p.created_by = auth.uid() or public.is_moderator())
    )
  );

create policy "Owners can tag their own pending places"
  on public.place_tags for insert
  to authenticated
  with check (
    exists (
      select 1 from public.places p
      where p.id = place_id and p.created_by = auth.uid() and p.status = 'pending'
    )
    or public.is_moderator()
  );

create policy "Owners can untag their own pending places"
  on public.place_tags for delete
  using (
    exists (
      select 1 from public.places p
      where p.id = place_id and p.created_by = auth.uid() and p.status = 'pending'
    )
    or public.is_moderator()
  );

-- ----------------------------------------------------------------------------
-- place_photos — same visibility shape as place_tags. Photos can be added
-- by the owner while pending, OR by a moderator at any time (e.g. cleanup).
-- ----------------------------------------------------------------------------
create policy "Photos readable when parent place is readable"
  on public.place_photos for select
  using (
    exists (
      select 1 from public.places p
      where p.id = place_id
        and (p.status = 'approved' or p.created_by = auth.uid() or public.is_moderator())
    )
  );

create policy "Owners can add photos to their own pending places"
  on public.place_photos for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      exists (
        select 1 from public.places p
        where p.id = place_id and p.created_by = auth.uid() and p.status = 'pending'
      )
      or public.is_moderator()
    )
  );

create policy "Owners can remove photos from their own pending places"
  on public.place_photos for delete
  using (
    exists (
      select 1 from public.places p
      where p.id = place_id and p.created_by = auth.uid() and p.status = 'pending'
    )
    or public.is_moderator()
  );

-- ----------------------------------------------------------------------------
-- place_reports — anyone logged in can file a report; only moderators can
-- read/manage the queue (reports shouldn't be publicly browsable, that
-- would just be a how-to-vandalize-the-map list).
-- ----------------------------------------------------------------------------
create policy "Authenticated users can file reports"
  on public.place_reports for insert
  to authenticated
  with check (auth.uid() = reported_by);

create policy "Moderators can read reports"
  on public.place_reports for select
  using (public.is_moderator());

create policy "Moderators can update reports"
  on public.place_reports for update
  using (public.is_moderator())
  with check (public.is_moderator());

-- ----------------------------------------------------------------------------
-- featured_places view inherits the security of its underlying tables
-- (it only ever selects status='approved' rows), but since views run with
-- the permissions of the view owner by default, we explicitly confirm
-- public read access is intended here — this view IS meant to be public,
-- keyless-readable data for the future cross-site banner.
-- ----------------------------------------------------------------------------
grant select on public.featured_places to anon, authenticated;
