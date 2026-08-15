import type { AppState } from '../types';
import { getBlob } from '../storage/db';
import {
  concatManifest,
  isUntrimmed,
  outputFileName,
  planExport,
  streamCopyArgs,
  trimArgs,
} from './concat';

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
  on(ev: 'progress', cb: (e: { progress: number }) => void): void;
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
  const segments: string[] = [];

  onProgress?.({ stage: 'writing' });
  for (let i = 0; i < plan.moments.length; i++) {
    const m = plan.moments[i];
    const blob = await getBlob(m.blobKey);
    if (!blob) throw new Error(`missing video for moment ${i + 1}`);

    const raw = `in${i}.mp4`;
    await ff.writeFile(raw, new Uint8Array(await blob.arrayBuffer()));
    written.push(raw);

    if (isUntrimmed(m)) {
      segments.push(raw);
    } else {
      onProgress?.({
        stage: 'trimming',
        detail: `moment ${i + 1} of ${plan.moments.length}`,
        ratio: i / plan.moments.length,
      });
      const cut = `cut${i}.mp4`;
      await ff.exec(trimArgs(m, raw, cut));
      written.push(cut);
      segments.push(cut);
    }
  }

  onProgress?.({ stage: 'stitching' });
  await ff.writeFile(
    'list.txt',
    new TextEncoder().encode(concatManifest(segments)),
  );
  written.push('list.txt');

  const out = 'out.mp4';
  let streamCopied = true;
  try {
    await ff.exec(streamCopyArgs(out));
  } catch {
    // Mismatched parameters between segments. Fall back to a real encode.
    streamCopied = false;
    onProgress?.({ stage: 'stitching', detail: 're-encoding' });
    await ff.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'list.txt',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      out,
    ]);
  }

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
