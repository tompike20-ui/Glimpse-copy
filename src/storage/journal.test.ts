import { describe, expect, it } from 'vitest';
import { apply, liveBlobKeys, replay, type JournalEntry } from './journal';
import { emptyState, type Moment } from '../types';

const ts = 1;

function moment(id: string, projectId: string, blobKey = `b-${id}`): Moment {
  return {
    id,
    projectId,
    createdAt: ts,
    blobKey,
    mimeType: 'video/mp4',
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: null,
    width: 1920,
    height: 1080,
    facing: 'environment',
    peakRms: 0.2,
    hadAudioTrack: true,
  };
}

const createP: JournalEntry = {
  t: 'project.create',
  id: 'p1',
  name: 'Trip',
  aspect: 'portrait',
  ts,
};

describe('journal replay', () => {
  it('rebuilds projects and moment order from entries', () => {
    const state = replay([
      createP,
      { t: 'moment.add', moment: moment('m1', 'p1'), ts },
      { t: 'moment.add', moment: moment('m2', 'p1'), ts },
    ]);
    expect(state.projects.p1.momentIds).toEqual(['m1', 'm2']);
    expect(state.projectOrder).toEqual(['p1']);
  });

  it('is deterministic — replaying twice gives the same state', () => {
    const entries: JournalEntry[] = [
      createP,
      { t: 'moment.add', moment: moment('m1', 'p1'), ts },
      { t: 'moment.reorder', projectId: 'p1', momentIds: ['m1'], ts },
      { t: 'project.rename', id: 'p1', name: 'Trip 2', ts },
    ];
    expect(replay(entries)).toEqual(replay(entries));
  });

  it('ignores entries for projects that no longer exist', () => {
    const state = replay([
      createP,
      { t: 'project.delete', id: 'p1', ts },
      { t: 'moment.add', moment: moment('m1', 'p1'), ts },
    ]);
    expect(state.moments).toEqual({});
    expect(state.projects).toEqual({});
  });

  it('ignores a duplicated add rather than double-listing the moment', () => {
    const m = moment('m1', 'p1');
    const state = replay([
      createP,
      { t: 'moment.add', moment: m, ts },
      { t: 'moment.add', moment: m, ts },
    ]);
    expect(state.projects.p1.momentIds).toEqual(['m1']);
  });

  it('rejects a reorder that is not a permutation of current moments', () => {
    const base = replay([
      createP,
      { t: 'moment.add', moment: moment('m1', 'p1'), ts },
      { t: 'moment.add', moment: moment('m2', 'p1'), ts },
    ]);
    // A stale entry referencing a deleted moment must not drop m2.
    const after = apply(base, {
      t: 'moment.reorder',
      projectId: 'p1',
      momentIds: ['m1', 'gone'],
      ts,
    });
    expect(after.projects.p1.momentIds).toEqual(['m1', 'm2']);
  });

  it('applies a genuine reorder', () => {
    const base = replay([
      createP,
      { t: 'moment.add', moment: moment('m1', 'p1'), ts },
      { t: 'moment.add', moment: moment('m2', 'p1'), ts },
    ]);
    const after = apply(base, {
      t: 'moment.reorder',
      projectId: 'p1',
      momentIds: ['m2', 'm1'],
      ts,
    });
    expect(after.projects.p1.momentIds).toEqual(['m2', 'm1']);
  });

  it('deleting a project drops its moments from state', () => {
    const state = replay([
      createP,
      { t: 'moment.add', moment: moment('m1', 'p1'), ts },
      { t: 'project.delete', id: 'p1', ts },
    ]);
    expect(Object.keys(state.moments)).toEqual([]);
  });

  it('unknown entry types leave state untouched', () => {
    const base = replay([createP]);
    const after = apply(base, { t: 'nonsense' } as unknown as JournalEntry);
    expect(after).toEqual(base);
  });

  it('tracks live blob keys for orphan detection', () => {
    const state = replay([
      createP,
      { t: 'moment.add', moment: moment('m1', 'p1', 'blob-a'), ts },
    ]);
    expect(liveBlobKeys(state)).toEqual(new Set(['blob-a']));
    expect(liveBlobKeys(emptyState()).size).toBe(0);
  });
});
