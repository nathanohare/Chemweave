// @vitest-environment jsdom
// The web version when a newer version is published while a page is open: recovery copies offered
// right after a reload (browser locks), the new-version notice's decisions, and the deploy script
// that keeps earlier versions' files on the site.

import { describe, it, expect } from 'vitest';
import { memoryStore } from '../src/keep/store';
import { Recovery, parseSession, type Copyable } from '../src/keep/recovery';
import { worthTelling, publishedBuild, pageBuild } from '../src/ui/web-update';
import { plan, parseList, safePath, KEEP_DAYS } from '../scripts/keep-old-web-files.mjs';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
function copyable(id: number): Copyable {
  return { id, name: `Tab ${id}.cdxml`, mode: 'drawing', path: null, stamp: null, dirty: true, token: 1, copy: async () => ({ name: `Tab ${id}.cdxml`, data: bytes(`drawing ${id}`) }) };
}

describe('recovery right after a reload (browser locks)', () => {
  it('a session that held a lock and let it go is offered at once, however lately it beat', async () => {
    const now = 1_000_000;
    const store = memoryStore(() => now);
    const before = new Recovery(store, 'before', () => now);
    before.holdsLock = true;
    await before.copy([copyable(1)]);
    expect(parseSession(text(await store.get('recovery/before/session.json')))?.held).toBe(true);
    const other = new Recovery(store, 'other', () => now);
    other.holdsLock = true;
    await other.copy([copyable(2)]);
    // the page reloaded a second later: only the other window still holds its lock
    const after = new Recovery(store, 'after', () => now + 1000);
    after.heldNow = async () => new Set(['other', 'after']);
    expect((await after.leftOver(7)).map((s) => s.session)).toEqual(['before']);
    expect(await after.running('before')).toBe(false);
    expect(await after.running('other')).toBe(true);
  });

  it('a session without a lock (an older page, a browser without locks) still goes by its beat', async () => {
    const now = 1_000_000;
    const store = memoryStore(() => now);
    const old = new Recovery(store, 'old', () => now);
    await old.copy([copyable(1)]);
    const after = new Recovery(store, 'after', () => now + 1000);
    after.heldNow = async () => new Set(['after']);
    expect(await after.leftOver(7)).toEqual([]);
    expect(await after.running('old')).toBe(true);
  });

  it('a session that said it was stopping is offered at once even without locks, and only until it beats again', async () => {
    const now = 1_000_000;
    const store = memoryStore(() => now);
    const before = new Recovery(store, 'before', () => now);
    await before.copy([copyable(1)]);
    await before.stop();
    const after = new Recovery(store, 'after', () => now + 1000);
    expect((await after.leftOver(7)).map((s) => s.session)).toEqual(['before']);
    // the reload didn't happen after all: its next beat says it runs
    await before.beat();
    expect(await after.leftOver(7)).toEqual([]);
    expect(await after.running('before')).toBe(true);
  });

  it('when the locks cannot be read, the beat decides, as before', async () => {
    const now = 1_000_000;
    const store = memoryStore(() => now);
    const before = new Recovery(store, 'before', () => now);
    before.holdsLock = true;
    await before.copy([copyable(1)]);
    const after = new Recovery(store, 'after', () => now + 1000);
    after.heldNow = async () => { throw new Error('not allowed'); };
    expect(await after.leftOver(7)).toEqual([]);
    const none = new Recovery(store, 'none', () => now + 1000);
    expect(await none.leftOver(7)).toEqual([]);
  });

  it('knows whether each tab\u2019s copy is of it as it is now', async () => {
    const store = memoryStore();
    const r = new Recovery(store, 'me');
    await r.copy([copyable(1)]);
    expect(r.copied(1, 1)).toBe(true);
    expect(r.copied(1, 2)).toBe(false); // changed after the copy
    expect(r.copied(2, 1)).toBe(false);
  });

  it('keeps the lock mark when the offer is answered', async () => {
    const now = 1_000_000;
    const store = memoryStore(() => now);
    const before = new Recovery(store, 'before', () => now);
    before.holdsLock = true;
    await before.copy([copyable(1), copyable(2)]);
    const after = new Recovery(store, 'after', () => now);
    after.heldNow = async () => new Set();
    const [s] = await after.leftOver(7);
    await after.markOffered(s);
    await after.forget(s, ['tab-1.cdxml']);
    const again = parseSession(text(await store.get('recovery/before/session.json')));
    expect(again?.held).toBe(true);
    expect(again?.offered).toBe(true);
  });
});

describe('new-version notice', () => {
  it('tells about a different published build, once per build after Later', () => {
    expect(worthTelling('a', 'b', null)).toBe(true);
    expect(worthTelling('a', 'a', null)).toBe(false);
    expect(worthTelling('a', null, null)).toBe(false);
    expect(worthTelling('a', 'b', 'b')).toBe(false);
    expect(worthTelling('a', 'c', 'b')).toBe(true);
  });

  it('reads the page\u2019s own build from the page', () => {
    const doc = new DOMParser().parseFromString('<head><meta name="chemweave-build" content="abc-1"></head>', 'text/html');
    expect(pageBuild(doc)).toBe('abc-1');
    expect(pageBuild(new DOMParser().parseFromString('<head></head>', 'text/html'))).toBeNull();
  });

  it('reads the build from version.json without the cache, and null when it cannot', async () => {
    const seen: [string, RequestInit | undefined][] = [];
    const ok = (async (u: string, o?: RequestInit) => { seen.push([u, o]); return new Response('{"build":"abc-1"}'); }) as typeof fetch;
    expect(await publishedBuild(ok, 'https://example.org/Chemweave/index.html', 42)).toBe('abc-1');
    // (a query of its own each time: GitHub's servers otherwise answer with a copy up to ten minutes old)
    expect(seen[0][0]).toBe('https://example.org/Chemweave/version.json?t=42');
    expect(seen[0][1]?.cache).toBe('no-store');
    const missing = (async () => new Response('Not found', { status: 404 })) as typeof fetch;
    expect(await publishedBuild(missing, 'https://example.org/')).toBeNull();
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    expect(await publishedBuild(offline, 'https://example.org/')).toBeNull();
    const odd = (async () => new Response('{"build":5}')) as typeof fetch;
    expect(await publishedBuild(odd, 'https://example.org/')).toBeNull();
  });
});

describe('keeping earlier versions’ files on the site', () => {
  const DAY = 86_400_000;
  const now = 100 * DAY;

  it('keeps last week’s files the new build no longer has, newest first, within the size limit', () => {
    const built = [{ path: 'app-NEW.js', size: 10 }, { path: 'fonts-SAME.js', size: 5 }];
    const listed = [
      { path: 'fonts-SAME.js', last: now - DAY, size: 5 },
      { path: 'app-OLD1.js', last: now - DAY, size: 10 },
      { path: 'app-OLD2.js', last: now - 3 * DAY, size: 10 },
      { path: 'app-GONE.js', last: now - (KEEP_DAYS + 1) * DAY, size: 10 },
      { path: 'app-OLD1.js', last: now - 2 * DAY, size: 10 },
    ];
    const { keep, list } = plan(built, listed, now);
    expect(keep.map((f: { path: string }) => f.path)).toEqual(['app-OLD1.js', 'app-OLD2.js']);
    expect(list).toEqual([
      { path: 'app-NEW.js', last: now, size: 10 },
      { path: 'fonts-SAME.js', last: now, size: 5 },
      { path: 'app-OLD1.js', last: now - DAY, size: 10 },
      { path: 'app-OLD2.js', last: now - 3 * DAY, size: 10 },
    ]);
    // a size limit leaves out the older ones first
    expect(plan(built, listed, now, KEEP_DAYS, 15).keep.map((f: { path: string }) => f.path)).toEqual(['app-OLD1.js']);
    // a file listed twice counts with its newest time, wherever it is in the list
    expect(plan([], [{ path: 'x-1.js', last: now - 9 * DAY, size: 1 }, { path: 'x-1.js', last: now - DAY, size: 1 }], now).keep)
      .toEqual([{ path: 'x-1.js', last: now - DAY, size: 1 }]);
    // and keeps versions whole: once one doesn't fit, nothing older (however small) is kept
    const small = [...listed, { path: 'tiny-OLD3.js', last: now - 4 * DAY, size: 1 }];
    expect(plan(built, small, now, KEEP_DAYS, 15).keep.map((f: { path: string }) => f.path)).toEqual(['app-OLD1.js']);
  });

  it('never writes a page, a hidden file or outside the site’s folder', () => {
    for (const p of ['app-1.js', 'assets/resources-2.json', 'a_b.c-d.woff2']) expect(safePath(p)).toBe(true);
    for (const p of ['../x.js', 'a/../../x.js', '/etc/x', '.git/config', 'index.html', 'version.json', 'kept-files.json', 'a//b.js', 'a\\b.js', 'a b.js', '', 5])
      expect(safePath(p)).toBe(false);
    const listed = parseList(JSON.stringify({ files: [
      { path: '../evil.js', last: 1, size: 1 }, { path: 'ok-1.js', last: 2, size: 3 }, { path: 'no-size.js', last: 2 }, 'junk',
    ] }));
    expect(listed).toEqual([{ path: 'ok-1.js', last: 2, size: 3 }]);
    expect(parseList('not json')).toEqual([]);
    expect(parseList('{"files":5}')).toEqual([]);
  });
});
