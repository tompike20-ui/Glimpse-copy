import { describe, expect, it } from 'vitest';
import { buildGraph, fitFilter, targetSize } from './filtergraph';
import type { Moment } from '../types';

function moment(id: string, over: Partial<Moment> = {}): Moment {
  return {
    id,
    projectId: 'p1',
    createdAt: 1,
    blobKey: `b-${id}`,
    mimeType: 'video/mp4',
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: null,
    width: 1920,
    height: 1080,
    facing: 'environment',
    peakRms: 0.2,
    hadAudioTrack: true,
    ...over,
  };
}

const size = { width: 1080, height: 1920 };

describe('fit filter', () => {
  it('scales to fit and pads rather than cropping or stretching', () => {
    const f = fitFilter(1080, 1920);
    expect(f).toContain('force_original_aspect_ratio=decrease');
    expect(f).toContain('pad=1080:1920');
    expect(f).toContain('setsar=1');
    // Cropping is what produced the original app's black half-frames.
    expect(f).not.toContain('crop');
  });
});

describe('target size', () => {
  it('maps aspect and preset to real dimensions', () => {
    expect(targetSize('portrait', '1080p')).toEqual({ width: 1080, height: 1920 });
    expect(targetSize('landscape', '1080p')).toEqual({ width: 1920, height: 1080 });
    expect(targetSize('square', '1080p')).toEqual({ width: 1080, height: 1080 });
    expect(targetSize('portrait', '720p')).toEqual({ width: 720, height: 1280 });
  });
});

describe('filter graph', () => {
  it('emits one video and one audio chain per moment, then concatenates', () => {
    const g = buildGraph({ moments: [moment('a'), moment('b')], ...size });
    expect(g.filter).toContain('[0:v]');
    expect(g.filter).toContain('[1:v]');
    expect(g.filter).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]');
    expect(g.videoOut).toBe('[vcat]');
    expect(g.audioOut).toBe('[acat]');
  });

  it('normalises frame rate, because iOS records variable frame rate', () => {
    const g = buildGraph({ moments: [moment('a')], ...size });
    expect(g.filter).toContain('fps=30');
  });

  it('applies trim bounds in seconds', () => {
    const g = buildGraph({
      moments: [moment('a', { trimStartMs: 250, trimEndMs: 750 })],
      ...size,
    });
    expect(g.filter).toContain('trim=start=0.250:end=0.750');
    expect(g.filter).toContain('atrim=start=0.250:end=0.750');
  });

  it('omits speed filters entirely at 1x', () => {
    const g = buildGraph({ moments: [moment('a')], ...size });
    expect(g.filter).not.toContain('PTS/');
    expect(g.filter).not.toContain('atempo');
  });

  it('applies setpts and atempo together so audio stays in sync', () => {
    const g = buildGraph({ moments: [moment('a', { speed: 2 })], ...size });
    expect(g.filter).toContain('setpts=PTS/2');
    expect(g.filter).toContain('atempo=2');
  });

  it('clamps speed into the range atempo supports without chaining', () => {
    const fast = buildGraph({ moments: [moment('a', { speed: 8 })], ...size });
    expect(fast.filter).toContain('atempo=2');
    const slow = buildGraph({ moments: [moment('a', { speed: 0.1 })], ...size });
    expect(slow.filter).toContain('atempo=0.5');
  });

  it('replaces a muted moment with silence of the same length, not nothing', () => {
    // Dropping the stream would desynchronise every later moment in the concat.
    const g = buildGraph({
      moments: [moment('a', { muted: true, durationMs: 2000 })],
      ...size,
    });
    expect(g.filter).toContain('anullsrc');
    expect(g.filter).toContain('atrim=duration=2.000');
  });

  it('treats a still as silent, since it has no audio track to trim', () => {
    const g = buildGraph({ moments: [moment('a', { kind: 'still' })], ...size });
    expect(g.filter).toContain('anullsrc');
  });

  it('accounts for speed when sizing a muted moment’s silence', () => {
    const g = buildGraph({
      moments: [moment('a', { muted: true, durationMs: 2000, speed: 2 })],
      ...size,
    });
    expect(g.filter).toContain('atrim=duration=1.000');
  });

  it('ducks music under clip audio with a sidechain compressor', () => {
    const g = buildGraph({
      moments: [moment('a')],
      ...size,
      musicInputIndex: 1,
      music: { blobKey: 'm', name: 'song', volume: 0.6, duckClips: false },
    });
    expect(g.filter).toContain('[1:a]volume=0.60');
    expect(g.filter).toContain('sidechaincompress');
    expect(g.audioOut).toBe('[amixed]');
  });

  it('drops clip audio under the music when the music is meant to lead', () => {
    const g = buildGraph({
      moments: [moment('a')],
      ...size,
      musicInputIndex: 1,
      music: { blobKey: 'm', name: 'song', volume: 1, duckClips: true },
    });
    expect(g.filter).toContain('[acat]volume=0.35');
    expect(g.filter).not.toContain('sidechaincompress');
  });

  it('limits the mix so combining sources cannot clip', () => {
    const g = buildGraph({
      moments: [moment('a')],
      ...size,
      musicInputIndex: 1,
      music: { blobKey: 'm', name: 'song', volume: 1, duckClips: false },
    });
    expect(g.filter).toContain('alimiter=limit=0.95');
  });

  it('leaves audio untouched when there is no music', () => {
    const g = buildGraph({ moments: [moment('a')], ...size });
    expect(g.filter).not.toContain('amix');
    expect(g.audioOut).toBe('[acat]');
  });
});
