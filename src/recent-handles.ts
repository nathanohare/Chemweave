// File > Open Recent in the web version: a browser that lets a page open files by itself
// (Chrome and Edge) can remember the files opened and saved, as "handles" kept in the page's own
// storage (IndexedDB). The recent list holds them as "handle:<id>:<name>"; the handle itself, which
// can't be written in the settings, stays here under its id. The browser asks the person once
// before such a file is opened again.

import type { FileHandle } from './io/files';

type Handle = FileHandle & {
  isSameEntry?(other: FileHandle): Promise<boolean>;
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

const PREFIX = 'handle:';

/** A recent-list entry for a file the browser keeps a handle to. */
export const isHandleEntry = (entry: string): boolean => entry.startsWith(PREFIX);

/** The entry's id and file name ("handle:7f3a:Scheme.cdxml"). */
export function handleEntry(entry: string): { id: string; name: string } | null {
  const m = /^handle:([^:]+):(.*)$/.exec(entry);
  return m ? { id: m[1], name: m[2] } : null;
}

/** Can this browser keep file handles? */
export const canKeepHandles = (): boolean => typeof indexedDB !== 'undefined' && 'showOpenFilePicker' in globalThis;

let db: Promise<IDBDatabase> | null = null;
/** The store, opened once and kept; a failed or lost opening is forgotten, so the next call tries again. */
const open = (): Promise<IDBDatabase> => {
  if (db) return db;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let failed = false;
    const r = indexedDB.open('chem-illustrator-recent', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => {
      const d = r.result;
      // (a late answer to an opening that was given up on is let go, and so is the store when another tab needs to upgrade it)
      if (failed) { d.close(); return; }
      d.onversionchange = () => { d.close(); if (db === p) db = null; };
      d.onclose = () => { if (db === p) db = null; };
      resolve(d);
    };
    r.onerror = () => { failed = true; reject(r.error ?? new Error('The recent files store could not be opened.')); };
    r.onblocked = () => { failed = true; reject(new Error('The recent files store is in use by another tab.')); };
  });
  db = p;
  p.catch(() => { if (db === p) db = null; });
  return p;
};
const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const s = (await open()).transaction('handles', mode).objectStore('handles');
  return new Promise((resolve, reject) => {
    const r = f(s);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
};

/** Handles just kept, by id and when: forgetHandles leaves them, as the list it is given may not hold their entries yet. */
const fresh = new Map<string, number>();
/** How long (ms) a handle just kept is spared by forgetHandles. */
const GRACE_MS = 15_000;

/**
 * Keep a handle and give its entry for the recent list. A file already in the list (`list`)
 * keeps its id, so it moves to the top rather than showing twice.
 */
export async function keepHandle(handle: FileHandle, list: readonly string[]): Promise<string> {
  const h = handle as Handle;
  for (const entry of list) {
    const e = handleEntry(entry);
    if (!e || e.name !== h.name) continue;
    const old = await run('readonly', (s) => s.get(e.id)) as Handle | undefined;
    if (old && (await old.isSameEntry?.(h).catch(() => false))) return entry;
  }
  const id = Math.random().toString(36).slice(2, 10);
  // (spared by forgetHandles from now on, not only once stored: another file's forget can read the keys while this put is on its way,
  // and not until the caller has had time to put its entry in the list)
  fresh.set(id, Date.now());
  try { await run('readwrite', (s) => s.put(h, id)); } catch (e) { fresh.delete(id); throw e; }
  return `${PREFIX}${id}:${h.name}`;
}

/** The kept handle for an entry, with the browser's leave to read it (asked for if need be), or null. */
export async function handleFor(entry: string): Promise<FileHandle | null> {
  const e = handleEntry(entry);
  if (!e) return null;
  const h = await run('readonly', (s) => s.get(e.id)) as Handle | undefined;
  if (!h) return null;
  const ok = (await h.queryPermission?.({ mode: 'readwrite' })) === 'granted' || (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  return ok ? h : null;
}

/** Forget the handles no longer in the list. */
export async function forgetHandles(list: readonly string[]): Promise<void> {
  const keep = new Set(list.map((x) => handleEntry(x)?.id).filter(Boolean));
  const now = Date.now();
  for (const [id, at] of fresh) {
    if (now - at < GRACE_MS) keep.add(id); else fresh.delete(id);
  }
  const keys = await run('readonly', (s) => s.getAllKeys());
  for (const k of keys) {
    // (looked at again here: a file kept while the keys were being read is not forgotten)
    const recent = fresh.get(String(k));
    if (!keep.has(String(k)) && !(recent !== undefined && Date.now() - recent < GRACE_MS)) await run('readwrite', (s) => s.delete(k));
  }
}
