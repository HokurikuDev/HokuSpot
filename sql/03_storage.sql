-- ============================================================================
-- Hokuriku Spots — Storage bucket for uploaded photos
-- ============================================================================
-- Run AFTER 01_schema.sql and 02_policies.sql.
-- Creates the 'place-photos' bucket used when a submitter uploads a photo
-- directly (as opposed to pasting an external URL — both are supported,
-- see place_photos table).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'place-photos',
  'place-photos',
  true,                          -- publicly readable URLs (needed for the map cards
                                  -- and the future homepage banner to hotlink images)
  8388608,                       -- 8 MB per file
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Anyone can VIEW photos (bucket is public, but we also add an explicit
-- policy so behavior is documented and doesn't depend solely on the
-- bucket-level public flag).
create policy "Public read access to place photos"
  on storage.objects for select
  using (bucket_id = 'place-photos');

-- Only authenticated users can upload, and only into a folder named after
-- their own user id (auth.uid()/filename.jpg) — this is the standard
-- Supabase Storage pattern for per-user upload isolation and stops one
-- user from overwriting or filling another user's path.
create policy "Authenticated users can upload their own photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'place-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own uploaded photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'place-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
