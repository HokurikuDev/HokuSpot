-- ============================================================================
-- RLS BEHAVIOR TESTS — run as app_test_user (non-superuser, RLS-enforced)
-- ============================================================================
-- Each block sets the simulated logged-in user via test.uid, then runs a
-- query/command and prints what happened. Expected outcomes are noted
-- inline with [EXPECT: ...] so failures are obvious.
-- ============================================================================

\echo '=== TEST 1: Anonymous (logged out) visitor reads places ==='
select set_config('test.uid', '', false);
select set_config('test.role', 'anon', false);
select name, status from public.places order by name;
-- [EXPECT: only the 6 approved seed places, no pending rows since none exist yet]

\echo ''
\echo '=== TEST 2: Alice inserts a new pending place (should succeed) ==='
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.role', 'authenticated', false);
insert into public.places (name, description, category_id, lat, lng, created_by)
values ('Alice''s Secret Spot', 'A cool abandoned building', 'haikyo', 36.70, 137.20, auth.uid())
returning id, name, status, featured;
-- [EXPECT: 1 row inserted, status forced to 'pending', featured forced to false]

\echo ''
\echo '=== TEST 3: Alice tries to insert a place that is pre-approved (should FAIL the with-check, forced to pending instead — verify by re-checking) ==='
-- Note: the with-check in the insert policy requires status='pending' literally,
-- so an attempt to insert status='approved' should be REJECTED outright, not silently corrected.
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
insert into public.places (name, category_id, lat, lng, created_by, status)
values ('Alice Tries To Skip Review', 'tourist', 36.71, 137.21, auth.uid(), 'approved');
-- [EXPECT: ERROR — new row violates row-level security policy]

\echo ''
\echo '=== TEST 4: Anonymous visitor should NOT see Alice''s pending place ==='
select set_config('test.uid', '', false);
select set_config('test.role', 'anon', false);
select name, status from public.places where name = 'Alice''s Secret Spot';
-- [EXPECT: 0 rows — pending places are invisible to anon]

\echo ''
\echo '=== TEST 5: Alice CAN see her own pending place ==='
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.role', 'authenticated', false);
select name, status from public.places where name = 'Alice''s Secret Spot';
-- [EXPECT: 1 row — owners can see their own pending submissions]

\echo ''
\echo '=== TEST 6: Bob (different user) should NOT see Alice''s pending place ==='
select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
select name, status from public.places where name = 'Alice''s Secret Spot';
-- [EXPECT: 0 rows — other regular users cannot see someone else's pending submission]

\echo ''
\echo '=== TEST 7: Bob tries to EDIT Alice''s pending place (should affect 0 rows) ==='
update public.places set name = 'Bob Hijacked This' where name = 'Alice''s Secret Spot';
select name from public.places where id in (select id from public.places where created_by = '11111111-1111-1111-1111-111111111111'::uuid);
-- [EXPECT: UPDATE 0 — Bob cannot modify Alice's place; name remains unchanged]

\echo ''
\echo '=== TEST 8: Alice tries to self-approve her own place ==='
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
update public.places set status = 'approved' where name = 'Alice''s Secret Spot';
select name, status from public.places where name = 'Alice''s Secret Spot';
-- [EXPECT: UPDATE 0 (blocked by with-check status=pending) — status remains 'pending']

\echo ''
\echo '=== TEST 9: Alice tries to self-feature her own place ==='
update public.places set featured = true where name = 'Alice''s Secret Spot';
select name, featured from public.places where name = 'Alice''s Secret Spot';
-- [EXPECT: UPDATE 0 — featured remains false]

\echo ''
\echo '=== TEST 10: Moderator (Moe) CAN see Alice''s pending place ==='
select set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
select name, status from public.places where name = 'Alice''s Secret Spot';
-- [EXPECT: 1 row — moderators see all places regardless of status]

\echo ''
\echo '=== TEST 11: Moderator approves Alice''s place ==='
update public.places set status = 'approved' where name = 'Alice''s Secret Spot';
select name, status from public.places where name = 'Alice''s Secret Spot';
-- [EXPECT: UPDATE 1 — moderators CAN change status; now 'approved']

\echo ''
\echo '=== TEST 12: Now-approved place IS visible to anonymous visitors ==='
select set_config('test.uid', '', false);
select set_config('test.role', 'anon', false);
select name, status from public.places where name = 'Alice''s Secret Spot';
-- [EXPECT: 1 row — newly approved places become publicly visible]

\echo ''
\echo '=== TEST 13: Alice can no longer edit her place now that it is approved ==='
select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
select set_config('test.role', 'authenticated', false);
update public.places set name = 'Alice Edits After Approval' where name = 'Alice''s Secret Spot';
select name, status from public.places where created_by = '11111111-1111-1111-1111-111111111111'::uuid;
-- [EXPECT: UPDATE 0 — owners can only edit while status='pending']

\echo ''
\echo '=== TEST 14: Anonymous visitor CANNOT insert a place at all ==='
select set_config('test.uid', '', false);
select set_config('test.role', 'anon', false);
insert into public.places (name, category_id, lat, lng) values ('Anon Spot', 'other', 36.5, 137.0);
-- [EXPECT: ERROR — new row violates row-level security policy (no anon insert policy exists)]

\echo ''
\echo '=== TEST 15: Regular user (Bob) cannot read place_reports (moderator-only) ==='
select set_config('test.uid', '22222222-2222-2222-2222-222222222222', false);
select set_config('test.role', 'authenticated', false);
insert into public.place_reports (place_id, reported_by, reason)
select id, auth.uid(), 'test report' from public.places limit 1;
select count(*) from public.place_reports;
-- [EXPECT: insert succeeds (1 row), but the subsequent SELECT returns 0 —
--  Bob can file a report but cannot browse the report queue]

\echo ''
\echo '=== TEST 16: Moderator CAN read place_reports ==='
select set_config('test.uid', '33333333-3333-3333-3333-333333333333', false);
select count(*) from public.place_reports;
-- [EXPECT: 1 — moderators can see the report Bob just filed]

\echo ''
\echo '=== TEST 17: featured_places view only shows approved+featured, readable by anon ==='
select set_config('test.uid', '', false);
select set_config('test.role', 'anon', false);
select name, category_label from public.featured_places order by name;
-- [EXPECT: only places with status=approved AND featured=true from seed data
--  (Amaharashi Coast, Chirihama Nagisa Driveway, Keta Taisha Shrine) —
--  Alice's place should NOT appear since featured=false]

\echo ''
\echo '=== ALL TESTS COMPLETE ==='
