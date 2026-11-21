import { useCallback, useEffect, useRef, useState } from 'react';
import type { Moment, MusicTrack } from '../types';
import { momentSpeed, trimmedDurationMs } from '../types';
import { getBlob } from '../storage/db';
import { Icon } from './Icon';
import type { FrameSource } from '../export/snapshot';

/**
 * Plays a Glimpse without exporting it.
 *
 * Rather than rendering the video and then playing the result — which would
 * mean waiting through a full ffmpeg pass to check whether an edit worked —
 * this plays the moments back to back from their stored files, honouring trim,
 * speed, mute and stills.
 *
 * Two video elements alternate: one plays while the next is preloaded and
 * seeked to its start frame. A single element would show a black flash at
 * every cut, which on one-second moments is most of what you would see.
 */

interface Props {
  moments: Moment[];
  music?: MusicTrack | null;
  onClose: () => void;
  /**
   * When set, the preview doubles as a frame picker: it opens paused on the
   * first moment and offers to save whatever is on screen. Picking a frame
   * anywhere but here would mean guessing which one was wanted.
   */
  onSaveFrame?: (src: FrameSource) => void;
  saving?: boolean;
}

export function Preview({ moments, music, onClose, onSaveFrame, saving }: Props) {
  const picking = !!onSaveFrame;
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!onSaveFrame);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);

  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const stillRef = useRef<HTMLImageElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [slot, setSlot] = useState<0 | 1>(0);
  // Where inside the current moment the scrubber sits, while picking a frame.
  const [scrubS, setScrubS] = useState(0);
  /* Bumped to ask for a re-seek to the current moment's start. Restart and the
     picker's step buttons can land on the moment that is already showing, and
     a state value that does not change cannot re-run an effect. */
  const [seekNonce, setSeekNonce] = useState(0);

  // Elapsed time of all moments before the current one, so the progress bar
  // reflects the whole Glimpse rather than the clip.
  const priorMs = useRef(0);
  const stillTimer = useRef<number | null>(null);

  const total = moments.reduce((s, m) => s + trimmedDurationMs(m), 0);

  /* Which files this player needs, as a value rather than an array identity.
     Keying the loader below on `moments` itself means any caller that rebuilds
     the array on render makes it revoke and re-fetch everything each time. */
  const sourceKey = moments.map((m) => m.blobKey).join(',') + `|${music?.blobKey ?? ''}`;

  /* Blob URLs for every moment. These are references, not copies, so holding
     them all at once is cheap even for a long Glimpse. */
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];

    // Clear before revoking: the cleanup below frees every URL in the previous
    // set, and any element still rendered with one would fail to load it.
    setUrls({});
    setMusicUrl(null);
    setReady(false);

    void (async () => {
      const next: Record<string, string> = {};
      for (const m of moments) {
        const b = await getBlob(m.blobKey);
        if (!b) continue;
        const u = URL.createObjectURL(b);
        made.push(u);
        next[m.id] = u;
      }
      if (music) {
        const mb = await getBlob(music.blobKey);
        if (mb) {
          const u = URL.createObjectURL(mb);
          made.push(u);
          if (!cancelled) setMusicUrl(u);
        }
      }
      if (!cancelled) {
        setUrls(next);
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sourceKey stands
    // in for moments/music by value; see the comment above.
  }, [sourceKey]);

  const current = moments[index];
  const next = moments[index + 1];

  const advance = useCallback(() => {
    setIndex((i) => {
      const done = moments[i];
      if (done) priorMs.current += trimmedDurationMs(done);
      const n = i + 1;
      if (n >= moments.length) {
        setPlaying(false);
        return i;
      }
      setSlot((s) => (s === 0 ? 1 : 0));
      return n;
    });
  }, [moments]);

  /* Position the active element on the current moment's first frame, and give
     it that moment's rate and volume. */
  useEffect(() => {
    if (!ready || !current || current.kind === 'still') return;
    const el = (slot === 0 ? videoA : videoB).current;
    if (!el) return;

    el.playbackRate = momentSpeed(current);
    el.muted = !!current.muted || (!!music && music.duckClips);
    el.volume = music && !music.duckClips ? 1 : 0.35;

    // Seeking an element that has not loaded metadata yet is silently ignored,
    // which on a trimmed moment leaves the wrong frame on screen — and while
    // picking a frame, the wrong frame is the one that gets saved.
    const seekToStart = () => {
      el.currentTime = current.trimStartMs / 1000;
    };
    if (el.readyState >= 1) seekToStart();
    else el.addEventListener('loadedmetadata', seekToStart, { once: true });

    return () => el.removeEventListener('loadedmetadata', seekToStart);
    // Deliberately not keyed on `playing`: rewinding to the trim point every
    // time playback pauses would restart the moment on every tap, and would
    // discard the position the frame picker's scrubber was left at.
  }, [ready, current, slot, music, seekNonce]);

  /* Transport: run or hold, without moving the playhead. A still has no
     playback of its own, so it is held for its duration on a timer. */
  useEffect(() => {
    if (!ready || !current) return;

    if (current.kind === 'still') {
      if (!playing) return;
      stillTimer.current = window.setTimeout(advance, trimmedDurationMs(current));
      return () => {
        if (stillTimer.current) window.clearTimeout(stillTimer.current);
      };
    }

    const el = (slot === 0 ? videoA : videoB).current;
    if (!el) return;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [ready, current, slot, playing, advance]);

  /* Preload the following moment into the idle element and park it on its
     first frame, so the swap is instant. */
  useEffect(() => {
    if (!ready || !next || next.kind === 'still') return;
    const el = (slot === 0 ? videoB : videoA).current;
    if (!el) return;
    const onMeta = () => {
      el.currentTime = next.trimStartMs / 1000;
    };
    el.addEventListener('loadedmetadata', onMeta, { once: true });
    return () => el.removeEventListener('loadedmetadata', onMeta);
  }, [ready, next, slot]);

  /* Stop at the trim point and keep the progress bar moving. */
  useEffect(() => {
    if (!playing || !current || current.kind === 'still') return;
    let raf = 0;
    const tick = () => {
      const el = (slot === 0 ? videoA : videoB).current;
      if (el) {
        const startS = current.trimStartMs / 1000;
        const endS = (current.trimEndMs ?? current.durationMs) / 1000;
        const played = Math.max(0, el.currentTime - startS);
        setElapsed(priorMs.current + (played * 1000) / momentSpeed(current));
        if (el.currentTime >= endS - 0.02) {
          advance();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, current, slot, advance]);

  /* Progress for stills, which have no timeupdate of their own. */
  useEffect(() => {
    if (!playing || !current || current.kind !== 'still') return;
    const started = performance.now();
    let raf = 0;
    const tick = () => {
      setElapsed(priorMs.current + (performance.now() - started));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, current]);

  /* Park the scrubber at the start of whichever moment is now showing. */
  useEffect(() => {
    if (!current) return;
    setScrubS(current.trimStartMs / 1000);
  }, [current]);

  /* Soundtrack runs across the whole preview, independent of the clips. */
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !musicUrl) return;
    a.volume = music?.volume ?? 0.7;
    if (playing) void a.play().catch(() => {});
    else a.pause();
  }, [playing, musicUrl, music]);

  function restart() {
    priorMs.current = 0;
    setElapsed(0);
    setIndex(0);
    setSlot(0);
    setPlaying(true);
    setSeekNonce((n) => n + 1);
    const a = audioRef.current;
    if (a) a.currentTime = 0;
  }

  /** Jump straight to a moment and hold there, paused on its first frame. */
  function goTo(i: number) {
    const clamped = Math.max(0, Math.min(moments.length - 1, i));
    priorMs.current = moments
      .slice(0, clamped)
      .reduce((s, m) => s + trimmedDurationMs(m), 0);
    setElapsed(priorMs.current);
    setPlaying(false);
    setSlot(0);
    setIndex(clamped);
    setSeekNonce((n) => n + 1);
  }

  /** Whatever is currently on the stage, for the caller to draw. */
  function stageSource(): FrameSource | null {
    if (!current) return null;
    if (current.kind === 'still') {
      const img = stillRef.current;
      return img ? { el: img, kind: 'still' } : null;
    }
    const el = (slot === 0 ? videoA : videoB).current;
    return el ? { el, kind: 'video' } : null;
  }

  /* Scrub within the current moment, so the saved frame is the one wanted
     rather than merely the one the clip happened to be paused on. */
  const startS = current ? current.trimStartMs / 1000 : 0;
  const endS = current
    ? (current.trimEndMs ?? current.durationMs) / 1000
    : 0;

  function seekTo(seconds: number) {
    const el = (slot === 0 ? videoA : videoB).current;
    if (!el) return;
    el.currentTime = seconds;
    setScrubS(seconds);
    setElapsed(
      priorMs.current +
        ((seconds - startS) * 1000) / (current ? momentSpeed(current) : 1),
    );
  }

  const finished = !playing && index === moments.length - 1 && elapsed > 0;
  const pct = total ? Math.min(100, (elapsed / total) * 100) : 0;

  return (
    <div className="preview" role="dialog" aria-label="Preview">
      <div className="preview-stage" onClick={() => setPlaying((p) => !p)}>
        <video
          ref={videoA}
          src={slot === 0 ? urls[current?.id ?? ''] : urls[next?.id ?? '']}
          playsInline
          style={{ opacity: slot === 0 ? 1 : 0 }}
        />
        <video
          ref={videoB}
          src={slot === 1 ? urls[current?.id ?? ''] : urls[next?.id ?? '']}
          playsInline
          style={{ opacity: slot === 1 ? 1 : 0 }}
        />

        {current?.kind === 'still' && urls[current.id] && (
          <img
            ref={stillRef}
            className="preview-still"
            src={urls[current.id]}
            alt=""
          />
        )}

        {!ready && <div className="preview-hint">Loading…</div>}

        {/* While picking a frame this moves out of the centre and shrinks: the
            frame under it is the whole point of the screen. */}
        {(!playing || finished) && ready && (
          <button
            className={`preview-play${picking ? ' corner' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              finished ? restart() : setPlaying(true);
            }}
            aria-label={finished ? 'Play again' : 'Play'}
          >
            <Icon
              name={finished ? 'flip' : 'play'}
              size={picking ? 20 : 32}
              strokeWidth={2}
            />
          </button>
        )}
      </div>

      {musicUrl && <audio ref={audioRef} src={musicUrl} loop />}

      <div className="preview-bar">
        <div className="preview-track">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="preview-meta">
          <span>
            Moment {Math.min(index + 1, moments.length)} of {moments.length}
          </span>
          <span>
            {(elapsed / 1000).toFixed(1)}s / {(total / 1000).toFixed(1)}s
          </span>
        </div>

        {picking ? (
          <>
            {current?.kind !== 'still' && endS > startS && (
              <input
                className="preview-scrub"
                type="range"
                // Whole milliseconds, one frame at a time. Seconds would put
                // the step grid on a float, where 0.6 is not a multiple of
                // 0.02 and the browser rejects the value.
                min={Math.round(startS * 1000)}
                max={Math.round(endS * 1000)}
                step={33}
                value={Math.round(scrubS * 1000)}
                aria-label="Position within this moment"
                onChange={(e) => {
                  setPlaying(false);
                  seekTo(Number(e.target.value) / 1000);
                }}
              />
            )}
            <div className="preview-steps">
              <button
                className="btn tinted"
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                aria-label="Previous moment"
              >
                <Icon name="chevron-left" size={18} strokeWidth={2.4} />
              </button>
              <button
                className="btn filled"
                onClick={() => {
                  const src = stageSource();
                  if (src) onSaveFrame?.(src);
                }}
                disabled={!ready || saving}
              >
                {saving ? 'Saving…' : 'Save frame'}
              </button>
              <button
                className="btn tinted"
                onClick={() => goTo(index + 1)}
                disabled={index >= moments.length - 1}
                aria-label="Next moment"
              >
                <Icon name="chevron-right" size={18} strokeWidth={2.4} />
              </button>
            </div>
            <button className="btn plain" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn tinted" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}
