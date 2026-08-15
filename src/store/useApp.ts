import { create } from 'zustand';
import type {
  AppState,
  Aspect,
  ExportPreset,
  Moment,
  MusicTrack,
} from '../types';
import { emptyState, TRASH_TTL_MS } from '../types';
import { normaliseImage, probeVideo } from '../import/media';
import { apply, expiredTrash, type JournalEntry } from '../storage/journal';
import {
  appendEntry,
  assemblePending,
  backfillEntryIds,
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
  restoreMoment: (projectId: string, momentId: string) => Promise<void>;
  purgeMoment: (momentId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  reorderMoments: (projectId: string, momentIds: string[]) => Promise<void>;
  trimMoment: (
    projectId: string,
    momentId: string,
    trimStartMs: number,
    trimEndMs: number | null,
  ) => Promise<void>;
  setMomentProps: (
    projectId: string,
    momentId: string,
    props: { muted?: boolean; speed?: number; durationMs?: number },
  ) => Promise<void>;

  setMusic: (projectId: string, music: MusicTrack | null) => Promise<void>;
  setBpm: (projectId: string, bpm: number | null) => Promise<void>;
  setExportPreset: (projectId: string, preset: ExportPreset) => Promise<void>;
  importFiles: (projectId: string, files: File[]) => Promise<number>;
}

/** Default on-screen time for an imported photo. */
const STILL_MS = 2000;

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
      await backfillEntryIds();
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

      // Anything past its recovery window goes now, which is the only point
      // at which this app deletes video on its own.
      for (const { momentId, blobKey } of expiredTrash(state, TRASH_TTL_MS)) {
        await commit({ t: 'moment.purge', momentId, ts: Date.now() });
        await deleteBlob(blobKey).catch(() => {});
      }

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
      // Its moments move to the trash rather than being erased, so deleting
      // the wrong Glimpse stays recoverable for the same window.
      await commit({ t: 'project.delete', id, ts: Date.now() });
      void get().refreshQuota();
    },

    async addMoment(m, blob) {
      // Blob before journal: an entry pointing at a missing file would be a
      // broken project, whereas a file with no entry is a recoverable orphan.
      await putBlob(m.blobKey, blob);
      await commit({ t: 'moment.add', moment: m, ts: Date.now() });
      void get().refreshQuota();
    },

    /** Non-destructive: the file survives until the moment is purged. */
    async removeMoment(projectId, momentId) {
      await commit({ t: 'moment.remove', projectId, momentId, ts: Date.now() });
    },

    async restoreMoment(projectId, momentId) {
      await commit({ t: 'moment.restore', projectId, momentId, ts: Date.now() });
    },

    async purgeMoment(momentId) {
      const key = get().state.trash[momentId]?.moment.blobKey;
      await commit({ t: 'moment.purge', momentId, ts: Date.now() });
      if (key) await deleteBlob(key).catch(() => {});
      void get().refreshQuota();
    },

    async emptyTrash() {
      for (const momentId of Object.keys(get().state.trash)) {
        await get().purgeMoment(momentId);
      }
    },

    async reorderMoments(projectId, momentIds) {
      await commit({ t: 'moment.reorder', projectId, momentIds, ts: Date.now() });
    },

    async trimMoment(projectId, momentId, trimStartMs, trimEndMs) {
      await commit({
        t: 'moment.trim',
        projectId,
        momentId,
        trimStartMs,
        trimEndMs,
        ts: Date.now(),
      });
    },

    async setMomentProps(projectId, momentId, props) {
      await commit({
        t: 'moment.props',
        projectId,
        momentId,
        ...props,
        ts: Date.now(),
      });
    },

    async setMusic(projectId, music) {
      const previous = get().state.projects[projectId]?.music?.blobKey;
      await commit({ t: 'project.music', id: projectId, music, ts: Date.now() });
      // Drop the old track only once the journal no longer points at it.
      if (previous && previous !== music?.blobKey) {
        await deleteBlob(previous).catch(() => {});
      }
      void get().refreshQuota();
    },

    async setBpm(projectId, bpm) {
      await commit({ t: 'project.bpm', id: projectId, bpm, ts: Date.now() });
    },

    async setExportPreset(projectId, preset) {
      await commit({
        t: 'project.exportPreset',
        id: projectId,
        preset,
        ts: Date.now(),
      });
    },

    /**
     * Bring existing videos and photos in from the camera roll. The original
     * app is capture-only, which means a Glimpse can never include footage you
     * already have — the single biggest functional gap in it.
     */
    async importFiles(projectId, files) {
      let added = 0;
      for (const file of files) {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        if (!isImage && !isVideo) continue;

        let blob: Blob = file;
        let width = 0;
        let height = 0;
        let durationMs = STILL_MS;
        let mimeType = file.type;

        if (isImage) {
          // Converts HEIC to JPEG using Safari's decoder, since ffmpeg has none.
          const img = await normaliseImage(file);
          blob = img.blob;
          width = img.width;
          height = img.height;
          mimeType = 'image/jpeg';
        } else {
          const probe = await probeVideo(file);
          durationMs = probe.durationMs;
          width = probe.width;
          height = probe.height;
        }

        const moment: Moment = {
          id: newId(),
          projectId,
          createdAt: Date.now(),
          blobKey: newId(),
          mimeType,
          durationMs,
          trimStartMs: 0,
          trimEndMs: null,
          width,
          height,
          facing: 'environment',
          // An import carries no capture-time audio evidence, so it must not
          // be reported as a silent recording.
          peakRms: 1,
          hadAudioTrack: isVideo,
          source: 'import',
          kind: isImage ? 'still' : 'video',
        };

        await get().addMoment(moment, blob);
        added++;
      }
      return added;
    },
  };
});
