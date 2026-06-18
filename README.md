# Hokuriku Spots

A community map of tourist spots, abandoned places, interesting roads, and
other points of interest across **Hakui (Ishikawa)** and **Toyama
Prefecture**, Japan — built to run free, forever, on GitHub Pages.

![Map screenshot](test/screenshot-main.png)

## What this is

- A full-bleed, detailed map (MapLibre GL + MapTiler) centered on Hakui and
  Toyama, clean and modern in style, built to hold up at the zoom levels
  rural/countryside spots actually need.
- Anyone can create an account and submit a place — name, category, free
  tags, address, description, "what's interesting about it," and photos
  (either uploaded or pasted as a URL). It shows up as a Google-Maps-style
  detail card.
- Submissions are reviewed by a moderator before they go live on the
  public map.
- A `featured_places` database view is already wired up for a **future**
  separate Ishikawa/Toyama homepage to pull a rotating banner from, with
  no shared code or deploy between the two sites — see
  `docs/ROADMAP.md`.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Hosting | GitHub Pages | Free, static, no server to maintain |
| Backend | Supabase (Postgres + PostGIS) | Reachable directly from client JS; RLS replaces a backend server for access control |
| Map | MapLibre GL + MapTiler | Detailed, free-tier vector tiles; no Mapbox lock-in |
| Auth | Supabase Auth | Email/password, built in, free tier |

No build step, no framework, no bundler — plain HTML/CSS/JS, because the
whole app is a handful of views and a build pipeline would add complexity
GitHub Pages doesn't need.

## Get started

**→ [docs/SETUP.md](docs/SETUP.md)** walks through creating the Supabase
project, getting a MapTiler key, running the SQL, and deploying.

Other docs:
- [docs/MODERATION.md](docs/MODERATION.md) — how the review/approval workflow works day to day
- [docs/ROADMAP.md](docs/ROADMAP.md) — the future cross-site banner integration, and what's deliberately left for later
- [docs/TESTING.md](docs/TESTING.md) — how to re-run the test suite, and a record of real bugs it caught

## Project structure

```
index.html                  Entry point — open this (via a local server, not file://)
css/                         tokens.css, layout.css, panel.css, modal.css
js/                          config.js (← edit with your keys), supabase-client.js,
                              categories.js, map.js, ui.js, app.js
sql/                         01_schema.sql → 02_policies.sql → 03_storage.sql → 04_seed.sql
                              (run in that order in the Supabase SQL Editor)
                              sql/test/ — local Postgres test scaffolding, never run against
                              your real Supabase project
test/                        Node + Playwright tests — see docs/TESTING.md
docs/                        SETUP.md, MODERATION.md, ROADMAP.md, TESTING.md
```

## Status

Schema, security policies, and frontend were all built with tests run
against real software (a local Postgres+PostGIS instance, a real headless
Chromium) rather than just written and assumed correct — see
`docs/TESTING.md` for what was actually verified and two real bugs the
tests caught along the way.

**This copy is already wired to a live Supabase project and MapTiler key**
(`js/config.js` has real values, not placeholders) — confirmed working via
`test/live-check.test.js` against the real backend; see
`test/screenshot-live.png` for what that looks like. The SQL files have
already been run against that project.

**Before deploying, you still need to:**
1. Sign up through the live site with an account/password *you* choose
   and know (don't reuse credentials anyone else generated for testing).
2. Promote that account to `moderator` or `admin` in the Supabase SQL
   Editor so you can approve submissions — see `docs/SETUP.md` step 1.5
   for the exact command and a note about a silent-failure trap if you
   run it before signing up.
3. Push this repo to GitHub and enable Pages (Settings → Pages → deploy
   from branch). No build step needed.
4. Once you know your Pages URL, add it to the MapTiler key's allowed
   domains (cloud.maptiler.com → API Keys) so the key keeps working in
   production and isn't open to quota theft from other sites.

All covered step-by-step in `docs/SETUP.md`.
