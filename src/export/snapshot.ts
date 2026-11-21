import type { Project } from '../types';
import { targetSize } from './filtergraph';

/**
 * A single frame, saved as an image.
 *
 * This deliberately does not go through ffmpeg. The frame the user wants is
 * already decoded and on screen in the preview, so a canvas grab is instant,
 * needs no 31 MB core download, and cannot pick a different frame than the one
 * they were looking at. Loading ffmpeg to re-decode a frame we already have
 * would be slower and less accurate.
 *
 * The canvas is not tainted: every source is a blob: URL minted from a local
 * file, which is same-origin.
 */

/** The visible framing, matched to what a video export of the same project
 *  would produce, so a snapshot and the video agree. */
export function fitAndPad(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  // Contain, never crop: cropping is the original app's front-camera bug.
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  return { x: Math.round((dstW - w) / 2), y: Math.round((dstH - h) / 2), w, h };
}

export type FrameSource =
  | { el: HTMLVideoElement; kind: 'video' }
  | { el: HTMLImageElement; kind: 'still' };

function sourceSize(src: FrameSource): { w: number; h: number } {
  return src.kind === 'video'
    ? { w: src.el.videoWidth, h: src.el.videoHeight }
    : { w: src.el.naturalWidth, h: src.el.naturalHeight };
}

export class NoFrameError extends Error {
  constructor() {
    super('That frame has not loaded yet. Give it a moment and try again.');
    this.name = 'NoFrameError';
  }
}

export async function grabFrame(
  src: FrameSource,
  project: Pick<Project, 'aspect' | 'exportPreset'>,
): Promise<Blob> {
  const { w: sw, h: sh } = sourceSize(src);
  // A video element reports 0×0 until it has decoded something. Drawing it
  // would silently produce a blank image, so refuse instead.
  if (!sw || !sh) throw new NoFrameError();

  const { width, height } = targetSize(
    project.aspect,
    project.exportPreset ?? '1080p',
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create an image from that frame.');
  // Letterbox in black, matching the video export's pad colour.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const box = fitAndPad(sw, sh, width, height);
  ctx.drawImage(src.el, box.x, box.y, box.w, box.h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92),
  );
  if (!blob) throw new Error('Could not create an image from that frame.');
  return blob;
}

/** Sanitised the same way as the video's name, so the pair sort together. */
export function snapshotFileName(projectName: string): string {
  const safe = projectName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `${safe || 'glimpse'}.jpg`;
}

/**
 * Same route as a video: the share sheet, where "Save Image" writes it to
 * Photos. A download link is inert inside an installed PWA.
 */
export async function shareImage(blob: Blob, fileName: string): Promise<boolean> {
  const file = new File([blob], fileName, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
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
