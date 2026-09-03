import { useEffect, useRef, useState } from 'react';
import { momentSpeed, type Moment } from '../types';
import { getBlob } from '../storage/db';
import { Icon } from './Icon';

/**
 * One moment, playing on a loop inside its own sheet.
 *
 * The trim and speed controls used to sit above nothing but numbers: you moved
 * a slider and had to export, or preview the whole Glimpse, to find out what
 * you had done. This plays the trimmed range only, and follows the sliders as
 * they move, so the controls have something to be about.
 */
export function ClipPreview({ moment }: { moment: Moment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const startS = moment.trimStartMs / 1000;
  const endS = (moment.trimEndMs ?? moment.durationMs) / 1000;

  useEffect(() => {
    let made: string | null = null;
    let cancelled = false;
    void getBlob(moment.blobKey).then((b) => {
      if (!b || cancelled) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [moment.blobKey]);

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
          <img src={url} alt="" />
        ) : (
          <video ref={videoRef} src={url} playsInline preload="auto" />
        )}

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
