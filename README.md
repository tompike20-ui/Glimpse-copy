# Glimpse-copy

A capture-first video storytelling PWA — record short "moments", append them
into one growing video, reorder and trim, export. Installed to the iPhone home
screen via Safari, not the App Store.

Rebuilt from [Glimpse – Video storytelling](https://apps.apple.com/us/app/glimpse-video-storytelling/id969793701)
(Excellent Rectangle, last updated Sept 2021), with its known defects designed
out rather than reproduced.

## Why a PWA

No Mac, no Apple Developer account, no App Store review. Safari → Share → Add
to Home Screen. The app is local-first: capture never touches the network, and
video stays on the device unless you explicitly share a Glimpse.

## Running it

```
https://tompike20-ui.github.io/Glimpse-copy/
```

Open in Safari, then **Add to Home Screen** and launch from the icon. Installed
PWAs are exempt from WebKit's 7-day storage eviction and are far more likely to
be granted persistent storage, so running it in a tab risks losing your work.

## What it does differently

| Original | Here |
|---|---|
| Audio silently missing on 2nd+ clip of a session | One held `MediaStream` per session; audio health asserted before every moment |
| No way to notice a silent recording | Live mic meter while recording; silent moments flagged in the editor |
| 2s / 3s / custom lengths behind Glimpse Pro | All lengths free |
| Front camera crops half the frame to black | Aspect is fitted, not cropped, on both cameras |
| Forced outro card, even on Pro | None |
| Capture-only, no recovery | Append-only journal replayed on launch; a crash cannot corrupt a project |
| Capture-only — camera roll footage can never be used | Import videos and photos; HEIC converted via canvas |
| No music | Soundtrack with real sidechain ducking under voices |
| No per-moment control | Speed (0.5/1/2×) and mute per moment |
| Fixed output | 1080p / 720p export presets |

Beyond the original: **tap tempo**. Tap a few beats and capture lengths snap to
the grid, so a pile of one-second clips cuts on the beat. Tapped rather than
detected, because a wrong automatic guess is worse than no guess.

## Measured on device

iPhone, iOS 18.7, installed to the home screen. These are results, not
assumptions:

| | |
|---|---|
| Consecutive-clip audio | **5 of 5 clips carried audio**, track `live` before and after each; the original's headline bug does not reproduce |
| Recording format | `video/mp4` → H.264 Constrained Baseline + AAC 48 kHz |
| `-c copy` concat | **377 ms** for five clips |
| ffmpeg core load | 7.4 s first time, then service-worker cached |
| Storage quota | **38.4 GB**, `persist()` granted |
| Web Share with files | Supported — *Save Video* reaches Photos |
| `SharedArrayBuffer` | Absent, as expected; the single-threaded core is mandatory |
| Clip size | ~1.5 MB per second at 1080p (~10–12 Mbps) |

Two behaviours worth knowing about:

- **Safari ignores the MediaRecorder timeslice for mp4** and emits one chunk at
  stop, so there is **no partial-moment recovery on iPhone**. A crash mid-record
  loses that moment. Everything already captured is safe, because the journal is
  what protects the project. Chunks are only persisted when they arrive while
  still recording, which on iOS means never — writing them would double every
  moment's disk traffic for no benefit.
- **Backgrounding mutes the camera and mic tracks rather than ending them**, and
  they unmute on return. The session survives app switching, so a mute is only
  reported as an interruption if it happened mid-moment.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run typecheck
npm run build      # → dist/

node e2e/smoke.mjs # end-to-end, needs the built app served at /Glimpse-copy/
```

The e2e run drives Chromium with fake media devices through create → record →
keep → delete → reload → export → apply speed → re-encode → import a photo →
export again.

Two things it checks that unit tests cannot:

- **`getUserMedia` is called once** across multiple moments. That single
  assertion is the app's core reliability claim and must never regress.
- **The filter graph is valid ffmpeg syntax.** It is unit-tested as a string,
  so only a real run proves it executes — including the `-loop 1` input path
  that stills depend on.

## Interface

Built to Apple's Human Interface Guidelines rather than styled by eye: system
colour palette, the iOS type scale, 44pt minimum targets, inset grouped lists
with content-aligned separators, segmented controls, switches, and sheets with
a grabber. Browsing and editing follow the system appearance in both light and
dark; capture is always dark, the way Camera is.

Capture is modelled on the Camera app — shutter, mode selector, flip, and a
dimmed overlay showing exactly which part of the frame the chosen shape keeps.

Two interactions are load-bearing on a phone and were built with pointer
events, not mouse or HTML5 drag:

- **Swipe a row left to delete**, the gesture the original advertised as
  "remove moments with the flick of a finger".
- **Drag ≡ to reorder.** The first implementation used HTML5 drag-and-drop,
  which never fires for touch on iOS — it worked in a desktop browser and was
  silently dead on the target device. The e2e run now asserts reordering by
  comparing moment ids, since rows are labelled by position and a successful
  reorder leaves the visible text identical.

## Architecture

- **`src/storage/journal.ts`** — every mutation is an append-only entry; state
  is rebuilt by replay. A crash can lose at most the entry being written, never
  an existing project.
- **`src/capture/session.ts`** — one `MediaStream` per capture session, reused
  for every moment. This is both the audio fix and what keeps encoder settings
  identical across moments.
- **`src/export/`** — ffmpeg concat at `-c copy` when nothing is trimmed
  (instant, no re-encode), falling back to a real encode only when needed.
  Output goes to the iOS share sheet, where *Save Video* reaches Photos.
- **`src/export/filtergraph.ts`** — pure string generation for the re-encode
  path (trim, speed, mute, fit-and-pad, concat, music ducking). Pure because
  that is the only way to test a filter chain without running ffmpeg in CI.
- **`src/import/media.ts`** — normalises imports at the door. iPhone photos are
  HEIC, which ffmpeg.wasm cannot decode, but Safari can — so images are drawn
  to a canvas and re-encoded as JPEG using the one decoder on the device that
  understands them.
- **`src/cloud/`** — optional Supabase layer. Absent by default.

## Not built

Deliberately left out, so the gap is visible rather than implied:

- **Automatic beat detection.** Tap tempo instead. I cannot listen to the
  output to judge whether a detector is any good, and a badly tuned one is
  worse than none.
- **Titles, captions and filters.**
- **Transitions between moments.** Everything is a hard cut.
- **Journal / serial Glimpses.** A long-running "a moment a day" Glimpse works,
  but there is no date-grouped timeline making it feel like a diary.

### ffmpeg constraints (learned the hard way)

- ffmpeg is **vendored**, not from a CDN — export must work offline.
- Use the **single-threaded** core. GitHub Pages cannot send COOP/COEP, so
  `SharedArrayBuffer` is unavailable and the `-mt` build cannot run.
- Do **not** pass `classWorkerURL` to `ffmpeg.load()`. The UMD build spawns a
  *module* worker when it is set, and module workers have no `importScripts()`,
  so the core fails to import. Omit it and keep `814.ffmpeg.js` beside
  `ffmpeg.js` so the library resolves it itself.

## Optional: collaboration

Everything above works with no account and no backend. Collaboration is
additive and off unless configured.

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor. It
   creates the tables, Row Level Security policies, the `moments` storage
   bucket and the invite-redemption function.
3. Set build-time env vars:

   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```

   For the GitHub Pages build, add them as repository **variables** and pass
   them into the build step.

Sync works because the local journal is already an append-only log of immutable
entries with stable ids: both sides exchange the entries the other lacks and
replay the union. There is no diffing and no merge algorithm. The Supabase SDK
is dynamically imported, so users who never sign in do not pay for it at
startup.

**Storage cost, honestly:** moment files upload at full quality. Measured on
device, one-second 1080p clips are ~1.5 MB, so a 60-moment Glimpse is roughly
90 MB against Supabase's 1 GB free tier — call it ten shared Glimpses.
Generating smaller proxies would mean a full re-encode per moment on the phone,
which costs more in battery and time than it saves in bytes. If you outgrow the
free tier, Cloudflare R2 (10 GB free, no egress fees) is the migration target.

## Phase 0 spike

[`public/spike/`](public/spike/) is the diagnostic page that produced the
measurements above. Kept rather than deleted, because it is the only way to
check real iOS Safari behaviour — no CI can run it — and it is worth re-running
after an iOS release.

Live at `/Glimpse-copy/spike/`. Install to the home screen first; two of its
checks report differently in a browser tab.
