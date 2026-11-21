import { useEffect, useRef, useState } from 'react';
import type { Moment } from '../types';
import { getBlob } from '../storage/db';
import { ensureBlob } from '../cloud/sync';

/**
 * A still frame of a moment, for thumbnails, tiles and poster cards.
 *
 * A `<video preload="metadata">` is not required to paint anything — it loads
 * the header and may sit blank until told to show a specific time. That is why
 * some cards rendered their footage and others showed an empty placeholder,
 * seemingly at random. Seeking just past the trim point forces a decode, so a
 * frame always appears.
 *
 * Every caller previously carried its own copy of the blob-to-object-URL
 * dance, including the revoke on unmount that leaks the file if forgotten.
 */
export function Frame({
  moment,
  className,
  shared = false,
  placeholder,
}: {
  moment: Moment;
  className?: string;
  /** Look in the bucket too: on a shared project the file may be a
   *  collaborator's and not on this device yet. */
  shared?: boolean;
  placeholder?: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Drop the previous URL from state before the new blob arrives, so nothing
    // renders against a source that is about to be freed.
    setUrl(null);
    setPoster(null);
    const load = shared
      ? ensureBlob(moment.projectId, moment.blobKey)
      : getBlob(moment.blobKey);
    void load
      .then((b) => {
        if (!b || cancelled) return;
        setUrl(URL.createObjectURL(b));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [moment.blobKey, moment.projectId, shared]);

  /* Free the previous URL only once React has committed a render that no
     longer points at it. Revoking in the loader's cleanup runs *before* that
     render, so the DOM briefly holds a dead src and the browser reports a
     failed load. */
  useEffect(() => {
    const prev = liveUrl.current;
    liveUrl.current = url;
    if (prev && prev !== url) URL.revokeObjectURL(prev);
  }, [url]);

  useEffect(
    () => () => {
      if (liveUrl.current) URL.revokeObjectURL(liveUrl.current);
    },
    [],
  );

  /* Seek to a real frame, capture it, and then let the video element go.
     A filmstrip of sixty moments would otherwise hold sixty live decoders —
     and on iOS the decoder budget is small enough that the extras simply fail,
     which shows up as blank tiles and, worse, a blank snapshot grabbed from a
     player that never got to decode. */
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url || poster) return;

    const capture = () => {
      if (!el.videoWidth) return;
      // Thumbnails are at most ~120pt wide on screen; a full-resolution poster
      // per tile is memory spent on pixels nobody sees.
      const w = Math.min(el.videoWidth, 320);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = Math.round((el.videoHeight / el.videoWidth) * w);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      try {
        setPoster(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        // A tainted canvas cannot happen for a same-origin blob, but a failed
        // capture must leave the live video in place rather than blanking it.
      }
    };

    const seek = () => {
      // A hair past the trim point: exactly 0 can land before the first
      // decodable frame on some files.
      const t = moment.trimStartMs / 1000 + 0.03;
      el.currentTime = Number.isFinite(el.duration)
        ? Math.min(t, Math.max(0, el.duration - 0.05))
        : t;
    };

    el.addEventListener('seeked', capture);
    if (el.readyState >= 1) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
    return () => {
      el.removeEventListener('loadedmetadata', seek);
      el.removeEventListener('seeked', capture);
    };
  }, [url, poster, moment.trimStartMs]);

  /* A new trim point means a new frame to show. */
  useEffect(() => setPoster(null), [moment.trimStartMs, moment.blobKey]);

  if (!url) return <>{placeholder ?? <span className={className} />}</>;
  if (poster) return <img className={className} src={poster} alt="" />;

  return moment.kind === 'still' ? (
    <img className={className} src={url} alt="" />
  ) : (
    <video
      ref={videoRef}
      className={className}
      src={url}
      muted
      playsInline
      preload="auto"
    />
  );
}
