// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 02:
//   F035: the web version's store read every kept copy and version into memory for each delete
//         (every save once a file had its 30 versions) and each list.
//   F349: after an update's restart, the restart's own copies of unsaved tabs were deleted even
//         when the recovery copies of the reopened tabs couldn't be made.

import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no desktop'); } }));

import { keepStore, memoryStore, putText } from '../src/keep/store';
import { reopenAfterRestart, restartWaiting } from '../src/keep/restart';
import type { Workspace } from '../src/workspace';

// A small IndexedDB, enough for the store: keys in order, ranges, cursors, and a count of the
// rows whose values were read.
class Range {
  constructor(readonly lo: string, readonly hi: string, readonly loOpen: boolean, readonly hiOpen: boolean) {}
  static bound(lo: string, hi: string, loOpen = false, hiOpen = false) { return new Range(lo, hi, loOpen, hiOpen); }
  has(k: string) { return (this.loOpen ? k > this.lo : k >= this.lo) && (this.hiOpen ? k < this.hi : k <= this.hi); }
}
const rows = new Map<string, unknown>();
let valuesRead = 0;
function request<T>(f: () => T) {
  const r: { result?: T; onsuccess?: () => void; onerror?: () => void; error?: unknown } = {};
  queueMicrotask(() => { r.result = f(); r.onsuccess?.(); });
  return r;
}
const objectStore = {
  put: (v: unknown, k: string) => request(() => { rows.set(k, v); return k; }),
  get: (k: string) => request(() => { if (rows.has(k)) valuesRead++; return rows.get(k); }),
  delete: (k: string | Range) => request(() => { for (const key of [...rows.keys()]) if (k instanceof Range ? k.has(key) : key === k) rows.delete(key); }),
  openCursor: (range?: Range) => {
    const keys = [...rows.keys()].filter((k) => !range || range.has(k)).sort();
    let i = 0;
    const r: { result: unknown; onsuccess?: () => void; onerror?: () => void } = { result: null };
    const step = () => queueMicrotask(() => {
      const k = keys[i++];
      r.result = k === undefined ? null : { key: k, get value() { valuesRead++; return rows.get(k); }, continue: step };
      r.onsuccess?.();
    });
    step();
    return r;
  },
};
const db = { transaction: () => ({ objectStore: () => objectStore }), createObjectStore: () => objectStore };

beforeAll(() => {
  (globalThis as unknown as { IDBKeyRange: unknown }).IDBKeyRange = Range;
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const r: { result: unknown; onsuccess?: () => void; onupgradeneeded?: () => void; onerror?: () => void } = { result: db };
      queueMicrotask(() => r.onsuccess?.());
      return r;
    },
  };
});

describe('F035: the web version’s store deletes and lists without reading everything', () => {
  it('deletes a version folder without reading any copy, and lists one folder only', async () => {
    const store = keepStore();
    const big = new Uint8Array(1000);
    for (let i = 0; i < 30; i++) await store.put(`versions/aaa/v${i}.pptx`, big);
    for (let i = 0; i < 30; i++) await store.put(`versions/bbb/v${i}.pptx`, big);
    await store.put('recovery/s1/tab-1.cdxml', big);
    await store.put('versions/aaa0', big); // a key just past the folder's range: not inside it
    valuesRead = 0;
    await store.remove('versions/aaa/v3.pptx');
    await store.remove('versions/bbb');
    expect(valuesRead).toBe(0);
    expect([...rows.keys()].filter((k) => k.startsWith('versions/bbb'))).toEqual([]);
    expect(rows.has('versions/aaa/v3.pptx')).toBe(false);
    expect(rows.has('versions/aaa/v4.pptx')).toBe(true);
    expect(rows.has('versions/aaa0')).toBe(true);
    // listing the recovery copies reads none of the versions
    valuesRead = 0;
    expect((await store.list('recovery')).map((e) => e.name)).toEqual(['s1']);
    expect(valuesRead).toBe(1);
  });
});

describe('F349: the restart’s copies stay when the recovery copies couldn’t be made', () => {
  it('keeps the unsaved tabs’ copies for the next start', async () => {
    const store = memoryStore();
    await store.put('restart/t1-0.cdxml', new TextEncoder().encode('drawing'));
    await putText(store, 'restart/tabs.json', JSON.stringify({ kind: 'restart', made: 1, active: 0, tabs: [{ name: 'a.cdxml', mode: 'drawing', path: null, stamp: null, copy: 't1-0.cdxml' }] }));
    const tab = { name: 'a.cdxml', mode: 'drawing', ref: { kind: 'none' } };
    const ws = {
      tabs: [tab] as unknown[], active: tab, pane: null,
      quietly: async (f: () => Promise<void>) => f(), withoutShowing: async (f: () => Promise<void>) => f(),
      openAs: async () => tab, hold: () => () => {}, activate: () => {}, reshow: () => {}, setSplit: () => {}, newWindow: () => tab,
    } as unknown as Workspace;
    const r = await reopenAfterRestart(ws, store, { liveView: () => null, secure: async () => { throw new Error('the disk is full'); } }).catch((e) => e);
    expect(r).toMatchObject({ opened: 1, failed: [] });
    expect(await restartWaiting(store)).toBe(true);
    expect(store.files.has('restart/t1-0.cdxml')).toBe(true);
  });
});
