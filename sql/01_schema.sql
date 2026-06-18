-- ============================================================================
-- Hokuriku Spots — Core Schema
-- Project: Map of interesting/abandoned/scenic places in Ishikawa & Toyama
-- Target: Supabase (Postgres + PostGIS)
-- ============================================================================
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Run files in order: 01_schema.sql -> 02_policies.sql -> 03_seed.sql (optional)
-- ============================================================================

-- PostGIS gives us proper geographic types, distance queries, and bounding-box
-- filtering, which a plain lat/lng pair of floats can't do efficiently.
create extension if not exists postgis;

-- ----------------------------------------------------------------------------
-- profiles
-- Mirrors auth.users (Supabase's built-in auth table) with app-specific fields.
-- We can't add columns to auth.users directly, so we extend via a 1:1 table.
-- ----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default 'Explorer',
  avatar_url    text,
  role          text not null default 'user'
                  check (role in ('user', 'moderator', 'admin')),
  created_at    timestamptz not null default now()
);

comment on table public.profiles is
  'One row per registered user. role drives moderation permissions — keep this flexible (not hardcoded to one admin) since the team may grow.';

-- Auto-create a profile row whenever someone signs up via Supabase Auth.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------------------
-- categories
-- Fixed top-level categories (per your requirement), each with a map-pin color
-- and icon key so the frontend can render consistent markers without
-- hardcoding a lookup table in JS that can drift from the database.
-- ----------------------------------------------------------------------------
create table public.categories (
  id          text primary key,        -- short stable slug, e.g. 'haikyo'
  label_en    text not null,
  label_ja    text,
  color       text not null,           -- hex, used for marker color
  icon        text not null,           -- icon key, mapped in frontend icon set
  sort_order  int not null default 0
);

comment on table public.categories is
  'Fixed category list. Add rows here (not in code) to introduce a new category.';

insert into public.categories (id, label_en, label_ja, color, icon, sort_order) values
  ('tourist',    'Tourist Spot',        '観光地',     '#3B7A57', 'landmark',  1),
  ('haikyo',     'Abandoned Place',     '廃墟',       '#8B5E3C', 'door-open', 2),
  ('road',       'Interesting Road',    '面白い道',   '#4A6FA5', 'route',     3),
  ('nature',     'Nature / Viewpoint',  '自然・展望', '#5C8A3A', 'mountain',  4),
  ('food',       'Food / Drink',        '飲食',       '#C9622A', 'utensils',  5),
  ('historic',   'Historic Site',       '史跡',       '#7A6A53', 'scroll',    6),
  ('onsen',      'Onsen / Bath',        '温泉',       '#B5483D', 'droplet',   7),
  ('other',      'Other',               'その他',     '#6B7280', 'pin',       8);

-- ----------------------------------------------------------------------------
-- tags
-- Free-form tags layered on top of fixed categories (per your requirement).
-- Stored as a normalized many-to-many so tags can be renamed/merged later
-- and so we can show "popular tags" without scanning text fields.
-- ----------------------------------------------------------------------------
create table public.tags (
  id    bigint generated always as identity primary key,
  label text not null unique
);

create table public.place_tags (
  place_id  uuid not null,   -- FK added after places table exists
  tag_id    bigint not null references public.tags(id) on delete cascade,
  primary key (place_id, tag_id)
);

-- ----------------------------------------------------------------------------
-- places
-- The core table. Status drives the moderation workflow you asked for
-- ("pending until an admin approves"). geom is the canonical location;
-- lat/lng are kept as plain columns too for trivial frontend consumption
-- without needing PostGIS functions on every read.
-- ----------------------------------------------------------------------------
create table public.places (
  id               uuid primary key default gen_random_uuid(),

  -- Core identity (mirrors a Google Maps-style place card)
  name             text not null,
  description      text,
  highlights       text,                 -- "interesting stuff about the spot"
  address          text,                 -- free-text human-readable address
  category_id      text not null references public.categories(id),

  -- Location
  geom             geography(Point, 4326) not null,
  lat              double precision not null,
  lng              double precision not null,

  -- Workflow
  status           text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  featured         boolean not null default false,  -- powers the future homepage banner

  -- Attribution
  created_by       uuid references public.profiles(id) on delete set null,
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.places is
  'Every submitted location. status=pending until a moderator/admin approves. featured=true surfaces a place to the public featured_places view for the future cross-site homepage banner.';
comment on column public.places.featured is
  'Future-proofing hook: the planned Ishikawa/Toyama homepage banner reads only featured+approved places via the public featured_places view.';

-- Keep geom and lat/lng in sync no matter which one the client writes.
create function public.places_sync_geom()
returns trigger
language plpgsql
as $$
begin
  if new.geom is not null then
    new.lat := ST_Y(new.geom::geometry);
    new.lng := ST_X(new.geom::geometry);
  elsif new.lat is not null and new.lng is not null then
    new.geom := ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)::geography;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger places_sync_geom_trigger
  before insert or update on public.places
  for each row execute procedure public.places_sync_geom();

-- Spatial index for fast "places within this map viewport" queries.
create index places_geom_idx on public.places using gist (geom);
create index places_status_idx on public.places (status);
create index places_category_idx on public.places (category_id);
create index places_featured_idx on public.places (featured) where featured = true;

alter table public.place_tags
  add constraint place_tags_place_fk
  foreign key (place_id) references public.places(id) on delete cascade;

-- ----------------------------------------------------------------------------
-- place_photos
-- Supports BOTH upload (Supabase Storage path) and pasted external URLs,
-- per your requirement. Exactly one of storage_path / external_url is set.
-- ----------------------------------------------------------------------------
create table public.place_photos (
  id             uuid primary key default gen_random_uuid(),
  place_id       uuid not null references public.places(id) on delete cascade,
  storage_path   text,         -- path within the 'place-photos' Storage bucket
  external_url   text,         -- pasted URL, used as-is
  caption        text,
  sort_order     int not null default 0,
  uploaded_by    uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint exactly_one_source check (
    (storage_path is not null and external_url is null) or
    (storage_path is null and external_url is not null)
  )
);

create index place_photos_place_idx on public.place_photos (place_id);

-- ----------------------------------------------------------------------------
-- place_reports
-- Lightweight flagging so the community can surface bad pins/content to
-- moderators even though we chose "pending review" over "instant + flag".
-- Cheap to include now; useful once approved content needs upkeep later.
-- ----------------------------------------------------------------------------
create table public.place_reports (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references public.places(id) on delete cascade,
  reported_by uuid references public.profiles(id) on delete set null,
  reason      text not null,
  status      text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Public view for the FUTURE cross-site homepage banner.
-- Exposes only safe, approved, featured data — never raw tables — so the
-- other site (and this one) can query a stable, intentionally narrow shape.
-- ----------------------------------------------------------------------------
create view public.featured_places as
  select
    p.id,
    p.name,
    p.description,
    p.highlights,
    p.address,
    p.category_id,
    c.label_en as category_label,
    c.color as category_color,
    p.lat,
    p.lng,
    (
      select coalesce(
        (select ph.external_url from public.place_photos ph
           where ph.place_id = p.id and ph.external_url is not null
           order by ph.sort_order limit 1),
        (select storage.filename(ph.storage_path) from public.place_photos ph
           where ph.place_id = p.id and ph.storage_path is not null
           order by ph.sort_order limit 1)
      )
    ) as primary_photo_path,
    p.updated_at
  from public.places p
  join public.categories c on c.id = p.category_id
  where p.status = 'approved' and p.featured = true;

comment on view public.featured_places is
  'Stable, public, read-only shape for external consumers (e.g. the future Ishikawa/Toyama homepage rotating banner). Treat its columns as an API contract: add columns freely, avoid renaming/removing them once another site depends on it.';
