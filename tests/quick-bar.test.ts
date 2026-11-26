// The quick bar beside the menus (Quick Access Toolbar): what it keeps in the settings.

import { describe, expect, it } from 'vitest';
import { parseQuick, withQuick, QUICK_DEFAULT, QUICK_WEB } from '../src/ui/quick-bar';

describe('quick bar', () => {
  it('starts with only Save, Undo and Redo, the same in every kind of tab and in both apps (Nate, 2026-11-26)', () => {
    expect(QUICK_DEFAULT).toEqual(['save', 'undo', 'redo']);
  });

  it('has no list of its own for the web app or for one kind of tab', async () => {
    const mod = await import('../src/ui/quick-bar');
    expect(Object.keys(mod).filter((k) => /^QUICK_/.test(k)).sort()).toEqual(['QUICK_DEFAULT', 'QUICK_OFFERED']);
    const { readFileSync } = await import('node:fs');
    // main.ts gives the bar no other starting list (a "defaults" hook per app or per mode)
    expect(readFileSync('src/main.ts', 'utf8')).not.toMatch(/\bdefaults:\s/);
  });

  it('starts with only Save, Undo and Redo in the web app (Nate, 2026-11-25)', () => {
    expect(QUICK_WEB).toEqual(['save', 'undo', 'redo']);
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
