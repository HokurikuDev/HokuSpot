// ============================================================================
// edit-flows-visual.test.js — Drives both edit flows through REAL clicks,
// as a simulated logged-in moderator, and saves screenshots. This is the
// complement to edit-flows.test.js: that file checks the Api layer
// directly; this one checks the actual DOM path a person would use.
//
// Run with: (python3 -m http.server 8080 --bind 127.0.0.1 &) ; sleep 1.5 ; node test/edit-flows-visual.test.js
// ============================================================================

const { chromium } = require('playwright');

const FAKE_CATEGORIES = [
  { id: 'tourist', label_en: 'Tourist Spot', color: '#3B7A57', icon: 'landmark', sort_order: 1 },
  { id: 'haikyo', label_en: 'Abandoned Place', color: '#8B5E3C', icon: 'door-open', sort_order: 2 },
];

const FAKE_SESSION = {
  access_token: 'fake-token', token_type: 'bearer', expires_in: 3600,
  refresh_token: 'fake-refresh', user: { id: 'mod-user-1', email: 'mod@test.com' },
};
const FAKE_PROFILE = { id: 'mod-user-1', display_name: 'Test Moderator', avatar_url: null, role: 'moderator' };

const MY_SUBMISSIONS = [
  { id: 'place-pending-1', name: 'My Pending Spot', category_id: 'tourist', status: 'pending', rejection_reason: null, created_at: new Date().toISOString() },
  { id: 'place-approved-2', name: 'My Old Approved Spot', category_id: 'haikyo', status: 'approved', rejection_reason: null, created_at: new Date().toISOString() },
];

const PENDING_PLACE_DETAIL = {
  id: 'place-pending-1', name: 'My Pending Spot', description: 'A spot I found',
  highlights: null, address: null, category_id: 'tourist', lat: 36.80, lng: 136.95,
  status: 'pending', featured: false, created_at: new Date().toISOString(), created_by: 'mod-user-1',
  place_photos: [], place_tags: [{ tags: { id: 1, label: 'sunset' } }],
};

const APPROVED_PLACE_DETAIL = {
  id: 'place-approved-1', name: 'Approved Spot', description: 'Already live on the map',
  highlights: null, address: null, category_id: 'tourist', lat: 36.70, lng: 137.10,
  status: 'approved', featured: false, created_at: new Date().toISOString(), created_by: 'someone-else',
  place_photos: [], place_tags: [],
};

let passed = 0, failed = 0;
function report(name, ok, detail = '') {
  if (ok) { console.log(`  ok  - ${name}`); passed++; }
  else { console.log(`FAIL  - ${name}${detail ? ' :: ' + detail : ''}`); failed++; }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.route('**/rest/v1/categories*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_CATEGORIES) }));
  await page.route('**/api.maptiler.com/maps/**/style.json*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [], glyphs: 'http://localhost:8080/__mock-glyphs__/{fontstack}/{range}.pbf' }) }));
  await page.route('**/__mock-glyphs__/**', (route) => route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }));

  await page.route('**/auth/v1/session*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: FAKE_SESSION }) }));
  await page.route('**/auth/v1/user*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_SESSION.user) }));

  await page.route('**/rest/v1/profiles*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_PROFILE) }));
  await page.route('**/rest/v1/place_tags*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/place_photos*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/rest/v1/tags*', (route) => {
    const method = route.request().method();
    if (method === 'POST') return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); // upsert
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 1, label: 'sunset' }]) });
  });

  await page.route('**/rest/v1/places*', (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'PATCH') {
      // Real Supabase, with .select() chained after .update() (as
      // js/supabase-client.js now does), responds 200 with the updated
      // row(s) as a JSON array — not 204/empty.
      const body = route.request().postDataJSON();
      const idMatch = url.match(/id=eq\.([^&]+)/);
      const patchedId = idMatch ? decodeURIComponent(idMatch[1]) : null;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: patchedId, ...body }]),
      });
    }
    if (url.includes('created_by') && !url.includes('place_photos') && url.includes('order=created_at')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MY_SUBMISSIONS) });
    }
    if (url.includes('place-pending-1') && url.includes('place_photos')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PENDING_PLACE_DETAIL) });
    }
    if (url.includes('place_photos')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(APPROVED_PLACE_DETAIL) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.addInitScript(({ session, profile }) => {
    window.__fakeSession = session;
    window.__fakeProfile = profile;
    const patchApi = () => {
      // NOTE: supabase-client.js declares `const Api = {...}` at the top
      // level of a plain <script> tag. Top-level const/let in a classic
      // script do NOT become properties of `window` (unlike `var` or
      // function declarations) — they live in a separate top-level
      // lexical scope that's still shared across script tags on the same
      // page. So `typeof window.Api` is always 'undefined' here; the
      // bare identifier `Api` is what actually resolves once
      // supabase-client.js has run. Polling via a try/catch on the bare
      // name (rather than `typeof window.Api`) is what actually detects
      // it becoming available.
      let exists = false;
      try { exists = typeof Api !== 'undefined'; } catch (e) { exists = false; }
      if (!exists) return false;
      Api.getSession = async () => window.__fakeSession;
      Api.getMyProfile = async () => window.__fakeProfile;
      return true;
    };
    if (!patchApi()) {
      const iv = setInterval(() => { if (patchApi()) clearInterval(iv); }, 1);
    }
  }, { session: FAKE_SESSION, profile: FAKE_PROFILE });

  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1800);

  console.log('\nLogged in as a moderator -------------------------------------------------');
  const userPillVisible = await page.locator('.user-pill').count();
  report('signed-in pill is visible (fake session was picked up)', userPillVisible === 1);

  console.log('\nFlow 1: "My submissions" -> click pending place -> edit form opens -------');
  await page.locator('#btn-my-submissions').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-my-submissions.png' });

  const rowCount = await page.locator('.mod-item').count();
  report('My submissions lists both places', rowCount === 2, `found ${rowCount}`);

  const editButtonsCount = await page.locator('.mod-item button:has-text("Edit")').count();
  report('only the PENDING place has an Edit button (approved one does not)', editButtonsCount === 1, `found ${editButtonsCount}`);

  await page.locator('.mod-item button:has-text("Edit")').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-edit-own-pending.png' });

  const editPanelOpen = await page.locator('#submit-panel.is-open').count();
  report('edit form opens in the side panel', editPanelOpen === 1);

  const nameValue = await page.locator('#form-submit input[name="name"]').inputValue();
  report('form is pre-filled with the existing name', nameValue === 'My Pending Spot', `got "${nameValue}"`);

  const pinReadout = await page.locator('#pin-readout').textContent();
  report('pin readout shows the existing location immediately (not "no location chosen")',
    pinReadout.includes('36.80') || pinReadout.includes('Pinned'), `got "${pinReadout}"`);

  const tagsValue = await page.locator('#form-submit input[name="tags"]').inputValue();
  report('existing tags are pre-filled', tagsValue.includes('sunset'), `got "${tagsValue}"`);

  const saveButtonText = await page.locator('#form-submit button[type="submit"]').textContent();
  report('submit button says "Save changes" in edit mode (not "Submit for review")', saveButtonText.trim() === 'Save changes');

  await page.mouse.click(400, 300);
  await page.waitForTimeout(300);
  await page.locator('#form-submit button[type="submit"]').click();
  await page.waitForTimeout(400);

  const errorVisible = await page.locator('#submit-error').isVisible().catch(() => false);
  const errorText = errorVisible ? await page.locator('#submit-error').textContent() : null;
  if (errorText) console.log('  [diagnostic] submit-error shown:', errorText);

  const panelClosedAfterSave = await page.locator('#submit-panel.is-open').count();
  report('panel closes after saving', panelClosedAfterSave === 0, errorText ? `error shown: ${errorText}` : 'no error shown, but panel still open');

  console.log('\nFlow 2: detail panel Edit button (moderator on an approved place) --------');
  await page.evaluate(() => UI.openPlaceDetail('place-approved-1'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-detail-with-edit-button.png' });

  const editBtnOnDetail = await page.locator('#btn-edit-place').count();
  report('Edit button appears on the detail panel for a moderator', editBtnOnDetail === 1);

  await page.locator('#btn-edit-place').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-edit-approved-place.png' });

  const editPanelOpen2 = await page.locator('#submit-panel.is-open').count();
  report('clicking Edit opens the edit form for the approved place', editPanelOpen2 === 1);

  const nameValue2 = await page.locator('#form-submit input[name="name"]').inputValue();
  report("approved place's form is pre-filled correctly", nameValue2 === 'Approved Spot', `got "${nameValue2}"`);

  const hintText = await page.locator('.submit-panel__body .form-hint').last().textContent();
  report('hint reflects that this place is already live', hintText.includes('already live'), `got "${hintText}"`);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
