/*
 * Screenshots every screen that needs eyes on it, at iPhone size and 2x.
 *
 * The smoke suite proves behaviour; markup passing assertions says nothing
 * about whether a layout is right. Several defects in this project were only
 * ever found by looking: a title and subtitle running together on one line, a
 * play button covering the frame it was there to help you choose, a separator
 * inset for a thumbnail beside a much smaller icon.
 *
 * Records a few moments first, because most of these screens do not exist
 * until a Glimpse has something in it.
 *
 *   npx vite preview --port 4173
 *   node e2e/screens.mjs /tmp/shots/run1
 *
 * Also asserts the things a screenshot cannot show: that Organise actually
 * reorders, that Undo restores the exact previous order, and that the result
 * survives a reload — which is the only proof it reached the journal.
 */
import pw from 'playwright';
const { chromium } = pw;

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/Glimpse-copy/';
const OUT = process.argv[2] ?? '/tmp/shot';

// CHROMIUM_PATH lets the harness point at a preinstalled browser when the
// Playwright package and the on-disk browser build don't line up.
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({
  permissions: ['camera', 'microphone'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.onboard', { timeout: 20000 });
await page.locator('.onboard .btn').click();
await page.waitForSelector('.onboard', { state: 'detached', timeout: 10000 });

await page.locator('.toolbar .btn', { hasText: 'New Glimpse' }).click();
await page.fill('.field', 'Barcelona');
await page.locator('.nav-btn', { hasText: 'Start' }).click();
await page.waitForSelector('.shutter[data-ready="true"]:not([disabled])', {
  timeout: 30000,
});
for (let i = 0; i < 4; i++) {
  await page.locator('.shutter').click();
  await page.waitForSelector('.review', { timeout: 20000 });
  await page.locator('.review-actions .btn.filled').click();
  await page.waitForSelector('.review', { state: 'detached', timeout: 20000 });
}
await page.locator('.nav-btn', { hasText: 'Done' }).click();
await page.waitForSelector('.scroll .list .row', { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}-editor.png` });
console.log('editor shot');

// The per-moment sheet, which now leads with a player.
await page.locator('.scroll .list .row .row-main').first().click();
await page.waitForSelector('.clip-stage', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}-moment.png` });
await page.locator('.sheet .nav-btn', { hasText: 'Done' }).click();
await page.waitForSelector('.sheet', { state: 'detached', timeout: 10000 });

await page.locator('.linkbtn', { hasText: 'Organise' }).click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}-organise-initial.png` });

await page.locator('.icon-row', { hasText: 'Shuffle' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}-organise-picked.png` });
console.log(
  'caption:',
  (await page.locator('.organise-caption').innerText()).trim(),
);
console.log('footer:', (await page.locator('.sheet .group-footer').innerText()).trim());

const before = await page.evaluate(() =>
  [...document.querySelectorAll('.scroll .list [data-moment-id]')].map(
    (el) => el.dataset.momentId,
  ),
);
await page.locator('.sheet .nav-btn', { hasText: 'Apply' }).click();
await page.waitForSelector('.sheet', { state: 'detached', timeout: 10000 });
await page.waitForTimeout(500);
const after = await page.evaluate(() =>
  [...document.querySelectorAll('.scroll .list [data-moment-id]')].map(
    (el) => el.dataset.momentId,
  ),
);
console.log('order changed:', JSON.stringify(before) !== JSON.stringify(after));
await page.screenshot({ path: `${OUT}-applied.png` });

// Undo must put the exact previous order back.
await page.locator('.toast-action', { hasText: 'Undo' }).click();
await page.waitForTimeout(600);
const undone = await page.evaluate(() =>
  [...document.querySelectorAll('.scroll .list [data-moment-id]')].map(
    (el) => el.dataset.momentId,
  ),
);
console.log('undo restored original:', JSON.stringify(before) === JSON.stringify(undone));

// And it must survive a reload, which is the only proof it reached the journal.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.scroll .list .row', { timeout: 20000 });
const persisted = await page.evaluate(() =>
  [...document.querySelectorAll('.scroll .list [data-moment-id]')].map(
    (el) => el.dataset.momentId,
  ),
);
console.log('persisted after reload:', JSON.stringify(before) === JSON.stringify(persisted));

await browser.close();
