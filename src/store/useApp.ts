import { create } from 'zustand';
import type { AppState, Aspect, Moment } from '../types';
import { emptyState } from '../types';
import { apply, type JournalEntry } from '../storage/journal';
import {
  appendEntry,
  assemblePending,
  clearPending,
  deleteBlob,
  findOrphanBlobs,
  loadState,
  pendingBlobKeys,
  putBlob,
  quota,
  requestPersistence,
  type QuotaInfo,
} from '../storage/db';

export const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

interface Store {
  state: AppState;
  ready: boolean;
  quota: QuotaInfo | null;
  /** Recording chunks found on launch that never became a moment. */
  recovered: string[];

  init: () => Promise<void>;
  refreshQuota: () => Promise<void>;

  createProject: (name: string, aspect: Aspect) => Promise<string>;
  renameProject: (id: string, name: string) => Promise<void>;
  setLocked: (id: string, locked: boolean) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  addMoment: (m: Moment, blob: Blob) => Promise<void>;
  removeMoment: (projectId: string, momentId: string) => Promise<void>;
  reorderMoments: (projectId: string, momentIds: string[]) => Promise<void>;
  trimMoment: (
    momentId: string,
    trimStartMs: number,
    trimEndMs: number | null,
  ) => Promise<void>;
}

export const useApp = create<Store>((set, get) => {
  /** Journal first, memory second — disk is the source of truth. */
  async function commit(e: JournalEntry) {
    await appendEntry(e);
    set({ state: apply(get().state, e) });
  }

  return {
    state: emptyState(),
    ready: false,
    quota: null,
    recovered: [],

    async init() {
      const state = await loadState();
      set({ state, ready: true });

      void requestPersistence();
      void get().refreshQuota();

      // Anything in `pending` is a moment that was being recorded when the app
      // died. Salvage what was flushed rather than discarding it.
      const stranded = await pendingBlobKeys();
      const live = new Set(Object.values(state.moments).map((m) => m.blobKey));
      const recovered: string[] = [];
      for (const key of stranded) {
        if (live.has(key)) {
          await clearPending(key);
          continue;
        }
        const blob = await assemblePending(key, 'video/mp4');
        if (blob && blob.size > 0) {
          await putBlob(key, blob);
          recovered.push(key);
        }
        await clearPending(key);
      }
      if (recovered.length) set({ recovered });

      // Orphans are reported, never silently deleted — they are video.
      const orphans = await findOrphanBlobs(state);
      if (orphans.length) {
        console.info(`[glimpse] ${orphans.length} orphaned clip(s) on disk`);
      }
    },

    async refreshQuota() {
      set({ quota: await quota() });
    },

    async createProject(name, aspect) {
      const id = newId();
      await commit({ t: 'project.create', id, name, aspect, ts: Date.now() });
      return id;
    },

    async renameProject(id, name) {
      await commit({ t: 'project.rename', id, name, ts: Date.now() });
    },

    async setLocked(id, locked) {
      await commit({ t: 'project.lock', id, locked, ts: Date.now() });
    },

    async deleteProject(id) {
      const project = get().state.projects[id];
      const keys =
        project?.momentIds
          .map((mid) => get().state.moments[mid]?.blobKey)
          .filter((k): k is string => !!k) ?? [];
      await commit({ t: 'project.delete', id, ts: Date.now() });
      for (const k of keys) await deleteBlob(k).catch(() => {});
      void get().refreshQuota();
    },

    async addMoment(m, blob) {
      // Blob before journal: an entry pointing at a missing file would be a
      // broken project, whereas a file with no entry is a recoverable orphan.
      await putBlob(m.blobKey, blob);
      await commit({ t: 'moment.add', moment: m, ts: Date.now() });
      void get().refreshQuota();
    },

    async removeMoment(projectId, momentId) {
      const key = get().state.moments[momentId]?.blobKey;
      await commit({ t: 'moment.remove', projectId, momentId, ts: Date.now() });
      if (key) await deleteBlob(key).catch(() => {});
      void get().refreshQuota();
    },

    async reorderMoments(projectId, momentIds) {
      await commit({ t: 'moment.reorder', projectId, momentIds, ts: Date.now() });
    },

    async trimMoment(momentId, trimStartMs, trimEndMs) {
      await commit({
        t: 'moment.trim',
        momentId,
        trimStartMs,
        trimEndMs,
        ts: Date.now(),
      });
    },
  };
});
