import pw from 'playwright';
const { chromium } = pw;

const errors = [];
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({
  permissions: ['camera', 'microphone'],
  viewport: { width: 390, height: 844 },
});
const page = await ctx.newPage();
// Count getUserMedia calls. The core reliability claim is that the stream is
// acquired ONCE per capture session, not once per moment — re-acquiring is
// what makes the original app drop audio on later clips.
await page.addInitScript(() => {
  window.__gumCalls = 0;
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (c) => {
    window.__gumCalls++;
    return orig(c);
  };
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://127.0.0.1:8099/Glimpse-copy/', { waitUntil: 'networkidle' });
console.log('1. loaded:', await page.locator('.topbar h1').innerText());

// Create a project.
await page.click('.fab');
await page.fill('.field', 'Smoke Test');
await page.click('.choices button:nth-child(2)'); // square
await page.click('.primary');
// Wait for the camera to actually be live, not merely for the button to exist.
await page.waitForSelector('.recbtn[data-ready="true"]:not([disabled])', { timeout: 30000 });
console.log('2. capture screen reached, camera live');

// Record three moments back to back on the held stream.
for (let i = 0; i < 3; i++) {
  await page.click('.recbtn');
  await page.waitForSelector('.review', { timeout: 20000 });
  await page.click('.btn-keep');
  await page.waitForSelector('.review', { state: 'detached', timeout: 20000 });
  console.log(`   kept moment ${i + 1}: ${await page.locator('.topbar h1').innerText()}`);
}

// Confirm the stream was held, not re-acquired per clip.
const gumCalls = await page.evaluate(() => window.__gumCalls ?? 'not-instrumented');
console.log('3. getUserMedia calls:', gumCalls);

await page.click('.topbar .link'); // Done
await page.waitForSelector('.strip', { timeout: 20000 });
const rows = await page.locator('.mrow').count();
console.log('4. editor rows:', rows);
console.log('   summary:', (await page.locator('.pad .dim').first().innerText()).trim());

// Reorder via the journal path, then confirm persistence across reload.
await page.locator('.mrow').first().locator('[aria-label="Delete moment"]').click();
await page.waitForTimeout(400);
console.log('5. after delete:', await page.locator('.mrow').count(), 'rows');

// Reload lands back on the hash route it was on, so navigate to the list
// explicitly to prove the journal survived a full restart.
await page.goto('http://127.0.0.1:8099/Glimpse-copy/#/', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.pcard', { timeout: 20000 });
console.log('6. persisted after reload:', (await page.locator('.pcard .dim').innerText()).trim());

// Export: exercises ffmpeg concat for real.
await page.click('.pcard');
await page.waitForSelector('.strip', { timeout: 20000 });
await page.evaluate(() => {
  // Web Share is unavailable in headless Chromium; capture the blob instead.
  navigator.canShare = () => false;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__exported = { name: this.download, href: this.href };
    else orig.call(this);
  };
});
await page.locator('.fab', { hasText: 'Export' }).click();
await page.waitForFunction(() => window.__exported, null, { timeout: 300000 });
const exported = await page.evaluate(() => window.__exported);
console.log('7. exported (stream copy):', exported.name);

const bytes = await page.evaluate(async () => {
  const r = await fetch(window.__exported.href);
  const b = await r.blob();
  return b.size;
});
console.log('   output bytes:', bytes);

// Force the re-encode path: the filter graph is only unit-tested as a string,
// so this is the one check that it is valid ffmpeg syntax.
await page.evaluate(() => {
  window.__exported = null;
});
await page.locator('.mrow').first().locator('[aria-label="Trim"]').click();
await page.locator('.mrow').first().locator('.chip', { hasText: '2×' }).click();
await page.waitForTimeout(500);
const speedLabel = await page.locator('.mrow').first().locator('.info').innerText();
console.log('8. applied speed:', speedLabel.split('\n')[0]);

await page.locator('.fab-inline, .fab', { hasText: 'Export' }).first().click()
  .catch(async () => {
    await page.locator('.fab', { hasText: 'Export' }).click();
  });
await page.waitForFunction(() => window.__exported, null, { timeout: 600000 });
const reencoded = await page.evaluate(async () => {
  const r = await fetch(window.__exported.href);
  return { name: window.__exported.name, size: (await r.blob()).size };
});
console.log('9. exported (re-encoded):', reencoded.name, reencoded.size, 'bytes');
if (reencoded.size < 1000) errors.push('re-encoded export produced an empty file');

// Import a photo. Stills take the trickiest ffmpeg path (-loop 1 on the input)
// and go through canvas normalisation first, which is also how HEIC is handled.
await page.evaluate(() => {
  window.__exported = null;
});
await page
  .locator('input[type=file][accept*="image"]')
  .setInputFiles('./public/icons/icon-512.png');
await page.waitForFunction(
  () => document.querySelectorAll('.mrow').length === 3,
  null,
  { timeout: 30000 },
);
const photoRow = await page.locator('.mrow').last().locator('.info').innerText();
console.log('10. imported photo row:', photoRow.replace(/\n/g, ' | '));

await page.locator('.fab', { hasText: 'Export' }).click();
await page.waitForFunction(() => window.__exported, null, { timeout: 600000 });
const withStill = await page.evaluate(async () => {
  const r = await fetch(window.__exported.href);
  return (await r.blob()).size;
});
console.log('11. exported with still:', withStill, 'bytes');
if (withStill < 1000) errors.push('export containing a still produced an empty file');

console.log(`\n=== ERRORS (${errors.length}) ===`);
errors.forEach((e) => console.log(e));
await browser.close();
process.exit(errors.length || bytes < 1000 ? 1 : 0);
