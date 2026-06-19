// ============================================================================
// repin-approved-marker.test.js — Regression test for the reported bug:
// "if I attempt to repin a pin from an already approved location using
// edit, it usually will not save the pin."
//
// Root cause: an approved place is still rendered on the map (it's visible
// to everyone). When a moderator opens its Edit form and clicks the map to
// move the pin, clicking on/near the place's OWN marker also fired the
// generic 'unclustered-point' click handler, which called onPlaceClick()
// and reopened the detail panel mid-edit, on top of the pin-picker. The fix
// makes the marker-click handler a no-op while pin-picker mode is active.
//
// This test renders the approved place as a real marker on the map, opens
// its edit form, clicks DIRECTLY on the marker's pixel position (not an
// empty patch of map), and confirms the pin moves and the save succeeds.
//
// Run with: (python3 -m http.server 8080 --bind 127.0.0.1 &) ; sleep 1.5 ; node test/repin-approved-marker.test.js
// ============================================================================

const { chromium } = require('playwright');

const FAKE_CATEGORIES = [
  { id: 'tourist', label_en: 'Tourist Spot', color: '#3B7A57', icon: 'landmark', sort_order: 1 },
];

const FAKE_SESSION = {
  access_token: 'fake-token', token_type: 'bearer', expires_in: 3600,
  refresh_token: 'fake-refresh', user: { id: 'mod-user-1', email: 'mod@test.com' },
};
const FAKE_PROFILE = { id: 'mod-user-1', display_name: 'Test Moderator', avatar_url: null, role: 'moderator' };

const MAP_CENTER = { lng: 136.95, lat: 36.80 };

const APPROVED_PLACE = {
  id: 'place-approved-1', name: 'Approved Spot', description: 'Already live on the map',
  highlights: null, address: null, category_id: 'tourist',
  lat: MAP_CENTER.lat, lng: MAP_CENTER.lng,
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
  let lastPatchBody = null;

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
  await page.route('**/rest/v1/tags*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.route('**/rest/v1/places*', (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'PATCH') {
      lastPatchBody = route.request().postDataJSON();
      const idMatch = url.match(/id=eq\.([^&]+)/);
      const patchedId = idMatch ? decodeURIComponent(idMatch[1]) : null;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: patchedId, ...lastPatchBody }]) });
    }
    if (url.includes('place_photos')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(APPROVED_PLACE) });
    }
    // Bounds query that MapController.refreshPlacesInView() makes on load —
    // return our one approved place so it renders as a real clickable marker.
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([APPROVED_PLACE]) });
  });

  await page.addInitScript(({ session, profile }) => {
    window.__fakeSession = session;
    window.__fakeProfile = profile;
    const patchApi = () => {
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
  await page.waitForTimeout(2000); // let the map style + marker layer settle

  console.log('\nSetup -----------------------------------------------------------------');
  const userPillVisible = await page.locator('.user-pill').count();
  report('signed-in pill is visible (fake session was picked up)', userPillVisible === 1);

  // Find the on-screen pixel position of the approved place's marker by
  // projecting its lng/lat through the live MapLibre instance — this is
  // exactly where a real person would click to try to "grab" the pin.
  const markerPoint = await page.evaluate(({ lng, lat }) => {
    const map = MapController.getMap();
    const p = map.project([lng, lat]);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }, MAP_CENTER);
  report('marker projects to an on-screen pixel position', Number.isFinite(markerPoint.x) && Number.isFinite(markerPoint.y), JSON.stringify(markerPoint));

  console.log('\nOpen edit form for the approved place ----------------------------------');
  await page.evaluate(() => UI.openPlaceDetail('place-approved-1'));
  await page.waitForTimeout(400);
  await page.locator('#btn-edit-place').click();
  await page.waitForTimeout(400);

  const editPanelOpen = await page.locator('#submit-panel.is-open').count();
  report('edit form opens for the approved place', editPanelOpen === 1);

  console.log('\nClick directly on the place\'s own marker to repin ----------------------');
  // This is the reported scenario: the user clicks on (or very near) the
  // pin that's already sitting on the map for this approved place, intending
  // to move it, rather than clicking empty water/forest elsewhere.
  await page.evaluate(() => {
    window.__detailOpenCalls = 0;
    const orig = UI.openPlaceDetail;
    UI.openPlaceDetail = (...args) => { window.__detailOpenCalls++; return orig(...args); };
  });

  await page.mouse.click(markerPoint.x + 6, markerPoint.y + 6);
  await page.waitForTimeout(300);

  const detailOpenCalls = await page.evaluate(() => window.__detailOpenCalls);
  console.log(`  [diagnostic] openPlaceDetail called ${detailOpenCalls} time(s) by the repin click`);

  const detailPanelReopened = await page.locator('#detail-panel.is-open').count();
  report('clicking the marker during edit does NOT reopen the detail panel', detailPanelReopened === 0);

  const editPanelStillOpen = await page.locator('#submit-panel.is-open').count();
  report('edit form stays open after clicking the marker', editPanelStillOpen === 1);

  console.log('\nMove the pin to a clearly different spot and save -----------------------');
  await page.mouse.click(600, 250); // a different on-screen point, away from the marker
  await page.waitForTimeout(300);

  const pinReadout = await page.locator('#pin-readout').textContent();
  report('pin readout updated after the repin click', pinReadout.includes('Pinned'), `got "${pinReadout}"`);

  await page.locator('#form-submit button[type="submit"]').click();
  await page.waitForTimeout(500);

  const errorVisible = await page.locator('#submit-error').isVisible().catch(() => false);
  const errorText = errorVisible ? await page.locator('#submit-error').textContent() : null;
  if (errorText) console.log('  [diagnostic] submit-error shown:', errorText);

  const panelClosedAfterSave = await page.locator('#submit-panel.is-open').count();
  report('edit panel closes after saving the repinned location', panelClosedAfterSave === 0, errorText ? `error shown: ${errorText}` : 'panel still open, no error shown');

  report('the PATCH request actually included new lat/lng', !!lastPatchBody && 'lat' in lastPatchBody && 'lng' in lastPatchBody, JSON.stringify(lastPatchBody));

  await page.screenshot({ path: '/home/claude/hokuspot/test/screenshot-repin-approved-marker.png' });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
