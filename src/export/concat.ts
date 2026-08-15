import type { AppState, Moment } from '../types';
import { trimmedDurationMs } from '../types';

export interface ExportPlan {
  moments: Moment[];
  /**
   * True when ffmpeg can stitch with `-c copy` and skip re-encoding entirely —
   * the difference between an instant export and a minute of work on a phone.
   *
   * Two conditions. Every moment must be used whole, and every moment must
   * share the same frame size. Moments from one held stream satisfy both by
   * construction, but flipping to the front camera can change resolution
   * mid-project, and the concat demuxer refuses mismatched inputs.
   */
  canStreamCopy: boolean;
  /** Why the fast path is unavailable, for the UI to explain the wait. */
  reencodeReason: 'trimmed' | 'mixed-sizes' | null;
  totalMs: number;
}

export function isUntrimmed(m: Moment): boolean {
  return m.trimStartMs === 0 && (m.trimEndMs === null || m.trimEndMs >= m.durationMs);
}

export function uniformSize(moments: Moment[]): boolean {
  if (moments.length < 2) return true;
  const { width, height } = moments[0];
  return moments.every((m) => m.width === width && m.height === height);
}

export function planExport(state: AppState, projectId: string): ExportPlan {
  const project = state.projects[projectId];
  const moments = (project?.momentIds ?? [])
    .map((id) => state.moments[id])
    .filter((m): m is Moment => !!m);

  const trimmed = !moments.every(isUntrimmed);
  const mixed = !uniformSize(moments);
  // Trimming is reported first: it forces a re-encode of the cut segments
  // regardless of whether sizes also differ.
  const reencodeReason = trimmed ? 'trimmed' : mixed ? 'mixed-sizes' : null;

  return {
    moments,
    canStreamCopy: reencodeReason === null,
    reencodeReason,
    totalMs: moments.reduce((sum, m) => sum + trimmedDurationMs(m), 0),
  };
}

/** ffmpeg concat demuxer manifest. Filenames are the in-worker FS names. */
export function concatManifest(names: string[]): string {
  // Single quotes are escaped per the concat demuxer's own rules.
  return names.map((n) => `file '${n.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

/** Args for the fast path: no decode, no encode, just remux. */
export function streamCopyArgs(output: string): string[] {
  return [
    '-f', 'concat',
    '-safe', '0',
    '-i', 'list.txt',
    '-c', 'copy',
    '-movflags', '+faststart',
    output,
  ];
}

/** Per-moment trim args, used only when a clip is not taken whole. */
export function trimArgs(m: Moment, input: string, output: string): string[] {
  const start = m.trimStartMs / 1000;
  const dur = trimmedDurationMs(m) / 1000;
  return [
    '-ss', start.toFixed(3),
    '-i', input,
    '-t', dur.toFixed(3),
    // Trimming needs a real cut, so this segment gets re-encoded. Keeping the
    // codecs identical to the untrimmed clips keeps the final concat on the
    // copy path.
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    output,
  ];
}

export function outputFileName(projectName: string): string {
  const safe = projectName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `${safe || 'glimpse'}.mp4`;
}
