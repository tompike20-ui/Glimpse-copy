import { supabase } from './client';
import type { JournalEntry } from '../storage/journal';
import {
  appendRemoteEntry,
  getBlob,
  loadEntriesWithKeys,
  putBlob,
  readMeta,
  writeMeta,
} from '../storage/db';

/**
 * Sync is deliberately boring, because the local journal already has the right
 * shape for it: an append-only log of immutable entries with stable ids. There
 * is no diffing, no merge algorithm and no conflict resolution — both sides
 * simply exchange the entries the other lacks, and each replays the union.
 *
 * Entries carry a uuid (`eid`) that is also the server primary key, so pushing
 * is idempotent and a retry after a dropped connection cannot duplicate work.
 */

interface Cursor {
  /** Highest server seq already pulled. */
  lastSeq: number;
  /** Highest local journal key already pushed. */
  pushedKey: number;
}

const emptyCursor: Cursor = { lastSeq: 0, pushedKey: 0 };

const cursorKey = (projectId: string) => `sync:${projectId}`;

async function getCursor(projectId: string): Promise<Cursor> {
  return ((await readMeta(cursorKey(projectId))) as Cursor) ?? emptyCursor;
}

async function setCursor(projectId: string, c: Cursor): Promise<void> {
  await writeMeta(cursorKey(projectId), c);
}

/** Publish a local project to the cloud and claim ownership of it. */
export async function publishProject(
  projectId: string,
  name: string,
  aspect: string,
): Promise<void> {
  const sb = await supabase();
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('sign in first');

  const { error } = await sb
    .from('projects')
    .upsert({ id: projectId, owner_id: uid, name, aspect }, { onConflict: 'id' });
  if (error) throw error;

  // Owner has to be a member too — every read policy goes through is_member.
  const { error: memberErr } = await sb
    .from('project_members')
    .upsert({ project_id: projectId, user_id: uid, role: 'owner' }, {
      onConflict: 'project_id,user_id',
    });
  if (memberErr) throw memberErr;
}

/** Upload any moment files this project has locally but the bucket lacks. */
async function pushBlobs(projectId: string, entries: JournalEntry[]): Promise<void> {
  const sb = await supabase();
  for (const e of entries) {
    if (e.t !== 'moment.add') continue;
    const blob = await getBlob(e.moment.blobKey);
    if (!blob) continue;
    const path = `${projectId}/${e.moment.blobKey}`;
    const { error } = await sb.storage
      .from('moments')
      .upload(path, blob, { contentType: e.moment.mimeType, upsert: false });
    // "already exists" is the expected outcome on re-sync, not a failure.
    if (error && !/exists/i.test(error.message)) throw error;
  }
}

export async function pushEntries(projectId: string): Promise<number> {
  const sb = await supabase();
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('sign in first');

  const cursor = await getCursor(projectId);
  const all = await loadEntriesWithKeys();

  const mine = all.filter(
    (row) =>
      row.key > cursor.pushedKey &&
      row.entry.eid &&
      entryProjectId(row.entry) === projectId,
  );
  if (!mine.length) return 0;

  await pushBlobs(projectId, mine.map((r) => r.entry));

  const { error } = await sb.from('entries').upsert(
    mine.map((row) => ({
      id: row.entry.eid,
      project_id: projectId,
      author_id: uid,
      payload: row.entry,
    })),
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw error;

  const maxKey = Math.max(...mine.map((r) => r.key));
  await setCursor(projectId, { ...cursor, pushedKey: maxKey });
  return mine.length;
}

export async function pullEntries(projectId: string): Promise<number> {
  const sb = await supabase();
  const cursor = await getCursor(projectId);

  const { data, error } = await sb
    .from('entries')
    .select('seq, payload')
    .eq('project_id', projectId)
    .gt('seq', cursor.lastSeq)
    .order('seq', { ascending: true });
  if (error) throw error;
  if (!data?.length) return 0;

  const known = new Set(
    (await loadEntriesWithKeys())
      .map((r) => r.entry.eid)
      .filter((x): x is string => !!x),
  );

  let applied = 0;
  let maxSeq = cursor.lastSeq;
  for (const row of data) {
    maxSeq = Math.max(maxSeq, row.seq as number);
    const entry = row.payload as JournalEntry;
    if (!entry?.eid || known.has(entry.eid)) continue;
    await appendRemoteEntry(entry);
    applied++;
  }

  await setCursor(projectId, { ...cursor, lastSeq: maxSeq });
  return applied;
}

export async function syncProject(projectId: string): Promise<{
  pushed: number;
  pulled: number;
}> {
  const pushed = await pushEntries(projectId);
  const pulled = await pullEntries(projectId);
  return { pushed, pulled };
}

/**
 * Fetch a moment file that arrived from a collaborator. Local blobs always
 * win, so this costs nothing for moments you recorded yourself.
 */
export async function ensureBlob(
  projectId: string,
  blobKey: string,
): Promise<Blob | undefined> {
  const local = await getBlob(blobKey);
  if (local) return local;

  const sb = await supabase();
  const { data, error } = await sb.storage
    .from('moments')
    .download(`${projectId}/${blobKey}`);
  if (error || !data) return undefined;

  await putBlob(blobKey, data);
  return data;
}

/* ---------------------------------------------------------------- invites */

export async function createInvite(projectId: string): Promise<string> {
  const sb = await supabase();
  const { data: userData } = await sb.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error('sign in first');

  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const { error } = await sb
    .from('project_invites')
    .insert({ token, project_id: projectId, created_by: uid });
  if (error) throw error;

  return `${window.location.origin}${window.location.pathname}#/join/${token}`;
}

export async function redeemInvite(token: string): Promise<string> {
  const sb = await supabase();
  const { data, error } = await sb.rpc('redeem_invite', { p_token: token });
  if (error) throw error;
  return data as string;
}

/** Live updates while collaborators are recording into the same Glimpse. */
export function subscribeToProject(
  projectId: string,
  onEntry: () => void,
): () => void {
  // Setup is async because the client is lazily imported, but callers are
  // React effects, so the returned teardown stays synchronous.
  let teardown = () => {};
  let cancelled = false;

  void (async () => {
    const sb = await supabase();
    const channel = sb
      .channel(`entries:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'entries',
          filter: `project_id=eq.${projectId}`,
        },
        onEntry,
      )
      .subscribe();

    if (cancelled) {
      void sb.removeChannel(channel);
      return;
    }
    teardown = () => void sb.removeChannel(channel);
  })();

  return () => {
    cancelled = true;
    teardown();
  };
}

/** Which project an entry belongs to, across the entry shapes that carry one. */
export function entryProjectId(e: JournalEntry): string | null {
  switch (e.t) {
    case 'project.create':
    case 'project.rename':
    case 'project.lock':
    case 'project.delete':
      return e.id;
    case 'moment.add':
      return e.moment.projectId;
    case 'moment.remove':
    case 'moment.reorder':
    case 'moment.trim':
      return e.projectId;
    default:
      return null;
  }
}
