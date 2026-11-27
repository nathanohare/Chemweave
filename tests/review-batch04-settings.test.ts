// @vitest-environment jsdom
//
// Fixes from the code review of 2026-11-26 (batch 04): a damaged settings file that couldn't be
// moved aside is never written over, a setting changed just before the window goes is still
// written, a pinch goes on after a third finger touches and lifts, and the Guides toolbox says
// when a drawing has as many guides as it keeps.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { loadSettings, saveSettings, flushSettings, parseSettings, settingsText, type SettingsStore } from '../src/settings';
import { installPenAndTouch } from '../src/editor/touch';
import { buildGuidesToolbox } from '../src/ui/guides-toolbox';
import { DEFAULT_GUIDES, MAX_GUIDES, type CanvasGuides } from '../src/editor/guides';

describe('F525: a setting changed just before the page goes', () => {
  it('is written at once when asked', async () => {
    localStorage.clear();
    const s = { ...parseSettings(null), nicknames: { Tf: 'FC(F)(F)S(=O)(=O)*' } };
    saveSettings(s);
    const before = Object.keys(localStorage).length;
    await flushSettings();
    expect(Object.keys(localStorage).length).toBe(before + 1);
    const key = Object.keys(localStorage)[0];
    expect(localStorage.getItem(key)).toBe(settingsText(s));
  });
});

describe('F524: a damaged settings file that couldn\'t be moved aside', () => {
  it('is not written over by the next change', async () => {
    localStorage.clear();
    const store: SettingsStore = {
      read: async () => '{"hotk',
      readBackup: async () => null,
      writeBackup: async () => {},
      setAside: async () => { throw new Error('read-only folder'); },
    };
    const notes: string[] = [];
    await loadSettings((m) => notes.push(m), store);
    expect(notes[0]).toMatch(/won.t be saved/);
    saveSettings(parseSettings(null));
    await flushSettings();
    expect(Object.keys(localStorage).length).toBe(0);
  });
});

describe('F377: a third finger touching and lifting during a pinch', () => {
  it('leaves the two fingers still pinching', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const view = { ox: 0, oy: 0, scale: 1 };
    installPenAndTouch({ overlay: el, view, requestScene: () => {}, abandonPress: () => {} });
    const ev = (type: string, id: number, x: number, y = 100) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
    // (a pen seen first: every finger pans and pinches)
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, pointerType: 'pen', bubbles: true }));
    ev('pointerdown', 1, 100); ev('pointerdown', 2, 200);
    ev('pointermove', 1, 90); ev('pointermove', 2, 210);
    ev('pointerdown', 3, 400, 400); ev('pointerup', 3, 400, 400);
    const s0 = view.scale;
    // the two fingers spread apart: the view zooms in
    ev('pointermove', 1, 50); ev('pointermove', 2, 250);
    expect(view.scale).toBeGreaterThan(s0 * 1.5);
    el.remove();
  });
});

describe('F373: the Guides toolbox at the most guides a drawing keeps', () => {
  it('turns its add buttons off, saying why', () => {
    const body = document.createElement('div');
    document.body.append(body);
    let g: CanvasGuides = { ...DEFAULT_GUIDES, list: [] };
    const tb = buildGuidesToolbox(body, false, { get: () => g, set: (n) => { g = n ?? { ...DEFAULT_GUIDES, list: [] }; }, centre: () => ({ x: 0, y: 0 }), units: () => 'in' });
    const add = () => [...body.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Add Horizontal Guide'))!;
    tb.refresh();
    expect(add().disabled).toBe(false);
    g = { ...g, list: Array.from({ length: MAX_GUIDES }, (_, i) => ({ kind: 'h' as const, x: 0, y: i })) };
    tb.refresh();
    expect(add().disabled).toBe(true);
    expect(add().title).toMatch(/keeps up to 1,000 guides/);
    body.remove();
  });
});
