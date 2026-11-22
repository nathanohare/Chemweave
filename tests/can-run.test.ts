// @vitest-environment jsdom
// Commands that cannot run are greyed with the reason in the tooltip (style guide S15, S85;
// retrospective audit G5-28).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paintCanRun, clearCanRun } from '../src/ui/can-run';
import { dataTableRef } from '../src/sheet/what-if';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

const button = (cmd: string, title?: string) => {
  const b = document.createElement('button');
  b.dataset.cmd = cmd;
  if (title) b.title = title;
  document.body.append(b);
  return b;
};

describe('paintCanRun', () => {
  it('greys a command that cannot run, the reason before its own tip, and gives it back after', () => {
    const b = button('scale', 'Scale the selection');
    let reason: string | null = 'Select something to scale.';
    paintCanRun([b], 'cmd', () => reason);
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('Select something to scale.\n\nScale the selection');
    paintCanRun([b], 'cmd', () => reason); // twice does not stack the reason
    expect(b.title).toBe('Select something to scale.\n\nScale the selection');
    reason = null;
    paintCanRun([b], 'cmd', () => reason);
    expect(b.disabled).toBe(false);
    expect(b.title).toBe('Scale the selection');
  });
  it('leaves alone commands without a check and items greyed for other reasons', () => {
    const undo = button('undo');
    undo.disabled = true;
    paintCanRun([undo], 'cmd', () => null);
    expect(undo.disabled).toBe(true);
    const other = button('bold');
    paintCanRun([other], 'cmd', () => undefined);
    expect(other.disabled).toBe(false);
  });
  it('a button without a tip gets the reason alone, and clearCanRun gives back every greyed one', () => {
    const b = button('turn-3d');
    paintCanRun([b], 'cmd', () => 'Select a structure to rotate in 3-D.');
    expect(b.title).toBe('Select a structure to rotate in 3-D.');
    clearCanRun(document.body);
    expect(b.disabled).toBe(false);
    expect(b.hasAttribute('title')).toBe(false);
  });
});

describe('the checks (G5-28)', () => {
  const main = src('src/main.ts');
  it('cover the drawing commands the audit ran on an empty file, with the reasons the toasts gave', () => {
    const f = main.slice(main.indexOf('function whyDrawingCannotRun('), main.indexOf('function whyCannotRun('));
    for (const c of ['contract-label', 'arrange-grid', 'stoichiometry-table', 'check-balance', 'rgroup-table', 'chiral-flag', 'animate-step', 'turn-3d', 'scale', 'action-settings']) expect(f, c).toContain(`case '${c}'`);
    expect(f).toContain('Select two or more structures or objects to put in a grid.');
    expect(f).toContain("'error' in g ? g.error : null");
  });
  it('are applied when a menu opens and to the ribbon buttons on show', () => {
    expect(main).toContain("paintCanRun([...m.list.querySelectorAll<HTMLButtonElement>('button[data-cmd]')].filter((b) => !b.closest('[data-mode-hid]')), 'cmd', (c) => whyCannotRun(c, true));");
    expect(main).toContain("paintCanRun(shown, 'cmd', (c) => whyDrawingCannotRun(c, true));");
    expect(main).toContain('editor.onChange = () => { refreshCanRun();');
  });
  it('the sheet answers for remove duplicates, sort, text to columns, properties and data table', () => {
    const sheet = src('src/ui/sheet-mode.ts');
    expect(sheet).toContain("const check = ['remove-duplicates', 'custom-sort', 'text-to-columns', 'property-column', 'data-table'];");
    expect(sheet).toContain("paintCanRun(this.ribbon.querySelectorAll<HTMLButtonElement>('button[data-sh]'), 'sh', (n) => this.cannotRun(n));");
    expect(src('src/ui/sheet-analysis-ui.ts')).toContain("['Data Table…', () => this.dataTableWindow(), typeof ref !== 'string'],");
    // one cell is not a data table; a 2 × 2 block is
    expect(typeof dataTableRef({ r1: 0, c1: 0, r2: 0, c2: 0 })).toBe('string');
    expect(dataTableRef({ r1: 0, c1: 0, r2: 1, c2: 1 })).toEqual({ r1: 1, c1: 1, r2: 1, c2: 1 });
  });
});
