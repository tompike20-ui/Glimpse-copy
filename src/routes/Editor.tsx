import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store/useApp';
import { getBlob } from '../storage/db';
import { trimmedDurationMs, type Moment } from '../types';
import {
  exportProject,
  shareVideo,
  type ExportProgress,
} from '../export/exporter';

function MomentRow({
  moment,
  index,
  locked,
  onRemove,
  onTrim,
  onDragStart,
  onDragEnter,
  onDragEnd,
  dragging,
}: {
  moment: Moment;
  index: number;
  locked: boolean;
  onRemove: () => void;
  onTrim: (start: number, end: number | null) => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    void getBlob(moment.blobKey).then((b) => {
      if (!b || cancelled) return;
      revoked = URL.createObjectURL(b);
      setUrl(revoked);
    });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [moment.blobKey]);

  const silent = moment.peakRms < 0.004;
  const end = moment.trimEndMs ?? moment.durationMs;

  return (
    <li
      className={`mrow${dragging ? ' dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
    >
      <span className="idx">{index + 1}</span>
      {url ? <video src={url} muted playsInline preload="metadata" /> : <div className="mrow-ph" />}

      <div className="info">
        <div>
          {(trimmedDurationMs(moment) / 1000).toFixed(1)}s
          {moment.interrupted && <span className="silent-flag"> · interrupted</span>}
        </div>
        {silent ? (
          <div className="silent-flag">no sound recorded</div>
        ) : (
          <div className="dim" style={{ fontSize: 12 }}>
            {moment.facing === 'user' ? 'Front' : 'Back'} camera
          </div>
        )}

        {open && !locked && (
          <div className="trim">
            <input
              type="range"
              min={0}
              max={moment.durationMs}
              step={50}
              value={moment.trimStartMs}
              onChange={(e) =>
                onTrim(Math.min(Number(e.target.value), end - 100), moment.trimEndMs)
              }
            />
            <input
              type="range"
              min={0}
              max={moment.durationMs}
              step={50}
              value={end}
              onChange={(e) =>
                onTrim(
                  moment.trimStartMs,
                  Math.max(Number(e.target.value), moment.trimStartMs + 100),
                )
              }
            />
          </div>
        )}
      </div>

      {!locked && (
        <>
          <button className="grip" onClick={() => setOpen((v) => !v)} aria-label="Trim">
            ✂
          </button>
          <button className="grip" onClick={onRemove} aria-label="Delete moment">
            ✕
          </button>
          <span
            className="grip"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            aria-label="Reorder"
          >
            ⠿
          </span>
        </>
      )}
    </li>
  );
}

export default function Editor() {
  const { id = '' } = useParams();
  const nav = useNavigate();

  const state = useApp((s) => s.state);
  const removeMoment = useApp((s) => s.removeMoment);
  const reorderMoments = useApp((s) => s.reorderMoments);
  const trimMoment = useApp((s) => s.trimMoment);
  const setLocked = useApp((s) => s.setLocked);
  const deleteProject = useApp((s) => s.deleteProject);
  const renameProject = useApp((s) => s.renameProject);

  const project = state.projects[id];
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const orderRef = useRef<string[]>([]);

  useEffect(() => {
    if (project) {
      setOrder(project.momentIds);
      orderRef.current = project.momentIds;
    }
  }, [project?.momentIds]);

  const moments = useMemo(
    () => order.map((mid) => state.moments[mid]).filter((m): m is Moment => !!m),
    [order, state.moments],
  );

  const totalMs = moments.reduce((s, m) => s + trimmedDurationMs(m), 0);
  const silentCount = moments.filter((m) => m.peakRms < 0.004).length;

  if (!project) return null;

  function move(from: number, to: number) {
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      orderRef.current = next;
      return next;
    });
    setDragIndex(to);
  }

  async function runExport() {
    setExportErr(null);
    try {
      const result = await exportProject(state, id, setProgress);
      await shareVideo(result.blob, result.fileName);
    } catch (err) {
      setExportErr((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="link" onClick={() => nav('/')}>
          Glimpses
        </button>
        <h1 style={{ textAlign: 'center', fontSize: 16 }}>{project.name}</h1>
        <button
          className="link"
          onClick={() => {
            setDraftName(project.name);
            setRenaming(true);
          }}
        >
          Edit
        </button>
      </div>

      <div className="scroll">
        <div className="pad">
          <div className="dim">
            {moments.length} moment{moments.length === 1 ? '' : 's'} ·{' '}
            {(totalMs / 1000).toFixed(1)}s
            {project.locked && ' · locked'}
          </div>
          {silentCount > 0 && (
            <div className="banner warn" style={{ marginTop: 10 }}>
              {silentCount} moment{silentCount > 1 ? 's' : ''} recorded no sound.
            </div>
          )}
          {exportErr && (
            <div className="banner bad" style={{ marginTop: 10 }}>
              {exportErr}
            </div>
          )}
          {progress && (
            <>
              <div className="dim" style={{ marginTop: 10 }}>
                {progress.stage === 'loading' && 'Loading video engine…'}
                {progress.stage === 'writing' && 'Preparing moments…'}
                {progress.stage === 'trimming' && `Trimming ${progress.detail}…`}
                {progress.stage === 'stitching' &&
                  (progress.detail ?? 'Stitching…')}
                {progress.stage === 'reading' && 'Finishing…'}
              </div>
              <div className="progress">
                <i style={{ width: `${(progress.ratio ?? 0.5) * 100}%` }} />
              </div>
            </>
          )}
        </div>

        {moments.length === 0 ? (
          <div className="empty">No moments yet.</div>
        ) : (
          <ul className="strip">
            {moments.map((m, i) => (
              <MomentRow
                key={m.id}
                moment={m}
                index={i}
                locked={project.locked}
                dragging={dragIndex === i}
                onDragStart={() => setDragIndex(i)}
                onDragEnter={() => {
                  if (dragIndex !== null && dragIndex !== i) move(dragIndex, i);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  void reorderMoments(id, orderRef.current);
                }}
                onRemove={() => void removeMoment(id, m.id)}
                onTrim={(start, end) => void trimMoment(m.id, start, end)}
              />
            ))}
          </ul>
        )}
      </div>

      {!project.locked && (
        <button
          className="fab"
          onClick={() => nav(`/p/${id}/capture`)}
          style={{ bottom: 'calc(var(--safe-b) + 76px)' }}
        >
          Add moments
        </button>
      )}
      <button
        className="fab"
        style={{ background: 'var(--info)' }}
        onClick={runExport}
        disabled={!!progress || moments.length === 0}
      >
        {progress ? 'Exporting…' : 'Export & share'}
      </button>

      {renaming && (
        <div className="sheet" onClick={() => setRenaming(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h2>Glimpse settings</h2>
            <input
              className="field"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
            <button
              className="primary"
              onClick={() => {
                void renameProject(id, draftName.trim() || project.name);
                setRenaming(false);
              }}
            >
              Save name
            </button>
            <button
              className="secondary"
              onClick={() => {
                void setLocked(id, !project.locked);
                setRenaming(false);
              }}
            >
              {project.locked ? 'Unlock this Glimpse' : 'Lock this Glimpse'}
            </button>
            <button
              className="secondary"
              style={{ color: 'var(--accent)' }}
              onClick={() => {
                if (confirm(`Delete “${project.name}” and all its moments?`)) {
                  void deleteProject(id);
                  nav('/');
                }
              }}
            >
              Delete Glimpse
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
