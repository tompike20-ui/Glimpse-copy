import { useCallback, useEffect, useRef, useState } from 'react';
import type { Moment, MusicTrack } from '../types';
import { momentSpeed, trimmedDurationMs } from '../types';
import { getBlob } from '../storage/db';
import { Icon } from './Icon';

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
}

export function Preview({ moments, music, onClose }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);

  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [slot, setSlot] = useState<0 | 1>(0);

  // Elapsed time of all moments before the current one, so the progress bar
  // reflects the whole Glimpse rather than the clip.
  const priorMs = useRef(0);
  const stillTimer = useRef<number | null>(null);

  const total = moments.reduce((s, m) => s + trimmedDurationMs(m), 0);

  /* Blob URLs for every moment. These are references, not copies, so holding
     them all at once is cheap even for a long Glimpse. */
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];

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
  }, [moments, music]);

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

  /* Drive the active element for the current moment. */
  useEffect(() => {
    if (!ready || !current) return;
    if (stillTimer.current) window.clearTimeout(stillTimer.current);

    if (current.kind === 'still') {
      if (!playing) return;
      stillTimer.current = window.setTimeout(
        advance,
        trimmedDurationMs(current),
      );
      return () => {
        if (stillTimer.current) window.clearTimeout(stillTimer.current);
      };
    }

    const el = (slot === 0 ? videoA : videoB).current;
    if (!el) return;

    el.playbackRate = momentSpeed(current);
    el.muted = !!current.muted || (!!music && music.duckClips);
    el.volume = music && !music.duckClips ? 1 : 0.35;
    el.currentTime = current.trimStartMs / 1000;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [ready, current, slot, playing, advance, music]);

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
    const a = audioRef.current;
    if (a) a.currentTime = 0;
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
          <img className="preview-still" src={urls[current.id]} alt="" />
        )}

        {!ready && <div className="preview-hint">Loading…</div>}

        {(!playing || finished) && ready && (
          <button
            className="preview-play"
            onClick={(e) => {
              e.stopPropagation();
              finished ? restart() : setPlaying(true);
            }}
            aria-label={finished ? 'Play again' : 'Play'}
          >
            <Icon name={finished ? 'flip' : 'play'} size={32} strokeWidth={2} />
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
        <button className="btn tinted" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
