import pw from 'playwright';
const { chromium } = pw;

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8099/Glimpse-copy/';
const errors = [];

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
// A bare "Failed to load resource" says nothing about what failed; the request
// event carries the URL and the reason.
page.on('requestfailed', (r) => {
  const why = r.failure()?.errorText ?? '';
  // A request cancelled by navigating away is not a defect; the favicon is
  // routinely aborted this way.
  if (why.includes('ERR_ABORTED')) return;
  errors.push(
    `REQUESTFAILED ${r.resourceType()} ${r.url().slice(0, 60)} — ${why}`,
  );
});
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
await page.waitForSelector('.strip-tile', { timeout: 20000 });
step(5, `filmstrip tiles: ${await page.locator('.strip-tile').count()}`);

// ---- reorder via pointer events ----
// HTML5 drag-and-drop never fires for touch on iOS, so reordering is built on
// pointer events. Compare moment ids, not visible text: tiles carry durations
// rather than positions, so a successful reorder can leave the text identical.
const ids = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-moment-id]')].map(
      (el) => el.dataset.momentId,
    ),
  );
const before = await ids();
const a = await page.locator('.strip-tile').first().boundingBox();
const b = await page.locator('.strip-tile').nth(1).boundingBox();
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();
// Long-press to pick the tile up, then carry it past its neighbour.
await page.waitForTimeout(400);
await page.mouse.move(b.x + b.width / 2 + 6, b.y + b.height / 2, { steps: 12 });
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
await page.locator('.strip-tile').first().click();
await page.waitForSelector('.moment-card', { timeout: 10000 });
const rowsBeforeDelete = await page.locator('.strip-tile').count();
await page.locator('.moment-card .btn.destructive').click();
await page.waitForFunction(
  (n) => document.querySelectorAll('.strip-tile').length === n - 1,
  rowsBeforeDelete,
  { timeout: 10000 },
);
step(7, `after delete: ${await page.locator('.strip-tile').count()} tiles`);

// ---- undo brings the moment back ----
// Deleting used to erase the file immediately, so a mis-swipe was permanent.
await page.locator('.toast-action', { hasText: 'Undo' }).click();
await page.waitForFunction(
  (n) => document.querySelectorAll('.strip-tile').length === n,
  rowsBeforeDelete,
  { timeout: 10000 },
);
step('7.5', `undo restored it: ${await page.locator('.strip-tile').count()} tiles`);

// Delete it again so later steps see the same state as before.
await page.locator('.strip-tile').first().click();
await page.waitForSelector('.moment-card', { timeout: 10000 });
await page.locator('.moment-card .btn.destructive').click();
await page.waitForFunction(
  (n) => document.querySelectorAll('.strip-tile').length === n - 1,
  rowsBeforeDelete,
  { timeout: 10000 },
);

// ---- persistence across a full reload ----
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
if (await page.locator('.onboard').count()) {
  errors.push('onboarding reappeared after being dismissed');
}
await page.waitForSelector('.poster', { timeout: 20000 });
step(8, `persisted: ${(await page.locator('.poster-sub').first().innerText()).trim()}`);

// ---- export: stream copy ----
await page.locator('.poster-open').first().click();
await page.waitForSelector('.toolbar', { timeout: 20000 });

// ---- preview plays the whole Glimpse without exporting ----
await page.locator('.nav-btn[aria-label="Preview"]').click();
await page.waitForSelector('.preview', { timeout: 20000 });
const totalLabel = await page.locator('.preview-meta').innerText();

// Pausing must hold the playhead where it is. It used to rewind to the
// moment's trim point, so every tap restarted the clip.
await page.waitForFunction(
  () => {
    const v = document.querySelector('.preview-stage video');
    return v && !v.paused && v.currentTime > 0.15;
  },
  null,
  { timeout: 20000 },
);
await page.locator('.preview-stage').click();
await page.waitForTimeout(300);
const heldAt = await page.evaluate(() => {
  const v = [...document.querySelectorAll('.preview-stage video')].find(
    (el) => el.style.opacity !== '0',
  );
  return { t: v?.currentTime ?? -1, paused: v?.paused };
});
if (!heldAt.paused) errors.push('tapping the stage did not pause the preview');
if (heldAt.t < 0.1) {
  errors.push(`pausing rewound the moment to ${heldAt.t.toFixed(2)}s`);
}
await page.locator('.preview-stage').click();

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

// ---- the filmstrip scrolls rather than paging into a second view ----
// The list/grid toggle is gone: the strip is horizontal, so sixty moments
// scroll sideways instead of needing a separate screen.
const stripScrollable = await page.evaluate(() => {
  const el = document.querySelector('.strip');
  return el ? { w: el.clientWidth, sw: el.scrollWidth, overflow: getComputedStyle(el).overflowX } : null;
});
step('8.7', `filmstrip: ${await page.locator('.strip-tile').count()} tiles, overflow-x ${stripScrollable?.overflow}`);
if (stripScrollable?.overflow !== 'auto') {
  errors.push('the filmstrip does not scroll horizontally');
}

/** Export now asks what kind first, so every export goes through the sheet. */
async function startVideoExport() {
  await page.locator('.toolbar .btn.filled').click();
  await page.waitForSelector('.sheet', { timeout: 10000 });
  await page.locator('.sheet .row', { hasText: 'Video' }).click();
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 10000 });
}

await page.evaluate(() => {
  navigator.canShare = () => false;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__exported = { name: this.download, href: this.href };
    else orig.call(this);
  };
});
await startVideoExport();
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
await page.locator('.strip-tile').first().click();
await page.waitForSelector('.moment-card', { timeout: 10000 });

// ---- the editor shows the moment it is editing ----
// Trim used to be two sliders over nothing but numbers, in a sheet that hid
// the clip while you adjusted it.
await page.waitForSelector('.editor-stage video', { timeout: 20000 });
const trimBefore = (await page.locator('.moment-card-value').first().innerText()).trim();

// Drag the start handle a third of the way in. It is a pointer-driven widget,
// not a range input, because a 3px edge is not a thumb-sized target.
const bar = await page.locator('.trimbar').boundingBox();
const handle = await page.locator('.trimbar-handle.start').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
await page.mouse.down();
await page.mouse.move(bar.x + bar.width * 0.35, handle.y + handle.height / 2, {
  steps: 10,
});
await page.mouse.up();
await page.waitForTimeout(400);

const clip = await page.evaluate(() => {
  const v = document.querySelector('.editor-stage video');
  return { t: v?.currentTime ?? -1, w: v?.videoWidth ?? 0 };
});
const trimAfter = (await page.locator('.moment-card-value').first().innerText()).trim();
step('9.5', `trim: "${trimBefore}" → "${trimAfter}", stage playhead ${clip.t.toFixed(2)}s`);
if (!clip.w) errors.push('the editor stage never decoded a frame');
// Dragging the start handle past the playhead must pull the picture with it.
if (clip.t < 0.1) {
  errors.push(`stage playhead stayed at ${clip.t.toFixed(2)}s, outside the trim`);
}
if (trimBefore === trimAfter) errors.push('the trim readout did not follow the handle');

await page.locator('.moment-card .segmented button', { hasText: '2×' }).click();
await page.waitForTimeout(300);
step(10, `applied 2x speed: ${(await page.locator('.editor-stage-len').innerText()).trim()}`);

await startVideoExport();
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
const rowsBefore = await page.locator('.strip-tile').count();
await page
  .locator('input[type=file][accept*="image"]')
  .setInputFiles('./public/icons/icon-512.png');
await page.waitForFunction(
  (n) => document.querySelectorAll('.strip-tile').length === n + 1,
  rowsBefore,
  { timeout: 30000 },
);
await page.locator('.strip-tile').last().click();
await page.waitForTimeout(300);
step(12, `imported photo: ${(await page.locator('.editor-stage-len').innerText()).trim()}`);

// A photo's on-screen time is editable; it used to be hard-coded to 2s.
const durBefore = (await page.locator('.strip-len').last().innerText()).trim();
await page.locator('.moment-card input[type=range]').first().fill('6000');
await page.waitForTimeout(400);
const durAfter = (await page.locator('.strip-len').last().innerText()).trim();
step('12.5', `still duration: ${durBefore} → ${durAfter}`);
if (durBefore === durAfter) errors.push('still duration did not change');

await startVideoExport();
await page.waitForFunction(() => window.__exported, null, { timeout: 600000 });
const stillOut = await page.evaluate(async () => {
  const r = await fetch(window.__exported.href);
  return (await r.blob()).size;
});
step(13, `exported with still: ${stillOut} bytes`);
if (stillOut < 1000) errors.push('export containing a still produced an empty file');

// ---- snapshot: one frame, grabbed from the paused preview ----
// This path never touches ffmpeg. It draws the on-screen frame to a canvas,
// so the checks that matter are that the canvas is readable (a tainted one
// throws) and that it holds a frame rather than an undecoded blank.
await page.evaluate(() => {
  window.__exported = null;
});
await page.locator('.toolbar .btn.filled').click();
await page.waitForSelector('.sheet', { timeout: 10000 });
await page.locator('.sheet .row', { hasText: 'Snapshot' }).click();
await page.waitForSelector('.preview-steps', { timeout: 20000 });
await page.waitForFunction(
  () => !document.querySelector('.preview-steps .btn.filled')?.disabled,
  null,
  { timeout: 20000 },
);
if (
  await page.evaluate(() =>
    [...document.querySelectorAll('.preview-stage video')].some((v) => !v.paused),
  )
) {
  errors.push('the frame picker started playing instead of holding still');
}
await page.locator('.preview-steps .btn.filled').click();
await page.waitForFunction(() => window.__exported, null, { timeout: 30000 });
const snap = await page.evaluate(async () => {
  const r = await fetch(window.__exported.href);
  const blob = await r.blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, Math.floor(bmp.height / 2), bmp.width, 1).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
  return {
    name: window.__exported.name,
    type: blob.type,
    size: blob.size,
    w: bmp.width,
    h: bmp.height,
    lit: lit / (d.length / 4),
  };
});
step(14, `snapshot: ${snap.name} ${snap.w}×${snap.h} ${snap.size} bytes`);
if (snap.type !== 'image/jpeg') errors.push(`snapshot was ${snap.type}, not a jpeg`);
if (snap.w !== 1080 || snap.h !== 1080) {
  errors.push(`snapshot was ${snap.w}×${snap.h}, expected 1080×1080 for a square Glimpse`);
}
if (snap.lit < 0.5) errors.push('snapshot came out blank');

// ---- recording into the middle of the timeline ----
// moment.add gained an optional index. Appending is still the default, so
// journals written before this existed replay unchanged.
await page.locator('.strip-tile').first().click();
await page.waitForSelector('.moment-card', { timeout: 10000 });
const orderBeforeInsert = await ids();
await page.locator('.moment-card .btn.tinted', { hasText: 'Record after this' }).click();
await page.waitForSelector('.shutter[data-ready="true"]:not([disabled])', {
  timeout: 30000,
});
if (!page.url().includes('at=1')) {
  errors.push(`insert position missing from the capture URL: ${page.url()}`);
}
await page.locator('.shutter').click();
await page.waitForSelector('.review', { timeout: 20000 });
await page.locator('.review-actions .btn.filled').click();
await page.waitForSelector('.review', { state: 'detached', timeout: 20000 });
await page.locator('.nav-btn', { hasText: 'Done' }).click();
await page.waitForSelector('.strip-tile', { timeout: 20000 });
const orderAfterInsert = await ids();
step(15, `insert: ${orderBeforeInsert.length} → ${orderAfterInsert.length} moments`);
if (orderAfterInsert.length !== orderBeforeInsert.length + 1) {
  errors.push('recording into the middle did not add a moment');
}
// The new moment must land at index 1, not on the end.
if (orderAfterInsert[0] !== orderBeforeInsert[0]) {
  errors.push('inserting displaced the first moment');
}
if (orderAfterInsert.includes(orderBeforeInsert[1]) &&
    orderAfterInsert.indexOf(orderBeforeInsert[1]) !== 2) {
  errors.push(
    `inserted moment did not land at position 2 — order is ${orderAfterInsert.join(',')}`,
  );
}

// ---- playing a Glimpse from the list, without opening the editor ----
await page.locator('.nav-btn', { hasText: 'Glimpses' }).click();
await page.waitForSelector('.poster', { timeout: 20000 });
await page.locator('.poster-play').first().click();
await page.waitForSelector('.preview', { timeout: 20000 });
const listPlay = (await page.locator('.preview-meta').innerText()).replace(/\n/g, ' | ');
step(16, `played from the list: ${listPlay}`);
await page.locator('.preview .btn', { hasText: 'Done' }).click();
await page.waitForSelector('.preview', { state: 'detached', timeout: 10000 });
if (!(await page.locator('.poster').count())) {
  errors.push('closing list playback did not return to the Glimpses list');
}

console.log(`\n=== ERRORS (${errors.length}) ===`);
errors.forEach((e) => console.log(e));
await browser.close();
process.exit(errors.length ? 1 : 0);
