// The quick bar beside the menus (Quick Access Toolbar): what it keeps in the settings.

import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseQuick, withQuick, QuickBar, QUICK_DEFAULT } from '../src/ui/quick-bar';

describe('quick bar', () => {
  it('starts with only Save, Undo and Redo, the same in every kind of tab and in both apps (Nate, 2026-11-26)', () => {
    expect(QUICK_DEFAULT).toEqual(['save', 'undo', 'redo']);
  });

  it('has no list of its own for the web app or for one kind of tab', async () => {
    const mod = await import('../src/ui/quick-bar');
    expect(Object.keys(mod).filter((k) => /^QUICK_/.test(k)).sort()).toEqual(['QUICK_DEFAULT', 'QUICK_OFFERED']);
  });

  it('shows Save, Undo and Redo until changed, and goes back to them on Reset', () => {
    const { window } = new JSDOM('<div id="qa"></div>');
    const g = globalThis as Record<string, unknown>;
    const was = { document: g.document, Element: g.Element };
    g.document = window.document; g.Element = window.Element;
    try {
      let saved: string[] | null = null;
      const bar = new QuickBar(window.document.getElementById('qa')!, {
        get: () => saved, set: (l) => { saved = l; }, run: () => {}, label: (c) => c, key: () => undefined,
        icon: () => undefined, state: () => ({ enabled: true, on: null }), all: () => [],
      });
      const shown = () => [...window.document.querySelectorAll<HTMLElement>('#qa [data-qa]')].map((b) => b.dataset.qa);
      expect(shown()).toEqual(['save', 'undo', 'redo']);
      bar.toggle('print', true);
      expect(saved).toEqual(['save', 'undo', 'redo', 'print']);
      bar.toggle('print', false);
      // (back to the starting list: kept as "as it comes", so a later change to it reaches this person too)
      expect(saved).toBeNull();
      expect(shown()).toEqual(['save', 'undo', 'redo']);
    } finally { g.document = was.document; g.Element = was.Element; }
  });

  it('reads its list from the settings, keeping only command names, once each', () => {
    expect(parseQuick(undefined)).toBeNull();
    expect(parseQuick('save')).toBeNull();
    expect(parseQuick(['save', 'save', 'Print', '<b>', 7, 'zoom-fit'])).toEqual(['save', 'zoom-fit']);
    expect(parseQuick([])).toEqual([]);
  });

  it('puts commands on, takes them off, and never doubles one', () => {
    expect(withQuick(['save', 'undo'], 'print', true)).toEqual(['save', 'undo', 'print']);
    expect(withQuick(['save', 'undo'], 'print', true, 1)).toEqual(['save', 'print', 'undo']);
    expect(withQuick(['save', 'undo', 'print'], 'save', true)).toEqual(['undo', 'print', 'save']);
    expect(withQuick(['save', 'undo'], 'save', false)).toEqual(['undo']);
  });
});
