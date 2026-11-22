// @vitest-environment jsdom
//
// The command list (src/commands/registry.ts) and the Insert menu made from it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSERT_MENU, commandDef, commandDefs, renderMenu } from '../src/commands/registry';

const MODES = new Set(['drawing', 'slides', 'sheet', 'document', 'design']);

describe('command list', () => {
  it('names each command once, with known kinds of tab', () => {
    const ids = commandDefs().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of commandDefs()) {
      expect(c.label.trim()).not.toBe('');
      for (const m of c.modes?.split(' ') ?? []) expect(MODES.has(m)).toBe(true);
    }
    expect(commandDef('name-to-structure')?.label).toBe('Structure from Name or SMILES…');
  });

  it('builds the Insert menu with its submenus, lines and tab kinds', () => {
    const menu = document.createElement('div');
    renderMenu(menu, INSERT_MENU);
    const pic = menu.querySelector<HTMLButtonElement>('[data-cmd="insert-picture"]')!;
    expect(pic.getAttribute('role')).toBe('menuitem');
    expect(pic.dataset.modes).toBe('drawing slides design document');
    // each mode's commands sit straight in the menu, marked with their mode, not in a submenu named after it (S85, R11)
    const heads = [...menu.querySelectorAll('.submenu > button')].map((b) => b.textContent);
    for (const m of ['Canvas', 'Presentation', 'Spreadsheet', 'Document', 'Design']) expect(heads).not.toContain(m);
    for (const [cmd, mode] of [['new-slide', 'slides'], ['insert-sheet', 'sheet'], ['insert-caption', 'document'], ['add-keyframe', 'slides']]) {
      const b = menu.querySelector<HTMLElement>(`:scope > [data-cmd="${cmd}"]`)!;
      expect(b, cmd).not.toBeNull();
      expect(b.dataset.modes, cmd).toBe(mode);
    }
    const toc = [...menu.querySelectorAll<HTMLElement>(':scope > .submenu')].find((s) => s.querySelector(':scope > button')?.textContent === 'Tables and Indexes')!;
    expect(toc.dataset.modes).toBe('document');
    expect(toc.querySelector<HTMLElement>(':scope > .menu.sub')!.hidden).toBe(true);
    expect(toc.querySelector('[data-cmd="insert-toc"]')).not.toBeNull();
    // every item straight in the menu says which tabs it works in, or works in all of them
    for (const el of menu.querySelectorAll<HTMLElement>(':scope > .submenu, :scope > button')) {
      const id = el.dataset.cmd;
      if (id && !commandDef(id)?.modes) continue;
      expect(el.dataset.modes, id ?? el.textContent ?? '').toBeTruthy();
    }
    expect(menu.querySelectorAll('[data-cmd]').length).toBe(commandDefs().length);
    expect(menu.querySelector('.keyframes-only[data-cmd="add-keyframe"]')).not.toBeNull();
  });

  it('is not also written out in index.html', () => {
    const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
    for (const c of commandDefs()) {
      const inInsert = html.slice(html.indexOf('id="insert-menu"'), html.indexOf('id="btn-format"'));
      expect(inInsert).not.toContain(`data-cmd="${c.id}"`);
    }
  });
});
