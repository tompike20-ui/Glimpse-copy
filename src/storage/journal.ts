import type {
  AppState,
  Aspect,
  ExportPreset,
  Moment,
  MusicTrack,
  Project,
} from '../types';
import { emptyState } from '../types';

/**
 * Every mutation is an append-only journal entry. Nothing mutates a project
 * record in place, so a crash mid-write can lose at most the entry being
 * appended — never corrupt an existing project. State is rebuilt by replay.
 */
/**
 * `eid` is a stable uuid that doubles as the server primary key, which is what
 * makes syncing idempotent — pushing the same entry twice is a no-op. It is
 * optional only so journals written before sync existed still replay.
 */
interface Base {
  ts: number;
  eid?: string;
}

export type JournalEntry =
  | ({ t: 'project.create'; id: string; name: string; aspect: Aspect } & Base)
  | ({ t: 'project.rename'; id: string; name: string } & Base)
  | ({ t: 'project.lock'; id: string; locked: boolean } & Base)
  | ({ t: 'project.delete'; id: string } & Base)
  | ({ t: 'moment.add'; moment: Moment } & Base)
  | ({ t: 'moment.remove'; projectId: string; momentId: string } & Base)
  | ({ t: 'moment.reorder'; projectId: string; momentIds: string[] } & Base)
  | ({
      t: 'moment.trim';
      // Carried explicitly so sync can route the entry without consulting
      // local state, which a collaborator may not have yet.
      projectId: string;
      momentId: string;
      trimStartMs: number;
      trimEndMs: number | null;
    } & Base)
  | ({
      t: 'moment.props';
      projectId: string;
      momentId: string;
      muted?: boolean;
      speed?: number;
    } & Base)
  | ({ t: 'project.music'; id: string; music: MusicTrack | null } & Base)
  | ({ t: 'project.bpm'; id: string; bpm: number | null } & Base)
  | ({ t: 'project.exportPreset'; id: string; preset: ExportPreset } & Base);

/** Applies one entry. Unknown or inapplicable entries are ignored, not fatal. */
export function apply(state: AppState, e: JournalEntry): AppState {
  switch (e.t) {
    case 'project.create': {
      if (state.projects[e.id]) return state;
      const p: Project = {
        id: e.id,
        name: e.name,
        aspect: e.aspect,
        createdAt: e.ts,
        updatedAt: e.ts,
        locked: false,
        momentIds: [],
      };
      return {
        ...state,
        projects: { ...state.projects, [e.id]: p },
        projectOrder: [e.id, ...state.projectOrder],
      };
    }

    case 'project.rename': {
      const p = state.projects[e.id];
      if (!p) return state;
      return {
        ...state,
        projects: {
          ...state.projects,
          [e.id]: { ...p, name: e.name, updatedAt: e.ts },
        },
      };
    }

    case 'project.lock': {
      const p = state.projects[e.id];
      if (!p) return state;
      return {
        ...state,
        projects: {
          ...state.projects,
          [e.id]: { ...p, locked: e.locked, updatedAt: e.ts },
        },
      };
    }

    case 'project.delete': {
      const p = state.projects[e.id];
      if (!p) return state;
      const projects = { ...state.projects };
      delete projects[e.id];
      const moments = { ...state.moments };
      for (const id of p.momentIds) delete moments[id];
      return {
        projects,
        moments,
        projectOrder: state.projectOrder.filter((id) => id !== e.id),
      };
    }

    case 'moment.add': {
      const p = state.projects[e.moment.projectId];
      if (!p) return state;
      if (state.moments[e.moment.id]) return state;
      return {
        ...state,
        moments: { ...state.moments, [e.moment.id]: e.moment },
        projects: {
          ...state.projects,
          [p.id]: {
            ...p,
            momentIds: [...p.momentIds, e.moment.id],
            updatedAt: e.ts,
          },
        },
      };
    }

    case 'moment.remove': {
      const p = state.projects[e.projectId];
      if (!p) return state;
      const moments = { ...state.moments };
      delete moments[e.momentId];
      return {
        ...state,
        moments,
        projects: {
          ...state.projects,
          [p.id]: {
            ...p,
            momentIds: p.momentIds.filter((id) => id !== e.momentId),
            updatedAt: e.ts,
          },
        },
      };
    }

    case 'moment.reorder': {
      const p = state.projects[e.projectId];
      if (!p) return state;
      // Only accept a permutation of what the project already holds, so a
      // stale reorder entry cannot resurrect or drop moments.
      const current = new Set(p.momentIds);
      const next = e.momentIds.filter((id) => current.has(id));
      if (next.length !== p.momentIds.length) return state;
      return {
        ...state,
        projects: {
          ...state.projects,
          [p.id]: { ...p, momentIds: next, updatedAt: e.ts },
        },
      };
    }

    case 'moment.trim': {
      const m = state.moments[e.momentId];
      if (!m) return state;
      return {
        ...state,
        moments: {
          ...state.moments,
          [e.momentId]: {
            ...m,
            trimStartMs: e.trimStartMs,
            trimEndMs: e.trimEndMs,
          },
        },
      };
    }

    case 'moment.props': {
      const m = state.moments[e.momentId];
      if (!m) return state;
      return {
        ...state,
        moments: {
          ...state.moments,
          [e.momentId]: {
            ...m,
            ...(e.muted === undefined ? {} : { muted: e.muted }),
            ...(e.speed === undefined ? {} : { speed: e.speed }),
          },
        },
      };
    }

    case 'project.music': {
      const p = state.projects[e.id];
      if (!p) return state;
      return {
        ...state,
        projects: {
          ...state.projects,
          [e.id]: { ...p, music: e.music, updatedAt: e.ts },
        },
      };
    }

    case 'project.bpm': {
      const p = state.projects[e.id];
      if (!p) return state;
      return {
        ...state,
        projects: { ...state.projects, [e.id]: { ...p, bpm: e.bpm, updatedAt: e.ts } },
      };
    }

    case 'project.exportPreset': {
      const p = state.projects[e.id];
      if (!p) return state;
      return {
        ...state,
        projects: {
          ...state.projects,
          [e.id]: { ...p, exportPreset: e.preset, updatedAt: e.ts },
        },
      };
    }

    default:
      return state;
  }
}

export function replay(entries: JournalEntry[]): AppState {
  return entries.reduce(apply, emptyState());
}

/**
 * Blob keys still referenced after replay. Anything else on disk is an orphan.
 * Music tracks count: they live in the same blob store as moments, and missing
 * them here would see every soundtrack reported as garbage.
 */
export function liveBlobKeys(state: AppState): Set<string> {
  const keys = new Set(Object.values(state.moments).map((m) => m.blobKey));
  for (const p of Object.values(state.projects)) {
    if (p.music?.blobKey) keys.add(p.music.blobKey);
  }
  return keys;
}
