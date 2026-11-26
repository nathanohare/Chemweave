// @vitest-environment jsdom
// File menu items shown in a Document or Spreadsheet (unmarked, or marked for that mode) run there:
// those tabs only pass on the commands listed in main.ts's ANY_TAB (or their own), so an item left
// out of that list did nothing there (File ▸ New ▸ SI Project and File ▸ Open SI Project worked only
// with a canvas showing).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const main = src('src/main.ts');
const listed = (name: string) => {
  const at = main.indexOf(`const ${name} = new Set([`);
  const body = main.slice(at, main.indexOf(']);', at));
  return new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1]));
};
const keysOf = (name: string) => {
  const at = main.indexOf(`const ${name}: Record<string, () => unknown> = {`);
  const body = main.slice(at, main.indexOf('\n};', at));
  return new Set([...body.matchAll(/^\s+'?([a-z0-9-]+)'?: /gm)].map((m) => m[1]));
};

describe('File menu commands run in every mode', () => {
  const page = new DOMParser().parseFromString(src('index.html'), 'text/html');
  const any = listed('ANY_TAB'), docAny = listed('DOC_ANY');
  const docOwn = keysOf('DOC_COMMANDS'), sheetOwn = keysOf('SHEET_COMMANDS');
  const docMode = src('src/ui/doc-mode.ts'), sheetMode = src('src/ui/sheet-mode.ts');
  const wrap = page.querySelector('#file-menu')!.closest('.menu-wrap');
  // each item and the modes it shows in (its own mark, or its submenu's; none: every mode)
  const items = [...page.querySelectorAll<HTMLElement>('[data-cmd]')]
    .filter((b) => b.closest('.menu-wrap') === wrap)
    .map((b) => ({ cmd: b.dataset.cmd!, modes: (b.dataset.modes ?? b.parentElement?.closest<HTMLElement>('[data-modes]')?.dataset.modes ?? 'document sheet').split(' ') }));
  it('finds the File menu', () => { expect(items.map((i) => i.cmd)).toContain('new-si-project'); });
  for (const { cmd, modes } of items) {
    if (!modes.includes('document') && !modes.includes('sheet')) continue;
    it(`${cmd} (${modes.join(', ')})`, () => {
      const inDoc = any.has(cmd) || docAny.has(cmd) || docOwn.has(cmd) || docMode.includes(`'${cmd}'`);
      // (a family of commands, such as sheet-paper-a4, read by its prefix)
      const family = cmd.replace(/-[a-z0-9]+$/, '-');
      const inSheet = any.has(cmd) || sheetOwn.has(cmd) || sheetMode.includes(`'${cmd}'`) || sheetMode.includes(`startsWith('${family}')`);
      if (modes.includes('document')) expect(inDoc, `${cmd} in a Document`).toBe(true);
      if (modes.includes('sheet')) expect(inSheet, `${cmd} in a Spreadsheet`).toBe(true);
    });
  }
});
