import type { AppState, Aspect, Moment, Project } from '../types';
import { emptyState } from '../types';

/**
 * Every mutation is an append-only journal entry. Nothing mutates a project
 * record in place, so a crash mid-write can lose at most the entry being
 * appended — never corrupt an existing project. State is rebuilt by replay.
 */
export type JournalEntry =
  | { t: 'project.create'; id: string; name: string; aspect: Aspect; ts: number }
  | { t: 'project.rename'; id: string; name: string; ts: number }
  | { t: 'project.lock'; id: string; locked: boolean; ts: number }
  | { t: 'project.delete'; id: string; ts: number }
  | { t: 'moment.add'; moment: Moment; ts: number }
  | { t: 'moment.remove'; projectId: string; momentId: string; ts: number }
  | { t: 'moment.reorder'; projectId: string; momentIds: string[]; ts: number }
  | {
      t: 'moment.trim';
      momentId: string;
      trimStartMs: number;
      trimEndMs: number | null;
      ts: number;
    };

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

    default:
      return state;
  }
}

export function replay(entries: JournalEntry[]): AppState {
  return entries.reduce(apply, emptyState());
}

/** Blob keys still referenced after replay. Anything else on disk is an orphan. */
export function liveBlobKeys(state: AppState): Set<string> {
  return new Set(Object.values(state.moments).map((m) => m.blobKey));
}
