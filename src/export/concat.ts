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
  reencodeReason: ReencodeReason | null;
  totalMs: number;
}

export type ReencodeReason =
  | 'trimmed'
  | 'mixed-sizes'
  | 'music'
  | 'effects'
  | 'imported';

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

  // Ordered by how clearly each explains the wait to someone watching a
  // progress bar, not by how the pipeline happens to check them.
  const reencodeReason: ReencodeReason | null = project?.music
    ? 'music'
    : moments.some((m) => m.muted || (m.speed ?? 1) !== 1)
      ? 'effects'
      : !moments.every(isUntrimmed)
        ? 'trimmed'
        : moments.some((m) => m.source === 'import' || m.kind === 'still')
          ? 'imported'
          : !uniformSize(moments)
            ? 'mixed-sizes'
            : null;

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

export function outputFileName(projectName: string): string {
  const safe = projectName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `${safe || 'glimpse'}.mp4`;
}
