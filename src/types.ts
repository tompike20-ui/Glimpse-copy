export type Aspect = 'square' | 'portrait' | 'landscape';

export const ASPECT_RATIO: Record<Aspect, number> = {
  square: 1,
  portrait: 9 / 16,
  landscape: 16 / 9,
};

export interface Moment {
  id: string;
  projectId: string;
  createdAt: number;
  /** Key into the blob store. */
  blobKey: string;
  mimeType: string;
  /** Measured duration of the stored file. */
  durationMs: number;
  /** Trim window. trimEndMs === null means "to the end". */
  trimStartMs: number;
  trimEndMs: number | null;
  width: number;
  height: number;
  facing: 'user' | 'environment';
  /** Peak mic RMS observed while recording. Zero means the clip is silent. */
  peakRms: number;
  /** Whether a live audio track was attached at record time. */
  hadAudioTrack: boolean;
  /** Set when the recording was cut short by an interruption. */
  interrupted?: boolean;
}

export interface Project {
  id: string;
  name: string;
  aspect: Aspect;
  createdAt: number;
  updatedAt: number;
  locked: boolean;
  /** Ordering is explicit, not derived from moment timestamps. */
  momentIds: string[];
}

export interface AppState {
  projects: Record<string, Project>;
  moments: Record<string, Moment>;
  projectOrder: string[];
}

export function emptyState(): AppState {
  return { projects: {}, moments: {}, projectOrder: [] };
}

/** Effective playback length of a moment after trimming. */
export function trimmedDurationMs(m: Moment): number {
  const end = m.trimEndMs ?? m.durationMs;
  return Math.max(0, end - m.trimStartMs);
}

export function projectDurationMs(state: AppState, projectId: string): number {
  const p = state.projects[projectId];
  if (!p) return 0;
  return p.momentIds.reduce((sum, id) => {
    const m = state.moments[id];
    return m ? sum + trimmedDurationMs(m) : sum;
  }, 0);
}
