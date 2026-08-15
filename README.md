# Glimpse-copy

A capture-first video storytelling PWA — record short "moments", append them into
one growing video, reorder and trim, export. Installed to the iPhone home screen
via Safari, not the App Store.

**Status: Phase 0.** Only the on-device diagnostic spike exists. The app is not
built yet.

## Why a PWA

No Mac, no Apple Developer account, no App Store review. Safari → Share → Add to
Home Screen. The app is local-first: capture never depends on the network.

## Phase 0 — run the spike

Deployed to GitHub Pages on every push. On your iPhone, open:

```
https://<user>.github.io/Glimpse-copy/spike/
```

Then: **Add to Home Screen first**, reopen from the icon, and run all tests in
order. Tap *Copy results* at the end.

It answers the questions CI cannot, because no CI runs iOS Safari:

| # | Test | Why it matters |
|---|------|----------------|
| 1 | Environment, codecs, Web Share | Confirms `video/mp4` recording and that export can reach Photos |
| 2 | Storage quota and `persist()` | Video is heavy; this is the main risk to the whole approach |
| 3 | **5 consecutive clips, one stream** | The original app silently loses audio on the 2nd+ clip |
| 4 | ffmpeg `-c copy` concat | Export speed depends on stitching without re-encoding |
| 5 | Interruption log | Backgrounding, screen lock, and phone calls during capture |

**Gate:** if audio survives all 5 clips and concat is fast, Phase 1 proceeds as
planned. If not, the approach gets revisited before app code is written.

## Notes for later

- ffmpeg is **vendored**, not loaded from a CDN — the app must export offline.
- Use the **single-threaded** core. GitHub Pages cannot send COOP/COEP, so
  `SharedArrayBuffer` is unavailable and the `-mt` build cannot run.
- Do **not** pass `classWorkerURL` to `ffmpeg.load()`. The UMD build spawns a
  *module* worker when it is set, and module workers have no `importScripts()`,
  so loading the UMD core fails. Omit it and keep `814.ffmpeg.js` next to
  `ffmpeg.js` so the library can resolve it itself.

## Plan

Phase 0 spike → Phase 1 local-first app → Phase 2 deploy/install → Phase 3
accounts → Phase 4 collaborative Glimpses.
