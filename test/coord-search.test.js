// ============================================================================
// coord-search.test.js — Verifies the "Go to coordinates" feature:
// opening the popover, validating input, flying the map to the entered
// point, and dropping/replacing the result marker.
//
// Run with: (python3 -m http.server 8080 --bind 127.0.0.1 &) ; sleep 1.5 ; node test/coord-search.test.js
// ============================================================================

const { chromium } = require('playwright');

let passed = 0, failed = 0;
function report(name, ok, detail = '') {
  if (ok) { console.log(`  ok  - ${name}`); passed++; }
  else { console.log(`FAIL  - ${name}${detail ? ' :: ' + detail : ''}`); failed++; }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.route('**/rest/v1/categories*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'tourist', label_en: 'Tourist Spot', color: '#3B7A57', icon: 'landmark', sort_order: 1 }]) }));
  await page.route('**/rest/v1/places*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.route('**/auth/v1/session*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/auth/v1/token*', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{}' }));
  await page.route('**/api.maptiler.com/maps/**/style.json*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [], glyphs: 'http://localhost:8080/__mock-glyphs__/{fontstack}/{range}.pbf' }) }));
  await page.route('**/__mock-glyphs__/**', (route) => route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }));

  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1500);

  console.log('\nOpening and closing the popover -----------------------------------------');

  const popoverHiddenInitially = await page.locator('#coord-search-popover').isHidden();
  report('popover starts hidden', popoverHiddenInitially);

  await page.locator('#btn-coord-search').click();
  await page.waitForTimeout(200);
  const popoverVisible = await page.locator('#coord-search-popover').isVisible();
  report('clicking the button opens the popover', popoverVisible);

  const hasLatInput = await page.locator('#form-coord-search input[name="lat"]').count();
  const hasLngInput = await page.locator('#form-coord-search input[name="lng"]').count();
  report('popover has lat and lng inputs', hasLatInput === 1 && hasLngInput === 1);

  await page.locator('#btn-coord-search').click();
  await page.waitForTimeout(200);
  const closedByToggle = await page.locator('#coord-search-popover').isHidden();
  report('clicking the button again closes the popover (toggle)', closedByToggle);

  console.log('\nClicking outside closes the popover ---------------------------------------');
  await page.locator('#btn-coord-search').click();
  await page.waitForTimeout(200);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(200);
  const closedByOutsideClick = await page.locator('#coord-search-popover').isHidden();
  report('clicking outside the popover closes it', closedByOutsideClick);

  console.log('\nEscape key closes the popover -----------------------------------------');
  await page.locator('#btn-coord-search').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const closedByEscape = await page.locator('#coord-search-popover').isHidden();
  report('pressing Escape closes the popover', closedByEscape);

  console.log('\nValidation ----------------------------------------------------------------');
  await page.locator('#btn-coord-search').click();
  await page.waitForTimeout(200);

  await page.locator('input[name="lat"]').fill('200');
  await page.locator('input[name="lng"]').fill('137');
  await page.locator('#form-coord-search button[type="submit"]').click();
  await page.waitForTimeout(200);
  const latErrorShown = await page.locator('#coord-search-error').isVisible();
  const latErrorText = latErrorShown ? await page.locator('#coord-search-error').textContent() : '';
  report('out-of-range latitude shows a validation error', latErrorShown && latErrorText.includes('Latitude'), latErrorText);

  const popoverStillOpenAfterError = await page.locator('#coord-search-popover').isVisible();
  report('popover stays open after a validation error (does not silently close)', popoverStillOpenAfterError);

  console.log('\nSuccessful search flies the map and drops a marker -------------------------');
  await page.locator('input[name="lat"]').fill('36.8047');
  await page.locator('input[name="lng"]').fill('136.9077');
  await page.locator('#form-coord-search button[type="submit"]').click();
  await page.waitForTimeout(1200);

  const popoverClosedAfterSuccess = await page.locator('#coord-search-popover').isHidden();
  report('popover closes after a successful search', popoverClosedAfterSuccess);

  const markerCount = await page.locator('.coord-search-marker').count();
  report('a result marker is dropped on the map', markerCount === 1, `found ${markerCount}`);

  const mapCenter = await page.evaluate(() => {
    const c = MapController.getMap().getCenter();
    return { lat: c.lat, lng: c.lng };
  });
  report('map flew to approximately the entered coordinates',
    Math.abs(mapCenter.lat - 36.8047) < 0.01 && Math.abs(mapCenter.lng - 136.9077) < 0.01,
    JSON.stringify(mapCenter));

  const toastVisible = await page.locator('.toast.is-visible').count();
  report('a confirmation toast is shown', toastVisible >= 1);

  console.log('\nA second search replaces the marker rather than stacking ---------------------');
  await page.locator('#btn-coord-search').click();
  await page.waitForTimeout(200);
  await page.locator('input[name="lat"]').fill('36.70');
  await page.locator('input[name="lng"]').fill('137.20');
  await page.locator('#form-coord-search button[type="submit"]').click();
  await page.waitForTimeout(1200);

  const markerCountAfterSecond = await page.locator('.coord-search-marker').count();
  report('still exactly one result marker after a second search', markerCountAfterSecond === 1, `found ${markerCountAfterSecond}`);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
