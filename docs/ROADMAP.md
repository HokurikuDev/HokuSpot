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

- **Reports inbox in the moderation UI** — currently you'd check the
  `place_reports` table directly in Supabase; see `docs/MODERATION.md`.
- **"Unpublish" button for already-approved places** — currently a manual
  Table Editor edit; `Api.rejectPlace()` already supports being called on
  approved places per RLS, just needs a UI affordance. (Note: a moderator
  *editing* an approved place's content is now built — see below — this
  item is specifically about taking a place off the public map entirely.)
- **Tag moderation** — see the note at the bottom of `docs/MODERATION.md`.
- **i18n** — category labels already have a `label_ja` column in the
  database (currently unused by the frontend, which only renders
  `label_en`). A language toggle could read that column with no schema
  change.

## Done since the original v1 build

- **"My submissions" screen** — built. Accessible via the "My
  submissions" button in the auth pill. Lists every place you've
  submitted with a status pill (pending / live / not approved) and a
  rejection reason where relevant. Clicking "Edit" on a still-pending
  submission opens the edit form, pre-filled.
- **Editing an already-approved place** — built, as a moderator/admin-only
  action. An "Edit" button appears on the place detail panel only when
  signed in as a moderator or admin (`currentProfile.role !== 'user'` in
  `js/ui.js`). Both this and the "edit your own pending submission" flow
  above share one form (`renderSubmitPanel` in `js/ui.js`) and one Api
  function (`Api.updatePlace`) — the function itself doesn't distinguish
  who's allowed to call it on which place; RLS does (see
  `sql/02_policies.sql`'s "Owners can edit their own pending submissions"
  vs. "Moderators can update any place" policies). Re-dropping the pin,
  changing tags, removing existing photos, and adding new ones are all
  supported in both flows.
