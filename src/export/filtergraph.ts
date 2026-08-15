import type { Moment, MusicTrack } from '../types';
import { momentSpeed, trimmedDurationMs } from '../types';

/**
 * Builds the ffmpeg filter_complex for an export that cannot be stream-copied.
 *
 * Everything here is pure string generation against the moment list, which is
 * the only reason it can be tested at all — running ffmpeg.wasm in CI to check
 * a filter chain would be far slower and no more informative.
 *
 * Shape of the graph:
 *   per moment  → trim, reset timestamps, apply speed, scale/pad to the target
 *   all moments → concat into one video and one audio stream
 *   music       → volume, optional ducking, mixed under the concatenated audio
 */

export interface GraphOptions {
  moments: Moment[];
  width: number;
  height: number;
  /** Index of the music input in the ffmpeg input list, if any. */
  musicInputIndex?: number;
  music?: MusicTrack | null;
}

export interface Graph {
  filter: string;
  videoOut: string;
  audioOut: string;
}

/** Scale to fit inside the frame, then pad — never crop, never stretch. */
export function fitFilter(width: number, height: number): string {
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
    `setsar=1`
  );
}

function videoChain(m: Moment, i: number, width: number, height: number): string {
  const speed = momentSpeed(m);
  const start = (m.trimStartMs / 1000).toFixed(3);
  const end = ((m.trimEndMs ?? m.durationMs) / 1000).toFixed(3);

  const parts = [
    `trim=start=${start}:end=${end}`,
    'setpts=PTS-STARTPTS',
    ...(speed === 1 ? [] : [`setpts=PTS/${speed}`]),
    fitFilter(width, height),
    // Normalise frame rate. iOS records variable frame rate, and concatenating
    // VFR segments is where audio/video drift creeps in on longer Glimpses.
    'fps=30',
  ];

  return `[${i}:v]${parts.join(',')}[v${i}]`;
}

function audioChain(m: Moment, i: number): string {
  const speed = momentSpeed(m);
  const start = (m.trimStartMs / 1000).toFixed(3);
  const end = ((m.trimEndMs ?? m.durationMs) / 1000).toFixed(3);
  const durS = (trimmedDurationMs(m) / 1000).toFixed(3);

  // A still has no audio track at all, and a muted moment should contribute
  // silence of exactly the right length rather than being dropped — otherwise
  // concat would misalign every moment after it.
  if (m.muted || m.kind === 'still') {
    return `anullsrc=r=48000:cl=mono,atrim=duration=${durS},asetpts=PTS-STARTPTS[a${i}]`;
  }

  const parts = [
    `atrim=start=${start}:end=${end}`,
    'asetpts=PTS-STARTPTS',
    ...(speed === 1 ? [] : [`atempo=${speed}`]),
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=mono',
  ];

  return `[${i}:a]${parts.join(',')}[a${i}]`;
}

export function buildGraph(opts: GraphOptions): Graph {
  const { moments, width, height, music, musicInputIndex } = opts;
  const chains: string[] = [];

  moments.forEach((m, i) => {
    chains.push(videoChain(m, i, width, height));
    chains.push(audioChain(m, i));
  });

  const concatInputs = moments.map((_, i) => `[v${i}][a${i}]`).join('');
  chains.push(`${concatInputs}concat=n=${moments.length}:v=1:a=1[vcat][acat]`);

  let audioOut = '[acat]';

  if (music && musicInputIndex !== undefined) {
    const vol = Math.min(1, Math.max(0, music.volume)).toFixed(2);
    chains.push(`[${musicInputIndex}:a]volume=${vol},aresample=48000[mus]`);

    if (music.duckClips) {
      // Music leads; clip audio sits underneath it.
      chains.push(`[acat]volume=0.35[aduck]`);
      chains.push(
        `[aduck][mus]amix=inputs=2:duration=first:dropout_transition=0,` +
          `alimiter=limit=0.95[amixed]`,
      );
    } else {
      // Clips lead; music is background. sidechaincompress pulls the music
      // down whenever there is sound in the clips, which is what "ducking"
      // actually means and is far better than a fixed volume cut.
      chains.push(
        `[mus][acat]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[mducked]`,
      );
      chains.push(
        `[acat][mducked]amix=inputs=2:duration=first:dropout_transition=0,` +
          `alimiter=limit=0.95[amixed]`,
      );
    }
    audioOut = '[amixed]';
  }

  return { filter: chains.join(';'), videoOut: '[vcat]', audioOut };
}

export const PRESET_SIZE: Record<string, { width: number; height: number }> = {
  '1080p': { width: 1080, height: 1920 },
  '720p': { width: 720, height: 1280 },
};

/** Target frame size for a project, respecting its aspect and export preset. */
export function targetSize(
  aspect: 'square' | 'portrait' | 'landscape',
  preset: '1080p' | '720p' = '1080p',
): { width: number; height: number } {
  const long = preset === '1080p' ? 1920 : 1280;
  const short = preset === '1080p' ? 1080 : 720;
  if (aspect === 'square') return { width: short, height: short };
  if (aspect === 'landscape') return { width: long, height: short };
  return { width: short, height: long };
}
