const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(2500);

  await page.locator('#btn-coord-search').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-coord-popover.png' });

  await page.locator('input[name="lat"]').fill('36.8047');
  await page.locator('input[name="lng"]').fill('136.9077');
  await page.locator('#form-coord-search button[type="submit"]').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/home/claude/hokuriku-map/test/screenshot-coord-result.png' });

  await browser.close();
})();
