// @vitest-environment jsdom
//
// Code review batch 24 (things kept for the session that stayed failed): each test fails on the code before the fix.

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('PDF fallback fonts after a failed load', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('/node_modules/@fontsource/noto-sans-hebrew/unicode.json'); });

  it('tries again on the next PDF', async () => {
    let calls = 0;
    vi.doMock('/node_modules/@fontsource/noto-sans-hebrew/unicode.json', () => {
      calls++;
      // a failed chunk fetch the first time, then the network is back
      if (calls === 1) throw new Error('Failed to fetch dynamically imported module');
      return { default: { 'hebrew': 'U+0590-05FF' } };
    });
    const { pdfFallbackFonts } = await import('../src/fonts');
    await expect(pdfFallbackFonts('א', 'א')).rejects.toThrow();
    // the network is back: the next one works (finds a Hebrew font file)
    const got = await pdfFallbackFonts('א', 'א');
    expect(got.length).toBeGreaterThan(0);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

/** A small stand-in for IndexedDB: one store, answering a moment later, and an opening that can be made to fail. */
function fakeIndexedDB(failOpens: number) {
  const data = new Map<string, unknown>();
  const reply = <T>(f: () => T) => {
    const r: { result?: T; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
    setTimeout(() => { r.result = f(); r.onsuccess?.(); }, 0);
    return r;
  };
  const db = {
    createObjectStore: () => ({}),
    close: () => {},
    onversionchange: null as null | (() => void),
    onclose: null as null | (() => void),
    transaction: () => ({
      objectStore: () => ({
        get: (k: string) => reply(() => data.get(k)),
        put: (v: unknown, k: string) => reply(() => { data.set(k, v); return k; }),
        getAllKeys: () => reply(() => [...data.keys()]),
        delete: (k: string) => reply(() => { data.delete(k); }),
      }),
    }),
  };
  let opens = 0;
  const open = () => {
    const r: { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void; onblocked?: () => void } = {};
    setTimeout(() => {
      if (++opens <= failOpens) { r.error = new Error('blocked by another tab'); r.onerror?.(); return; }
      r.result = db;
      r.onupgradeneeded?.();
      r.onsuccess?.();
    }, 0);
    return r;
  };
  return { indexedDB: { open }, data, opens: () => opens };
}

const fileHandle = (name: string) => ({ name, queryPermission: async () => 'granted' }) as never;

describe('the recent files store', () => {
  afterEach(() => { vi.resetModules(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('opens again after an opening that failed once', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB(1).indexedDB);
    const { keepHandle, handleFor } = await import('../src/recent-handles');
    await expect(keepHandle(fileHandle('a.cdxml'), [])).rejects.toBeTruthy();
    // the other tab is gone: the next file is kept and can be opened from the list
    const entry = await keepHandle(fileHandle('b.cdxml'), []);
    expect(entry).toMatch(/^handle:[^:]+:b\.cdxml$/);
    expect(await handleFor(entry)).toBeTruthy();
  });

  it('opens again after the store was closed for another tab to upgrade it', async () => {
    const fake = fakeIndexedDB(0);
    vi.stubGlobal('indexedDB', fake.indexedDB);
    const { keepHandle } = await import('../src/recent-handles');
    await keepHandle(fileHandle('a.cdxml'), []);
    expect(fake.opens()).toBe(1);
    // (the connection the page holds is told to let go)
    const conn = (await new Promise<{ onversionchange: () => void }>((resolve) => {
      const r = fake.indexedDB.open() as { onsuccess?: () => void; result?: never };
      r.onsuccess = () => resolve(r.result as never);
    }));
    conn.onversionchange();
    await keepHandle(fileHandle('b.cdxml'), []);
    expect(fake.opens()).toBe(3);
  });

  it('does not forget a handle just kept whose entry is not in the list yet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubGlobal('indexedDB', fakeIndexedDB(0).indexedDB);
    const { keepHandle, forgetHandles, handleFor } = await import('../src/recent-handles');
    const first = await keepHandle(fileHandle('a.cdxml'), []);
    const second = await keepHandle(fileHandle('b.cdxml'), [first]);
    // the list the first file's forget was started with does not hold the second yet
    await forgetHandles([first]);
    expect(await handleFor(second)).toBeTruthy();
    // a handle that is in no list long after it was kept is forgotten, as before
    vi.setSystemTime(Date.now() + 60_000);
    await forgetHandles([first]);
    expect(await handleFor(second)).toBeNull();
    expect(await handleFor(first)).toBeTruthy();
  });
});

describe('the shift network download in its worker', () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

  it('asks again after a download that failed, instead of keeping the failure', async () => {
    const posted: unknown[] = [];
    const fake = { postMessage: (m: unknown) => posted.push(m), onmessage: null as null | ((e: { data: unknown }) => Promise<void>) };
    vi.stubGlobal('self', fake);
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { fetched.push(url); throw new TypeError('Failed to fetch'); });
    await import('../src/worker/nmr-net-worker');
    const ask = async (id: number) => { await fake.onmessage!({ data: { id, url: '/nets.bin', g: {}, solvent: null } }); await new Promise((r) => setTimeout(r, 0)); };
    await ask(1);
    await ask(2);
    expect(posted).toEqual([{ id: 1, net: null, blend: null }, { id: 2, net: null, blend: null }]);
    // offline at first use: the next request fetches again
    expect(fetched).toEqual(['/nets.bin', '/nets.bin']);
  });
});

describe('the AI key on the desktop app', () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.doUnmock('@tauri-apps/api/core'); });

  it('asks whether a key is saved for the address now chosen (Other: a key for another address is not sent)', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: async (cmd: string, args: Record<string, unknown>) => { calls.push([cmd, args]); return true; } }));
    const { hasAiKey } = await import('../src/ai/link');
    await hasAiKey({ provider: 'compatible', model: 'm', base: 'http://localhost:9999/v1/' });
    expect(calls).toEqual([['ai_key_has', { provider: 'compatible', base: 'http://localhost:9999/v1' }]]);
  });
});
