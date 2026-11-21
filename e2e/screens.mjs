/**
 * Screenshot harness.
 *
 * No CI can run iOS Safari, and markup that reads correctly is routinely
 * wrong on screen — most of the layout defects in this project were found by
 * photographing the result rather than by reasoning about the CSS. This drives
 * the app to each surface at iPhone size and writes a PNG per screen.
 *
 *   node e2e/screens.mjs /tmp/shots
 *
 * CHROMIUM_PATH points at a preinstalled browser when the Playwright package
 * and the on-disk browser build don't line up.
 */
import pw from 'playwright';
const { chromium } = pw;

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/Glimpse-copy/';
const OUT = process.argv[2] ?? '/tmp/shots';
const notes = [];

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
page.on('pageerror', (e) => notes.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && notes.push(m.text()));

const shot = async (name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot: ${name}`);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.onboard', { timeout: 20000 });
await shot('01-onboarding');
await page.locator('.onboard .btn').click();
await page.waitForSelector('.onboard', { state: 'detached', timeout: 10000 });
await shot('02-empty');

// Two Glimpses, so the list has something to lay out.
for (const [name, clips] of [
  ['Weekend in Rome', 4],
  ['A second a day', 2],
]) {
  await page.locator('.toolbar .btn', { hasText: 'New Glimpse' }).click();
  await page.fill('.field', name);
  await page.locator('.nav-btn', { hasText: 'Start' }).click();
  await page.waitForSelector('.shutter[data-ready="true"]:not([disabled])', {
    timeout: 30000,
  });
  if (name === 'Weekend in Rome') await shot('03-capture');
  for (let i = 0; i < clips; i++) {
    await page.locator('.shutter').click();
    await page.waitForSelector('.review', { timeout: 20000 });
    if (i === 0 && name === 'Weekend in Rome') await shot('04-review');
    await page.locator('.review-actions .btn.filled').click();
    await page.waitForSelector('.review', { state: 'detached', timeout: 20000 });
  }
  await page.locator('.nav-btn', { hasText: 'Done' }).click();
  await page.waitForSelector('.scroll', { timeout: 20000 });
  await page.locator('.nav-btn', { hasText: 'Glimpses' }).click();
  await page.waitForSelector('.poster', { timeout: 20000 });
}

await shot('05-glimpses');
console.log(`posters: ${await page.locator('.poster').count()}`);
console.log(`header: ${(await page.locator('.nav-large').innerText()).replace(/\n/g, ' | ')}`);

// Playing a Glimpse without opening the editor.
await page.locator('.poster-play').first().click();
await page.waitForSelector('.preview', { timeout: 20000 });
await shot('06-list-playback');
await page.locator('.preview .btn', { hasText: 'Done' }).click();
await page.waitForSelector('.preview', { state: 'detached', timeout: 10000 });

// Editor.
await page.locator('.poster-open').first().click();
await page.waitForSelector('.toolbar', { timeout: 20000 });
// The stage is the editor's headline surface; wait for it rather than
// photographing a half-mounted screen.
await page.waitForSelector('.editor-stage video, .editor-stage img', { timeout: 20000 });
await shot('07-editor');

if (await page.locator('.strip-tile').count()) {
  await page.locator('.strip-tile').nth(1).click();
  await shot('08-editor-selected');
}

await browser.close();
console.log(notes.length ? `\nCONSOLE ISSUES:\n- ${notes.join('\n- ')}` : '\nno console errors');
process.exit(notes.length ? 1 : 0);
