// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 02: AutoSave, recovery copies and Version History.
//   F031: a tool window left open (Symbol, a PivotTable's fields) stopped AutoSave and recovery copies.
//   F032: a disk check while the app wrote the file took the app's own write for a change made elsewhere.
//   F033: recovery copies that couldn't be reopened were deleted anyway.
//   F034: AutoSave and Recovery Options stored numbers outside their limits (AutoSave every 0 s).
//   F345: closing tab 1 closed tab 12's notices.
//   F347: Restore Version went on when what the tab had couldn't be kept first.
//   F348: one tab that couldn't be copied stopped every other tab's recovery copy.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no desktop'); } }));
const ui = vi.hoisted(() => ({ recover: null as unknown, options: null as unknown }));
vi.mock('../src/ui/keep-ui', async (orig) => ({
  ...(await orig<typeof import('../src/ui/keep-ui')>()),
  choose: async () => 1,
  recoverDialog: async () => ui.recover,
  optionsDialog: async () => ui.options,
}));
// the file on disk: its stamp as the tests set it
const fileStamp = vi.hoisted(() => ({ now: { modified: 1, size: 10 } as { modified: number; size: number } | null }));
vi.mock('../src/io/files', async (orig) => ({
  ...(await orig<typeof import('../src/io/files')>()),
  stampOf: async () => fileStamp.now,
  readRef: async () => null,
}));

import { Keeper } from '../src/keep/keeper';
import { memoryStore } from '../src/keep/store';
import { Recovery, type Copyable, type Session } from '../src/keep/recovery';
import { DEFAULT_KEEP, type KeepPrefs } from '../src/keep/prefs';
import { notice, hasNotice } from '../src/ui/keep-ui';
import type { Tab, Workspace } from '../src/workspace';

const bytes = (s: string) => new TextEncoder().encode(s);

function tabOf(id: number, over: Partial<Tab> = {}): Tab {
  return { id, name: `t${id}.cdxml`, ref: { kind: 'path', path: `/w/t${id}.cdxml` }, stamp: { modified: 1, size: 10 }, dirty: true, mode: 'drawing', ...over } as unknown as Tab;
}

function keeperWith(tabs: Tab[], ws: Partial<Workspace> = {}, prefs: KeepPrefs = { ...DEFAULT_KEEP, recoveryMinutes: 0 }) {
  const flashes: string[] = [];
  const set: KeepPrefs[] = [];
  const w = { tabs, fileTabs: tabs, token: () => 1, ...ws } as unknown as Workspace;
  const keeper = new Keeper({ ws: w, prefs: () => prefs, setPrefs: (p) => set.push(p), flash: (m) => flashes.push(m), refresh: () => {} }, memoryStore());
  return { keeper, flashes, set };
}

const priv = (k: Keeper) => k as unknown as { busy(): boolean; checkDisk(t: Tab): Promise<void>; offer(s: Session[], atStart: boolean): Promise<void>; restoreVersion(t: Tab, key: string, v: unknown): Promise<boolean> };

beforeEach(() => {
  document.body.innerHTML = '';
  fileStamp.now = { modified: 1, size: 10 };
});

describe('F031: only modal windows hold AutoSave off', () => {
  it('a tool window open beside the work is not a reason to wait; a modal window is', () => {
    const { keeper } = keeperWith([]);
    const tool = document.createElement('dialog');
    tool.setAttribute('open', ''); // as show() leaves it
    document.body.append(tool);
    expect(priv(keeper).busy()).toBe(false);
    const modal = document.createElement('dialog');
    modal.setAttribute('open', '');
    modal.classList.add('is-modal'); // as src/ui/modal-guard.ts marks a showModal() window
    document.body.append(modal);
    expect(priv(keeper).busy()).toBe(true);
  });
});

describe('F032: the app writing the file is not a change on disk', () => {
  it('leaves a tab alone while its file is being written, and checks it again after', async () => {
    const tab = tabOf(1);
    const { keeper } = keeperWith([tab]);
    expect(await keeper.beforeWrite(tab, tab.ref, tab.name, 'autosaved')).toBe('go');
    // half way through the write the file's stamp is neither the old one nor the new one
    fileStamp.now = { modified: 2, size: 4 };
    await priv(keeper).checkDisk(tab);
    expect(keeper.isPaused(tab)).toBe(false);
    expect(hasNotice('disk-1')).toBe(false);
    // written: the tab has the new stamp, so nothing is said
    fileStamp.now = { modified: 3, size: 12 };
    tab.stamp = { modified: 3, size: 12 };
    keeper.saved(tab, bytes('x'), 'autosaved', tab.ref);
    keeper.written(tab);
    await priv(keeper).checkDisk(tab);
    expect(keeper.isPaused(tab)).toBe(false);
    // a real change made elsewhere afterwards is still seen
    fileStamp.now = { modified: 9, size: 20 };
    await priv(keeper).checkDisk(tab);
    expect(keeper.isPaused(tab)).toBe(true);
    expect(hasNotice('disk-1')).toBe(true);
  });
});

describe('F033: a copy that couldn’t be reopened is kept', () => {
  it('forgets only the copies that opened', async () => {
    const opens = [null, tabOf(5)];
    const { keeper, flashes } = keeperWith([], { openAs: async () => opens.shift() ?? null } as Partial<Workspace>);
    const s: Session = { session: 'old', started: 1, beat: 2, tabs: [
      { id: 1, name: 'a.cdxml', mode: 'drawing', path: null, stamp: null, file: 'tab-1.cdxml', copied: 1 },
      { id: 2, name: 'b.cdxml', mode: 'drawing', path: null, stamp: null, file: 'tab-2.cdxml', copied: 1 },
    ] };
    vi.spyOn(keeper.recovery, 'read').mockResolvedValue(bytes('copy'));
    const forget = vi.spyOn(keeper.recovery, 'forget').mockResolvedValue();
    ui.recover = { action: 'reopen', picked: s.tabs.map((t) => ({ session: s, tab: t })) };
    await priv(keeper).offer([s], false);
    // a.cdxml didn't open: it stays; b.cdxml is open in a tab now
    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget.mock.calls[0][1]).toEqual(['tab-2.cdxml']);
    expect(flashes.at(-1)).toMatch(/One copy couldn’t be opened; it is kept/);
  });
});

describe('F034: the options are held to their limits', () => {
  it('stores AutoSave every 2 s at least and copies kept a day at least', async () => {
    const { keeper, set } = keeperWith([]);
    ui.options = { ...DEFAULT_KEEP, autoSaveSeconds: 0, recoveryDays: 0, versionsKeep: -3 };
    await keeper.optionsCommand();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({ autoSaveSeconds: 2, recoveryDays: 1, versionsKeep: 0 });
  });
});

describe('F345: closing a tab closes only its own notices', () => {
  it('leaves tab 12’s notice when tab 1 closes', () => {
    const one = tabOf(1), twelve = tabOf(12);
    const { keeper } = keeperWith([one, twelve]);
    notice('disk-1', 'one', '', [{ label: 'OK', run: () => {} }]);
    notice('disk-12', 'twelve', '', [{ label: 'OK', run: () => {} }]);
    keeper.dropped(one);
    expect(hasNotice('disk-1')).toBe(false);
    expect(hasNotice('disk-12')).toBe(true);
  });
});

describe('F347: Restore Version keeps the tab when its contents can’t be kept first', () => {
  it('doesn’t replace the tab, and says so', async () => {
    const tab = tabOf(1);
    const openAs = vi.fn(async () => tab);
    const { keeper, flashes } = keeperWith([tab], { encode: async () => { throw new Error('out of space'); }, openAs } as Partial<Workspace>);
    await keeper.versions.add('/w/t1.cdxml', bytes('old'), 'saved', { keep: 30, days: 0, ext: 'cdxml' });
    const [v] = await keeper.versions.list('/w/t1.cdxml');
    expect(await priv(keeper).restoreVersion(tab, '/w/t1.cdxml', v)).toBe(false);
    expect(openAs).not.toHaveBeenCalled();
    expect(flashes.at(-1)).toMatch(/wasn’t restored/);
  });
});

describe('F348: one tab that can’t be copied doesn’t stop the others', () => {
  it('copies the rest, writes the list, then says it failed', async () => {
    const store = memoryStore();
    const r = new Recovery(store, 'me');
    const tab = (id: number, copy: Copyable['copy']): Copyable => ({ id, name: `T${id}.cdxml`, mode: 'drawing', path: null, stamp: null, dirty: true, token: 1, copy });
    await expect(r.copy([
      tab(1, async () => { throw new Error('a damaged drawing'); }),
      tab(2, async () => ({ name: 'T2.cdxml', data: bytes('two') })),
    ])).rejects.toThrow('a damaged drawing');
    expect(store.files.has('recovery/me/tab-2.cdxml')).toBe(true);
    expect(r.copied(2, 1)).toBe(true);
    const list = JSON.parse(new TextDecoder().decode((await store.get('recovery/me/session.json'))!)) as Session;
    expect(list.tabs.map((t) => t.id)).toEqual([2]);
  });
});
