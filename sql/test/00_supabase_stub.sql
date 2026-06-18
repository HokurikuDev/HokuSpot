-- ============================================================================
-- LOCAL TEST SCAFFOLDING ONLY — NOT PART OF THE REAL DEPLOYMENT
-- ============================================================================
-- Supabase projects come with built-in `auth` and `storage` schemas plus
-- helper functions like auth.uid(). Vanilla Postgres (this local test db)
-- has none of that. This file stubs the minimum needed so 01_schema.sql,
-- 02_policies.sql, and 03_storage.sql can actually execute and be verified
-- locally, mirroring real Supabase shapes closely enough to catch syntax
-- and logic errors before deploying to a real Supabase project.
-- ============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

create schema if not exists auth;
create schema if not exists storage;

-- Minimal stand-in for Supabase's auth.users
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Supabase's auth.uid() reads the JWT claim of the current request.
-- Locally we fake it with a settable session variable so we can simulate
-- "logged in as user X" by running: select set_config('test.uid', '<uuid>', false);
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(current_setting('test.role', true), 'anon');
$$;

-- Minimal stand-in for Supabase Storage tables used by 03_storage.sql
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);

create or replace function storage.foldername(name text) returns text[]
language sql immutable
as $$
  select string_to_array(name, '/');
$$;

create or replace function storage.filename(name text) returns text
language sql immutable
as $$
  select name;
$$;

-- Supabase roles used by RLS policies ("to authenticated", "to anon").
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
end $$;

-- Real Supabase projects grant USAGE on auth/storage schemas (and EXECUTE
-- on auth.uid()/auth.role()) to authenticated/anon by default so policies
-- like `using (auth.uid() = created_by)` work inside RLS-enforced queries.
-- Replicate that here or every policy calling auth.uid() will fail locally
-- with "permission denied for schema auth" even though the policy logic
-- itself is correct.
grant usage on schema auth to authenticated, anon;
grant usage on schema storage to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant execute on function auth.role() to authenticated, anon;
