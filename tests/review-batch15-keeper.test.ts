// @vitest-environment jsdom
//
// Review batch 15 (F344, F346): the AutoSave message gives the delay the setting really uses, and
// the "changed on disk" notice keeps a space between its two sentences when the tab has unsaved changes.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (cmd: string) => {
    if (cmd === 'path_exists') return false;
    if (cmd === 'file_held') return false;
    if (cmd === 'file_stamp') return null;
    throw new Error('unexpected ' + cmd);
  },
}));

import { Keeper } from '../src/keep/keeper';
import { memoryStore } from '../src/keep/store';
import { DEFAULT_KEEP } from '../src/keep/prefs';
import type { Tab, Workspace } from '../src/workspace';

function keeper(autoSaveSeconds: number, flashes: string[]) {
  const tab = { id: 1, name: 'a.cdxml', ref: { kind: 'path', path: '/w/a.cdxml' }, dirty: true } as unknown as Tab;
  const ws = { tabs: [tab], fileTabs: [tab], canAutoSave: () => true } as unknown as Workspace;
  const prefs = { ...DEFAULT_KEEP, autoSaveSeconds };
  const k = new Keeper({ ws, prefs: () => prefs, setPrefs: () => {}, flash: (m: string) => { flashes.push(m); }, refresh: () => {} }, memoryStore());
  return { k, tab };
}

describe('AutoSave message (F344)', () => {
  it('says the number of seconds from the AutoSave setting', async () => {
    const flashes: string[] = [];
    const { k, tab } = keeper(90, flashes);
    await k.toggleAutoSave(tab);
    expect(flashes.at(-1)).toBe('AutoSave on for a.cdxml: it saves itself 90 seconds after the last change.');
    expect(flashes.at(-1)).not.toContain('a few seconds');
  });
});

describe('changed-on-disk notice (F346)', () => {
  it('has a space before "You also have unsaved changes."', async () => {
    document.body.replaceChildren();
    const { k, tab } = keeper(30, []);
    await (k as unknown as { changedOnDisk(t: Tab, d: { modified: number; size: number }): Promise<void> }).changedOnDisk(tab, { modified: Date.now(), size: 5 });
    const text = document.querySelector('.keep-notice p')!.textContent!;
    expect(text).toContain('bringing in changes. You also have unsaved changes.');
    expect(text).not.toContain('changes.You');
  });
});
