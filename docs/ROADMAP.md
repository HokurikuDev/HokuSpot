# Roadmap Notes

Things intentionally designed for, but not yet built.

---

## The future Ishikawa/Toyama homepage banner

You mentioned this site will eventually link to a separate homepage for
Ishikawa and Toyama, which will show a rotating banner pulling from
interesting places on this map. Here's what's already in place for that,
and what the other site's developer (maybe future-you) will need to do.

### What's already built

- **`public.featured_places`** — a database view (defined in
  `sql/01_schema.sql`) that exposes only `status = 'approved' AND
  featured = true` places, with a deliberately narrow, stable column set:
  `id, name, description, highlights, address, category_id,
  category_label, category_color, lat, lng, primary_photo_path,
  updated_at`.
- It's **publicly readable with no authentication** — granted to both
  `anon` and `authenticated` roles. Any website can query it directly over
  Supabase's REST API using only the same public anon key already in
  `js/config.js`.
- Moderators mark a place as featured via the "Approve & feature" button
  in the Review queue (see `docs/MODERATION.md`).

### How the other site would consume it

A plain `fetch()` call, no SDK required:

```js
const res = await fetch(
  'https://YOUR-PROJECT-REF.supabase.co/rest/v1/featured_places?select=*',
  { headers: { apikey: 'YOUR-PUBLIC-ANON-KEY' } }
);
const featured = await res.json();
// featured is an array of place objects, ready to render into a banner/carousel
```

Or, for a random rotating selection server-side-free, add `&order=random()`
— though Postgres's `random()` ordering via PostgREST needs to be exposed
through a custom RPC function rather than a raw query param; the simplest
approach for a "rotating" banner is usually to fetch all featured places
once (there likely won't be many) and rotate through them client-side with
a `setInterval`.

### What that other site will need from you

- The same `SUPABASE_URL` and `SUPABASE_ANON_KEY` from this project's
  `js/config.js` — they're public by design, safe to reuse in another
  static site.
- Nothing else. No shared code, no shared deploy, no API to coordinate
  versioning on — that was the point of putting a stable view in front of
  the raw tables instead of having the other site query `places` directly.

### If you add columns later

Treat `featured_places`'s existing columns as a contract once another site
depends on it: adding new columns is safe and won't break the other site;
renaming or removing existing ones will. If you need to reshape it
significantly, consider creating a new view (e.g. `featured_places_v2`)
rather than changing this one out from under a consumer you may not be
actively watching.

---

## Smaller things worth doing eventually, not done yet

These weren't asked for explicitly, so they're deliberately left out of
the v1 build, but the schema/architecture already accommodates them:

- **"My submissions" screen** — `Api.getMySubmissions()` already exists in
  `js/supabase-client.js` and returns a user's own places with their
  status and rejection reason; there's just no UI screen wired up to call
  it yet. Would slot naturally next to the existing auth-pill dropdown.
- **Reports inbox in the moderation UI** — currently you'd check the
  `place_reports` table directly in Supabase; see `docs/MODERATION.md`.
- **"Unpublish" button for already-approved places** — currently a manual
  Table Editor edit; `Api.rejectPlace()` already supports being called on
  approved places per RLS, just needs a UI affordance.
- **Editing an approved place** — right now only moderators can edit a
  place once it's approved (by design, see `sql/02_policies.sql`). A
  "suggest an edit" flow (storing a proposed diff for moderator approval,
  rather than allowing direct edits) would fit the same approval pattern
  already used for new submissions.
- **Tag moderation** — see the note at the bottom of `docs/MODERATION.md`.
- **i18n** — category labels already have a `label_ja` column in the
  database (currently unused by the frontend, which only renders
  `label_en`). A language toggle could read that column with no schema
  change.
