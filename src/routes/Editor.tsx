import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../store/useApp';
import { getBlob, putBlob } from '../storage/db';
import { trimmedDurationMs, type Moment } from '../types';
import {
  exportProject,
  shareVideo,
  type ExportProgress,
} from '../export/exporter';
import { planExport } from '../export/concat';
import { useCloud } from '../cloud/useCloud';
import { createInvite, ensureBlob, subscribeToProject } from '../cloud/sync';
import {
  BackButton,
  NavBar,
  Segmented,
  Sheet,
  SwipeToDelete,
  Switch,
  useScrolled,
} from '../ui/components';
import { useReorder } from '../ui/useReorder';
import { Icon } from '../ui/Icon';
import { Toast } from '../ui/Toast';

const REENCODE_TEXT: Record<string, string> = {
  trimmed: 'Re-encoding trimmed moments…',
  'mixed-sizes': 'Re-encoding — this Glimpse mixes frame sizes…',
  music: 'Mixing the soundtrack…',
  effects: 'Applying speed and mute changes…',
  imported: 'Re-encoding imported media…',
};

function MomentThumb({ moment, shared }: { moment: Moment; shared: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let made: string | null = null;
    let cancelled = false;
    // On a shared project the file may belong to a collaborator and not exist
    // locally yet, so fall through to the bucket.
    const load = shared
      ? ensureBlob(moment.projectId, moment.blobKey)
      : getBlob(moment.blobKey);
    void load.then((b) => {
      if (!b || cancelled) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [moment.blobKey, moment.projectId, shared]);

  if (!url) return <div className="thumb lg" />;
  return moment.kind === 'still' ? (
    <img className="thumb lg" src={url} alt="" />
  ) : (
    <video className="thumb lg" src={url} muted playsInline preload="metadata" />
  );
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
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const importRef = useRef<HTMLInputElement>(null);
  const musicRef = useRef<HTMLInputElement>(null);
  const tapsRef = useRef<number[]>([]);

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
  const silentCount = moments.filter((m) => m.peakRms < 0.004).length;
  const plan = planExport(state, id);
  const editingMoment = editing ? state.moments[editing] : null;

  if (!project) return null;

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
          <button
            className="nav-btn right"
            onClick={() => {
              setDraftName(project.name);
              setSettingsOpen(true);
            }}
          >
            Settings
          </button>
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
            <svg className="empty-art" viewBox="0 0 132 96" fill="none" aria-hidden>
              <rect x="8" y="26" width="46" height="44" rx="6"
                stroke="currentColor" strokeWidth="2" />
              <rect x="62" y="26" width="46" height="44" rx="6"
                stroke="currentColor" strokeWidth="2" strokeDasharray="5 5"
                opacity=".5" />
              <path d="M118 40v16M110 48h16" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" opacity=".5" />
            </svg>
            <strong>No moments yet</strong>
            Record or import something to begin.
          </div>
        ) : (
          <div className="group">
            <ul className="list">
              {moments.map((m, i) => {
                const dragging = reorder.state.draggingId === m.id;
                return (
                  <li
                    key={m.id}
                    data-moment-id={m.id}
                    style={
                      dragging
                        ? {
                            transform: `translateY(${reorder.state.offsetY}px)`,
                            position: 'relative',
                            zIndex: 2,
                          }
                        : undefined
                    }
                  >
                    <SwipeToDelete
                      disabled={project.locked}
                      onDelete={() => void removeMoment(id, m.id)}
                    >
                      <div className={`row inset-sep${dragging ? ' lifted' : ''}`}>
                        <MomentThumb moment={m} shared={shared} />
                        <button
                          className="row-main"
                          style={{ background: 'none', textAlign: 'left' }}
                          onClick={() => !project.locked && setEditing(m.id)}
                        >
                          <div className="row-title">
                            {i + 1}. {(trimmedDurationMs(m) / 1000).toFixed(1)}s
                            {(m.speed ?? 1) !== 1 && ` · ${m.speed}×`}
                            {m.muted && ' · muted'}
                          </div>
                          <div className="row-sub">
                            {m.peakRms < 0.004 ? (
                              <span className="flag">no sound recorded</span>
                            ) : (
                              describe(m)
                            )}
                            {m.interrupted && (
                              <span className="flag"> · interrupted</span>
                            )}
                          </div>
                        </button>

                        {!project.locked && (
                          <span
                            className="grip"
                            aria-label="Reorder"
                            onPointerDown={(e) => reorder.begin(m.id, e)}
                            onPointerMove={reorder.move}
                            onPointerUp={reorder.end}
                            onPointerCancel={reorder.end}
                          >
                            <Icon name="grip" size={20} />
                          </span>
                        )}
                      </div>
                    </SwipeToDelete>
                  </li>
                );
              })}
            </ul>
            <div className="group-footer">
              Tap a moment to trim it or change its speed. Drag the handle to
              reorder, swipe left to delete.
            </div>
          </div>
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
          onClick={runExport}
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

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {/* ---------------------------------------------- per-moment editing */}
      {editingMoment && (
        <Sheet
          title={`Moment ${order.indexOf(editingMoment.id) + 1}`}
          onClose={() => setEditing(null)}
          leftAction={
            <button className="nav-btn" onClick={() => setEditing(null)}>
              Done
            </button>
          }
        >
          {editingMoment.kind !== 'still' && (
            <div className="group">
              <div className="group-header">Trim</div>
              <div className="list">
                <div className="row">
                  <span className="row-value" style={{ flex: '0 0 52px' }}>
                    Start
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={editingMoment.durationMs}
                    step={50}
                    value={editingMoment.trimStartMs}
                    onChange={(e) =>
                      void trimMoment(
                        id,
                        editingMoment.id,
                        Math.min(
                          Number(e.target.value),
                          (editingMoment.trimEndMs ?? editingMoment.durationMs) - 100,
                        ),
                        editingMoment.trimEndMs,
                      )
                    }
                  />
                </div>
                <div className="row">
                  <span className="row-value" style={{ flex: '0 0 52px' }}>
                    End
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={editingMoment.durationMs}
                    step={50}
                    value={editingMoment.trimEndMs ?? editingMoment.durationMs}
                    onChange={(e) =>
                      void trimMoment(
                        id,
                        editingMoment.id,
                        editingMoment.trimStartMs,
                        Math.max(
                          Number(e.target.value),
                          editingMoment.trimStartMs + 100,
                        ),
                      )
                    }
                  />
                </div>
              </div>
              <div className="group-footer">
                {(trimmedDurationMs(editingMoment) / 1000).toFixed(2)}s of{' '}
                {(editingMoment.durationMs / 1000).toFixed(2)}s
              </div>
            </div>
          )}

          <div className="group">
            <div className="group-header">Speed</div>
            <Segmented
              options={[0.5, 1, 2] as const}
              value={editingMoment.speed ?? 1}
              onChange={(s) => void setMomentProps(id, editingMoment.id, { speed: s })}
              format={(s) => `${s}×`}
            />
          </div>

          <div className="group">
            <ul className="list">
              <li className="row">
                <div className="row-main">
                  <div className="row-title">Mute this moment</div>
                </div>
                <Switch
                  checked={!!editingMoment.muted}
                  onChange={(v) =>
                    void setMomentProps(id, editingMoment.id, { muted: v })
                  }
                />
              </li>
            </ul>
          </div>

          <div className="group">
            <ul className="list">
              <li>
                <button
                  className="row destructive"
                  onClick={() => {
                    void removeMoment(id, editingMoment.id);
                    setEditing(null);
                  }}
                >
                  <div className="row-main">
                    <div className="row-title">Delete moment</div>
                  </div>
                </button>
              </li>
            </ul>
          </div>
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
