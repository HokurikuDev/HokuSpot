// ============================================================================
// moderation-embed.test.js — Confirms the fix for:
//   "Could not embed because more than one relationship was found for
//    'places' and 'profiles'"
//
// Root cause: `places` has two foreign keys into `profiles`
// (created_by and reviewed_by), so PostgREST's embedding shorthand
// `profiles ( display_name )` is ambiguous — it doesn't know which FK to
// follow. Fixed in js/supabase-client.js's getPendingPlaces() by using
// the `profiles!created_by` disambiguation hint.
//
// This test needs no auth — it confirms the QUERY SHAPE itself is valid
// against the live schema (PGRST201 is a planning-time error, returned
// before RLS / row visibility is even evaluated), which is exactly the
// failure the moderation queue UI hit.
//
// Run with: node test/moderation-embed.test.js
// ============================================================================

const SUPABASE_URL = 'https://jmlypmsxrdhooxhpdfsg.supabase.co';
const ANON_KEY = 'sb_publishable_oA_VkjQ3m4ozwZKEL6aExQ_SI6xovcU';

let passed = 0, failed = 0;
function report(name, ok, detail = '') {
  if (ok) { console.log(`  ok  - ${name}`); passed++; }
  else { console.log(`FAIL  - ${name}${detail ? ' :: ' + detail : ''}`); failed++; }
}

async function main() {
  console.log('\nConfirm the OLD ambiguous query genuinely fails this way ----------------');
  const oldRes = await fetch(
    `${SUPABASE_URL}/rest/v1/places?select=id,name,profiles(display_name)&limit=1`,
    { headers: { apikey: ANON_KEY } }
  );
  const oldBody = await oldRes.json();
  report('old unqualified embed fails with PGRST201 (ambiguous relationship)',
    oldRes.status === 300 && oldBody.code === 'PGRST201', `status=${oldRes.status} code=${oldBody.code}`);

  console.log('\nConfirm the FIXED query (profiles!created_by) succeeds -------------------');
  const newUrl = `${SUPABASE_URL}/rest/v1/places?select=id,name,category_id,lat,lng,description,created_at,created_by,profiles!created_by(display_name)&status=eq.pending&order=created_at`;
  const newRes = await fetch(newUrl, { headers: { apikey: ANON_KEY } });
  const newBody = await newRes.json();
  report('fixed query returns 200 (this is the exact query getPendingPlaces() sends)',
    newRes.status === 200, `status=${newRes.status} body=${JSON.stringify(newBody).slice(0,200)}`);
  report('response is an array (not an error object)', Array.isArray(newBody));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
