# Testing

This project was built with tests at every layer, not just eyeballed.
Here's how to re-run them after making changes.

## 1. Database / RLS tests (the most important ones)

Since this app has no backend server, **Postgres Row-Level Security is the
entire access-control layer**. These tests run the real SQL files against
a real local Postgres+PostGIS instance and verify actual access-control
behavior (not just that the SQL compiles).

Requires: Postgres 16 + PostGIS installed locally (`apt-get install
postgresql postgresql-contrib postgis postgresql-16-postgis-3` on
Debian/Ubuntu).

```bash
# One-time setup
sudo service postgresql start
sudo -u postgres createdb hokuriku_test

# Load schema + policies + storage + seed data, in order
sudo -u postgres psql -d hokuriku_test -f sql/test/00_supabase_stub.sql
sudo -u postgres psql -d hokuriku_test -f sql/01_schema.sql
sudo -u postgres psql -d hokuriku_test -f sql/02_policies.sql
sudo -u postgres psql -d hokuriku_test -f sql/03_storage.sql
sudo -u postgres psql -d hokuriku_test -f sql/04_seed.sql

# Create test users + a restricted (non-superuser) role that RLS
# actually applies to — see sql/test/rls_tests.sql header comment
# for why testing as a superuser would be meaningless.
sudo -u postgres psql -d hokuriku_test -c "
  insert into auth.users (id, email) values
    ('11111111-1111-1111-1111-111111111111', 'alice@test.com'),
    ('22222222-2222-2222-2222-222222222222', 'bob@test.com'),
    ('33333333-3333-3333-3333-333333333333', 'modmoe@test.com');
  update public.profiles set role = 'moderator' where display_name = 'modmoe';
  create role app_test_user nosuperuser login;
  grant authenticated to app_test_user;
  grant anon to app_test_user;
  grant usage on schema public to app_test_user;
  grant select, insert, update, delete on all tables in schema public to app_test_user;
  grant select on public.featured_places to app_test_user;
  grant usage, select on all sequences in schema public to app_test_user;
"

# Run the 17 scenario tests
echo "set role app_test_user;" > /tmp/run.sql
cat sql/test/rls_tests.sql >> /tmp/run.sql
sudo -u postgres psql -d hokuriku_test -f /tmp/run.sql
```

Read the `[EXPECT: ...]` comments in `sql/test/rls_tests.sql` next to each
query's output to confirm behavior — anonymous read scoping, ownership
checks, self-approval/self-featuring being blocked, moderator override,
and the `featured_places` view's filtering are all covered.

`sql/test/00_supabase_stub.sql` is **local test scaffolding only** — it
fakes the `auth`/`storage` schemas that a real Supabase project provides
automatically, so the real schema/policy files can be exercised locally
before ever touching a live project. It is never run against your actual
Supabase project.

## 2. Frontend functional tests (Node, mocked Supabase SDK)

These load the *actual* shipped files in `js/` (via Node's `vm` module,
not a reimplementation) against an in-memory mock of the Supabase client,
catching logic bugs like wrong field names or bad payload shapes.

```bash
node test/api.test.js          # 11 tests — supabase-client.js
node test/categories.test.js   # 5 tests — categories.js
```

## 3. End-to-end browser tests (Playwright, real Chromium)

These load the real `index.html` in a headless browser with network calls
to Supabase/MapTiler intercepted and faked, and check actual DOM behavior:
the map canvas renders, filter chips populate and respond to clicks, the
auth modal opens/closes and switches tabs correctly, etc.

```bash
npm install --no-save playwright
npx playwright install --with-deps chromium   # one-time browser download

# Serve the app and run the test in the SAME shell command/session —
# background processes started in a separate command may not be reachable
# by a subsequent one depending on your environment's process isolation.
(python3 -m http.server 8080 --bind 127.0.0.1 &) ; sleep 1.5 ; node test/e2e.test.js
```

### Pin-drop interaction test

A dedicated test reproduces the "Add a place" pin-picking flow click by
click — this is the test that caught the bug described below, and it's
worth re-running after any change to `js/map.js`'s `startPinPicker`/
`stopPinPicker` or the submit-panel markup in `js/ui.js`:

```bash
(python3 -m http.server 8080 --bind 127.0.0.1 &) ; sleep 1.5 ; node test/pin-drop.test.js
```

### Moderation queue embed test

Confirms the moderation queue's `places`-to-`profiles` join resolves
correctly against the live database. Needs no auth and makes no writes —
safe to run anytime:

```bash
node test/moderation-embed.test.js
```

## 5. Live backend check (against your real Supabase project, once configured)

Unlike the e2e test above, this one makes **no mocked network calls** — it
loads `index.html` with whatever real `js/config.js` values are currently
in place and confirms the actual deployed stack works: real MapTiler
tiles, real category/place data from your Supabase project, real auth
endpoint reachability.

```bash
(python3 -m http.server 8080 --bind 127.0.0.1 &) ; sleep 1.5 ; node test/live-check.test.js
```

Run this once after filling in `js/config.js` and before pushing to GitHub
Pages, to catch config typos or RLS misconfigurations before they show up
as a blank map in production. `test/screenshot-live.png` is a saved
example of what a successful run looks like.

## 6. Visual review

`test/screenshot.js` drives the same mocked setup as the e2e test but
saves PNG screenshots instead of asserting — useful after any CSS change
to eyeball the result instead of guessing from source.

```bash
(python3 -m http.server 8080 --bind 127.0.0.1 &) ; sleep 1.5 ; node test/screenshot.js
# outputs: test/screenshot-main.png, screenshot-zoomed.png,
#          screenshot-detail-panel.png, screenshot-auth-modal.png
```

## Bugs this test suite actually caught while building

Kept here as evidence the tests are doing real work, not just padding:

1. **`categories.js`** — the `loaded` flag was never set to `true` on the
   error/fallback path, so `Categories.isLoaded()` incorrectly reported
   `false` even after a completed (fallback) load attempt.
2. **`css/modal.css`** — `.stack { display: flex }` silently overrode the
   `[hidden]` attribute on the sign-up form (a class selector beating an
   attribute selector of equal specificity via source order), so switching
   to the "Create account" tab didn't actually hide the sign-in form. Only
   visible by actually rendering the DOM and checking computed styles —
   invisible from reading the code.
3. **RLS policy gap during stub-writing** (not a real schema bug, but
   worth noting): the local test stub initially didn't grant `usage` on
   the `auth` schema to `authenticated`/`anon`, causing every policy
   calling `auth.uid()` to fail with a permission error — a reminder that
   real Supabase grants this by default, so the *stub* needed fixing to
   match reality, not the policies themselves.
4. **"Add a place" pin-dropping didn't work at all** — the submission
   form originally opened inside `#modal-root`, a full-screen
   `position: fixed; inset: 0` overlay sitting at a higher z-index than
   the map. The instructions said "click the map to drop a pin," but the
   map was completely covered by the modal backdrop, so there was no way
   for a click to ever reach it. Fixed by moving the form into its own
   slide-in side panel (`#submit-panel`, same pattern as the existing
   place-detail panel) that leaves the map visible and clickable beside
   it. A second, related bug in the original code — two stacked map click
   listeners (`map.once` plus a `map.on` "re-armer") — was replaced with a
   single owned listener via `MapController.startPinPicker()`. Caught and
   verified fixed by `test/pin-drop.test.js`, which simulates real mouse
   clicks at screen coordinates and checks the marker/readout update —
   this class of bug (an overlay silently blocking input) is invisible to
   unit tests and only shows up when something actually clicks the page.
5. **Moderation queue failed with "Could not embed because more than one
   relationship was found for 'places' and 'profiles'"** — `places` has
   two foreign keys into `profiles` (`created_by` and `reviewed_by`), so
   PostgREST's embedding shorthand `profiles ( display_name )` in
   `getPendingPlaces()` was ambiguous: it had two valid paths to follow
   and refused to guess. Fixed by disambiguating with
   `profiles!created_by ( display_name )`. This only ever surfaces once a
   table has more than one FK to the same related table — the seed data
   (inserted directly via SQL with no `created_by`) never exercised this
   path, which is why it wasn't caught until a real user submission went
   through the moderation queue. `test/moderation-embed.test.js` reproduces
   the exact PGRST201 error against the live database and confirms the
   fixed query resolves it, without needing a real authenticated session.
