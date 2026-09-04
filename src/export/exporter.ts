import type { AppState } from '../types';
import { getBlob } from '../storage/db';
import {
  concatManifest,
  outputFileName,
  planExport,
  streamCopyArgs,
} from './concat';
import { buildGraph, targetSize } from './filtergraph';

/**
 * ffmpeg.wasm is loaded from vendored files rather than a CDN, because export
 * has to work offline.
 *
 * Two constraints learned the hard way in the Phase 0 spike:
 *  - The single-threaded core is mandatory. GitHub Pages cannot send COOP/COEP
 *    headers, so SharedArrayBuffer is unavailable and the -mt build cannot run.
 *  - `classWorkerURL` must NOT be passed. Setting it makes the UMD build spawn
 *    a *module* worker, which has no importScripts(), so the core fails to
 *    import. Omitting it spawns a classic worker that resolves 814.ffmpeg.js
 *    relative to ffmpeg.js.
 */

interface FFmpegLike {
  on(ev: 'log', cb: (e: { message: string }) => void): void;
  on(ev: 'progress', cb: (e: { progress: number; time: number }) => void): void;
  load(opts: { coreURL: string; wasmURL: string }): Promise<boolean>;
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array>;
  deleteFile(path: string): Promise<boolean>;
  exec(args: string[]): Promise<number>;
}

declare global {
  interface Window {
    FFmpegWASM?: { FFmpeg: new () => FFmpegLike };
  }
}

const VENDOR = `${import.meta.env.BASE_URL}vendor/`;

let ffmpeg: FFmpegLike | null = null;
let loading: Promise<FFmpegLike> | null = null;

/**
 * ffmpeg reports progress against whichever exec is running. The handler is
 * swapped per export rather than registered per call, because the library only
 * supports a single listener list for the lifetime of the instance.
 */
let onEncodeProgress: ((ratio: number) => void) | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export async function loadFFmpeg(
  onLog?: (line: string) => void,
): Promise<FFmpegLike> {
  if (ffmpeg) return ffmpeg;
  if (loading) return loading;

  loading = (async () => {
    await injectScript(`${VENDOR}ffmpeg.js`);
    const Ctor = window.FFmpegWASM?.FFmpeg;
    if (!Ctor) throw new Error('ffmpeg failed to load');

    const inst = new Ctor();
    if (onLog) inst.on('log', (e) => onLog(e.message));
    inst.on('progress', (e) => {
      // Reported as 0..1 but can overshoot slightly at the tail.
      if (Number.isFinite(e.progress)) {
        onEncodeProgress?.(Math.min(1, Math.max(0, e.progress)));
      }
    });
    await inst.load({
      coreURL: `${VENDOR}ffmpeg-core.js`,
      wasmURL: `${VENDOR}ffmpeg-core.wasm`,
    });
    ffmpeg = inst;
    return inst;
  })();

  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

export interface ExportProgress {
  stage: 'loading' | 'writing' | 'trimming' | 'stitching' | 'reading' | 'done';
  detail?: string;
  ratio?: number;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  streamCopied: boolean;
  elapsedMs: number;
}

export async function exportProject(
  state: AppState,
  projectId: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<ExportResult> {
  const project = state.projects[projectId];
  if (!project) throw new Error('project not found');

  const plan = planExport(state, projectId);
  if (!plan.moments.length) throw new Error('nothing to export');

  const t0 = performance.now();
  onProgress?.({ stage: 'loading' });
  const ff = await loadFFmpeg();

  const written: string[] = [];
  const inputs: string[] = [];
  // Per-input flags, because a still has to be looped into a clip of the right
  // length rather than decoded as a one-frame video.
  const inputArgs: string[][] = [];

  onProgress?.({ stage: 'writing' });
  for (let i = 0; i < plan.moments.length; i++) {
    const m = plan.moments[i];
    const blob = await getBlob(m.blobKey);
    if (!blob) throw new Error(`missing video for moment ${i + 1}`);

    const still = m.kind === 'still';
    const name = still ? `in${i}.jpg` : `in${i}.mp4`;
    await ff.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
    written.push(name);
    inputs.push(name);
    inputArgs.push(
      still
        ? ['-loop', '1', '-framerate', '30', '-t', (m.durationMs / 1000).toFixed(3), '-i', name]
        : ['-i', name],
    );
    onProgress?.({ stage: 'writing', ratio: (i + 1) / plan.moments.length });
  }

  const out = 'out.mp4';
  let streamCopied = plan.canStreamCopy;

  if (plan.canStreamCopy) {
    onProgress?.({ stage: 'stitching' });
    await ff.writeFile(
      'list.txt',
      new TextEncoder().encode(concatManifest(inputs)),
    );
    written.push('list.txt');
    try {
      await ff.exec(streamCopyArgs(out));
    } catch {
      // Segments disagreed in a way the stored metadata did not capture.
      streamCopied = false;
    }
  }

  if (!streamCopied) {
    onProgress?.({ stage: 'stitching', detail: 're-encoding', ratio: 0 });
    // Real progress, not a static bar. A long re-encode on a phone takes
    // minutes, and a frozen bar is indistinguishable from a hang.
    onEncodeProgress = (ratio) =>
      onProgress?.({ stage: 'stitching', detail: 're-encoding', ratio });

    // Music becomes the last ffmpeg input, so the graph can reference it.
    let musicInputIndex: number | undefined;
    if (project.music) {
      const musicBlob = await getBlob(project.music.blobKey);
      if (musicBlob) {
        const name = 'music.dat';
        await ff.writeFile(name, new Uint8Array(await musicBlob.arrayBuffer()));
        written.push(name);
        inputs.push(name);
        inputArgs.push(['-i', name]);
        musicInputIndex = inputs.length - 1;
      }
    }

    const { width, height } = targetSize(
      project.aspect,
      project.exportPreset ?? '1080p',
    );
    const graph = buildGraph({
      moments: plan.moments,
      width,
      height,
      music: project.music ?? null,
      musicInputIndex,
    });

    await ff.exec([
      ...inputArgs.flat(),
      '-filter_complex', graph.filter,
      '-map', graph.videoOut,
      '-map', graph.audioOut,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart',
      out,
    ]);
  }

  onEncodeProgress = null;
  onProgress?.({ stage: 'reading' });
  const data = await ff.readFile(out);
  const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: 'video/mp4' });

  // Free the worker FS; it is not garbage collected between exports.
  for (const f of [...written, out]) {
    await ff.deleteFile(f).catch(() => {});
  }

  onProgress?.({ stage: 'done' });
  return {
    blob,
    fileName: outputFileName(project.name),
    streamCopied,
    elapsedMs: Math.round(performance.now() - t0),
  };
}

/**
 * Hand the file to iOS via the share sheet, where "Save Video" writes it to
 * Photos. A sandboxed page cannot write to the photo library directly, and a
 * download link is inert inside an installed PWA, so this is the only route.
 */
export async function shareVideo(blob: Blob, fileName: string): Promise<boolean> {
  const file = new File([blob], fileName, { type: 'video/mp4' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      // AbortError means the user dismissed the sheet, which is not a failure.
      if ((err as Error).name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return false;
}
