import { describe, expect, it } from 'vitest';
import { beatMs, momentSpeed, snapToBeat, trimmedDurationMs } from './types';
import type { Moment } from './types';

function moment(over: Partial<Moment> = {}): Moment {
  return {
    id: 'm',
    projectId: 'p',
    createdAt: 1,
    blobKey: 'b',
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

describe('moment speed', () => {
  it('defaults to 1 when unset', () => {
    expect(momentSpeed(moment())).toBe(1);
  });

  it('clamps to the range atempo handles without chaining filters', () => {
    expect(momentSpeed(moment({ speed: 10 }))).toBe(2);
    expect(momentSpeed(moment({ speed: 0.01 }))).toBe(0.5);
  });
});

describe('trimmed duration', () => {
  it('is the trim window at normal speed', () => {
    expect(trimmedDurationMs(moment({ trimStartMs: 200, trimEndMs: 800 }))).toBe(600);
  });

  it('shortens at 2x and lengthens at 0.5x', () => {
    expect(trimmedDurationMs(moment({ speed: 2 }))).toBe(500);
    expect(trimmedDurationMs(moment({ speed: 0.5 }))).toBe(2000);
  });

  it('never goes negative on an inverted trim window', () => {
    expect(trimmedDurationMs(moment({ trimStartMs: 900, trimEndMs: 100 }))).toBe(0);
  });
});

describe('beat grid', () => {
  it('converts tempo to a beat length', () => {
    expect(beatMs(120)).toBe(500);
    expect(beatMs(60)).toBe(1000);
  });

  it('treats missing or nonsense tempo as no grid', () => {
    expect(beatMs(null)).toBeNull();
    expect(beatMs(0)).toBeNull();
    expect(beatMs(-10)).toBeNull();
  });

  it('snaps a length to the nearest whole beat', () => {
    // 120 BPM = 500ms beats; 1000ms is already 2 beats.
    expect(snapToBeat(1000, 120)).toBe(1000);
    // 1200ms is closer to 2 beats (1000) than 3 (1500).
    expect(snapToBeat(1200, 120)).toBe(1000);
    expect(snapToBeat(1400, 120)).toBe(1500);
  });

  it('never snaps down to nothing', () => {
    expect(snapToBeat(10, 120)).toBe(500);
  });

  it('leaves the length alone with no tempo set', () => {
    expect(snapToBeat(1234, null)).toBe(1234);
  });
});
