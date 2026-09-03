import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/useApp';
import type { Aspect, Moment, Project } from '../types';
import { projectDurationMs } from '../types';
import { Preview } from '../ui/Preview';
import { Frame } from '../ui/Frame';
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

/**
 * The Glimpse's own footage, filling the card.
 *
 * The list used to be grouped rows with 52px thumbnails — a settings screen
 * that happened to contain video. The footage is the only thing that tells one
 * Glimpse from another at a glance, so it leads.
 */
function Poster({ project }: { project: Project }) {
  const firstId = project.momentIds[0];
  const first = useApp((s) => (firstId ? s.state.moments[firstId] : undefined));

  if (!first) {
    return (
      <span className="poster-empty">
        <Icon name={project.locked ? 'lock' : 'film'} size={30} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <Frame
      moment={first}
      className="poster-media"
      placeholder={<span className="poster-empty" />}
    />
  );
}

/**
 * A short strip of ticks, reading as "this is made of pieces".
 *
 * The mockup filled a varying number of ticks per card, which on inspection
 * encodes nothing a viewer could read — the exact count is spelled out in
 * words directly below. So it caps at five and is honest about being a motif
 * rather than a gauge.
 */
function Ticks({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="poster-ticks" aria-hidden="true">
      {Array.from({ length: Math.min(count, 5) }, (_, i) => (
        <i key={i} />
      ))}
    </span>
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
  /** Id of the Glimpse being played inline, if any. */
  const [playing, setPlaying] = useState<string | null>(null);

  async function create() {
    const id = await createProject(name.trim() || 'Untitled', aspect);
    setCreating(false);
    setName('');
    nav(`/p/${id}/capture`);
  }

  const projects = state.projectOrder
    .map((id) => state.projects[id])
    .filter(Boolean);

  const totalMs = projects.reduce(
    (sum, p) => sum + projectDurationMs(state, p.id),
    0,
  );

  const playingProject = playing ? state.projects[playing] : null;
  /* Memoised because the player reloads its blobs whenever this array's
     identity changes — a fresh array per render made it revoke and re-create
     every URL continuously, and any element still holding the old one failed
     to load it. */
  const playingMoments = useMemo(
    () =>
      (playingProject?.momentIds ?? [])
        .map((mid) => state.moments[mid])
        .filter((m): m is Moment => !!m),
    [playingProject?.momentIds, state.moments],
  );

  return (
    <div className="screen">
      <NavBar
        title="Glimpses"
        subtitle={
          projects.length > 0
            ? `${projects.length} Glimpse${projects.length === 1 ? '' : 's'} · ${fmtDuration(totalMs)} of footage`
            : undefined
        }
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
          <div className="posters">
            <ul>
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
                    <div className="poster">
                      <button
                        className="poster-open"
                        onClick={() => nav(`/p/${p.id}`)}
                        aria-label={`Open ${p.name}`}
                      >
                        <Poster project={p} />
                        <span className="poster-scrim" />
                        <Ticks count={p.momentIds.length} />

                        <span className="poster-pills">
                          {p.locked && (
                            <span className="poster-pill">
                              <Icon name="lock" size={11} strokeWidth={2.4} />
                              Locked
                            </span>
                          )}
                          {p.momentIds.length > 0 && (
                            <span className="poster-pill">
                              {fmtDuration(projectDurationMs(state, p.id))}
                            </span>
                          )}
                        </span>

                        <span className="poster-meta">
                          <span className="poster-name">{p.name}</span>
                          <span className="poster-sub">
                            {p.momentIds.length} moment
                            {p.momentIds.length === 1 ? '' : 's'} ·{' '}
                            {relativeDay(p.updatedAt)}
                          </span>
                        </span>
                      </button>

                      {/* Watching a Glimpse should not require opening the
                          editor first — playing it back is the whole point of
                          collecting the moments. */}
                      {p.momentIds.length > 0 && (
                        <button
                          className="poster-play"
                          onClick={() => setPlaying(p.id)}
                          aria-label={`Play ${p.name}`}
                        >
                          <Icon name="play" size={18} />
                        </button>
                      )}
                    </div>
                  </SwipeToDelete>
                </li>
              ))}
            </ul>
            <div className="group-footer">
              Tap a Glimpse to edit it, or play it here. Swipe left to delete.
            </div>
          </div>
        )}

        <div className="buildstamp">
          Version {__BUILD_ID__} · {__BUILD_TIME__}
        </div>
      </div>

      <div className="toolbar">
        <button className="btn filled" onClick={() => setCreating(true)}>
          New Glimpse
        </button>
      </div>

      {playingProject && playingMoments.length > 0 && (
        <Preview
          moments={playingMoments}
          music={playingProject.music}
          onClose={() => setPlaying(null)}
        />
      )}

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
