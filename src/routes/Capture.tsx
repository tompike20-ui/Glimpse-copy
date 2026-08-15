import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CaptureSession, type RecordedMoment } from '../capture/session';
import { newId, useApp } from '../store/useApp';
import { ASPECT_RATIO, snapToBeat, type Moment } from '../types';

/** All lengths are free. The original paywalls everything past 1 second. */
const LENGTHS = [1000, 2000, 3000, 5000];

const SILENT_RMS = 0.004;

export default function Capture() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const project = useApp((s) => s.state.projects[id]);
  const addMoment = useApp((s) => s.addMoment);

  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const meterRef = useRef<HTMLElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);

  const [lengthMs, setLengthMs] = useState(1000);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [silent, setSilent] = useState(false);
  const [pending, setPending] = useState<RecordedMoment | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [count, setCount] = useState(project?.momentIds.length ?? 0);

  /* Acquire the stream once, on entering the screen — not per moment, and not
     on the first tap, so the record button responds instantly. */
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
              ? 'Camera and microphone access was denied. Enable it in Settings → Safari.'
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

  /* Live mic meter. Driven off rAF rather than React state so a 60 Hz signal
     does not re-render the tree. */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = sessionRef.current;
      const bar = meterRef.current;
      if (s?.active && bar) {
        const level = s.level();
        bar.style.width = `${Math.min(100, level * 400)}%`;
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
      };
      await addMoment(moment, rec.blob);
      setCount((c) => c + 1);
    },
    [addMoment, id],
  );

  async function record() {
    const session = sessionRef.current;
    if (!session?.active || recording) return;

    setError(null);
    setRecording(true);

    // Animate the countdown ring for the nominal length.
    const ring = ringRef.current;
    if (ring) {
      ring.style.transition = 'none';
      ring.style.strokeDashoffset = '251';
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
        ring.style.strokeDashoffset = '251';
      }
    }
  }

  async function keepPending() {
    if (pending) await commitMoment(pending);
    discardPendingUrl();
  }

  function discardPendingUrl() {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    setPendingUrl(null);
    setPending(null);
  }

  if (!project) return null;

  const ratio = ASPECT_RATIO[project.aspect];

  return (
    <div className="screen">
      <div className="topbar">
        <button className="link" onClick={() => nav(`/p/${id}`)}>
          Done
        </button>
        <h1 style={{ textAlign: 'center', fontSize: 15 }}>
          {count} moment{count === 1 ? '' : 's'}
        </h1>
        <button
          className="link"
          aria-pressed={autoSave}
          onClick={() => setAutoSave((v) => !v)}
        >
          {autoSave ? 'Auto-save on' : 'Auto-save off'}
        </button>
      </div>

      <div className="stage">
        <video ref={videoRef} playsInline muted autoPlay />
        <div
          className="frame"
          style={{
            width: ratio >= 1 ? '92%' : `${92 * ratio}%`,
            aspectRatio: String(ratio),
          }}
        />

        {pending && pendingUrl && (
          <div className="review">
            <video src={pendingUrl} autoPlay loop playsInline controls={false} />
            <div className="actions">
              <button className="btn-drop" onClick={discardPendingUrl}>
                Discard
              </button>
              <button className="btn-keep" onClick={keepPending}>
                Keep
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="controls">
        {error && <div className="banner bad">{error}</div>}
        {!ready && !error && (
          <div className="banner warn">Starting the camera…</div>
        )}
        {silent && !error && (
          <div className="banner warn">
            That moment recorded almost no sound. Check the mic isn’t covered.
          </div>
        )}

        <div className="meter" data-silent={silent}>
          <i ref={meterRef} />
        </div>

        <div className="lenrow">
          {LENGTHS.map((ms) => {
            // With a tempo set, offer beat multiples instead of round seconds,
            // so every cut lands on the grid and the result looks edited.
            const actual = project.bpm ? snapToBeat(ms, project.bpm) : ms;
            return (
              <button
                key={ms}
                className="len"
                aria-pressed={lengthMs === actual}
                onClick={() => setLengthMs(actual)}
              >
                {(actual / 1000).toFixed(project.bpm ? 2 : 0)}s
              </button>
            );
          })}
        </div>
        {project.bpm && (
          <div className="dim" style={{ textAlign: 'center', fontSize: 12 }}>
            Snapped to {project.bpm} BPM
          </div>
        )}

        <div className="recrow">
          <button
            className="side"
            onClick={() => {
              const s = sessionRef.current;
              if (!s) return;
              void s.flip().then((stream) => {
                if (videoRef.current) videoRef.current.srcObject = stream;
              });
            }}
          >
            Flip
          </button>

          <button
            className="recbtn"
            data-recording={recording}
            data-ready={ready}
            onClick={record}
            disabled={!ready || recording}
            aria-label="Record a moment"
          >
            <svg width="86" height="86" viewBox="0 0 86 86">
              <circle
                ref={ringRef}
                cx="43"
                cy="43"
                r="40"
                fill="none"
                stroke="#e5484d"
                strokeWidth="3"
                strokeDasharray="251"
                strokeDashoffset="251"
              />
            </svg>
            <i />
          </button>

          <button
            className="side"
            onClick={() => sessionRef.current?.stopEarly()}
            disabled={!recording}
          >
            {recording ? 'Stop' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
