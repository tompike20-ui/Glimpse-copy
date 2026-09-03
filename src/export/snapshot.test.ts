import { describe, expect, it } from 'vitest';
import { fitAndPad, snapshotFileName } from './snapshot';

describe('fitAndPad', () => {
  it('fills the frame exactly when the aspects already match', () => {
    expect(fitAndPad(1080, 1920, 1080, 1920)).toEqual({
      x: 0,
      y: 0,
      w: 1080,
      h: 1920,
    });
  });

  it('letterboxes a landscape source into a portrait frame', () => {
    const box = fitAndPad(1920, 1080, 1080, 1920);
    expect(box.w).toBe(1080);
    expect(box.h).toBe(608);
    // Centred, with the bars split evenly top and bottom.
    expect(box.x).toBe(0);
    expect(box.y).toBe(Math.round((1920 - 608) / 2));
  });

  it('pillarboxes a portrait source into a landscape frame', () => {
    const box = fitAndPad(1080, 1920, 1920, 1080);
    expect(box.h).toBe(1080);
    expect(box.w).toBe(608);
    expect(box.y).toBe(0);
    expect(box.x).toBe(Math.round((1920 - 608) / 2));
  });

  it('never crops — the drawn box always fits inside the frame', () => {
    for (const [sw, sh] of [
      [4032, 3024],
      [720, 1280],
      [1, 4000],
      [4000, 1],
    ]) {
      const box = fitAndPad(sw, sh, 1080, 1080);
      expect(box.w).toBeLessThanOrEqual(1080);
      expect(box.h).toBeLessThanOrEqual(1080);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('preserves the source aspect ratio', () => {
    const box = fitAndPad(1600, 900, 1080, 1920);
    expect(box.w / box.h).toBeCloseTo(1600 / 900, 2);
  });

  it('falls back to the full frame for a source of unknown size', () => {
    // videoWidth is 0 until the first frame decodes; better a full-frame box
    // than a division by zero.
    expect(fitAndPad(0, 0, 1080, 1080)).toEqual({ x: 0, y: 0, w: 1080, h: 1080 });
  });
});

describe('snapshotFileName', () => {
  it('matches how the video file is named, but as a jpg', () => {
    expect(snapshotFileName('Smoke Test')).toBe('Smoke-Test.jpg');
    expect(snapshotFileName('Barcelona 2026!')).toBe('Barcelona-2026.jpg');
  });

  it('falls back when the name has nothing usable in it', () => {
    expect(snapshotFileName('***')).toBe('glimpse.jpg');
    expect(snapshotFileName('')).toBe('glimpse.jpg');
  });
});
