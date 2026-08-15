import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/useApp';
import { getBlob } from '../storage/db';
import type { Aspect, Project } from '../types';
import { projectDurationMs } from '../types';
import { Icon } from '../ui/Icon';
import {
  NavBar,
  Segmented,
  Sheet,
  SwipeToDelete,
  useScrolled,
} from '../ui/components';

const ASPECTS: Aspect[] = ['portrait', 'square', 'landscape'];
const ASPECT_LABEL: Record<Aspect, string> = {
  portrait: 'Portrait',
  square: 'Square',
  landscape: 'Landscape',
};

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sec`;
  return `${Math.floor(s / 60)} min ${s % 60} sec`;
}

function relativeDay(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

/** Cover frame for a Glimpse, read from its first moment. */
function Cover({ project }: { project: Project }) {
  const [url, setUrl] = useState<string | null>(null);
  const firstId = project.momentIds[0];
  const blobKey = useApp((s) =>
    firstId ? s.state.moments[firstId]?.blobKey : undefined,
  );
  const kind = useApp((s) => (firstId ? s.state.moments[firstId]?.kind : undefined));

  useEffect(() => {
    if (!blobKey) return;
    let made: string | null = null;
    let cancelled = false;
    void getBlob(blobKey).then((b) => {
      if (!b || cancelled) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [blobKey]);

  if (!url)
    return (
      <div className="thumb brand-mark">
        <Icon name={project.locked ? 'lock' : 'film'} size={22} />
      </div>
    );
  return kind === 'still' ? (
    <img className="thumb" src={url} alt="" />
  ) : (
    <video className="thumb" src={url} muted playsInline preload="metadata" />
  );
}

export default function ProjectList() {
  const nav = useNavigate();
  const state = useApp((s) => s.state);
  const createProject = useApp((s) => s.createProject);
  const deleteProject = useApp((s) => s.deleteProject);
  const quota = useApp((s) => s.quota);
  const recovered = useApp((s) => s.recovered);
  const { scrolled, onScroll } = useScrolled();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [aspect, setAspect] = useState<Aspect>('portrait');

  async function create() {
    const id = await createProject(name.trim() || 'Untitled', aspect);
    setCreating(false);
    setName('');
    nav(`/p/${id}/capture`);
  }

  const projects = state.projectOrder
    .map((id) => state.projects[id])
    .filter(Boolean);

  return (
    <div className="screen">
      <NavBar
        title="Glimpses"
        scrolled={scrolled}
        right={
          <button
            className="nav-btn right"
            onClick={() => setCreating(true)}
            aria-label="New Glimpse"
          >
            <Icon name="plus" size={24} strokeWidth={2} />
          </button>
        }
      />

      <div className="scroll" onScroll={onScroll}>
        {recovered.length > 0 && (
          <div className="banner warn">
            Recovered {recovered.length} clip{recovered.length > 1 ? 's' : ''} from
            an interrupted recording.
          </div>
        )}

        {quota && quota.ratio > 0.8 && (
          <div className="banner bad">
            Storage is {Math.round(quota.ratio * 100)}% full. Export and delete a
            Glimpse to free space.
          </div>
        )}

        {projects.length === 0 ? (
          <div className="empty">
            <div className="mark">
              <Icon name="film" size={34} strokeWidth={1.6} />
            </div>
            <strong>Nothing here yet</strong>
            Capture a second at a time. Every moment joins the same growing
            video.
          </div>
        ) : (
          <div className="group">
            <ul className="list">
              {projects.map((p) => (
                <li key={p.id}>
                  <SwipeToDelete
                    disabled={p.locked}
                    onDelete={() => {
                      if (confirm(`Delete “${p.name}” and all its moments?`)) {
                        void deleteProject(p.id);
                      }
                    }}
                  >
                    <button
                      className="row inset-sep"
                      onClick={() => nav(`/p/${p.id}`)}
                    >
                      <Cover project={p} />
                      <div className="row-main">
                        <div className="row-title">
                          {p.locked && (
                            <Icon
                              name="lock"
                              size={14}
                              strokeWidth={2}
                              className="inline-lock"
                            />
                          )}
                          {p.name}
                        </div>
                        <div className="row-sub">
                          {p.momentIds.length} moment
                          {p.momentIds.length === 1 ? '' : 's'} ·{' '}
                          {fmtDuration(projectDurationMs(state, p.id))}
                        </div>
                        <div className="row-sub">{relativeDay(p.updatedAt)}</div>
                      </div>
                      <span className="chevron">
                        <Icon name="chevron-right" size={17} strokeWidth={2.4} />
                      </span>
                    </button>
                  </SwipeToDelete>
                </li>
              ))}
            </ul>
            <div className="group-footer">
              Swipe a Glimpse left to delete it. Locked Glimpses cannot be
              deleted or edited.
            </div>
          </div>
        )}
      </div>

      <div className="toolbar">
        <button className="btn filled" onClick={() => setCreating(true)}>
          New Glimpse
        </button>
      </div>

      {creating && (
        <Sheet
          title="New Glimpse"
          onClose={() => setCreating(false)}
          rightAction={
            <button
              className="nav-btn right"
              style={{ fontWeight: 600 }}
              onClick={create}
            >
              Start
            </button>
          }
        >
          <div className="group">
            <input
              className="field"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="group">
            <div className="group-header">Shape</div>
            <Segmented
              options={ASPECTS}
              value={aspect}
              onChange={setAspect}
              format={(a) => ASPECT_LABEL[a]}
            />
            <div className="group-footer">
              Every moment is fitted to this shape, so mixing cameras never
              crops the frame. This cannot be changed later.
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
