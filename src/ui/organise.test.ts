import { describe, expect, it } from 'vitest';
import type { Moment } from '../types';
import { isNoop, organise, shuffled } from './organise';

function m(id: string, createdAt: number): Moment {
  return {
    id,
    projectId: 'p1',
    createdAt,
    blobKey: `b-${id}`,
    mimeType: 'video/mp4',
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: null,
    width: 1080,
    height: 1920,
    facing: 'environment',
    peakRms: 0.2,
    hadAudioTrack: true,
  };
}

// Recorded out of the order they currently sit in, which is the whole point.
const moments: Record<string, Moment> = {
  a: m('a', 300),
  b: m('b', 100),
  c: m('c', 200),
};
const order = ['a', 'b', 'c'];

/** Deterministic stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('organise', () => {
  it('sorts oldest recorded first', () => {
    expect(organise(order, moments, 'oldest')).toEqual(['b', 'c', 'a']);
  });

  it('sorts newest recorded first', () => {
    expect(organise(order, moments, 'newest')).toEqual(['a', 'c', 'b']);
  });

  it('breaks createdAt ties by current position, so the sort is stable', () => {
    const tied: Record<string, Moment> = {
      x: m('x', 500),
      y: m('y', 500),
      z: m('z', 500),
    };
    expect(organise(['z', 'x', 'y'], tied, 'oldest')).toEqual(['z', 'x', 'y']);
    expect(organise(['z', 'x', 'y'], tied, 'newest')).toEqual(['z', 'x', 'y']);
  });

  it('keeps a moment the store has never heard of rather than dropping it', () => {
    // The journal rejects a reorder that isn't a permutation, so losing an id
    // here would silently turn Apply into a no-op.
    const out = organise(['a', 'ghost', 'b'], moments, 'oldest');
    expect(out.slice().sort()).toEqual(['a', 'b', 'ghost']);
    expect(out).toHaveLength(3);
  });

  it('returns a permutation for every mode', () => {
    for (const mode of ['shuffle', 'oldest', 'newest'] as const) {
      const out = organise(order, moments, mode, seeded(7));
      expect(out.slice().sort()).toEqual(order.slice().sort());
    }
  });

  it('shuffles without losing or duplicating ids', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const out = shuffled(ids, seeded(99));
    expect(new Set(out).size).toBe(40);
    expect(out).not.toEqual(ids);
  });

  it('leaves a single moment alone', () => {
    expect(shuffled(['only'], seeded(1))).toEqual(['only']);
    expect(organise(['only'], moments, 'shuffle', seeded(1))).toEqual(['only']);
  });

  it('detects a no-op order', () => {
    expect(isNoop(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isNoop(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(isNoop(['a'], ['a', 'b'])).toBe(false);
  });
});
