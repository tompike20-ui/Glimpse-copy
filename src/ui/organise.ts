import type { Moment } from '../types';

/**
 * Bulk reordering, kept as pure functions so the orders can be unit-tested
 * without a browser. Every mode returns a permutation of the input — never a
 * shorter or longer list — because the journal rejects a reorder entry that
 * isn't one, and silently dropping a moment would be data loss.
 */
export type OrganiseMode = 'shuffle' | 'oldest' | 'newest';

export const ORGANISE_MODES: {
  mode: OrganiseMode;
  title: string;
  sub: string;
  icon: 'shuffle' | 'sort-down' | 'sort-up';
}[] = [
  {
    mode: 'shuffle',
    title: 'Shuffle',
    sub: 'Random order, reshuffles each tap',
    icon: 'shuffle',
  },
  {
    mode: 'oldest',
    title: 'Oldest recorded first',
    sub: 'Back to the order you filmed in',
    icon: 'sort-down',
  },
  {
    mode: 'newest',
    title: 'Newest recorded first',
    sub: 'Most recent moment opens the video',
    icon: 'sort-up',
  },
];

/** Fisher–Yates. `rand` is injectable so tests can pin the result. */
export function shuffled(ids: string[], rand: () => number = Math.random): string[] {
  const out = ids.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function organise(
  ids: string[],
  moments: Record<string, Moment>,
  mode: OrganiseMode,
  rand: () => number = Math.random,
): string[] {
  if (mode === 'shuffle') return shuffled(ids, rand);

  // Two moments can share a createdAt (imports land in a single batch), so
  // fall back to current position to keep the sort stable and total.
  const pos = new Map(ids.map((id, i) => [id, i]));
  const at = (id: string) => moments[id]?.createdAt ?? 0;
  const dir = mode === 'oldest' ? 1 : -1;
  return ids
    .slice()
    .sort((a, b) => (at(a) - at(b)) * dir || pos.get(a)! - pos.get(b)!);
}

/** True when applying the mode would leave the order untouched. */
export function isNoop(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((id, i) => id === after[i]);
}
