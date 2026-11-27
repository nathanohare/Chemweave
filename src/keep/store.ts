// Where recovery copies and earlier versions are kept. The desktop app keeps them as files in
// its own data folder ("Kept"); a browser keeps them in the page's IndexedDB storage. Keys are
// short paths of plain names: "recovery/<session>/<file>" and "versions/<file id>/<file>".

import { invoke, isTauri } from '@tauri-apps/api/core';

export interface KeptEntry {
  name: string;
  size: number;
  /** Milliseconds since 1970. */
  modified: number;
  folder: boolean;
}

export interface KeepStore {
  put(key: string, data: Uint8Array): Promise<void>;
  /** Null when there is nothing under the key. */
  get(key: string): Promise<Uint8Array | null>;
  /** What a folder holds, one level down (nothing when it isn't there). */
  list(folder: string): Promise<KeptEntry[]>;
  /** Delete a copy, or a folder with everything in it. */
  remove(key: string): Promise<void>;
  /** Where the copies are, to say so in AutoSave and Recovery Options. */
  where(): Promise<string>;
}

/** A name that is safe as one part of a key. */
export function keyPart(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '').slice(0, 100) || 'x';
}

export async function getText(store: KeepStore, key: string): Promise<string | null> {
  const b = await store.get(key);
  return b ? new TextDecoder().decode(b) : null;
}

export function putText(store: KeepStore, key: string, text: string): Promise<void> {
  return store.put(key, new TextEncoder().encode(text));
}

/** The desktop app: files in the app's data folder. */
export const desktopStore: KeepStore = {
  put: (key, data) => invoke('keep_put', data, { headers: { key } }),
  async get(key) {
    try { return new Uint8Array(await invoke<ArrayBuffer>('keep_get', { key })); } catch { return null; }
  },
  list: (folder) => invoke<KeptEntry[]>('keep_list', { key: folder }),
  remove: (key) => invoke('keep_remove', { key }),
  where: () => invoke<string>('keep_folder'),
};

/** Copies kept in memory (tests, and browsers that block storage). */
export function memoryStore(clock: () => number = Date.now): KeepStore & { files: Map<string, { data: Uint8Array; modified: number }> } {
  const files = new Map<string, { data: Uint8Array; modified: number }>();
  return {
    files,
    async put(key, data) { files.set(key, { data: data.slice(), modified: clock() }); },
    async get(key) { return files.get(key)?.data.slice() ?? null; },
    async list(folder) { return listKeys(folder, [...files].map(([k, v]) => ({ key: k, size: v.data.length, modified: v.modified }))); },
    async remove(key) { for (const k of [...files.keys()]) if (k === key || k.startsWith(key + '/')) files.delete(k); },
    async where() { return 'memory (not kept after closing)'; },
  };
}

/** One level of a flat list of keys, as folders and files. */
function listKeys(folder: string, all: { key: string; size: number; modified: number }[]): KeptEntry[] {
  const pre = folder.replace(/\/$/, '') + '/';
  const out = new Map<string, KeptEntry>();
  for (const f of all) {
    if (!f.key.startsWith(pre)) continue;
    const rest = f.key.slice(pre.length);
    const slash = rest.indexOf('/');
    const name = slash < 0 ? rest : rest.slice(0, slash);
    const had = out.get(name);
    if (slash < 0) out.set(name, { name, size: f.size, modified: f.modified, folder: false });
    else out.set(name, { name, size: (had?.size ?? 0) + f.size, modified: Math.max(had?.modified ?? 0, f.modified), folder: true });
  }
  return [...out.values()];
}

/**
 * A browser: the page's IndexedDB storage. Each copy's bytes are in "kept"; its size and time are
 * also in "sizes", so listing a folder and deleting never read the copies themselves (a file's
 * 30 versions of a large deck would otherwise be read at every save).
 */
export function browserStore(): KeepStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => db ??= new Promise((resolve, reject) => {
    // ask the browser to keep this storage when space runs short (it may still say no, or ask the person)
    void navigator.storage?.persist?.().catch(() => false);
    const r = indexedDB.open('chem-illustrator-kept', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      const had = d.objectStoreNames.contains('kept');
      if (!had) d.createObjectStore('kept');
      if (!d.objectStoreNames.contains('sizes')) {
        const sizes = d.createObjectStore('sizes');
        // (once, from version 1: the sizes of what is kept already)
        if (had) {
          const c = r.transaction!.objectStore('kept').openCursor();
          c.onsuccess = () => {
            const at = c.result;
            if (!at) return;
            const row = at.value as Row;
            sizes.put({ size: row.data.length, modified: row.modified } satisfies Size, at.key);
            at.continue();
          };
        }
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  type Row = { data: Uint8Array; modified: number };
  type Size = { size: number; modified: number };
  /** Work on both stores at once, done when the browser has written it all. */
  const both = async (mode: IDBTransactionMode, f: (kept: IDBObjectStore, sizes: IDBObjectStore) => void): Promise<void> => {
    const t = (await open()).transaction(['kept', 'sizes'], mode);
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
      f(t.objectStore('kept'), t.objectStore('sizes'));
    });
  };
  // Everything under a folder: the keys from "folder/" up to (not including) "folder0", as '0'
  // comes straight after '/'.
  const under = (folder: string) => {
    const pre = folder.replace(/\/$/, '') + '/';
    return IDBKeyRange.bound(pre, pre.slice(0, -1) + '0', false, true);
  };
  const sizesUnder = async (folder: string) => {
    const s = (await open()).transaction('sizes', 'readonly').objectStore('sizes');
    const out: { key: string; size: number; modified: number }[] = [];
    return new Promise<typeof out>((resolve, reject) => {
      const r = s.openCursor(under(folder));
      r.onsuccess = () => {
        const c = r.result;
        if (!c) { resolve(out); return; }
        const z = c.value as Size;
        out.push({ key: String(c.key), size: z.size, modified: z.modified });
        c.continue();
      };
      r.onerror = () => reject(r.error);
    });
  };
  return {
    async put(key, data) {
      const modified = Date.now();
      await both('readwrite', (kept, sizes) => {
        kept.put({ data: data.slice(), modified } satisfies Row, key);
        sizes.put({ size: data.length, modified } satisfies Size, key);
      });
    },
    async get(key) {
      const s = (await open()).transaction('kept', 'readonly').objectStore('kept');
      const r = await new Promise<Row | undefined>((resolve, reject) => {
        const q = s.get(key);
        q.onsuccess = () => resolve(q.result as Row | undefined);
        q.onerror = () => reject(q.error);
      });
      return r ? r.data : null;
    },
    async list(folder) { return listKeys(folder, await sizesUnder(folder)); },
    async remove(key) {
      // the copy itself and everything under it, deleted by key without reading any of them
      await both('readwrite', (kept, sizes) => {
        for (const st of [kept, sizes]) { st.delete(key); st.delete(under(key)); }
      });
    },
    async where() { return 'this browser’s storage for the page'; },
  };
}

/** The store for where the app is running. */
export function keepStore(): KeepStore {
  if (isTauri()) return desktopStore;
  return typeof indexedDB !== 'undefined' ? browserStore() : memoryStore();
}
