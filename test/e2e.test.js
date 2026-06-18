// ============================================================================
// e2e.test.js — Loads the real index.html in a headless browser and checks
// the app boots cleanly: no console errors, the map canvas renders, the
// category filter bar populates, and the auth modal opens.
//
// Network calls to Supabase/MapTiler are intercepted and faked since this
// is a structural/wiring smoke test, not a live-backend integration test
// (there is no real project configured at this stage of building the repo).
//
// Run with: node test/e2e.test.js
// Requires: a static server already running on http://localhost:8080
//           (the script in this repo serves the project root)
// ============================================================================

const { chromium } = require('playwright');

const FAKE_CATEGORIES = [
  { id: 'tourist', label_en: 'Tourist Spot', color: '#3B7A57', icon: 'landmark', sort_order: 1 },
  { id: 'haikyo', label_en: 'Abandoned Place', color: '#8B5E3C', icon: 'door-open', sort_order: 2 },
];

const FAKE_PLACES = [
  { id: 'p1', name: 'Test Shrine', category_id: 'tourist', lat: 36.80, lng: 136.95, featured: true },
  { id: 'p2', name: 'Test Ruin', category_id: 'haikyo', lat: 36.82, lng: 136.97, featured: false },
];

let passed = 0;
let failed = 0;
function report(name, ok, detail = '') {
  if (ok) { console.log(`  ok  - ${name}`); passed++; }
  else { console.log(`FAIL  - ${name}${detail ? ' :: ' + detail : ''}`); failed++; }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  // --- Mock Supabase REST endpoints -------------------------------------
  await page.route('**/rest/v1/categories*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_CATEGORIES) })
  );
  await page.route('**/rest/v1/places*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_PLACES) })
  );
  await page.route('**/auth/v1/session*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  );
  await page.route('**/auth/v1/token*', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'no session' }) })
  );

  // --- Mock MapTiler style + tile responses so MapLibre doesn't hang on
  //     real network calls or fail loudly for lack of a real API key. ---
  await page.route('**/api.maptiler.com/maps/**/style.json*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [],
        glyphs: 'http://localhost:8080/__mock-glyphs__/{fontstack}/{range}.pbf',
      }),
    })
  );
  // Mock the glyphs endpoint our fake style references, so MapLibre's
  // request for it resolves cleanly instead of 404ing — keeps console
  // error output meaningful (real bugs only) rather than full of expected
  // test-fixture noise.
  await page.route('**/__mock-glyphs__/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) })
  );

  console.log('\nPage load & boot ---------------------------------------------------');

  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle', timeout: 15000 });
  report('page loads without throwing', true);

  // Give app.js's async IIFE time to finish (category load + map init).
  await page.waitForTimeout(1200);

  const title = await page.title();
  report('page title is set correctly', title.includes('HokuSpot'), `got "${title}"`);

  const mapCanvasCount = await page.locator('#map canvas').count();
  report('MapLibre renders a canvas element inside #map', mapCanvasCount > 0, `found ${mapCanvasCount} canvases`);

  const filterChips = await page.locator('.filter-chip').count();
  report('category filter chips rendered (All + 2 fake categories)', filterChips === 3, `found ${filterChips}`);

  const allChipActive = await page.locator('.filter-chip.is-active').textContent();
  report('"All" filter chip is active by default', allChipActive.trim() === 'All', `got "${allChipActive}"`);

  console.log('\nAuth modal -----------------------------------------------------------');

  const signInBtn = page.locator('#btn-sign-in');
  report('sign-in button visible when logged out', await signInBtn.isVisible());

  await signInBtn.click();
  await page.waitForTimeout(150);
  const modalOpen = await page.locator('#modal-root.is-open').count();
  report('clicking sign-in opens the modal', modalOpen === 1);

  const hasEmailField = await page.locator('#form-signin input[name="email"]').count();
  report('sign-in form has an email field', hasEmailField === 1);

  // Switch to the sign-up tab and check the form swaps correctly.
  await page.locator('.auth-tab[data-tab="signup"]').click();
  await page.waitForTimeout(100);
  const signupVisible = await page.locator('#form-signup').isVisible();
  const signinHidden = await page.locator('#form-signin').isHidden();
  report('switching to "Create account" tab shows signup form and hides signin form', signupVisible && signinHidden);

  await page.locator('.modal__close').click();
  await page.waitForTimeout(100);
  const modalClosedAfter = await page.locator('#modal-root.is-open').count();
  report('closing the modal via the X button works', modalClosedAfter === 0);

  console.log('\nCategory filter interaction --------------------------------------------');

  await page.locator('.filter-chip', { hasText: 'Abandoned Place' }).click();
  await page.waitForTimeout(100);
  const activeChipText = await page.locator('.filter-chip.is-active').textContent();
  report('clicking a category chip makes it active', activeChipText.includes('Abandoned Place'), `got "${activeChipText}"`);

  console.log('\nConsole / runtime errors ------------------------------------------------');
  // Filter out expected/benign noise: MapTiler tile 404s from our minimal
  // fake style, and MapLibre telemetry calls we didn't bother mocking.
  const meaningfulErrors = consoleErrors.filter((e) =>
    !/maptiler|telemetry|tiles\.json|favicon/i.test(e)
  );
  report('no unexpected JS console errors', meaningfulErrors.length === 0, meaningfulErrors.join(' | '));

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
