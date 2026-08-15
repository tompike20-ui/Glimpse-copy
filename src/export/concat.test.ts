import { describe, expect, it } from 'vitest';
import {
  concatManifest,
  isUntrimmed,
  outputFileName,
  planExport,
  streamCopyArgs,
  trimArgs,
} from './concat';
import { replay, type JournalEntry } from '../storage/journal';
import type { Moment } from '../types';

const ts = 1;

function moment(id: string, over: Partial<Moment> = {}): Moment {
  return {
    id,
    projectId: 'p1',
    createdAt: ts,
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

function stateWith(moments: Moment[]) {
  const entries: JournalEntry[] = [
    { t: 'project.create', id: 'p1', name: 'Trip', aspect: 'portrait', ts },
    ...moments.map((m) => ({ t: 'moment.add' as const, moment: m, ts })),
  ];
  return replay(entries);
}

describe('export planning', () => {
  it('takes the stream-copy path when nothing is trimmed', () => {
    const plan = planExport(stateWith([moment('m1'), moment('m2')]), 'p1');
    expect(plan.canStreamCopy).toBe(true);
    expect(plan.totalMs).toBe(2000);
  });

  it('drops off the stream-copy path as soon as one moment is trimmed', () => {
    const plan = planExport(
      stateWith([moment('m1'), moment('m2', { trimStartMs: 200 })]),
      'p1',
    );
    expect(plan.canStreamCopy).toBe(false);
  });

  it('counts only the trimmed span in total duration', () => {
    const plan = planExport(
      stateWith([moment('m1', { trimStartMs: 250, trimEndMs: 750 })]),
      'p1',
    );
    expect(plan.totalMs).toBe(500);
  });

  it('treats an explicit full-length trimEnd as untrimmed', () => {
    expect(isUntrimmed(moment('m', { trimEndMs: 1000 }))).toBe(true);
    expect(isUntrimmed(moment('m', { trimEndMs: 900 }))).toBe(false);
  });

  it('returns an empty plan for a project that does not exist', () => {
    const plan = planExport(stateWith([]), 'nope');
    expect(plan.moments).toEqual([]);
    expect(plan.totalMs).toBe(0);
  });
});

describe('concat manifest', () => {
  it('emits one file directive per segment', () => {
    expect(concatManifest(['a.mp4', 'b.mp4'])).toBe(
      "file 'a.mp4'\nfile 'b.mp4'\n",
    );
  });

  it('escapes single quotes so a filename cannot break out of the directive', () => {
    expect(concatManifest(["it's.mp4"])).toBe("file 'it'\\''s.mp4'\n");
  });
});

describe('ffmpeg args', () => {
  it('stream copy avoids any encoder flags', () => {
    const args = streamCopyArgs('out.mp4');
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args.join(' ')).not.toContain('libx264');
  });

  it('trim args place -ss before -i so the seek is fast', () => {
    const args = trimArgs(
      moment('m', { trimStartMs: 500, trimEndMs: 900 }),
      'in.mp4',
      'cut.mp4',
    );
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('0.500');
    expect(args[args.indexOf('-t') + 1]).toBe('0.400');
  });
});

describe('output naming', () => {
  it('slugifies the project name', () => {
    expect(outputFileName('Trip to Rome!')).toBe('Trip-to-Rome.mp4');
  });

  it('falls back when a name has no usable characters', () => {
    expect(outputFileName('!!!')).toBe('glimpse.mp4');
  });
});
