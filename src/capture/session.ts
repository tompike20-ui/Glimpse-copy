import { clearPending, putChunk } from '../storage/db';

/**
 * A capture session owns ONE MediaStream for its whole lifetime.
 *
 * This is the core reliability decision of the app. The original Glimpse
 * appears to re-acquire the camera and microphone per clip, and loses audio on
 * the second and later clips of a session — the defect that cost one reviewer
 * their wedding vows. Here getUserMedia is called once; every moment gets a
 * fresh MediaRecorder bound to that same, still-live stream.
 *
 * Holding one stream has a second benefit: every moment is encoded with
 * identical parameters, which is what lets export concatenate with `-c copy`
 * instead of re-encoding.
 */

export type Facing = 'user' | 'environment';

export interface RecordedMoment {
  blobKey: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  facing: Facing;
  peakRms: number;
  hadAudioTrack: boolean;
  interrupted: boolean;
}

export interface AudioHealth {
  hasTrack: boolean;
  live: boolean;
  muted: boolean;
  /** Rolling peak so a brief dip does not read as failure. */
  level: number;
}

const MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs="vp8,opus"',
  'video/webm',
];

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* isTypeSupported can throw on malformed strings in older engines */
    }
  }
  return '';
}

export class CaptureSession {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(new ArrayBuffer(2048 * 4));
  private recorder: MediaRecorder | null = null;
  private facing: Facing = 'environment';

  readonly mimeType = pickMimeType();

  /** Raised when iOS takes the mic or camera away (call, Siri, app switch). */
  onInterrupt: ((reason: string) => void) | null = null;

  get active(): boolean {
    return !!this.stream;
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  get currentFacing(): Facing {
    return this.facing;
  }

  /** Acquire camera + mic. Called once on entering capture, not per moment. */
  async start(facing: Facing = 'environment'): Promise<MediaStream> {
    if (this.stream && this.facing === facing) return this.stream;
    if (this.stream) this.stop();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: true,
    });

    this.stream = stream;
    this.facing = facing;

    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () =>
        this.onInterrupt?.(`${track.kind} track ended`),
      );
      track.addEventListener('mute', () =>
        this.onInterrupt?.(`${track.kind} track muted`),
      );
    }

    // One AudioContext for the session, feeding the on-screen level meter.
    // A visible meter is the cheapest possible defence against recording
    // silence without noticing.
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.audioCtx = new Ctor();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.audioCtx.createMediaStreamSource(stream).connect(this.analyser);
    await this.audioCtx.resume().catch(() => {});

    return stream;
  }

  async flip(): Promise<MediaStream> {
    return this.start(this.facing === 'environment' ? 'user' : 'environment');
  }

  /** Instantaneous mic RMS, 0..~1. */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.buf.length);
  }

  audioHealth(): AudioHealth {
    const track = this.stream?.getAudioTracks()[0];
    return {
      hasTrack: !!track,
      live: track?.readyState === 'live',
      muted: !!track?.muted,
      level: this.level(),
    };
  }

  /**
   * Re-acquire only if the audio track has actually died. Checked before every
   * moment so a dead mic surfaces as an error instead of a silent clip.
   */
  async ensureHealthy(): Promise<AudioHealth> {
    const h = this.audioHealth();
    if (h.hasTrack && h.live) return h;
    await this.start(this.facing);
    return this.audioHealth();
  }

  /**
   * Record one moment. Chunks are flushed to IndexedDB as they arrive, so a
   * crash costs at most one timeslice rather than the whole moment.
   */
  async recordMoment(durationMs: number, blobKey: string): Promise<RecordedMoment> {
    if (!this.stream) throw new Error('capture session not started');
    if (this.recorder) throw new Error('already recording');

    const health = await this.ensureHealthy();
    const track = this.stream.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};

    const rec = this.mimeType
      ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
      : new MediaRecorder(this.stream);
    this.recorder = rec;

    const chunks: Blob[] = [];
    let peak = 0;
    let interrupted = false;
    let seq = 0;

    const meter = window.setInterval(() => {
      peak = Math.max(peak, this.level());
    }, 50);

    const onHidden = () => {
      if (document.visibilityState === 'hidden' && rec.state === 'recording') {
        interrupted = true;
        rec.stop();
      }
    };
    document.addEventListener('visibilitychange', onHidden);

    const started = performance.now();

    const done = new Promise<void>((resolve, reject) => {
      rec.ondataavailable = (e) => {
        if (!e.data?.size) return;
        chunks.push(e.data);
        // Fire-and-forget: never let disk latency stall the recorder.
        void putChunk(blobKey, seq++, e.data);
      };
      rec.onerror = () => reject(new Error('recorder error'));
      rec.onstop = () => resolve();
    });

    rec.start(250);
    const timer = window.setTimeout(() => {
      if (rec.state === 'recording') rec.stop();
    }, durationMs);

    try {
      await done;
    } finally {
      window.clearInterval(meter);
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onHidden);
      this.recorder = null;
    }

    const elapsed = performance.now() - started;
    const mimeType = rec.mimeType || this.mimeType || 'video/mp4';
    const blob = new Blob(chunks, { type: mimeType });

    // Chunks have served their purpose; the assembled blob is authoritative.
    await clearPending(blobKey);

    return {
      blobKey,
      blob,
      mimeType,
      durationMs: Math.round(Math.min(elapsed, durationMs)),
      width: settings.width ?? 1920,
      height: settings.height ?? 1080,
      facing: this.facing,
      peakRms: peak,
      hadAudioTrack: health.hasTrack && health.live,
      interrupted,
    };
  }

  /** Stop early and keep whatever has been captured so far. */
  stopEarly(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  stop(): void {
    this.recorder = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.analyser = null;
  }
}
