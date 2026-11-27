// @vitest-environment jsdom
//
// Restoring a version with Version History switched off (versions kept: 0) must keep the tab's
// current contents as a 'restored' version without deleting the versions kept before: the
// dialog says "Versions kept before are still here", and tidy() leaves switched-off history alone.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no desktop'); } }));
vi.mock('../src/ui/keep-ui', async (orig) => ({ ...(await orig<typeof import('../src/ui/keep-ui')>()), choose: async () => 1 }));

import { Keeper } from '../src/keep/keeper';
import { memoryStore } from '../src/keep/store';
import { DEFAULT_KEEP } from '../src/keep/prefs';
import type { Tab, Workspace } from '../src/workspace';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('Restore Version with Version History switched off', () => {
  it('keeps every earlier version', async () => {
    const tab = { id: 1, name: 'a.cdxml', ref: { kind: 'path', path: '/w/a.cdxml' }, stamp: null } as unknown as Tab;
    const ws = {
      tabs: [tab], fileTabs: [tab],
      encode: async () => ({ data: 'now' }),
      openAs: async () => tab,
    } as unknown as Workspace;
    let prefs = { ...DEFAULT_KEEP, versionsKeep: 30, versionsDays: 0, autoSave: false, recoveryMinutes: 0 };
    const keeper = new Keeper({ ws, prefs: () => prefs, setPrefs: () => {}, flash: () => {}, refresh: () => {} }, memoryStore());
    let t = 1_700_000_000_000;
    (keeper.versions as unknown as { now: () => number }).now = () => (t += 60_000);
    for (const s of ['one', 'two', 'three']) await keeper.versions.add('/w/a.cdxml', bytes(s), 'saved', { keep: 30, days: 0, ext: 'cdxml' });
    expect(await keeper.versions.list('/w/a.cdxml')).toHaveLength(3);
    // Version History switched off, then an old version restored
    prefs = { ...prefs, versionsKeep: 0 };
    const old = (await keeper.versions.list('/w/a.cdxml')).at(-1)!;
    const restore = (keeper as unknown as { restoreVersion(t: Tab, k: string, v: unknown): Promise<boolean> }).restoreVersion.bind(keeper);
    expect(await restore(tab, '/w/a.cdxml', old)).toBe(true);
    const after = await keeper.versions.list('/w/a.cdxml');
    expect(after.map((v) => v.how)).toEqual(['restored', 'saved', 'saved', 'saved']);
    expect(after.some((v) => v.file === old.file)).toBe(true);
  });
});
