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

  /** Where it came from. Imports carry no capture-time audio evidence. */
  source?: 'capture' | 'import';
  /** A still is held on screen for durationMs rather than played. */
  kind?: 'video' | 'still';
  /** Silence this moment in the finished video. */
  muted?: boolean;
  /** Playback rate. 1 is untouched; anything else forces a re-encode. */
  speed?: number;
}

export interface MusicTrack {
  blobKey: string;
  name: string;
  /** 0..1 */
  volume: number;
  /** Duck clip audio under the music, or the music under the clips. */
  duckClips: boolean;
}

export function momentSpeed(m: Moment): number {
  const s = m.speed ?? 1;
  // atempo is only defined over 0.5..2.0 without chaining filters.
  return Math.min(2, Math.max(0.5, s));
}

export type ExportPreset = '1080p' | '720p';

export interface Project {
  id: string;
  name: string;
  aspect: Aspect;
  createdAt: number;
  updatedAt: number;
  locked: boolean;
  /** Ordering is explicit, not derived from moment timestamps. */
  momentIds: string[];
  music?: MusicTrack | null;
  /**
   * When set, capture snaps each moment's length to the beat grid. A pile of
   * one-second clips cut on the beat is what makes this format look edited.
   * Set by tapping tempo rather than detected, because a wrong guess is worse
   * than no guess.
   */
  bpm?: number | null;
  exportPreset?: ExportPreset;
}

export interface AppState {
  projects: Record<string, Project>;
  moments: Record<string, Moment>;
  projectOrder: string[];
}

export function emptyState(): AppState {
  return { projects: {}, moments: {}, projectOrder: [] };
}

/** Effective playback length of a moment after trimming and speed. */
export function trimmedDurationMs(m: Moment): number {
  const end = m.trimEndMs ?? m.durationMs;
  return Math.max(0, (end - m.trimStartMs) / momentSpeed(m));
}

/** Milliseconds per beat, or null when no tempo is set. */
export function beatMs(bpm: number | null | undefined): number | null {
  if (!bpm || bpm <= 0) return null;
  return 60_000 / bpm;
}

/**
 * Round a length to the nearest whole number of beats, never to zero. Used to
 * pick capture lengths that land on the grid.
 */
export function snapToBeat(ms: number, bpm: number | null | undefined): number {
  const beat = beatMs(bpm);
  if (!beat) return ms;
  return Math.max(1, Math.round(ms / beat)) * beat;
}

export function projectDurationMs(state: AppState, projectId: string): number {
  const p = state.projects[projectId];
  if (!p) return 0;
  return p.momentIds.reduce((sum, id) => {
    const m = state.moments[id];
    return m ? sum + trimmedDurationMs(m) : sum;
  }, 0);
}
