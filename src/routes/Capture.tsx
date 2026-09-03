import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CaptureSession, type RecordedMoment } from '../capture/session';
import { newId, useApp } from '../store/useApp';
import { ASPECT_RATIO, snapToBeat, type Moment } from '../types';
import { Switch } from '../ui/components';
import { Icon } from '../ui/Icon';

/** All lengths are free. The original paywalls everything past 1 second. */
const LENGTHS = [1000, 2000, 3000, 5000];

const SILENT_RMS = 0.004;

export default function Capture() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [search] = useSearchParams();
  const project = useApp((s) => s.state.projects[id]);
  const addMoment = useApp((s) => s.addMoment);

  /* ?at=N records into the middle of the timeline rather than appending. A
     run of moments recorded in one visit stays in the order it was shot, so
     the insertion point advances with each keep. */
  const atParam = search.get('at');
  const insertAt = useRef<number | null>(
    atParam === null || Number.isNaN(Number(atParam)) ? null : Number(atParam),
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const meterRef = useRef<HTMLElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);

  const [lengthMs, setLengthMs] = useState(1000);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [silent, setSilent] = useState(false);
  const [pending, setPending] = useState<RecordedMoment | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [count, setCount] = useState(project?.momentIds.length ?? 0);

  /* Acquire the stream once, on entering the screen — not per moment, and not
     on the first tap, so the shutter responds instantly. */
  useEffect(() => {
    const session = new CaptureSession();
    sessionRef.current = session;
    let cancelled = false;

    session.onInterrupt = (reason) => setError(`Recording interrupted: ${reason}`);

    session
      .start('environment')
      .then((stream) => {
        if (cancelled) return;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          void v.play().catch(() => {});
        }
        setReady(true);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(
            err.name === 'NotAllowedError'
              ? 'Camera access denied. Enable it in Settings → Safari.'
              : `Could not start the camera: ${err.message}`,
          );
        }
      });

    return () => {
      cancelled = true;
      session.stop();
      sessionRef.current = null;
    };
  }, []);

  /* Mic meter driven off rAF rather than React state, so a 60 Hz signal does
     not re-render the tree. */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = sessionRef.current;
      const bar = meterRef.current;
      if (s?.active && bar) {
        bar.style.width = `${Math.min(100, s.level() * 400)}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const commitMoment = useCallback(
    async (rec: RecordedMoment) => {
      const moment: Moment = {
        id: newId(),
        projectId: id,
        createdAt: Date.now(),
        blobKey: rec.blobKey,
        mimeType: rec.mimeType,
        durationMs: rec.durationMs,
        trimStartMs: 0,
        trimEndMs: null,
        width: rec.width,
        height: rec.height,
        facing: rec.facing,
        peakRms: rec.peakRms,
        hadAudioTrack: rec.hadAudioTrack,
        interrupted: rec.interrupted || undefined,
        source: 'capture',
        kind: 'video',
      };
      await addMoment(moment, rec.blob, insertAt.current ?? undefined);
      if (insertAt.current !== null) insertAt.current += 1;
      setCount((c) => c + 1);
    },
    [addMoment, id],
  );

  async function record() {
    const session = sessionRef.current;
    if (!session?.active || recording) return;

    setError(null);
    setRecording(true);

    const ring = ringRef.current;
    if (ring) {
      ring.style.transition = 'none';
      ring.style.strokeDashoffset = '236';
      requestAnimationFrame(() => {
        ring.style.transition = `stroke-dashoffset ${lengthMs}ms linear`;
        ring.style.strokeDashoffset = '0';
      });
    }

    try {
      const rec = await session.recordMoment(lengthMs, newId());
      setSilent(rec.peakRms < SILENT_RMS);

      if (autoSave) {
        await commitMoment(rec);
      } else {
        setPending(rec);
        setPendingUrl(URL.createObjectURL(rec.blob));
      }
    } catch (err) {
      setError(`Recording failed: ${(err as Error).message}`);
    } finally {
      setRecording(false);
      if (ring) {
        ring.style.transition = 'none';
        ring.style.strokeDashoffset = '236';
      }
    }
  }

  async function keepPending() {
    if (pending) await commitMoment(pending);
    discardPending();
  }

  function discardPending() {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    setPendingUrl(null);
    setPending(null);
  }

  if (!project) return null;

  const ratio = ASPECT_RATIO[project.aspect];

  return (
    <div className="screen dark">
      <div className="stage">
        <video ref={videoRef} playsInline muted autoPlay />

        {/* Dims everything outside the chosen shape, so what you see is what
            you get — the original crops the frame to black instead. */}
        {/* Fills as much of the stage as the shape allows, rather than sitting
            small in the middle. max-height shrinks it back when the shape is
            taller than the stage. */}
        <div
          className="frame-guide"
          style={{ '--r': String(ratio) } as React.CSSProperties}
        />

        {error ? (
          <div className="pill bad">{error}</div>
        ) : !ready ? (
          <div className="pill">Starting camera…</div>
        ) : silent ? (
          <div className="pill warn">That moment recorded almost no sound</div>
        ) : (
          <div className="pill">
            {count} moment{count === 1 ? '' : 's'}
            {project.bpm ? ` · ${project.bpm} BPM` : ''}
          </div>
        )}

        <button
          className="nav-btn"
          onClick={() => nav(`/p/${id}`)}
          style={{
            position: 'absolute',
            top: 'calc(var(--safe-t) + 8px)',
            left: 8,
            color: '#fff',
            zIndex: 4,
          }}
        >
          <Icon name="chevron-left" size={21} strokeWidth={2.2} />
          Done
        </button>

        <button
          className="round-btn"
          onClick={() => setShowSettings((v) => !v)}
          style={{
            position: 'absolute',
            top: 'calc(var(--safe-t) + 8px)',
            right: 12,
            zIndex: 4,
          }}
          aria-label="Capture settings"
        >
          <Icon name="ellipsis" size={20} />
        </button>

        {showSettings && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(var(--safe-t) + 60px)',
              right: 12,
              zIndex: 4,
              background: 'rgba(30,30,30,0.9)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderRadius: 12,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              color: '#fff',
              fontSize: 15,
            }}
          >
            Auto-save
            <Switch checked={autoSave} onChange={setAutoSave} />
          </div>
        )}

        {pending && pendingUrl && (
          <div className="review">
            <video src={pendingUrl} autoPlay loop playsInline />
            <div className="review-actions">
              <button className="btn tinted" onClick={discardPending}>
                Retake
              </button>
              <button className="btn filled" onClick={keepPending}>
                Keep
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="capture-bar">
        <div className="meter" data-silent={silent}>
          <i ref={meterRef} />
        </div>

        <div className="modes">
          {LENGTHS.map((ms) => {
            // With a tempo set, offer beat multiples instead of round seconds
            // so every cut lands on the grid.
            const actual = project.bpm ? snapToBeat(ms, project.bpm) : ms;
            return (
              <button
                key={ms}
                aria-pressed={lengthMs === actual}
                onClick={() => setLengthMs(actual)}
              >
                {(actual / 1000).toFixed(project.bpm ? 2 : 0)}s
              </button>
            );
          })}
        </div>

        <div className="shutter-row">
          <button
            className="round-btn"
            onClick={() => {
              void sessionRef.current?.flip().then((stream) => {
                if (videoRef.current) videoRef.current.srcObject = stream;
              });
            }}
            aria-label="Flip camera"
          >
            <Icon name="flip" size={21} />
          </button>

          <button
            className="shutter"
            data-recording={recording}
            data-ready={ready}
            onClick={record}
            disabled={!ready || recording}
            aria-label="Record a moment"
          >
            <svg width="81" height="81" viewBox="0 0 81 81" aria-hidden>
              <circle
                ref={ringRef}
                cx="40.5"
                cy="40.5"
                r="37.5"
                fill="none"
                stroke="var(--brand)"
                strokeWidth="3.5"
                strokeDasharray="236"
                strokeDashoffset="236"
              />
            </svg>
            <i />
          </button>

          <button
            className="round-btn right"
            onClick={() => sessionRef.current?.stopEarly()}
            disabled={!recording}
            aria-label="Stop early"
            style={{ opacity: recording ? 1 : 0.35 }}
          >
            <Icon name="stop" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
