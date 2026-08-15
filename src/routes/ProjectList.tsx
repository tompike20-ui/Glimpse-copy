import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/useApp';
import type { Aspect } from '../types';
import { projectDurationMs } from '../types';

const ASPECTS: { key: Aspect; label: string }[] = [
  { key: 'portrait', label: 'Portrait' },
  { key: 'square', label: 'Square' },
  { key: 'landscape', label: 'Landscape' },
];

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function ProjectList() {
  const nav = useNavigate();
  const state = useApp((s) => s.state);
  const createProject = useApp((s) => s.createProject);
  const quota = useApp((s) => s.quota);
  const recovered = useApp((s) => s.recovered);

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
      <div className="topbar">
        <h1>Glimpses</h1>
      </div>

      <div className="scroll">
        {recovered.length > 0 && (
          <div className="pad">
            <div className="banner warn">
              Recovered {recovered.length} clip
              {recovered.length > 1 ? 's' : ''} from an interrupted recording.
            </div>
          </div>
        )}

        {quota && quota.ratio > 0.8 && (
          <div className="pad">
            <div className="banner bad">
              Storage is {Math.round(quota.ratio * 100)}% full. Export and delete
              a Glimpse to free space.
            </div>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="empty">
            No Glimpses yet.
            <br />
            Start one and record your first moment.
          </div>
        ) : (
          <ul className="plist">
            {projects.map((p) => (
              <li key={p.id}>
                <button className="pcard" onClick={() => nav(`/p/${p.id}`)}>
                  <div className="thumb">{p.locked ? '🔒' : '🎞'}</div>
                  <div className="meta">
                    <div className="name">{p.name}</div>
                    <div className="dim">
                      {p.momentIds.length} moment
                      {p.momentIds.length === 1 ? '' : 's'} ·{' '}
                      {fmtDuration(projectDurationMs(state, p.id))}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button className="fab" onClick={() => setCreating(true)}>
        New Glimpse
      </button>

      {creating && (
        <div className="sheet" onClick={() => setCreating(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h2>New Glimpse</h2>
            <input
              className="field"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <div className="choices">
              {ASPECTS.map((a) => (
                <button
                  key={a.key}
                  aria-pressed={aspect === a.key}
                  onClick={() => setAspect(a.key)}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <button className="primary" onClick={create}>
              Start recording
            </button>
            <button className="secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
