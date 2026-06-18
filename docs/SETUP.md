# Hokuriku Spots — Setup Guide

A community map of tourist spots, abandoned places, interesting roads, and
other points of interest across **Ishikawa** and **Toyama
Prefecture**, Japan. Built to run entirely on **GitHub Pages** (static
hosting, no server) with **Supabase** as the backend (auth, database,
storage) and **MapTiler + MapLibre GL** for the map itself.

---

## How it's architected, and why

GitHub Pages can only serve static files — no server-side code, no
traditional database connection. So the entire data layer lives in
**Supabase**, which is reachable directly from client-side JavaScript using
a public "anon" key. That key is *meant* to be public; it's safe to commit.
Security is enforced by **Postgres Row-Level Security (RLS) policies**
(`sql/02_policies.sql`), not by hiding the key. Every table has RLS enabled
and was tested against 17 real access-control scenarios — see
`sql/test/rls_tests.sql` if you want to re-run or extend them.

```
Browser (GitHub Pages)
  │
  ├── MapLibre GL  ──────►  MapTiler (vector tiles, needs a free API key)
  │
  └── Supabase JS SDK ───►  Supabase (Postgres + PostGIS, Auth, Storage)
                              - RLS policies gate every read/write
                              - "places" start as status=pending
                              - moderators/admins approve before public display
```

The **`featured_places`** database view (defined in `sql/01_schema.sql`)
exists specifically so a *future* separate website (the planned
Ishikawa/Toyama homepage with a rotating banner) can query approved,
featured places directly over Supabase's REST API, without sharing any
code with this repo. Treat its columns as a stable contract once another
site depends on it.

---

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project. Free tier is
   sufficient to start.
2. Once created, open **Project Settings → API**. You'll need:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon public** key (NOT the `service_role` key — never use that one
     in frontend code)
3. Open the **SQL Editor** in the Supabase dashboard and run the files in
   `sql/` **in this exact order**:
   1. `01_schema.sql` — tables, indexes, the `featured_places` view
   2. `02_policies.sql` — Row-Level Security policies (the actual security layer)
   3. `03_storage.sql` — the `place-photos` storage bucket + its policies

      > **If this errors with `policy ... already exists`**, it means an
      > earlier partial run already created the storage policies (this is a
      > known Supabase quirk: the SQL Editor's role often can't `INSERT INTO
      > storage.buckets` due to that table's own RLS, even though the
      > `CREATE POLICY` statements below it succeed independently). Run
      > `03a_storage_fixup.sql` first to drop the three storage policies
      > cleanly, then re-run `03_storage.sql`. If the bucket insert keeps
      > silently not taking effect, create the bucket manually instead:
      > **Storage → New bucket → name it exactly `place-photos` → toggle
      > Public ON** — then re-run `03_storage.sql` so just the policies
      > apply (the bucket insert uses `on conflict do nothing`, so it's safe
      > to run again once the bucket exists).
   4. `04_seed.sql` *(optional)* — a handful of real, well-known landmarks
      so the map isn't empty on first load

   Each file is idempotent-ish but designed to run once, in order, on a
   fresh project. If you need to start over, drop the tables first.

4. **Enable email auth**: Authentication → Providers → make sure "Email" is
   enabled (it is by default). Decide whether to require email
   confirmation (Authentication → Settings) — for a small invite-only
   group you may want to turn confirmation off for faster onboarding.

5. **Promote yourself to moderator/admin** so you can approve submissions.
   After you sign up once through the live site, run this in the SQL
   Editor (replace the email):
   ```sql
   update public.profiles
   set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

   > **Order matters here.** This `update` matches zero rows — silently,
   > with no error — if you run it *before* actually signing up through
   > the app. Sign up first (create an account via the live site's "Sign
   > in" → "Create account" with a password you choose and will remember),
   > *then* run this. To check it actually worked:
   > ```sql
   > select display_name, role from public.profiles where role != 'user';
   > ```
   > should return your row. An empty result means the `update` matched
   > nothing — double-check the email is spelled exactly as you signed up
   > with, then re-run.

---

## 2. Get a MapTiler key

1. Sign up free at [maptiler.com](https://cloud.maptiler.com/).
2. Go to **Account → API Keys**, copy your key.
3. **Restrict the key to your domain**: API Keys → (your key) → Allowed
   URLs → add `https://yourusername.github.io/*` (and `http://localhost:*`
   while developing locally). This stops other sites from burning your
   free quota using your key, since the key is visible in your page source.

---

## 3. Configure the app

Edit `js/config.js`:

```js
const CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',       // from step 1
  SUPABASE_ANON_KEY: 'eyJ...',                       // from step 1 (anon key)
  MAPTILER_KEY: 'your-maptiler-key',                 // from step 2
  // map center / zoom / bounds can stay as-is, or adjust to taste
};
```

This file is safe to commit — see the comment block inside it for why.

---

## 4. Run locally before deploying

No build step is needed, but opening `index.html` directly via `file://`
will break some browser APIs. Serve it over HTTP instead:

```bash
cd hokuriku-map
python3 -m http.server 8080
# then open http://localhost:8080
```

Confirm:
- The map loads and is centered on Ishikawa/Toyama
- Category filter chips appear along the bottom
- "Sign in" lets you create an account and sign in
- "+ Add a place" lets you drop a pin and submit (it should NOT appear on
  the public map yet — check Supabase's Table Editor, `places` table,
  status should be `pending`)
- After promoting yourself to admin/moderator (step 1.5) and refreshing,
  a "Review queue" button appears; approving a place makes it visible

---

## 5. Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Repo → **Settings → Pages** → Source: deploy from branch → pick `main`
   (or `master`) and the `/ (root)` folder.
3. Your site will be live at `https://yourusername.github.io/repo-name/`.
4. Go back to MapTiler and add that exact URL (with `/*`) to the key's
   allowed domains if you haven't already.

That's it — no build pipeline, no server to maintain.

---

## Project structure

```
index.html                 Entry point
css/
  tokens.css                Design tokens (colors, type, spacing)
  layout.css                Map shell, header, category filter bar
  panel.css                 Place detail slide-in panel
  modal.css                 Auth modal, submission form, moderation queue, toasts
js/
  config.js                  Supabase/MapTiler keys, map defaults — EDIT THIS
  supabase-client.js         All database/auth/storage calls in one place
  categories.js              Category metadata cache (DB-backed, with fallback)
  map.js                     MapLibre map controller, clustering, markers
  ui.js                      Auth modal, place detail card, submission form, moderation
  app.js                     Entry point wiring it all together
sql/
  01_schema.sql               Tables, indexes, featured_places view
  02_policies.sql             Row-Level Security policies (the security layer)
  03_storage.sql              Photo storage bucket + its policies
  04_seed.sql                 Optional real-landmark seed data
  test/                       Local test harness (Postgres stub + RLS test scenarios)
test/                        Node-based functional + e2e tests (see TESTING.md)
docs/
  SETUP.md                    This file
  MODERATION.md               How the review/approval workflow works
  ROADMAP.md                  Notes on the future cross-site banner integration
```

---

## Adding/editing categories

Categories are fixed (per the project's design) but live in the database,
not hardcoded in JavaScript, so you can add or restyle one without
touching the frontend:

```sql
insert into public.categories (id, label_en, label_ja, color, icon, sort_order)
values ('festival', 'Festival Site', '祭り会場', '#9B5DE5', 'sparkles', 9);
```

The frontend re-fetches categories on load (`js/categories.js`) and falls
back to a hardcoded list only if the database is briefly unreachable.

## Roles and moderation

Roles (`user`, `moderator`, `admin`) live on `public.profiles.role`. There's
intentionally no single hardcoded admin — promote anyone via SQL as shown
in step 1.5. Both `moderator` and `admin` can approve/reject/feature
places and view the report queue; the two roles are currently equivalent
in permissions, giving you room to differentiate them later (e.g.
restricting category management to `admin` only) without a schema change.
