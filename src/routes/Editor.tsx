import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store/useApp';
import { putBlob } from '../storage/db';
import { trimmedDurationMs, TRASH_TTL_MS, type Moment } from '../types';
import {
  exportProject,
  shareVideo,
  type ExportProgress,
} from '../export/exporter';
import { planExport } from '../export/concat';
import {
  grabFrame,
  shareImage,
  snapshotFileName,
  type FrameSource,
} from '../export/snapshot';
import { useCloud } from '../cloud/useCloud';
import { createInvite, subscribeToProject } from '../cloud/sync';
import {
  BackButton,
  NavBar,
  Segmented,
  Sheet,
  Switch,
  useScrolled,
} from '../ui/components';
import { useReorder } from '../ui/useReorder';
import { Icon } from '../ui/Icon';
import { Toast } from '../ui/Toast';
import { Preview } from '../ui/Preview';
import { OrganiseSheet } from '../ui/OrganiseSheet';
import { ClipPreview } from '../ui/ClipPreview';
import { Frame } from '../ui/Frame';
import { TrimBar } from '../ui/TrimBar';

const REENCODE_TEXT: Record<string, string> = {
  trimmed: 'Re-encoding trimmed moments…',
  'mixed-sizes': 'Re-encoding — this Glimpse mixes frame sizes…',
  music: 'Mixing the soundtrack…',
  effects: 'Applying speed and mute changes…',
  imported: 'Re-encoding imported media…',
};

function MomentThumb({
  moment,
  shared,
  fill,
}: {
  moment: Moment;
  shared: boolean;
  fill?: boolean;
}) {
  const cls = fill ? '' : 'thumb lg';
  return (
    <Frame
      moment={moment}
      shared={shared}
      className={cls}
      placeholder={<div className={fill ? 'tile-ph' : 'thumb lg'} />}
    />
  );
}

/**
 * Long-press to pick a tile up, tap to open it — the way rearranging works on
 * the iOS home screen. A grip handle on a thumbnail would cover the image it
 * is meant to show.
 *
 * A plain factory rather than a hook, because these are built inside a map and
 * a hook cannot be called in a loop. One shared bit of state is enough: only
 * one drag can be in progress at a time.
 */
interface PressState {
  timer: number | null;
  started: boolean;
}

function longPressHandlers(
  id: string,
  reorder: ReturnType<typeof useReorder>,
  onTap: () => void,
  press: PressState,
  enabled: boolean,
) {
  if (!enabled) return { onClick: onTap };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      press.started = false;
      const el = e.currentTarget as HTMLElement;
      const { pointerId, clientX, clientY } = e;
      press.timer = window.setTimeout(() => {
        press.started = true;
        reorder.begin(id, el, pointerId, clientX, clientY);
      }, 280);
    },
    onPointerMove: () => {
      // An early slide is a scroll, not a drag.
      if (!press.started && press.timer) {
        window.clearTimeout(press.timer);
        press.timer = null;
      }
    },
    onPointerUp: () => {
      if (press.timer) window.clearTimeout(press.timer);
      // The drag ends itself via the window listeners; a plain press opens it.
      if (!press.started) onTap();
      press.started = false;
    },
    onPointerCancel: () => {
      if (press.timer) window.clearTimeout(press.timer);
      press.started = false;
    },
  };
}

function daysLeft(deletedAt: number): string {
  const left = Math.ceil((deletedAt + TRASH_TTL_MS - Date.now()) / 86_400_000);
  if (left <= 0) return 'Removing soon';
  return `${left} day${left === 1 ? '' : 's'} left`;
}

/** m:ss, for durations long enough that "64.0s" stops being readable. */
function fmtClock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * A rough finished size, so "Save to Photos" is not a blind commitment on a
 * phone that may be nearly full. Measured on device at roughly 1.5 MB per
 * second of 1080p; 720p lands near half that. Deliberately approximate — the
 * real figure depends on the footage, and the label says "about".
 */
function estimateMb(ms: number, preset: '1080p' | '720p'): number {
  const perSecond = preset === '1080p' ? 1.5 : 0.7;
  return Math.max(1, Math.round((ms / 1000) * perSecond));
}

function describe(m: Moment): string {
  if (m.source === 'import') return m.kind === 'still' ? 'Photo' : 'Imported clip';
  return `${m.facing === 'user' ? 'Front' : 'Back'} camera`;
}

export default function Editor() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { scrolled, onScroll } = useScrolled();

  const state = useApp((s) => s.state);
  const removeMoment = useApp((s) => s.removeMoment);
  const restoreMoment = useApp((s) => s.restoreMoment);
  const purgeMoment = useApp((s) => s.purgeMoment);
  const emptyTrash = useApp((s) => s.emptyTrash);
  const reorderMoments = useApp((s) => s.reorderMoments);
  const trimMoment = useApp((s) => s.trimMoment);
  const setMomentProps = useApp((s) => s.setMomentProps);
  const setMusic = useApp((s) => s.setMusic);
  const setBpm = useApp((s) => s.setBpm);
  const setExportPreset = useApp((s) => s.setExportPreset);
  const importFiles = useApp((s) => s.importFiles);
  const setLocked = useApp((s) => s.setLocked);
  const deleteProject = useApp((s) => s.deleteProject);
  const renameProject = useApp((s) => s.renameProject);

  const project = state.projects[id];

  const [order, setOrder] = useState<string[]>([]);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The moment on the stage, and the one the inline controls act on. */
  const [selected, setSelected] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [undo, setUndo] = useState<{ momentId: string } | null>(null);
  const [organising, setOrganising] = useState(false);
  const [exportChoice, setExportChoice] = useState(false);
  const [exportKind, setExportKind] = useState<'video' | 'frame'>('video');
  /** A capture of the stage frame, shown on the "This frame" option. */
  const [framePreview, setFramePreview] = useState<string | null>(null);
  const [savingFrame, setSavingFrame] = useState(false);
  /** Stage playback position, mirrored onto the trim bar. */
  const [playheadMs, setPlayheadMs] = useState<number | undefined>(undefined);
  // The order Organise replaced, kept only long enough to offer it back.
  const [orderUndo, setOrderUndo] = useState<string[] | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  /** The element currently on the stage, so a snapshot can be taken from the
   *  frame already on screen rather than from a second player. */
  const stageMedia = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const musicRef = useRef<HTMLInputElement>(null);
  const tapsRef = useRef<number[]>([]);
  const pressRef = useRef<PressState>({ timer: null, started: false });

  const cloudConfigured = useCloud((s) => s.configured);
  const userId = useCloud((s) => s.userId);
  const cloudBusy = useCloud((s) => s.busy);
  const cloudError = useCloud((s) => s.error);
  const shareProject = useCloud((s) => s.share);
  const syncNow = useCloud((s) => s.sync);
  const reload = useApp((s) => s.init);

  const [shared, setShared] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  useEffect(() => {
    if (project) setOrder(project.momentIds);
  }, [project?.momentIds]);

  /* Keep a moment selected: the stage and the controls are the editor now, so
     an empty selection would leave most of the screen blank. */
  useEffect(() => {
    if (order.length === 0) {
      if (selected !== null) setSelected(null);
    } else if (!selected || !order.includes(selected)) {
      setSelected(order[0]);
    }
  }, [order, selected]);

  /* Poll the stage element rather than listening for timeupdate, which fires
     about four times a second — too coarse for a marker to look attached to
     the picture. */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = stageMedia.current;
      setPlayheadMs(
        el instanceof HTMLVideoElement && el.readyState >= 1
          ? el.currentTime * 1000
          : undefined,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!shared || !userId) return;
    return subscribeToProject(id, () => {
      void syncNow(id).then(() => reload());
    });
  }, [shared, userId, id, syncNow, reload]);

  const reorder = useReorder(order, setOrder, (next) => {
    void reorderMoments(id, next);
  });

  const moments = useMemo(
    () => order.map((mid) => state.moments[mid]).filter((m): m is Moment => !!m),
    [order, state.moments],
  );

  const totalMs = moments.reduce((s, m) => s + trimmedDurationMs(m), 0);
  const preset = project?.exportPreset ?? '1080p';
  const silentCount = moments.filter((m) => m.peakRms < 0.004).length;
  const plan = planExport(state, id);
  const selectedMoment = selected ? state.moments[selected] : null;
  // Newest first, so the thing just deleted is at the top.
  const trashed = Object.entries(state.trash).sort(
    (a, b) => b[1].deletedAt - a[1].deletedAt,
  );
  const trashCount = trashed.length;

  if (!project) return null;

  /** Capture the stage frame when the sheet opens, so the option can show it. */
  function captureStagePreview() {
    const el = stageMedia.current;
    if (!el) return setFramePreview(null);
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!w || !h) return setFramePreview(null);
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = Math.round((h / w) * 96);
    const ctx = canvas.getContext('2d');
    if (!ctx) return setFramePreview(null);
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
    try {
      setFramePreview(canvas.toDataURL('image/jpeg', 0.7));
    } catch {
      setFramePreview(null);
    }
  }

  async function saveStageFrame() {
    const el = stageMedia.current;
    if (!el || !project) return;
    setExportErr(null);
    setSavingFrame(true);
    try {
      const src: FrameSource =
        el instanceof HTMLVideoElement
          ? { el, kind: 'video' }
          : { el, kind: 'still' };
      const blob = await grabFrame(src, project);
      const ok = await shareImage(blob, snapshotFileName(project.name));
      setToast(ok ? 'Shared' : 'Snapshot ready');
    } catch (err) {
      setExportErr((err as Error).message);
    } finally {
      setSavingFrame(false);
    }
  }

  async function runExport() {
    setExportErr(null);
    try {
      const result = await exportProject(state, id, setProgress);
      const shared = await shareVideo(result.blob, result.fileName);
      // Exporting used to end in silence, which reads as a failure.
      setToast(shared ? 'Shared' : 'Video ready');
    } catch (err) {
      setExportErr((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="screen">
      <NavBar
        title={project.name}
        scrolled={scrolled}
        large={false}
        left={<BackButton label="Glimpses" onClick={() => nav('/')} />}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="nav-btn"
              onClick={() => setPreviewing(true)}
              disabled={moments.length === 0}
              aria-label="Preview"
            >
              <Icon name="play" size={22} />
            </button>
            <button
              className="nav-btn right"
              onClick={() => {
                setDraftName(project.name);
                setSettingsOpen(true);
              }}
              aria-label="Glimpse settings"
            >
              <Icon name="sliders" size={22} />
            </button>
          </div>
        }
      />

      <div className="scroll" onScroll={onScroll}>
        <div className="summary">
          {moments.length} moment{moments.length === 1 ? '' : 's'} ·{' '}
          {(totalMs / 1000).toFixed(1)}s
          {project.locked && ' · locked'}
          {moments.length > 0 &&
            (plan.canStreamCopy
              ? ' · exports instantly'
              : ' · needs re-encoding')}
        </div>

        {silentCount > 0 && (
          <div className="banner warn">
            {silentCount} moment{silentCount > 1 ? 's' : ''} recorded no sound.
          </div>
        )}
        {exportErr && <div className="banner bad">{exportErr}</div>}

        {progress && (
          <div className="group">
            <div className="group-header">
              {progress.stage === 'loading' && 'Loading video engine…'}
              {progress.stage === 'writing' && 'Preparing moments…'}
              {progress.stage === 'trimming' && `Trimming ${progress.detail}…`}
              {progress.stage === 'stitching' &&
                (progress.detail === 're-encoding'
                  ? REENCODE_TEXT[plan.reencodeReason ?? 'mixed-sizes']
                  : 'Stitching…')}
              {progress.stage === 'reading' && 'Finishing…'}
            </div>
            <div className="progress">
              <i style={{ width: `${(progress.ratio ?? 0.5) * 100}%` }} />
            </div>
          </div>
        )}

        {moments.length === 0 ? (
          <div className="empty">
            <div className="mark">
              <Icon name="camera" size={34} strokeWidth={1.6} />
            </div>
            <strong>No moments yet</strong>
            Record something, or bring in a video or photo you already have.
          </div>
        ) : (
          <>
            {/* The hero: the moment under the playhead, at a size worth
                looking at. The old editor showed 52px thumbnails in grouped
                rows — a settings screen that happened to contain video. */}
            {selectedMoment && (
              <div className="editor-stage">
                <ClipPreview moment={selectedMoment} mediaRef={stageMedia} />
                <div className="editor-stage-meta">
                  <span className="editor-stage-index">
                    Moment {order.indexOf(selectedMoment.id) + 1} of {moments.length}
                  </span>
                  <span className="editor-stage-len">
                    {(trimmedDurationMs(selectedMoment) / 1000).toFixed(1)}s ·{' '}
                    {selectedMoment.peakRms < 0.004 ? (
                      <span className="flag">no sound recorded</span>
                    ) : (
                      describe(selectedMoment)
                    )}
                    {(selectedMoment.speed ?? 1) !== 1 && ` · ${selectedMoment.speed}×`}
                    {selectedMoment.muted && ' · muted'}
                    {selectedMoment.interrupted && (
                      <span className="flag"> · interrupted</span>
                    )}
                  </span>
                </div>
              </div>
            )}

            <div className="listbar">
              <div className="section-title">Timeline</div>
              {!project.locked && moments.length > 1 && (
                <button
                  className="linkbtn"
                  onClick={() => setOrganising(true)}
                  aria-label="Organise moments"
                >
                  <Icon name="shuffle" size={17} />
                  Organise
                </button>
              )}
            </div>

            {/* Horizontal, because that is the shape a Glimpse actually has.
                A vertical row per moment does not survive sixty of them. */}
            <ul className="strip">
              {moments.map((m, i) => {
                const dragging = reorder.state.draggingId === m.id;
                return (
                  <li
                    key={m.id}
                    data-moment-id={m.id}
                    className={dragging ? 'dragging-item' : undefined}
                    style={
                      dragging
                        ? {
                            transform: `translate(${reorder.state.offsetX}px, ${reorder.state.offsetY}px)`,
                            position: 'relative',
                            zIndex: 3,
                          }
                        : undefined
                    }
                  >
                    <button
                      className={`strip-tile${m.id === selected ? ' on' : ''}${dragging ? ' lifted' : ''}`}
                      aria-label={`Moment ${i + 1}`}
                      aria-pressed={m.id === selected}
                      {...longPressHandlers(
                        m.id,
                        reorder,
                        () => setSelected(m.id),
                        pressRef.current,
                        !project.locked,
                      )}
                    >
                      <MomentThumb moment={m} shared={shared} fill />
                      {m.peakRms < 0.004 && <span className="flagdot" />}
                      <span className="strip-len">
                        {(trimmedDurationMs(m) / 1000).toFixed(1)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {!project.locked && (
                <li>
                  <button
                    className="strip-add"
                    onClick={() => nav(`/p/${id}/capture`)}
                    aria-label="Record another moment at the end"
                  >
                    <Icon name="plus" size={18} strokeWidth={2.2} />
                  </button>
                </li>
              )}
            </ul>
            <div className="group-footer">
              Tap a moment to put it on the stage. Press and hold to pick it up
              and reorder.
            </div>

            {/* The selected moment's controls, inline rather than buried in a
                sheet you have to open and dismiss to compare two clips. */}
            {selectedMoment && !project.locked && (
              <div className="moment-card">
                {selectedMoment.kind === 'still' ? (
                  <>
                    <div className="moment-card-head">
                      <span>On screen for</span>
                      <span className="moment-card-value">
                        {(selectedMoment.durationMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={500}
                      max={10000}
                      step={250}
                      value={selectedMoment.durationMs}
                      aria-label="Time on screen"
                      onChange={(e) =>
                        void setMomentProps(id, selectedMoment.id, {
                          durationMs: Number(e.target.value),
                        })
                      }
                    />
                  </>
                ) : (
                  <>
                    <div className="moment-card-head">
                      <span>Trim</span>
                      <span className="moment-card-value">
                        Moment {order.indexOf(selectedMoment.id) + 1}
                      </span>
                    </div>
                    <TrimBar
                      moment={selectedMoment}
                      playheadMs={playheadMs}
                      onChange={(startMs, endMs) =>
                        void trimMoment(id, selectedMoment.id, startMs, endMs)
                      }
                    />
                    <div className="trimbar-scale">
                      <span>{(selectedMoment.trimStartMs / 1000).toFixed(2)}s</span>
                      <span>
                        keeping {(trimmedDurationMs(selectedMoment) / 1000).toFixed(2)}s
                        of {(selectedMoment.durationMs / 1000).toFixed(2)}s
                      </span>
                      <span>
                        {(
                          (selectedMoment.trimEndMs ?? selectedMoment.durationMs) / 1000
                        ).toFixed(2)}s
                      </span>
                    </div>
                  </>
                )}

                <div className="moment-card-row">
                  <Segmented
                    options={[0.5, 1, 2]}
                    value={selectedMoment.speed ?? 1}
                    onChange={(v) =>
                      void setMomentProps(id, selectedMoment.id, { speed: v })
                    }
                    format={(v) => `${v}×`}
                  />
                  <button
                    className={`sq-btn${selectedMoment.muted ? ' on' : ''}`}
                    aria-pressed={!!selectedMoment.muted}
                    aria-label="Mute this moment"
                    onClick={() =>
                      void setMomentProps(id, selectedMoment.id, {
                        muted: !selectedMoment.muted,
                      })
                    }
                  >
                    <Icon name="mic-off" size={17} />
                  </button>
                </div>

                <div className="moment-card-row">
                  <button
                    className="btn tinted"
                    onClick={() =>
                      nav(
                        `/p/${id}/capture?at=${order.indexOf(selectedMoment.id) + 1}`,
                      )
                    }
                  >
                    <Icon name="camera" size={17} />
                    Record after this
                  </button>
                  <button
                    className="btn plain destructive"
                    onClick={() => {
                      const i = order.indexOf(selectedMoment.id);
                      void removeMoment(id, selectedMoment.id);
                      setUndo({ momentId: selectedMoment.id });
                      setSelected(order[i + 1] ?? order[i - 1] ?? null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="toolbar">
        {!project.locked && (
          <>
            <button
              className="btn tinted"
              onClick={() => nav(`/p/${id}/capture`)}
            >
              <Icon name="camera" size={18} />
              Record
            </button>
            <button
              className="btn tinted"
              onClick={() => importRef.current?.click()}
              disabled={importing}
            >
              <Icon name="photo" size={18} />
              {importing ? 'Importing…' : 'Import'}
            </button>
          </>
        )}
        <button
          className="btn filled"
          onClick={() => {
            captureStagePreview();
            setExportChoice(true);
          }}
          disabled={!!progress || moments.length === 0}
        >
          {progress ? (
            'Exporting…'
          ) : (
            <>
              <Icon name="share" size={18} />
              Export
            </>
          )}
        </button>
      </div>

      {/* Opens the iOS photo picker. Videos and photos both land as moments. */}
      <input
        ref={importRef}
        type="file"
        accept="video/*,image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (!files.length) return;
          setImporting(true);
          try {
            const n = await importFiles(id, files);
            if (n < files.length) {
              setExportErr(
                `Imported ${n} of ${files.length}. Some files were an unsupported type.`,
              );
            }
          } catch (err) {
            setExportErr(`Import failed: ${(err as Error).message}`);
          } finally {
            setImporting(false);
          }
        }}
      />

      {previewing && (
        <Preview
          moments={moments}
          music={project.music}
          onClose={() => setPreviewing(false)}
        />
      )}

      {exportChoice && (
        <Sheet title="Export" bare onClose={() => setExportChoice(false)}>
          <div className="export-head">
            <h3>Export</h3>
            <p>
              {project.name} · {moments.length} moment
              {moments.length === 1 ? '' : 's'} · {fmtClock(totalMs)}
            </p>
          </div>

          <div className="export-picks">
            <button
              className={`export-pick${exportKind === 'video' ? ' on' : ''}`}
              aria-pressed={exportKind === 'video'}
              onClick={() => setExportKind('video')}
            >
              <span className="export-icon grad">
                <Icon name="film" size={22} />
              </span>
              <span className="export-text">
                <span className="export-title">Whole Glimpse</span>
                <span className="export-sub">
                  {preset} video · about {estimateMb(totalMs, preset)} MB ·{' '}
                  {plan.canStreamCopy ? 'exports instantly' : 'needs re-encoding'}
                </span>
              </span>
              {exportKind === 'video' && (
                <span className="export-check">
                  <Icon name="check" size={20} strokeWidth={2.6} />
                </span>
              )}
            </button>

            <button
              className={`export-pick${exportKind === 'frame' ? ' on' : ''}`}
              aria-pressed={exportKind === 'frame'}
              onClick={() => setExportKind('frame')}
              disabled={!selectedMoment}
            >
              <span className="export-icon">
                <Icon name="photo" size={22} />
              </span>
              <span className="export-text">
                <span className="export-title">This frame</span>
                <span className="export-sub">
                  {selectedMoment
                    ? `JPEG still · moment ${order.indexOf(selectedMoment.id) + 1}`
                    : 'Nothing on the stage to capture'}
                </span>
              </span>
              {/* The frame itself, so what you are about to save is not a
                  description of a frame but the frame. */}
              {framePreview ? (
                <img className="export-thumb" src={framePreview} alt="" />
              ) : (
                exportKind === 'frame' && (
                  <span className="export-check">
                    <Icon name="check" size={20} strokeWidth={2.6} />
                  </span>
                )
              )}
            </button>
          </div>

          {exportKind === 'video' && (
            <div className="group export-quality">
              <div className="group-header">Quality</div>
              <Segmented
                options={['1080p', '720p'] as const}
                value={preset}
                onChange={(v) => void setExportPreset(id, v)}
                format={(v) => v}
              />
            </div>
          )}

          <div className="export-actions">
            <button
              className="btn filled"
              disabled={!!progress || savingFrame}
              onClick={() => {
                setExportChoice(false);
                if (exportKind === 'video') void runExport();
                else void saveStageFrame();
              }}
            >
              <Icon name="share" size={19} />
              Save to Photos
            </button>
            <button className="btn plain" onClick={() => setExportChoice(false)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}

      {organising && (
        <OrganiseSheet
          order={order}
          moments={state.moments}
          onCancel={() => setOrganising(false)}
          onApply={(next) => {
            setOrderUndo(order);
            setOrder(next);
            void reorderMoments(id, next);
            setOrganising(false);
          }}
        />
      )}

      {orderUndo && (
        <Toast
          message="Order changed"
          actionLabel="Undo"
          onAction={() => {
            setOrder(orderUndo);
            void reorderMoments(id, orderUndo);
            setOrderUndo(null);
          }}
          onDone={() => setOrderUndo(null)}
          ms={6000}
        />
      )}

      {undo && (
        <Toast
          message="Moment deleted"
          actionLabel="Undo"
          onAction={() => {
            void restoreMoment(id, undo.momentId);
            setUndo(null);
          }}
          onDone={() => setUndo(null)}
          ms={6000}
        />
      )}

      {/* An undo offer outranks a plain confirmation: only one can be on
          screen, and the one carrying a way back is the one worth showing. */}
      {toast && !undo && !orderUndo && (
        <Toast message={toast} onDone={() => setToast(null)} />
      )}

      {trashOpen && (
        <Sheet
          title="Recently Deleted"
          onClose={() => setTrashOpen(false)}
          leftAction={
            <button className="nav-btn" onClick={() => setTrashOpen(false)}>
              Done
            </button>
          }
        >
          {trashed.length === 0 ? (
            <div className="empty">
              <div className="mark">
                <Icon name="trash" size={32} strokeWidth={1.6} />
              </div>
              <strong>Nothing deleted</strong>
              Deleted moments wait here for 30 days before their files are
              removed.
            </div>
          ) : (
            <>
              <div className="group">
                <ul className="list">
                  {trashed.map(([mid, t]) => (
                    <li key={mid} className="row inset-sep">
                      <MomentThumb moment={t.moment} shared={false} />
                      <div className="row-main">
                        <div className="row-title">
                          {(trimmedDurationMs(t.moment) / 1000).toFixed(1)}s
                        </div>
                        <div className="row-sub">{daysLeft(t.deletedAt)}</div>
                      </div>
                      <button
                        className="chip"
                        onClick={() => void restoreMoment(id, mid)}
                      >
                        Restore
                      </button>
                      <button
                        className="chip"
                        style={{ color: 'var(--red)' }}
                        onClick={() => void purgeMoment(mid)}
                        aria-label="Delete permanently"
                      >
                        <Icon name="trash" size={17} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="group">
                <button
                  className="btn plain destructive"
                  onClick={() => {
                    if (confirm('Permanently delete every trashed moment?')) {
                      void emptyTrash();
                    }
                  }}
                >
                  Delete All Permanently
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}

      {/* ------------------------------------------------ project settings */}
      {settingsOpen && (
        <Sheet
          title="Glimpse Settings"
          onClose={() => setSettingsOpen(false)}
          leftAction={
            <button className="nav-btn" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
          }
        >
          <div className="group">
            <div className="group-header">Name</div>
            <input
              className="field"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() =>
                void renameProject(id, draftName.trim() || project.name)
              }
            />
          </div>

          <div className="group">
            <div className="group-header">Soundtrack</div>
            <ul className="list">
              <li>
                <button className="row tinted" onClick={() => musicRef.current?.click()}>
                  <div className="row-main">
                    <div className="row-title">
                      {project.music ? 'Replace music' : 'Add music'}
                    </div>
                    {project.music && (
                      <div className="row-sub">{project.music.name}</div>
                    )}
                  </div>
                </button>
              </li>
              {project.music && (
                <>
                  <li className="row">
                    <div className="row-main">
                      <div className="row-title">Volume</div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={project.music.volume}
                      onChange={(e) =>
                        void setMusic(id, {
                          ...project.music!,
                          volume: Number(e.target.value),
                        })
                      }
                      style={{ flex: '0 0 150px' }}
                    />
                  </li>
                  <li className="row">
                    <div className="row-main">
                      <div className="row-title">Music leads</div>
                      <div className="row-sub">
                        Off: music ducks under voices automatically
                      </div>
                    </div>
                    <Switch
                      checked={project.music.duckClips}
                      onChange={(v) =>
                        void setMusic(id, { ...project.music!, duckClips: v })
                      }
                    />
                  </li>
                  <li>
                    <button
                      className="row destructive"
                      onClick={() => void setMusic(id, null)}
                    >
                      <div className="row-main">
                        <div className="row-title">Remove music</div>
                      </div>
                    </button>
                  </li>
                </>
              )}
            </ul>
          </div>

          <div className="group">
            <div className="group-header">Tempo</div>
            <ul className="list">
              <li>
                <button
                  className="row tinted"
                  onClick={() => {
                    // Tapped, not detected: a wrong automatic guess is worse
                    // than no guess, and four taps are unambiguous.
                    const now = performance.now();
                    const taps = tapsRef.current.filter((t) => now - t < 3000);
                    taps.push(now);
                    tapsRef.current = taps;
                    if (taps.length >= 2) {
                      const gaps = taps.slice(1).map((t, i) => t - taps[i]);
                      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
                      void setBpm(id, Math.round(60_000 / avg));
                    }
                  }}
                >
                  <div className="row-main">
                    <div className="row-title">Tap tempo</div>
                    <div className="row-sub">
                      Tap along to the music a few times
                    </div>
                  </div>
                  <span className="row-value">
                    {project.bpm ? `${project.bpm} BPM` : 'Off'}
                  </span>
                </button>
              </li>
              {project.bpm && (
                <li>
                  <button className="row" onClick={() => void setBpm(id, null)}>
                    <div className="row-main">
                      <div className="row-title">Clear tempo</div>
                    </div>
                  </button>
                </li>
              )}
            </ul>
            <div className="group-footer">
              With a tempo set, new moments snap to the beat so cuts land in
              time with the music.
            </div>
          </div>

          <div className="group">
            <div className="group-header">Export quality</div>
            <Segmented
              options={['1080p', '720p'] as const}
              value={project.exportPreset ?? '1080p'}
              onChange={(p) => void setExportPreset(id, p)}
            />
          </div>

          <div className="group">
            <ul className="list">
              <li>
                <button
                  className="row"
                  onClick={() => {
                    setSettingsOpen(false);
                    setTrashOpen(true);
                  }}
                >
                  <div className="row-main">
                    <div className="row-title">Recently Deleted</div>
                    <div className="row-sub">
                      Kept for 30 days before the files are removed
                    </div>
                  </div>
                  <span className="row-value">{trashCount}</span>
                  <span className="chevron">
                    <Icon name="chevron-right" size={17} strokeWidth={2.4} />
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <div className="group">
            <ul className="list">
              <li className="row">
                <div className="row-main">
                  <div className="row-title">Lock this Glimpse</div>
                  <div className="row-sub">
                    Prevents accidental edits and deletion
                  </div>
                </div>
                <Switch
                  checked={project.locked}
                  onChange={(v) => void setLocked(id, v)}
                />
              </li>
            </ul>
          </div>

          {cloudConfigured && (
            <div className="group">
              <div className="group-header">Collaboration</div>
              {cloudError && <div className="banner bad">{cloudError}</div>}
              <ul className="list">
                {!userId ? (
                  <li className="row">
                    <div className="row-main">
                      <div className="row-sub">
                        Sign in from an invite link to collaborate. Everything
                        else works without an account.
                      </div>
                    </div>
                  </li>
                ) : inviteLink ? (
                  <li>
                    <button
                      className="row tinted"
                      onClick={() => void navigator.clipboard?.writeText(inviteLink)}
                    >
                      <div className="row-main">
                        <div className="row-title">Copy invite link</div>
                        <div className="row-sub">{inviteLink}</div>
                      </div>
                    </button>
                  </li>
                ) : (
                  <li>
                    <button
                      className="row tinted"
                      disabled={cloudBusy}
                      onClick={() => {
                        void (async () => {
                          await shareProject(id, project.name, project.aspect);
                          setShared(true);
                          setInviteLink(await createInvite(id));
                        })();
                      }}
                    >
                      <div className="row-main">
                        <div className="row-title">
                          {cloudBusy ? 'Sharing…' : 'Share this Glimpse'}
                        </div>
                        <div className="row-sub">
                          Others can add their own moments
                        </div>
                      </div>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="group">
            <ul className="list">
              <li>
                <button
                  className="row destructive"
                  onClick={() => {
                    if (confirm(`Delete “${project.name}” and all its moments?`)) {
                      void deleteProject(id);
                      nav('/');
                    }
                  }}
                >
                  <div className="row-main">
                    <div className="row-title">Delete Glimpse</div>
                  </div>
                </button>
              </li>
            </ul>
          </div>

          <input
            ref={musicRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const blobKey = `music-${Date.now().toString(36)}`;
              await putBlob(blobKey, file);
              await setMusic(id, {
                blobKey,
                name: file.name,
                volume: 0.7,
                duckClips: false,
              });
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
