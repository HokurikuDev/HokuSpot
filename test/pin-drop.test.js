// ============================================================================
// pin-drop.test.js — Reproduces and verifies the fix for: "dropping a pin
// to mark places for the add place function doesn't work."
//
// Root cause was that the submission form opened inside #modal-root, a
// full-screen fixed-position overlay (z-index 50) that completely covers
// #map underneath it — so a click intended for the map could never reach
// it; it only ever hit the modal backdrop. Fixed by moving the form into
// its own slide-in side panel (#submit-panel) that leaves the map visible
// and clickable, and by giving pin-picking a single owned listener via
// MapController.startPinPicker() instead of two stacked listeners on the
// map (map.once + map.on for re-arming) which was a second latent bug in
// the original implementation.
//
// Run with: (python3 -m http.server 8080 --bind 127.0.0.1 &) ; sleep 1.5 ; node test/pin-drop.test.js
// ============================================================================

const { chromium } = require('playwright');

const FAKE_CATEGORIES = [
  { id: 'tourist', label_en: 'Tourist Spot', color: '#3B7A57', icon: 'landmark', sort_order: 1 },
];

let passed = 0;
let failed = 0;
function report(name, ok, detail = '') {
  if (ok) { console.log(`  ok  - ${name}`); passed++; }
  else { console.log(`FAIL  - ${name}${detail ? ' :: ' + detail : ''}`); failed++; }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Mock just enough to get a logged-in-looking session and a working map,
  // without touching the real Supabase project for this interaction test.
  await page.route('**/rest/v1/categories*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_CATEGORIES) }));
  await page.route('**/rest/v1/places*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.route('**/auth/v1/session*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/auth/v1/token*', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'no session' }) }));
  await page.route('**/api.maptiler.com/maps/**/style.json*', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ version: 8, sources: {}, layers: [], glyphs: 'http://localhost:8080/__mock-glyphs__/{fontstack}/{range}.pbf' }),
    }));
  await page.route('**/__mock-glyphs__/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }));

  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);

  console.log('\nReproducing the reported bug scenario --------------------------------');

  // Open the form the same way a real user would: via the auth-pill button.
  // Since we're not actually signed in (no real session), call the UI
  // function directly to open the panel the same way the "+Add a place"
  // button does, isolating the pin-picking behavior from auth flow.
  await page.evaluate(() => { UI.openSubmissionForm(); });
  await page.waitForTimeout(300);

  const panelOpen = await page.locator('#submit-panel.is-open').count();
  report('submit panel opens (side panel, not full-screen modal)', panelOpen === 1);

  const mapStillVisible = await page.locator('#map canvas').isVisible();
  report('map canvas is still visible while the form is open', mapStillVisible);

  // Check the map element is NOT covered by a full-screen overlay —
  // verify by checking elementFromPoint at a coordinate clearly outside
  // the side panel's width (which is min(420px, 100vw)), so on a
  // 1280px-wide viewport, x=200 should hit the map, not the panel.
  const elementAtMapPoint = await page.evaluate(() => {
    const el = document.elementFromPoint(200, 400);
    return el ? el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className : '') : null;
  });
  report('the point at (200,400) is NOT inside the submit panel (map is clickable there)',
    !elementAtMapPoint || !elementAtMapPoint.includes('submit-panel'),
    `element found: ${elementAtMapPoint}`);

  const readoutBefore = await page.locator('#pin-readout').textContent();
  report('pin readout initially shows no location chosen', readoutBefore.includes('No location chosen'));

  // THE ACTUAL REPRODUCTION: click on the map at a point outside the panel.
  await page.mouse.click(200, 400);
  await page.waitForTimeout(300);

  const readoutAfter = await page.locator('#pin-readout').textContent();
  report('pin readout updates after clicking the map', readoutAfter.includes('Pinned at'), `got: "${readoutAfter}"`);

  const markerCount = await page.locator('.pin-picker-marker').count();
  report('a visible pin marker is added to the map', markerCount === 1, `found ${markerCount}`);

  // Click a second, different point on the MAP (not inside the side
  // panel, which on this 1280px viewport occupies roughly x=860-1280) —
  // confirm the SAME marker moves rather than a second one being added,
  // and rather than the click being silently swallowed by the panel.
  await page.mouse.click(500, 200);
  await page.waitForTimeout(300);

  const markerCountAfterSecondClick = await page.locator('.pin-picker-marker').count();
  report('clicking again moves the same marker rather than adding a second one',
    markerCountAfterSecondClick === 1, `found ${markerCountAfterSecondClick}`);

  const readoutAfterSecondClick = await page.locator('#pin-readout').textContent();
  report('pin readout updates again on the second click', readoutAfterSecondClick !== readoutAfter,
    `before: "${readoutAfter}" / after: "${readoutAfterSecondClick}"`);

  // Closing the form should remove the marker and stop listening for clicks.
  await page.locator('#btn-close-submit').click();
  await page.waitForTimeout(300);

  const markerCountAfterClose = await page.locator('.pin-picker-marker').count();
  report('closing the form removes the pin marker', markerCountAfterClose === 0, `found ${markerCountAfterClose}`);

  const panelOpenAfterClose = await page.locator('#submit-panel.is-open').count();
  report('closing the form closes the panel', panelOpenAfterClose === 0);

  // Clicking the map after closing should do nothing (no leftover listener).
  await page.mouse.click(400, 400);
  await page.waitForTimeout(300);
  const markerAfterStrayClick = await page.locator('.pin-picker-marker').count();
  report('clicking the map after the form is closed does not re-add a pin marker (no leaked listener)',
    markerAfterStrayClick === 0, `found ${markerAfterStrayClick}`);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
