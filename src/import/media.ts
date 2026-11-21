/**
 * Normalising imported media at the door, rather than at export time.
 *
 * iPhone photos are HEIC, which the ffmpeg.wasm core cannot decode. Safari
 * *can* decode HEIC into an <img>, so drawing it to a canvas and re-encoding
 * as JPEG converts it using the one decoder on the device that understands it.
 * Everything downstream then only ever sees JPEG and H.264.
 */

export interface NormalisedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Longest edge of a stored still. Bigger than any export preset needs. */
const MAX_EDGE = 2048;

export async function normaliseImage(file: File): Promise<NormalisedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);

    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) throw new Error('could not convert image');

    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('unsupported image format'));
    img.src = src;
  });
}

export interface VideoProbe {
  durationMs: number;
  width: number;
  height: number;
}

/** Duration and frame size of an imported video, read from the file itself. */
export function probeVideo(blob: Blob, fallbackMs = 3000): Promise<VideoProbe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    let settled = false;

    const finish = (p: VideoProbe) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(p);
    };

    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      const d = v.duration;
      finish({
        durationMs: Math.round(Number.isFinite(d) && d > 0 ? d * 1000 : fallbackMs),
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
      });
    };
    v.onerror = () => finish({ durationMs: fallbackMs, width: 0, height: 0 });
    setTimeout(() => finish({ durationMs: fallbackMs, width: 0, height: 0 }), 5000);
    v.src = url;
  });
}
