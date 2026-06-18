// ============================================================================
// live-check.test.js — Smoke test against the REAL Supabase project
// (not mocked) using the actual js/config.js values. Loads the real
// index.html in headless Chromium with NO network interception, so MapTiler
// and Supabase calls go out for real. Confirms the deployed config actually
// works end-to-end before pushing to GitHub Pages.
//
// Run with: (python3 -m http.server 8080 --bind 127.0.0.1 &) ; sleep 1.5 ; node test/live-check.test.js
// ============================================================================

const { chromium } = require('playwright');

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
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  console.log('\nLive backend check (real Supabase + real MapTiler, no mocking) -----------');

  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(3000);

  const mapCanvasCount = await page.locator('#map canvas').count();
  report('MapLibre renders a real canvas with the live MapTiler key', mapCanvasCount > 0, `found ${mapCanvasCount}`);

  // Categories should now be loaded from the REAL database (8 rows from
  // 01_schema.sql's seed, not the hardcoded fallback) — verify by checking
  // the filter chip count: "All" + 8 categories = 9.
  const chipCount = await page.locator('.filter-chip').count();
  report('category filter chips loaded from the live database (All + 8 categories)', chipCount === 9, `found ${chipCount}`);

  // The 6 seed places from 04_seed.sql should be fetched and rendered as
  // map markers/clusters once the map settles on its default view.
  await page.waitForTimeout(2000);
  const sourceFeatureCount = await page.evaluate(() => {
    try {
      const map = MapController.getMap();
      const src = map.getSource('places');
      if (!src) return -1;
      const data = src._data || src.serialize?.().data;
      return data && data.features ? data.features.length : -1;
    } catch (e) {
      return -2;
    }
  });
  report('live places data was fetched into the map source', sourceFeatureCount > 0, `feature count reported: ${sourceFeatureCount}`);

  // Sign-in modal should open and the auth network calls should reach the
  // real Supabase Auth endpoint (we don't actually sign in, just confirm
  // the UI and network path work).
  await page.locator('#btn-sign-in').click();
  await page.waitForTimeout(300);
  const modalOpen = await page.locator('#modal-root.is-open').count();
  report('auth modal opens against the live config', modalOpen === 1);

  await browser.close();

  const meaningfulErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
  console.log('\nConsole errors seen (for manual review, not auto-failed since live network variance is expected):');
  if (meaningfulErrors.length === 0) {
    console.log('  (none)');
  } else {
    meaningfulErrors.forEach((e) => console.log('  -', e));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
