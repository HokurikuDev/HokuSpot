-- ============================================================================
-- Fix-up script: run this FIRST if 03_storage.sql failed with
-- "policy ... already exists", then re-run 03_storage.sql normally.
--
-- This only drops the three storage policies if they exist (safe to run
-- even if some/none of them exist) — it does not touch any table data,
-- the categories/places/tags schema, or the RLS policies on your actual
-- application tables (places, profiles, etc.). Only storage.objects
-- policies for the place-photos bucket are affected.
--
-- NOTE: an earlier version of this script also tried to
-- `delete from storage.buckets`, but Supabase blocks direct deletes on
-- storage tables via a protective trigger (intentional, to prevent
-- orphaned-object data loss) — that statement is removed here. It isn't
-- needed anyway: 03_storage.sql's bucket insert uses
-- `on conflict (id) do nothing`, so a leftover bucket row (if one exists)
-- is harmless to leave in place.
-- ============================================================================

drop policy if exists "Public read access to place photos" on storage.objects;
drop policy if exists "Authenticated users can upload their own photos" on storage.objects;
drop policy if exists "Users can delete their own uploaded photos" on storage.objects;
