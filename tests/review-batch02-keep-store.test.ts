// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 02:
//   F035: the web version's store read every kept copy and version into memory for each delete
//         (every save once a file had its 30 versions) and each list.
//   F349: after an update's restart, the restart's own copies of unsaved tabs were deleted even
//         when the recovery copies of the reopened tabs couldn't be made; only the copies of
//         tabs still without a recovery copy stay, and they go once one is made.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no desktop'); } }));

import { keepStore, memoryStore, putText } from '../src/keep/store';
import { reopenAfterRestart, restartWaiting, settleRestart, parseRestart } from '../src/keep/restart';
import type { Tab, Workspace } from '../src/workspace';

// A small IndexedDB, enough for the store: named object stores with keys in order, ranges,
// cursors, transactions that complete, an upgrade from version 1, and a count of the rows whose
// stored bytes were read.
class Range {
  constructor(readonly lo: string, readonly hi: string, readonly loOpen: boolean, readonly hiOpen: boolean) {}
  static bound(lo: string, hi: string, loOpen = false, hiOpen = false) { return new Range(lo, hi, loOpen, hiOpen); }
  has(k: string) { return (this.loOpen ? k > this.lo : k >= this.lo) && (this.hiOpen ? k < this.hi : k <= this.hi); }
}
let stores = new Map<string, Map<string, unknown>>();
let version = 0;
let bytesRead = 0;
const read = (name: string, v: unknown) => { if (name === 'kept') bytesRead++; return v; };
function request<T>(f: () => T, done?: () => void) {
  const r: { result?: T; onsuccess?: () => void; onerror?: () => void; error?: unknown } = {};
  queueMicrotask(() => { r.result = f(); r.onsuccess?.(); done?.(); });
  return r;
}
function storeOf(name: string, t: { pending: number; finish: () => void }) {
  const rows = stores.get(name)!;
  const op = <T>(f: () => T) => { t.pending++; return request(f, () => { t.pending--; t.finish(); }); };
  return {
    put: (v: unknown, k: string) => op(() => { rows.set(k, v); return k; }),
    get: (k: string) => op(() => (rows.has(k) ? read(name, rows.get(k)) : undefined)),
    delete: (k: string | Range) => op(() => { for (const key of [...rows.keys()]) if (k instanceof Range ? k.has(key) : key === k) rows.delete(key); }),
    openCursor: (range?: Range) => {
      const keys = [...rows.keys()].filter((k) => !range || range.has(k)).sort();
      let i = 0;
      t.pending++;
      const r: { result: unknown; onsuccess?: () => void; onerror?: () => void } = { result: null };
      const step = () => queueMicrotask(() => {
        const k = keys[i++];
        r.result = k === undefined ? null : { key: k, get value() { return read(name, rows.get(k)); }, continue: step };
        r.onsuccess?.();
        if (k === undefined) { t.pending--; t.finish(); }
      });
      step();
      return r;
    },
  };
}
function transaction() {
  const t = { pending: 0, oncomplete: null as null | (() => void), onerror: null, onabort: null, error: null, finish: () => {}, objectStore: (n: string) => storeOf(n, t) };
  t.finish = () => queueMicrotask(() => { if (t.pending === 0) { const f = t.oncomplete; t.oncomplete = null; f?.(); } });
  queueMicrotask(() => t.finish());
  return t;
}
const db = {
  objectStoreNames: { contains: (n: string) => stores.has(n) },
  createObjectStore: (n: string) => { stores.set(n, new Map()); return storeOf(n, { pending: 0, finish: () => {} }); },
  transaction: () => transaction(),
};

beforeEach(() => {
  stores = new Map();
  version = 0;
  bytesRead = 0;
  (globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = Range;
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: (_name: string, v: number) => {
      const r: { result: unknown; transaction: unknown; onsuccess?: () => void; onupgradeneeded?: () => void; onerror?: () => void } = { result: db, transaction: transaction() };
      queueMicrotask(() => {
        if (v > version) { r.onupgradeneeded?.(); version = v; }
        setTimeout(() => r.onsuccess?.(), 0);
      });
      return r;
    },
  };
});

describe('F035: the web version’s store deletes and lists without reading the copies', () => {
  it('deletes a version folder and lists a folder reading no copy', async () => {
    const store = keepStore();
    const big = new Uint8Array(1000);
    for (let i = 0; i < 30; i++) await store.put(`versions/aaa/v${i}.pptx`, big);
    for (let i = 0; i < 30; i++) await store.put(`versions/bbb/v${i}.pptx`, big);
    await store.put('recovery/s1/tab-1.cdxml', big);
    await store.put('versions/aaa0', big); // a key just past the folder's range: not inside it
    bytesRead = 0;
    await store.remove('versions/aaa/v3.pptx');
    await store.remove('versions/bbb');
    const listed = await store.list('versions');
    expect(bytesRead).toBe(0);
    expect(listed.map((e) => [e.name, e.folder, e.size])).toEqual([['aaa', true, 29_000], ['aaa0', false, 1000]]);
    const kept = stores.get('kept')!;
    expect([...kept.keys()].filter((k) => k.startsWith('versions/bbb'))).toEqual([]);
    expect(kept.has('versions/aaa/v3.pptx')).toBe(false);
    expect(kept.has('versions/aaa0')).toBe(true);
    expect((await store.list('recovery')).map((e) => e.name)).toEqual(['s1']);
    expect(bytesRead).toBe(0);
    expect(await store.get('versions/aaa/v4.pptx')).toEqual(big);
  });

  it('takes the sizes of copies kept before, once, when it is opened the first time', async () => {
    stores.set('kept', new Map([['recovery/s1/tab-1.cdxml', { data: new Uint8Array(7), modified: 123 }]]));
    version = 1;
    const listed = await keepStore().list('recovery/s1');
    expect(listed).toEqual([{ name: 'tab-1.cdxml', size: 7, modified: 123, folder: false }]);
  });
});

describe('F349: the restart’s copies of tabs without a recovery copy stay, until one is made', () => {
  const setup = async () => {
    const store = memoryStore();
    for (const f of ['t1-0.cdxml', 't1-1.cdxml']) await store.put(`restart/${f}`, new TextEncoder().encode('drawing'));
    await putText(store, 'restart/tabs.json', JSON.stringify({ kind: 'restart', made: 1, active: 0, tabs: [
      { name: 'a.cdxml', mode: 'drawing', path: null, stamp: null, copy: 't1-0.cdxml' },
      { name: 'b.cdxml', mode: 'drawing', path: null, stamp: null, copy: 't1-1.cdxml' },
    ] }));
    const made: Tab[] = [];
    const ws = {
      tabs: made as unknown[], get active() { return made[0]; }, pane: null,
      quietly: async (f: () => Promise<void>) => f(),
      openAs: async (_b: unknown, _f: string, o: { name: string }) => { const t = { name: o.name, mode: 'drawing', ref: { kind: 'none' } } as unknown as Tab; made.push(t); return t; },
      hold: () => () => {}, activate: () => {}, reshow: () => {}, setSplit: () => {}, newWindow: () => null,
    } as unknown as Workspace;
    return { store, ws };
  };

  it('keeps only the copy of the tab the recovery copies don’t have, and lets it go later', async () => {
    const { store, ws } = await setup();
    const secure = vi.fn(async () => { throw new Error('a.cdxml couldn’t be encoded'); });
    const r = await reopenAfterRestart(ws, store, { liveView: () => null, secure, kept: (t) => t.name === 'b.cdxml' });
    expect(r).toMatchObject({ opened: 2, failed: [] });
    // tried twice before giving up
    expect(secure).toHaveBeenCalledTimes(2);
    const left = parseRestart(new TextDecoder().decode((await store.get('restart/tabs.json'))!))!;
    expect(left.tabs.map((t) => [t.name, t.unsecured])).toEqual([['a.cdxml', true]]);
    expect(store.files.has('restart/t1-0.cdxml')).toBe(true);
    expect(store.files.has('restart/t1-1.cdxml')).toBe(false);
    // a later round of recovery copies has every tab: the restart's copy goes
    await settleRestart(store);
    expect(await restartWaiting(store)).toBe(false);
  });

  it('lets the copies go when the second try works', async () => {
    const { store, ws } = await setup();
    let n = 0;
    await reopenAfterRestart(ws, store, { liveView: () => null, secure: async () => { if (n++ === 0) throw new Error('busy'); } });
    expect(await restartWaiting(store)).toBe(false);
  });
});
