import pw from 'playwright';
const { chromium } = pw;

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8099/Glimpse-copy/';
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

const step = (n, msg) => console.log(`${String(n).padStart(2)}. ${msg}`);

await page.goto(BASE, { waitUntil: 'networkidle' });

// First run shows onboarding, which must appear once and then never again.
await page.waitForSelector('.onboard', { timeout: 20000 });
step(0, `onboarding: "${await page.locator('.onboard h1').innerText()}"`);
await page.locator('.onboard .btn').click();
await page.waitForSelector('.onboard', { state: 'detached', timeout: 10000 });

step(1, `loaded: ${await page.locator('.nav-large').innerText()}`);

// ---- create a project ----
await page.locator('.toolbar .btn', { hasText: 'New Glimpse' }).click();
await page.fill('.field', 'Smoke Test');
await page.locator('.segmented button', { hasText: 'Square' }).click();
await page.locator('.nav-btn', { hasText: 'Start' }).click();

await page.waitForSelector('.shutter[data-ready="true"]:not([disabled])', {
  timeout: 30000,
});
step(2, 'capture screen reached, camera live');

// ---- record three moments on the held stream ----
for (let i = 0; i < 3; i++) {
  await page.locator('.shutter').click();
  await page.waitForSelector('.review', { timeout: 20000 });
  await page.locator('.review-actions .btn.filled').click();
  await page.waitForSelector('.review', { state: 'detached', timeout: 20000 });
}
step(3, `recorded 3 moments — pill reads "${await page.locator('.pill').innerText()}"`);
step(4, `getUserMedia calls: ${await page.evaluate(() => window.__gumCalls)}`);
if ((await page.evaluate(() => window.__gumCalls)) !== 1) {
  errors.push('stream was re-acquired: the audio-loss regression is back');
}

// ---- editor ----
await page.locator('.nav-btn', { hasText: 'Done' }).click();
await page.waitForSelector('.scroll .list .row', { timeout: 20000 });
step(5, `editor rows: ${await page.locator('.scroll .list .row').count()}`);

// ---- reorder via pointer events ----
// The previous implementation used HTML5 drag-and-drop, which never fires for
// touch on iOS. This drag proves the pointer-event path actually reorders.
// Compare moment ids, not row text: rows are labelled by position, so a
// successful reorder leaves the visible strings identical.
const ids = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-moment-id]')].map(
      (el) => el.dataset.momentId,
    ),
  );
const before = await ids();
const grip = page.locator('.scroll .list .row .grip').first();
const box = await grip.boundingBox();
const rowBox = await page.locator('.scroll .list .row').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + rowBox.height, {
  steps: 10,
});
await page.mouse.up();
await page.waitForTimeout(400);
const after = await ids();
step(
  6,
  `reorder: ${before.join(',').slice(0, 30)} → ${after.join(',').slice(0, 30)}`,
);
if (JSON.stringify(before) === JSON.stringify(after)) {
  errors.push('reorder did nothing — pointer-event drag is broken');
}

// ---- per-moment sheet: delete ----
await page.locator('.scroll .list .row .row-main').first().click();
await page.waitForSelector('.sheet', { timeout: 10000 });
const rowsBeforeDelete = await page.locator('.scroll .list .row').count();
await page.locator('.sheet .row.destructive').click();
await page.waitForSelector('.sheet', { state: 'detached', timeout: 10000 });
await page.waitForFunction(
  (n) => document.querySelectorAll('.scroll .list .row').length === n - 1,
  rowsBeforeDelete,
  { timeout: 10000 },
);
step(7, `after delete: ${await page.locator('.scroll .list .row').count()} rows`);

// ---- persistence across a full reload ----
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
if (await page.locator('.onboard').count()) {
  errors.push('onboarding reappeared after being dismissed');
}
await page.waitForSelector('.scroll .list .row', { timeout: 20000 });
step(8, `persisted: ${(await page.locator('.row-sub').first().innerText()).trim()}`);

// ---- export: stream copy ----
await page.locator('.scroll .list .row').first().click();
await page.waitForSelector('.toolbar', { timeout: 20000 });

// ---- preview plays the whole Glimpse without exporting ----
await page.locator('.nav-btn[aria-label="Preview"]').click();
await page.waitForSelector('.preview', { timeout: 20000 });
const totalLabel = await page.locator('.preview-meta').innerText();
// Wait for playback to actually reach the end rather than assuming it does.
await page.waitForFunction(
  () => {
    const bar = document.querySelector('.preview-track i');
    return bar && parseFloat(bar.style.width) > 85;
  },
  null,
  { timeout: 30000 },
);
step(8.5, `preview reached end — ${totalLabel.replace(/\n/g, ' | ')}`);
await page.locator('.preview .btn').click();
await page.waitForSelector('.preview', { state: 'detached', timeout: 10000 });

await page.evaluate(() => {
  navigator.canShare = () => false;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__exported = { name: this.download, href: this.href };
    else orig.call(this);
  };
});
await page.locator('.toolbar .btn.filled').click();
await page.waitForFunction(() => window.__exported, null, { timeout: 600000 });
const copyOut = await page.evaluate(async () => {
  const r = await fetch(window.__exported.href);
  return { name: window.__exported.name, size: (await r.blob()).size };
});
step(9, `exported (stream copy): ${copyOut.name} ${copyOut.size} bytes`);
if (copyOut.size < 1000) errors.push('stream-copy export produced an empty file');

// ---- export: forced re-encode ----
// The filter graph is unit-tested only as a string, so this is the one check
// that it is valid ffmpeg syntax rather than merely well-formed text.
await page.evaluate(() => {
  window.__exported = null;
});
await page.locator('.scroll .list .row .row-main').first().click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.locator('.sheet .segmented button', { hasText: '2×' }).click();
await page.locator('.sheet .nav-btn', { hasText: 'Done' }).click();
await page.waitForSelector('.sheet', { state: 'detached', timeout: 10000 });
step(10, `applied 2x speed: ${(await page.locator('.row-title').first().innerText()).trim()}`);

await page.locator('.toolbar .btn.filled').click();
await page.waitForFunction(() => window.__exported, null, { timeout: 600000 });
const reOut = await page.evaluate(async () => {
  const r = await fetch(window.__exported.href);
  return (await r.blob()).size;
});
step(11, `exported (re-encoded): ${reOut} bytes`);
if (reOut < 1000) errors.push('re-encoded export produced an empty file');

// ---- import a photo, then export with a still in the timeline ----
// Stills take the trickiest ffmpeg path (-loop 1) and go through canvas
// normalisation first, which is also how HEIC is handled on device.
await page.evaluate(() => {
  window.__exported = null;
});
const rowsBefore = await page.locator('.scroll .list .row').count();
await page
  .locator('input[type=file][accept*="image"]')
  .setInputFiles('./public/icons/icon-512.png');
await page.waitForFunction(
  (n) => document.querySelectorAll('.scroll .list .row').length === n + 1,
  rowsBefore,
  { timeout: 30000 },
);
step(12, `imported photo: ${(await page.locator('.row-sub').last().innerText()).trim()}`);

// A photo's on-screen time is editable; it used to be hard-coded to 2s.
await page.locator('.scroll .list .row .row-main').last().click();
await page.waitForSelector('.sheet', { timeout: 10000 });
const durBefore = (await page.locator('.scroll .list .row-title').last().innerText()).trim();
await page.locator('.sheet input[type=range]').first().fill('6000');
await page.waitForTimeout(400);
const durAfter = (await page.locator('.scroll .list .row-title').last().innerText()).trim();
step('12.5', `still duration: ${durBefore} → ${durAfter}`);
if (durBefore === durAfter) errors.push('still duration did not change');
await page.locator('.sheet .nav-btn', { hasText: 'Done' }).click();
await page.waitForSelector('.sheet', { state: 'detached', timeout: 10000 });

await page.locator('.toolbar .btn.filled').click();
await page.waitForFunction(() => window.__exported, null, { timeout: 600000 });
const stillOut = await page.evaluate(async () => {
  const r = await fetch(window.__exported.href);
  return (await r.blob()).size;
});
step(13, `exported with still: ${stillOut} bytes`);
if (stillOut < 1000) errors.push('export containing a still produced an empty file');

console.log(`\n=== ERRORS (${errors.length}) ===`);
errors.forEach((e) => console.log(e));
await browser.close();
process.exit(errors.length ? 1 : 0);
