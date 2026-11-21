import { useRef, useState } from 'react';
import type { Moment } from '../types';

/** Never let the two handles meet — a zero-length moment exports as nothing. */
const MIN_MS = 100;

/**
 * Trim as a direct manipulation of the clip's length, rather than two number
 * sliders whose relationship you have to hold in your head.
 *
 * Pointer events, not drag-and-drop or mouse events: HTML5 drag never fires
 * for touch on iOS, which is the only platform this app actually ships to.
 */
export function TrimBar({
  moment,
  onChange,
  playheadMs,
}: {
  moment: Moment;
  onChange: (startMs: number, endMs: number | null) => void;
  /** Where the clip is currently playing, drawn against the untrimmed clip so
   *  the kept window and the playhead can be read together. */
  playheadMs?: number;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  const total = Math.max(1, moment.durationMs);
  const startMs = moment.trimStartMs;
  const endMs = moment.trimEndMs ?? moment.durationMs;

  function begin(edge: 'start' | 'end', e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const bar = barRef.current;
    if (!bar) return;
    setDragging(edge);

    const move = (ev: PointerEvent) => {
      const rect = bar.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const ms = Math.round(ratio * total);
      if (edge === 'start') {
        onChange(Math.min(ms, endMs - MIN_MS), moment.trimEndMs);
      } else {
        // Dragging the end handle to the very end stores null rather than the
        // measured duration, which is what keeps the export on its fast path.
        const next = Math.max(ms, startMs + MIN_MS);
        onChange(startMs, next >= total - 20 ? null : next);
      }
    };
    const up = () => {
      setDragging(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // On window, not the handle: the pointer routinely leaves a 3px-wide
    // target mid-drag, and the drag has to survive that.
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  const leftPct = (startMs / total) * 100;
  const rightPct = 100 - (endMs / total) * 100;

  return (
    <div className={`trimbar${dragging ? ' dragging' : ''}`} ref={barRef}>
      {playheadMs !== undefined && (
        <span
          className="trimbar-playhead"
          style={{ left: `${Math.min(100, Math.max(0, (playheadMs / total) * 100))}%` }}
        />
      )}
      <div
        className="trimbar-keep"
        style={{ left: `${leftPct}%`, right: `${rightPct}%` }}
      >
        <span
          className="trimbar-handle start"
          role="slider"
          tabIndex={0}
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={startMs}
          onPointerDown={(e) => begin('start', e)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 500 : 100;
            if (e.key === 'ArrowLeft') {
              onChange(Math.max(0, startMs - step), moment.trimEndMs);
            } else if (e.key === 'ArrowRight') {
              onChange(Math.min(startMs + step, endMs - MIN_MS), moment.trimEndMs);
            }
          }}
        />
        <span
          className="trimbar-handle end"
          role="slider"
          tabIndex={0}
          aria-label="Trim end"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={endMs}
          onPointerDown={(e) => begin('end', e)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 500 : 100;
            if (e.key === 'ArrowLeft') {
              onChange(startMs, Math.max(startMs + MIN_MS, endMs - step));
            } else if (e.key === 'ArrowRight') {
              const next = endMs + step;
              onChange(startMs, next >= total - 20 ? null : Math.min(next, total));
            }
          }}
        />
      </div>
    </div>
  );
}
