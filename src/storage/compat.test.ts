import { describe, expect, it } from 'vitest';
import { liveBlobKeys, replay, type JournalEntry } from './journal';

/**
 * Guards footage already on the user's phone.
 *
 * Projects are rebuilt by replaying a journal, so every feature that adds an
 * entry type or a field is a chance to silently break journals written before
 * it existed. These fixtures are deliberately written in the OLD shapes and
 * must keep loading — a failure here means a real recording would vanish from
 * someone's device, which no amount of new functionality is worth.
 *
 * When a future change alters the entry format, add the old shape here rather
 * than updating these fixtures.
 */

/** A moment as written before source/kind/muted/speed existed. */
const legacyMoment = {
  id: 'm1',
  projectId: 'p1',
  createdAt: 1_700_000_000_000,
  blobKey: 'blob-1',
  mimeType: 'video/mp4',
  durationMs: 1090,
  trimStartMs: 0,
  trimEndMs: null,
  width: 1920,
  height: 1080,
  facing: 'environment' as const,
  peakRms: 0.04,
  hadAudioTrack: true,
};

describe('journals written by earlier versions', () => {
  it('loads a project recorded before entry ids existed', () => {
    // `eid` arrived with sync. Entries without one must still replay.
    const state = replay([
      {
        t: 'project.create',
        id: 'p1',
        name: 'Wedding',
        aspect: 'portrait',
        ts: 1,
      },
      { t: 'moment.add', moment: legacyMoment, ts: 2 },
    ] as JournalEntry[]);

    expect(state.projects.p1.name).toBe('Wedding');
    expect(state.projects.p1.momentIds).toEqual(['m1']);
    expect(state.moments.m1.blobKey).toBe('blob-1');
  });

  it('keeps the video file live so orphan sweeping cannot claim it', () => {
    const state = replay([
      { t: 'project.create', id: 'p1', name: 'W', aspect: 'portrait', ts: 1 },
      { t: 'moment.add', moment: legacyMoment, ts: 2 },
    ] as JournalEntry[]);
    expect(liveBlobKeys(state).has('blob-1')).toBe(true);
  });

  it('applies a trim entry written before it carried a project id', () => {
    // moment.trim gained projectId when sync needed to route it. Older entries
    // have only momentId.
    const state = replay([
      { t: 'project.create', id: 'p1', name: 'W', aspect: 'portrait', ts: 1 },
      { t: 'moment.add', moment: legacyMoment, ts: 2 },
      { t: 'moment.trim', momentId: 'm1', trimStartMs: 200, trimEndMs: 900, ts: 3 },
    ] as unknown as JournalEntry[]);

    expect(state.moments.m1.trimStartMs).toBe(200);
    expect(state.moments.m1.trimEndMs).toBe(900);
  });

  it('treats a legacy moment as an unmuted, full-speed recorded clip', () => {
    const state = replay([
      { t: 'project.create', id: 'p1', name: 'W', aspect: 'portrait', ts: 1 },
      { t: 'moment.add', moment: legacyMoment, ts: 2 },
    ] as JournalEntry[]);

    const m = state.moments.m1;
    expect(m.muted).toBeUndefined();
    expect(m.speed).toBeUndefined();
    expect(m.kind).toBeUndefined();
    expect(m.source).toBeUndefined();
  });

  it('survives entry types it has never seen', () => {
    // A journal synced from a newer client must not break an older replay.
    const state = replay([
      { t: 'project.create', id: 'p1', name: 'W', aspect: 'portrait', ts: 1 },
      { t: 'moment.add', moment: legacyMoment, ts: 2 },
      { t: 'moment.sparkle', momentId: 'm1', ts: 3 },
    ] as unknown as JournalEntry[]);

    expect(state.projects.p1.momentIds).toEqual(['m1']);
  });

  it('replays an old delete into the trash rather than losing the record', () => {
    // Deletion used to erase the file immediately, so these entries land in
    // the trash pointing at a file that is gone. The app purges those on
    // launch; what matters here is that replay itself stays consistent.
    const state = replay([
      { t: 'project.create', id: 'p1', name: 'W', aspect: 'portrait', ts: 1 },
      { t: 'moment.add', moment: legacyMoment, ts: 2 },
      { t: 'moment.remove', projectId: 'p1', momentId: 'm1', ts: 3 },
    ] as JournalEntry[]);

    expect(state.projects.p1.momentIds).toEqual([]);
    expect(state.trash.m1).toBeDefined();
  });

  it('preserves ordering across a long mixed journal', () => {
    const mk = (id: string) => ({ ...legacyMoment, id, blobKey: `blob-${id}` });
    const state = replay([
      { t: 'project.create', id: 'p1', name: 'W', aspect: 'portrait', ts: 1 },
      { t: 'moment.add', moment: mk('a'), ts: 2 },
      { t: 'moment.add', moment: mk('b'), ts: 3 },
      { t: 'moment.add', moment: mk('c'), ts: 4 },
      { t: 'moment.reorder', projectId: 'p1', momentIds: ['c', 'a', 'b'], ts: 5 },
      { t: 'project.rename', id: 'p1', name: 'Wedding day', ts: 6 },
    ] as JournalEntry[]);

    expect(state.projects.p1.momentIds).toEqual(['c', 'a', 'b']);
    expect(state.projects.p1.name).toBe('Wedding day');
    expect(liveBlobKeys(state).size).toBe(3);
  });
});
