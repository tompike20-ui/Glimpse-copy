# Glimpse-copy — decision record

A record of what was decided while building a personal copy of **Glimpse –
Video storytelling** (Excellent Rectangle, App Store ID `969793701`), and why.
Written for a fresh start: it states the choices, the reasoning behind them,
the options rejected, and the places where we changed our minds partway
through.

It is a record, not a set of instructions. Where a decision still looks right,
the reasoning is here so it can be re-adopted quickly. Where it looks wrong,
the reasoning is here so it can be argued with.

---

## 1. The fixed points

These came from the project owner and were never up for negotiation. Everything
in section 3 follows from them.

| Constraint | Decision |
|---|---|
| Distribution | **PWA**, installed via Safari → Add to Home Screen. No Mac, no Apple Developer account, no App Store. |
| Hosting | **GitHub Pages**, deployed from the repo. |
| Priority | **Rock-solid capture.** Reliability over features, explicitly, when asked to rank. |
| Approach | **Clone first, then improve.** |
| Sharing | Collaborative Glimpses, *and* other people able to use the app independently. |
| Data | Existing recordings must survive every change. Stated as a precondition partway through, and treated as binding from then on. |

### What the original app does, and what's wrong with it

The core loop: record a short fixed-length "moment", review it, append it to a
growing video, reorder and trim later, export. Last real update v1.6, Sept 2021.

Defects worth designing against, from the App Store reviews:

- **Audio silently missing on the 2nd+ clip in a session.** One reviewer lost
  wedding vows. This is the single most important thing to get right.
- Front-camera frames cropped to black.
- A forced outro card.
- A paywall on the basic 2s/3s moment lengths.

---

## 2. The one real tension, and how it resolved

GitHub Pages is static-only. Collaboration needs auth, a database and storage.

Rather than override either of the owner's choices, the frontend stays on
GitHub Pages and **Supabase** supplies auth + Postgres + Storage + Realtime,
called directly from the browser with Row Level Security doing the enforcement.
There is no server to run, so the hosting choice survives intact.

Worth separating two things that got conflated in the original request:

- *"Other people can use the app independently"* needs **no backend at all**.
  It's a public URL plus local-first storage. This works today.
- *Collaborative Glimpses* is the only part that needs Supabase.

---

## 3. Decisions

### 3.1 Stack

| Choice | Reasoning |
|---|---|
| Vite + React 18 + TypeScript | Unremarkable, fast, and the PWA plugin is good. |
| Zustand | The app has one store and little global state. Redux-scale tooling would be overhead. |
| `idb` | Thin promise wrapper over IndexedDB. No ORM, no migration framework. |
| `vite-plugin-pwa` (Workbox) | Manifest + service worker without hand-writing either. |
| **HashRouter**, not BrowserRouter | GitHub Pages has no SPA rewrite, so `/project/123` would 404 on reload or deep-link. The URL is invisible inside an installed PWA anyway. |
| **Plain CSS with custom properties** | *Changed our mind.* The plan said Tailwind. The app turned out to be a small set of iOS-shaped primitives — grouped lists, sheets, segmented controls — and a token file expressed them better than utility classes. Tailwind was never installed. |

### 3.2 Storage

**Append-only journal, replayed on launch, is the source of truth.** Project
state is never written directly; every mutation is an immutable entry appended
to a log. Launch replays the log into memory.

This was chosen for crash-safety — a crash can lose at most the entry being
written, never an existing project — and it paid off twice more:

- **Sync fell out of it for free.** Collaboration is "exchange the entries the
  other side lacks, replay the union". No diffing, no merge algorithm, no
  conflict resolution.
- **Undo is natural.** Deletion is an entry, so restoring is another entry.

Entries carry a uuid that doubles as the server primary key, which makes pushing
idempotent — a retry after a dropped connection cannot duplicate work.

**Fourteen entry types:** `project.create` `project.rename` `project.lock`
`project.delete` `project.music` `project.bpm` `project.exportPreset`
`moment.add` `moment.remove` `moment.restore` `moment.purge` `moment.reorder`
`moment.trim` `moment.props`

**IndexedDB `glimpse`, version 1, four stores:** `journal` (autoIncrement),
`blobs`, `pending` (in-flight recorder chunks), `meta`.

Two rules that became binding once data safety was raised:

1. **Schema changes are additive only.** No destructive version bumps. A new
   field is optional, so journals written before it existed replay unchanged.
   This is tested with fixtures in the *old* shapes, not just the current one.
2. **Nothing deletes a video file except** the trash expiry sweep, an explicit
   purge, or replacing a music track.

Video blobs live in IndexedDB. Safari backs these with files rather than memory,
so a long Glimpse is not held in RAM. `navigator.storage.persist()` is requested
on first launch.

### 3.3 Capture — the core of the project

Ten decisions, most aimed squarely at the original's defects.

1. **One long-lived `MediaStream` per session.** `getUserMedia` is called once
   on entering a project and held; each moment gets a fresh `MediaRecorder`
   bound to that same stream. Re-acquiring per clip is the signature of the
   original's missing-audio bug. **This is the single most important decision in
   the project** — everything else is replaceable.
2. **Verify the audio track is live and unmuted before arming.** If it isn't,
   re-acquire and say so, rather than silently recording a mute clip.
3. **Live audio meter**, driven by an `AnalyserNode`. Cheap, and the strongest
   single defence against losing something irreplaceable.
4. **Interruption handling** for `visibilitychange`, `pagehide`, and track
   `ended`/`mute` — phone call, Siri, another app taking the mic.
5. **Identical encoder settings for every moment**, which falls out of never
   re-acquiring the stream, and is what makes `-c copy` export work.
6. **Pre-warm the camera** on entering a project, so the first tap has no
   latency. The record button stays disabled until `getUserMedia` resolves —
   without that, an early tap is silently ignored.
7. **Fit the chosen aspect, never crop**, on both cameras. Fixes the original's
   black-half-frame bug.
8. **All moment lengths free** (1s/2s/3s/5s). The original paywalls everything
   past one second.
9. **No outro card, ever.**
10. **Tap tempo, not automatic beat detection.** Snapping clip lengths to a beat
    grid is what makes a pile of one-second clips look edited. It is *tapped*
    rather than detected because a wrong guess is worse than no guess, and the
    output of a detector cannot be evaluated by ear from inside a build process.

### 3.4 Export

**Concat demuxer at `-c copy` whenever possible; re-encode only when forced.**
This holds because all moments share encoder parameters by construction.

The fast path is **decided up front, not discovered by exception**. *Changed our
mind here:* the first version attempted `-c copy` and caught the failure. That
meant a doomed pass that reads every segment before failing, and a UI that
couldn't explain why export had suddenly become slow. `planExport` now reports
which of five conditions forced the slow path, so the progress text can say
what the wait is for: `trimmed`, `mixed-sizes`, `music`, `effects`, `imported`.

Other export decisions:

- **Filter graph built as pure string generation**, so it can be unit-tested
  without running ffmpeg. The e2e run is then the only check needed that it is
  valid ffmpeg rather than merely well-formed text.
- **A muted moment contributes silence of exactly its own length** rather than
  being dropped. Dropping the stream desynchronises everything after it.
- **Soundtrack ducking uses `sidechaincompress`**, so music pulls back whenever
  there is sound in the clips — not a fixed volume cut.
- **Imported images are normalised at the door, not at export.** iPhone photos
  are HEIC, which ffmpeg.wasm cannot decode but Safari can. They are drawn to a
  canvas and re-encoded as JPEG using the one decoder on the device that
  understands them.
- **Snapshot export never touches ffmpeg.** The frame is already decoded and on
  screen, so a canvas grab is instant, needs no 31 MB core download, and cannot
  pick a different frame than the one being looked at.
- Output goes to `navigator.share({files})` → iOS share sheet → **Save Video**.
  A sandboxed page cannot write to the photo library, and a download link is
  inert inside an installed PWA, so this is the only route.

### 3.5 Deletion and data safety

*Changed our mind.* Deleting a moment originally erased its file immediately, so
one mis-swipe destroyed footage permanently. That contradicted the premise the
app is built on — the onboarding screen literally says "nothing gets lost".

Deletion now moves the moment to a **trash held for 30 days**, Undo is offered
immediately, and Recently Deleted lists what is recoverable with days remaining.
Deleting a whole Glimpse trashes its moments too. Trashed files count as live,
so orphan detection cannot sweep them up.

### 3.6 Interaction

- **Pointer events everywhere, never HTML5 drag-and-drop.** HTML5 DnD never
  fires for touch on iOS. Reorder worked in a desktop browser and was silently
  dead on the only platform the app ships to. The same applies to
  swipe-to-delete and the trim handles.
- **Drags are tracked on `window`, not on the dragged element.** Hit-testing
  what is underneath requires the dragged element to be transparent to
  `elementFromPoint`, which means `pointer-events: none` — which also stops it
  receiving the `pointerup` that ends the drag.
- **Reorder bookkeeping lives in refs, not state.** Calling the reorder callback
  inside a `setState` updater is a side effect in what must be a pure function;
  React can double-invoke or drop it.
- **A 3px visual edge gets a 32px invisible target.** Nothing tappable is below
  44pt.

### 3.7 Design direction

*Changed our mind twice.*

1. The brief started as "make it look like Glimpse". The App Store screenshots
   turned out to be unreachable from the build environment, so matching it
   visually could only have been invention. The owner redirected: **"run
   separate to Glimpse — make it look like a polished app that would be
   publishable to the App Store."**
2. Interactive text was originally iOS blue, on the reasoning that blue is
   familiar and contrast-safe. Once the rest of the app went amber, a single
   blue element looked like a leftover. The blue token was **deleted** rather
   than left unreferenced, so it cannot drift back in.

The resulting system:

| Token | Value | Why |
|---|---|---|
| `--brand` | `#e08700` (light) / `#ffb020` (dark) | Amber reads warm and filmic, and stays clear of the red that record and destructive actions own. **Fills and icons only.** |
| `--brand-ink` | `#c2410c` | Amber on white measures ~2.9:1 — well under the 4.5:1 text minimum. This burnt orange measures 5.2:1 on white and 4.6:1 on the grouped background. **Anything that has to be read.** A darker yellow passes contrast too, but reads muddy brown. |
| `--grad` | `linear-gradient(160deg, #f0a01c, #d24b16)` | Primary buttons and the app mark. |
| `--radius` | `14px` | |

Other decisions:

- **Vector icons on a 24×24 grid, no text glyphs or emoji.** Those were the
  clearest tell that this was a web page: they render differently per platform,
  ignore the type scale, and cannot inherit weight.
- **Browsing and editing follow the system appearance; capture is always dark**,
  the way Camera is.
- **The footage is the interface.** The list was grouped rows with 52px
  thumbnails — a settings screen that happened to contain video. It became
  poster cards; the editor became a stage over a horizontal filmstrip.
- **One moment view, not two.** *Changed our mind:* a list/grid toggle paged
  between two views of the same data. A horizontal filmstrip scrolls instead,
  and sixty moments need no second screen.
- **Controls inline, not in a sheet.** *Changed our mind:* per-moment trim and
  speed lived in a sheet you had to open and dismiss to compare two clips.
- **Export is a choice you confirm, not one that fires on tap.** Exporting is a
  wait, so mis-tapping the wrong kind means sitting through it.

### 3.8 Verification

- **Unit tests (Vitest)** for anything expressible as a pure function: journal
  replay, ordering, trim maths, filter-graph generation, quota accounting.
  Currently 94.
- **One end-to-end run (Playwright, Chromium, fake media devices)** covering the
  whole journey. Currently 17 steps. It asserts things a unit test cannot, most
  importantly **`getUserMedia` is called exactly once across three moments** —
  the structural proof that the audio bug cannot return.
- **A screenshot harness** that drives the app to each surface at iPhone size
  and writes a PNG per screen. This was kept rather than thrown away because
  *every single visual defect in the project was found by looking at a
  screenshot, not by a test*. Markup that passes assertions says nothing about
  whether a layout is right.
- **An on-device checklist**, because no CI can run iOS Safari. See §6.

---

## 4. Measured findings

These cost the most to discover and are the most valuable thing in this
document. The first four were measured on a real iPhone (iOS 18.7, installed to
the home screen) in a throwaway diagnostic page built **before any app code** —
a decision that paid for itself immediately.

### Verified on device

| Finding | Value |
|---|---|
| Audio across consecutive clips on one held stream | **5 of 5 carried audio**, track live before and after each. The held-stream design works. |
| `-c copy` concat of 3 clips | **377 ms** |
| Storage quota | **38.4 GB**, persistence granted |
| `SharedArrayBuffer` | **Absent**, as predicted |
| ffmpeg core load, first use → cached | **7376 ms → 150 ms** (the service worker caches it as intended, so the slow first export is a genuine one-off) |
| 1080p footage size | **~1.5 MB per second** (the earlier ~1 MB estimate was wrong) |

### Three assumptions the device disproved

1. **Safari ignores the `MediaRecorder` timeslice for mp4** and emits a single
   chunk at stop. The mid-recording flush to IndexedDB never fired on iPhone.
   The claim that a crash costs at most one timeslice was wrong there — it costs
   the in-flight moment. Chunks are now persisted only when they arrive while
   still recording, rather than writing every moment to disk twice for a
   recovery path iOS does not provide.
2. **A 1000 ms request reliably produces a 1090 ms file.** Duration was taken
   from the wall clock, so trim sliders were capped ~90 ms short of real
   footage. Duration is now measured from the file, falling back to the timer
   when Safari reports `Infinity`.
3. **Backgrounding mutes tracks rather than ending them**, and unmutes on
   return. Reporting every mute as an interruption meant ordinary app switching
   raised a false error. Mutes are now surfaced only mid-moment.

Also observed: iOS produces **variable frame rates across clips** (29.54 to
30.56 fps, with `tbr` differing between sessions). Harmless when all clips share
resolution and codec, but it exposed that the stream-copy decision was only
checking trims, not segment compatibility.

### Hard platform constraints

- **GitHub Pages cannot set HTTP headers** → no COOP/COEP → no cross-origin
  isolation → no `SharedArrayBuffer` → **the single-threaded ffmpeg.wasm core is
  mandatory.** Acceptable because `-c copy` is I/O-bound.
  - The `coi-serviceworker` workaround conflicts with the PWA service worker.
    Rejected.
- **Never pass `classWorkerURL` to ffmpeg's `load()`.** It makes the UMD build
  spawn a *module* worker, which has no `importScripts`, so the core fails to
  import. Omitting it spawns a classic worker that resolves `814.ffmpeg.js`
  relative to `ffmpeg.js`.
- **ffmpeg is vendored, not loaded from a CDN**, because export has to work
  offline. It is runtime-cached rather than precached — ~31 MB would make first
  install punishing on cellular.
- **Home-screen PWAs are exempt** from WebKit's 7-day script-storage eviction
  cap. `navigator.storage.persist()` is fully supported from Safari 17.
- **iOS has a small simultaneous video-decoder budget.** A filmstrip that mounts
  one `<video>` per tile will simply fail to decode the extras. Thumbnails must
  capture one frame to a canvas and release the element.
- One source claimed a "~50 MB PWA storage limit". **This is false** on modern
  WebKit, where quota scales with disk — measured at 38.4 GB.

---

## 5. What exists today

### Working

Phases 0–2 of the original plan: the diagnostic spike, the local-first app
(capture, edit, organise, export), and deploy-and-install. Plus everything
requested later: export as video or snapshot, preview of a clip and of the whole
Glimpse, randomise and organise, the UI overhaul, playback from the list, and
recording into the middle of the timeline.

### Built but switched off

**Collaboration (Phases 3–4).** The code is complete and tested — Supabase Auth
by magic link, Postgres under Row Level Security, Storage for moment files,
Realtime for live updates. There is no `.env`, so `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are undefined and the app deliberately behaves as if
collaboration does not exist.

Design notes worth keeping if it is revived:

- Every table behind RLS, because the browser talks to Postgres directly and
  there is no server in between.
- Membership checks through a `SECURITY DEFINER` function, to avoid recursive
  policy evaluation.
- Entries have **no update or delete policy**, so the log cannot be rewritten by
  anyone, including the owner.
- Storage objects authorised by their project-id path prefix.
- The Supabase SDK is **dynamically imported**. *Changed our mind:* bundling it
  statically pushed the initial bundle from 192 KB to 420 KB for every user
  including those who never sign in, which contradicts the local-first premise.

**Storage economics, flagged honestly:** raw video is heavy. A 2-minute 1080p
Glimpse is roughly 150 MB of raw moments, against Supabase's free tier of 1 GB
storage and 5 GB monthly bandwidth. The plan was to upload **720p proxies** while
originals stay on-device, rendering finally from the highest-quality source
available. If that outgrows the tier, Cloudflare R2 (10 GB free, zero egress) is
the migration target. **Worth knowing before inviting people, not after.**

### Never built

Recommended early, then deprioritised when capture reliability was chosen as the
sole priority. None were ever requested:

- Automatic beat detection (tap tempo exists; see §3.3 for why detection was
  rejected rather than deferred)
- Titles and captions
- Filters / colour grading
- Transitions between moments
- A date-grouped view of the Glimpses list
- Changing a Glimpse's shape after creation
- A warning when backgrounding interrupts an export

---

## 6. The on-device checklist

No CI can run iOS Safari, so this is the verification that actually counts.
**Only item 1 has ever been run** — in the Phase 0 spike. Everything since has
been verified in Chromium with a fake camera.

1. Record 10 consecutive moments; confirm **all 10 have audio**. ✅ *(passed as
   5/5 in the spike)*
2. Background the app mid-moment; confirm clean recovery with no lost project.
3. Take a phone call mid-capture; confirm recovery.
4. Force-quit mid-recording; confirm journal replay loses at most the in-flight
   moment.
5. Flip front/back cameras mid-project; confirm no black bars and that export
   still runs `-c copy`.
6. Export a 30-moment project; confirm timing and that Save Video reaches Photos.
7. Leave the installed PWA untouched for 8+ days; confirm data survives.

---

## 7. If starting again

Things worth doing differently, in rough order of value.

1. **Build the diagnostic spike first, again.** It cost very little and
   disproved three assumptions that were already baked into working code. The
   findings in §4 mean a second attempt can skip it — but only if those
   findings are trusted rather than re-derived.
2. **Settle the shell before the features.** The list and editor were built as
   grouped lists, then rebuilt as poster cards and a filmstrip. The second
   version is better, and the first version's CSS, grid view and per-moment
   sheet all had to be deleted. Design the shell first; the design-canvas
   artboards already exist.
3. **Decide the appearance model once.** The artboards are dark-first; the app
   supports light and dark via tokens. Both are defensible; holding both open
   meant every surface had to work twice.
4. **Write the screenshot harness on day one.** It found every visual defect.
   The test suite found none of them.
5. **Keep one shared component for "a frame of a moment".** Three separate
   copies of blob → object URL → `<video>` were written before they were
   consolidated, and the bugs in each were slightly different.
6. **Treat collaboration as a genuinely separate project.** It is the most
   expensive part of the plan and the least connected to the stated priority.
   The local-first app is complete and useful without it, and "other people can
   use the app" was already satisfied by a public URL.
