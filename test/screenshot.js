const { chromium } = require('playwright');

const FAKE_CATEGORIES = [
  { id: 'tourist', label_en: 'Tourist Spot', color: '#3B7A57', icon: 'landmark', sort_order: 1 },
  { id: 'haikyo', label_en: 'Abandoned Place', color: '#8B5E3C', icon: 'door-open', sort_order: 2 },
  { id: 'road', label_en: 'Interesting Road', color: '#4A6FA5', icon: 'route', sort_order: 3 },
  { id: 'nature', label_en: 'Nature / Viewpoint', color: '#5C8A3A', icon: 'mountain', sort_order: 4 },
];
const FAKE_PLACES = [
  { id: 'p1', name: 'Test Shrine', category_id: 'tourist', lat: 36.80, lng: 136.95, featured: true },
  { id: 'p2', name: 'Test Ruin', category_id: 'haikyo', lat: 36.82, lng: 136.97, featured: false },
  { id: 'p3', name: 'Coastal Road', category_id: 'road', lat: 36.78, lng: 136.90, featured: false },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.route('**/rest/v1/categories*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_CATEGORIES) }));
  await page.route('**/rest/v1/places*', (route) => {
    const url = route.request().url();
    if (url.includes('select=') && url.includes('place_photos')) {
      // Detail query for a single place (joins photos + tags)
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          id: 'p1', name: 'Test Shrine', description: 'A peaceful shrine tucked into the hillside, said to be centuries old.',
          highlights: 'Best visited at dawn before the tour groups arrive. Free entry, small parking lot nearby.',
          address: 'Jike, Hakui, Ishikawa', category_id: 'tourist', lat: 36.80, lng: 136.95,
          status: 'approved', featured: true, created_at: new Date().toISOString(), created_by: 'u1',
          place_photos: [
            { id: 'ph1', storage_path: null, external_url: 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=800', caption: 'Shrine gate', sort_order: 0 },
          ],
          place_tags: [{ tags: { id: 1, label: 'free-entry' } }, { tags: { id: 2, label: 'sunrise' } }],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_PLACES) });
  });
  await page.route('**/auth/v1/session*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/auth/v1/token*', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'no session' }) }));
  await page.route('**/api.maptiler.com/maps/**/style.json*', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: {
          'osm': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        glyphs: 'http://localhost:8080/__mock-glyphs__/{fontstack}/{range}.pbf',
      }),
    }));
  await page.route('**/__mock-glyphs__/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }));
  // Let real OSM tiles through so the screenshot looks like an actual map.

  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-main.png' });

  // Zoom in on the cluster of fake places to see individual unclustered pins
  await page.evaluate(() => { MapController.flyTo(136.95, 36.80, 13); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-zoomed.png' });

  // Open a place detail panel directly via the UI module
  await page.evaluate(() => { UI.openPlaceDetail('p1'); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-detail-panel.png' });
  await page.evaluate(() => { UI.closePlaceDetail(); });

  // Open the auth modal
  await page.locator('#btn-sign-in').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-auth-modal.png' });
  await page.locator('.modal__close').click();
  await page.waitForTimeout(200);

  // Simulate clicking a marker by directly invoking the panel open function
  await page.evaluate(() => {
    window.__testOpenDetail = () => {
      UI.openPlaceDetail.toString(); // just to ensure UI is in scope
    };
  });

  await browser.close();
  console.log('Screenshots saved.');
})();
