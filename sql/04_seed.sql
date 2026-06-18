-- ============================================================================
-- Hokuriku Spots — Seed Data (OPTIONAL)
-- ============================================================================
-- Populates a handful of real, well-known, already-public landmarks so the
-- map isn't empty on first run. This is just test/demo data — delete or
-- replace freely. All places here are inserted directly as 'approved' since
-- they bypass the normal user-submission flow (there is no created_by user).
--
-- Run AFTER 01_schema.sql, 02_policies.sql, and 03_storage.sql.
-- ============================================================================

insert into public.places
  (name, description, highlights, address, category_id, lat, lng, status, featured)
values
  (
    'Chirihama Nagisa Driveway',
    'An 8 km stretch of beach in Hakui where the sand is packed firm enough to drive a car on — the only beach driveway of its kind in Japan.',
    'Open year-round and free of charge except in rough weather. Sunset drives along the Sea of Japan are the main draw; the hard-packed sand supports cars, buses, and even bicycles.',
    'Imahama, Hodatsushimizu-cho, Hakui, Ishikawa',
    'road',
    36.9209, 136.8136,
    'approved', true
  ),
  (
    'Keta Taisha Shrine',
    'A Shinto shrine in Hakui said to have been founded roughly 2,000 years ago, dedicated to Okuninushi-no-mikoto.',
    'The inner shrine sits within a sacred grove called the "Forbidden Forest," a designated National Natural Monument that is not open for entry — viewed from the approach only.',
    'Jike Town, Hakui, Ishikawa',
    'historic',
    36.8847, 136.7894,
    'approved', true
  ),
  (
    'Cosmo Isle Hakui',
    'A small space and UFO museum in Hakui — fitting for a city known for having some of the highest reported UFO sighting rates in Japan.',
    'Houses genuine flown spacecraft replicas/hardware and bilingual exhibits. Hakui leans into its "UFO town" identity with related statues and signage around the city.',
    'Menden, Tsurugi-machi, Hakui, Ishikawa',
    'tourist',
    36.8916, 136.7847,
    'approved', false
  ),
  (
    'The World''s Longest Bench',
    'A Guinness-recognized 460.9 m wooden bench running along the Masuhogaura Coast in Shika Town, Hakui District.',
    'Faces west over the Sea of Japan — known locally as a sunset-watching spot, built and maintained by local volunteers.',
    'Aigami, Shika Town, Hakui District, Ishikawa',
    'nature',
    36.8264, 136.7444,
    'approved', false
  ),
  (
    'Toyama Castle',
    'A reconstructed castle in the heart of Toyama City, originally built in the 16th century, now housing a small history museum.',
    'The surrounding Toyama Castle Park is a popular cherry blossom spot in spring and sits walkably close to Toyama Station.',
    '1-62 Marunouchi, Toyama, Toyama Prefecture',
    'historic',
    36.6953, 137.2137,
    'approved', false
  ),
  (
    'Amaharashi Coast',
    'A coastal viewpoint in Toyama famous for clear-day views of the snow-capped Tateyama mountain range rising directly behind the sea.',
    'One of Japan''s "Top 100 Sunset Spots" — best visited at dawn or dusk, particularly in winter when the mountains are snow-covered.',
    'Takaoka, Toyama Prefecture',
    'nature',
    36.8167, 137.0500,
    'approved', true
  )
on conflict do nothing;

-- Attach a couple of illustrative tags to demonstrate the tag system.
-- (Skipped safely if the places above weren't inserted, e.g. on a re-run.)
insert into public.tags (label) values
  ('sunset'), ('free-entry'), ('car-accessible'), ('photography'), ('seasonal')
on conflict (label) do nothing;

insert into public.place_tags (place_id, tag_id)
select p.id, t.id
from public.places p, public.tags t
where p.name = 'Chirihama Nagisa Driveway' and t.label in ('sunset', 'free-entry', 'car-accessible')
on conflict do nothing;

insert into public.place_tags (place_id, tag_id)
select p.id, t.id
from public.places p, public.tags t
where p.name = 'Amaharashi Coast' and t.label in ('sunset', 'photography', 'seasonal')
on conflict do nothing;
