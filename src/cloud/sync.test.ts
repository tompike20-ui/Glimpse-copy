import { describe, expect, it } from 'vitest';
import { entryProjectId } from './sync';
import type { JournalEntry } from '../storage/journal';
import type { Moment } from '../types';

const ts = 1;

const moment: Moment = {
  id: 'm1',
  projectId: 'p1',
  createdAt: ts,
  blobKey: 'b1',
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

describe('sync entry routing', () => {
  // Every entry shape must resolve to a project, or it would be silently
  // dropped from every push and never reach collaborators.
  const cases: [string, JournalEntry][] = [
    ['project.create', { t: 'project.create', id: 'p1', name: 'x', aspect: 'square', ts }],
    ['project.rename', { t: 'project.rename', id: 'p1', name: 'y', ts }],
    ['project.lock', { t: 'project.lock', id: 'p1', locked: true, ts }],
    ['project.delete', { t: 'project.delete', id: 'p1', ts }],
    ['moment.add', { t: 'moment.add', moment, ts }],
    ['moment.remove', { t: 'moment.remove', projectId: 'p1', momentId: 'm1', ts }],
    ['moment.reorder', { t: 'moment.reorder', projectId: 'p1', momentIds: ['m1'], ts }],
    [
      'moment.trim',
      { t: 'moment.trim', projectId: 'p1', momentId: 'm1', trimStartMs: 0, trimEndMs: 500, ts },
    ],
  ];

  it.each(cases)('routes %s to its project', (_name, entry) => {
    expect(entryProjectId(entry)).toBe('p1');
  });

  it('returns null for an unrecognised entry rather than throwing', () => {
    expect(entryProjectId({ t: 'bogus' } as unknown as JournalEntry)).toBeNull();
  });
});
