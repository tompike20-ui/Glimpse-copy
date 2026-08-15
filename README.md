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
| Capture-only, no recovery | Chunks flushed to disk mid-recording and salvaged after a crash |

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
keep → delete → reload → export, and asserts `getUserMedia` is called **once**
across multiple moments. That single assertion is the app's core reliability
claim, so it should never be allowed to regress.

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
- **`src/cloud/`** — optional Supabase layer. Absent by default.

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

**Storage cost, honestly:** moment files upload at full quality. One-second
1080p clips are roughly 1 MB each, so a 60-moment Glimpse is around 60 MB
against Supabase's 1 GB free tier — call it a dozen or so shared Glimpses.
Generating smaller proxies would mean a full re-encode per moment on the phone,
which costs more in battery and time than it saves in bytes. If you outgrow the
free tier, Cloudflare R2 (10 GB free, no egress fees) is the migration target.

## Phase 0 spike

[`public/spike/`](public/spike/) is a throwaway diagnostic page, kept because it
is the only way to measure real iOS Safari behaviour — no CI can run it. It
reports codec support, actual storage quota, `persist()` grant, whether audio
survives five consecutive clips, and ffmpeg concat timing.

Live at `/Glimpse-copy/spike/`.
