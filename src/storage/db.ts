import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { JournalEntry } from './journal';
import { liveBlobKeys, replay } from './journal';
import type { AppState } from '../types';

interface GlimpseDB extends DBSchema {
  journal: { key: number; value: JournalEntry };
  /** Finished moment files, keyed by blobKey. */
  blobs: { key: string; value: Blob };
  /**
   * Chunks written *during* recording. If the app dies mid-moment these are
   * what survive, and they are assembled on next launch rather than lost.
   */
  pending: {
    key: string;
    value: { blobKey: string; seq: number; chunk: Blob };
    indexes: { byBlobKey: string };
  };
  meta: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<GlimpseDB>> | null = null;

export function db(): Promise<IDBPDatabase<GlimpseDB>> {
  if (!dbp) {
    dbp = openDB<GlimpseDB>('glimpse', 1, {
      upgrade(d) {
        d.createObjectStore('journal', { autoIncrement: true });
        d.createObjectStore('blobs');
        const pending = d.createObjectStore('pending');
        pending.createIndex('byBlobKey', 'blobKey');
        d.createObjectStore('meta');
      },
    });
  }
  return dbp;
}

export async function appendEntry(e: JournalEntry): Promise<void> {
  const d = await db();
  await d.add('journal', { ...e, eid: e.eid ?? crypto.randomUUID() });
}

/** Append an entry that came from a collaborator, preserving its id. */
export async function appendRemoteEntry(e: JournalEntry): Promise<void> {
  const d = await db();
  await d.add('journal', e);
}

export async function loadState(): Promise<AppState> {
  const d = await db();
  const entries = await d.getAll('journal');
  return replay(entries);
}

export async function loadEntriesWithKeys(): Promise<
  { key: number; entry: JournalEntry }[]
> {
  const d = await db();
  const tx = d.transaction('journal');
  const out: { key: number; entry: JournalEntry }[] = [];
  for await (const cursor of tx.store) {
    out.push({ key: cursor.key as number, entry: cursor.value });
  }
  await tx.done;
  return out;
}

/**
 * Entries written before sync existed have no id, so they could never be
 * pushed. Assigning one on first run makes existing local work syncable.
 */
export async function backfillEntryIds(): Promise<number> {
  const d = await db();
  const tx = d.transaction('journal', 'readwrite');
  let n = 0;
  for await (const cursor of tx.store) {
    if (!cursor.value.eid) {
      await cursor.update({ ...cursor.value, eid: crypto.randomUUID() });
      n++;
    }
  }
  await tx.done;
  return n;
}

export async function readMeta(key: string): Promise<unknown> {
  const d = await db();
  return d.get('meta', key);
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  const d = await db();
  await d.put('meta', value, key);
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  const d = await db();
  await d.put('blobs', blob, key);
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const d = await db();
  return d.get('blobs', key);
}

/* ---------- in-flight recording chunks ---------- */

export async function putChunk(
  blobKey: string,
  seq: number,
  chunk: Blob,
): Promise<void> {
  const d = await db();
  await d.put('pending', { blobKey, seq, chunk }, `${blobKey}:${seq}`);
}

export async function assemblePending(
  blobKey: string,
  mimeType: string,
): Promise<Blob | null> {
  const d = await db();
  const all = await d.getAllFromIndex('pending', 'byBlobKey', blobKey);
  if (!all.length) return null;
  all.sort((a, b) => a.seq - b.seq);
  return new Blob(
    all.map((c) => c.chunk),
    { type: mimeType },
  );
}

export async function clearPending(blobKey: string): Promise<void> {
  const d = await db();
  const tx = d.transaction('pending', 'readwrite');
  const idx = tx.store.index('byBlobKey');
  for await (const cursor of idx.iterate(blobKey)) await cursor.delete();
  await tx.done;
}

/** Any blobKey with leftover chunks — i.e. a recording that never finished. */
export async function pendingBlobKeys(): Promise<string[]> {
  const d = await db();
  const all = await d.getAll('pending');
  return [...new Set(all.map((c) => c.blobKey))];
}

/* ---------- housekeeping ---------- */

/**
 * Blobs on disk that replay says nothing references. Returned rather than
 * deleted so the UI can offer recovery instead of silently discarding video.
 */
export async function findOrphanBlobs(state: AppState): Promise<string[]> {
  const d = await db();
  const keys = (await d.getAllKeys('blobs')) as string[];
  const live = liveBlobKeys(state);
  return keys.filter((k) => !live.has(k));
}

export async function deleteBlob(key: string): Promise<void> {
  const d = await db();
  await d.delete('blobs', key);
}

export interface QuotaInfo {
  usage: number;
  quota: number;
  ratio: number;
  persisted: boolean;
}

export async function quota(): Promise<QuotaInfo | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  const usage = est.usage ?? 0;
  const q = est.quota ?? 0;
  const persisted = navigator.storage.persisted
    ? await navigator.storage.persisted()
    : false;
  return { usage, quota: q, ratio: q ? usage / q : 0, persisted };
}

/** Best-effort. Safari grants this far more readily to an installed PWA. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}
