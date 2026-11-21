import { useEffect, useRef, useState } from 'react';
import { momentSpeed, trimmedDurationMs, type Moment } from '../types';
import { getBlob } from '../storage/db';
import { Icon } from './Icon';

function describeMoment(m: Moment): string {
  if (m.source === 'import') return m.kind === 'still' ? 'Photo' : 'Imported';
  return m.facing === 'user' ? 'Front camera' : 'Back camera';
}

/**
 * One moment, playing on a loop inside its own sheet.
 *
 * The trim and speed controls used to sit above nothing but numbers: you moved
 * a slider and had to export, or preview the whole Glimpse, to find out what
 * you had done. This plays the trimmed range only, and follows the sliders as
 * they move, so the controls have something to be about.
 */
export function ClipPreview({
  moment,
  mediaRef,
}: {
  moment: Moment;
  /** Lets the editor grab the frame currently on the stage for a snapshot,
   *  rather than opening a second player to choose one. */
  mediaRef?: React.MutableRefObject<HTMLVideoElement | HTMLImageElement | null>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const liveUrl = useRef<string | null>(null);

  const startS = moment.trimStartMs / 1000;
  const endS = (moment.trimEndMs ?? moment.durationMs) / 1000;

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    void getBlob(moment.blobKey).then((b) => {
      if (!b || cancelled) return;
      setUrl(URL.createObjectURL(b));
    });
    return () => {
      cancelled = true;
    };
  }, [moment.blobKey]);

  /* Free the previous URL only once React has committed a render that no
     longer points at it. Revoking in the loader's cleanup runs *before* that
     render, so the DOM briefly holds a dead src and the browser reports a
     failed load. */
  useEffect(() => {
    const prev = liveUrl.current;
    liveUrl.current = url;
    if (prev && prev !== url) URL.revokeObjectURL(prev);
  }, [url]);

  useEffect(
    () => () => {
      if (liveUrl.current) URL.revokeObjectURL(liveUrl.current);
    },
    [],
  );

  /* Hold the playhead inside the trim window, and loop within it. Dragging a
     handle past the playhead should snap the picture, not leave it stranded
     outside the range being trimmed. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el || moment.kind === 'still') return;
    el.playbackRate = momentSpeed(moment);
    el.muted = !!moment.muted;

    const clamp = () => {
      if (el.currentTime < startS || el.currentTime > endS) {
        el.currentTime = startS;
      }
    };
    // Before metadata loads a seek is silently dropped, so a moment whose trim
    // starts partway in would open on the wrong frame.
    if (el.readyState >= 1) clamp();
    else el.addEventListener('loadedmetadata', clamp, { once: true });
    return () => el.removeEventListener('loadedmetadata', clamp);
  }, [moment, startS, endS, url]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !playing || moment.kind === 'still') return;
    let raf = 0;
    const tick = () => {
      if (el.currentTime >= endS - 0.02) el.currentTime = startS;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, startS, endS, moment.kind]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || moment.kind === 'still') return;
    if (playing) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, [playing, moment.kind, url]);

  const isStill = moment.kind === 'still';

  return (
    <div className="clip-preview">
      <div
        className="clip-stage"
        onClick={() => !isStill && setPlaying((p) => !p)}
      >
        {!url ? (
          <span className="tile-ph" />
        ) : isStill ? (
          <img
            src={url}
            alt=""
            ref={(el) => {
              if (mediaRef) mediaRef.current = el;
            }}
          />
        ) : (
          <video
            ref={(el) => {
              videoRef.current = el;
              if (mediaRef) mediaRef.current = el;
            }}
            src={url}
            playsInline
            preload="auto"
          />
        )}

        {/* What this clip is, on the clip — the artboard's pills. */}
        <span className="clip-pills">
          <span className="clip-pill">{describeMoment(moment)}</span>
          <span className="clip-pill">
            {(trimmedDurationMs(moment) / 1000).toFixed(1)}s
          </span>
        </span>

        {!isStill && url && !playing && (
          <button
            className="clip-play"
            onClick={(e) => {
              e.stopPropagation();
              setPlaying(true);
            }}
            aria-label="Play this moment"
          >
            <Icon name="play" size={22} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
