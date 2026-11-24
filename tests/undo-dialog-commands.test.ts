// @vitest-environment jsdom
// Undo of commands that go through a window, found by the dialog sweep of the November audit:
// References ▸ Insert Caption took three undos and Cross-reference two (G3-11, G3-12), and
// File ▸ Page Setup on a canvas made no undo step at all (G3-10).
import { describe, it, expect, beforeAll } from 'vitest';
import { docMode, type } from './doc-mode-harness';
import { objectRun } from '../src/document/document';
import * as rt from '../src/richtext';
import { Doc, type PageSetup } from '../src/model';
import type { DocFile } from '../src/document/doc-file';

beforeAll(() => {
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => undefined;
  el.releasePointerCapture ??= () => undefined;
  const dlg = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dlg.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dlg.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});

const state = (f: DocFile) => JSON.stringify(f.t);
const steps = (f: DocFile) => (f.ed as unknown as { undoStack: unknown[] }).undoStack.length;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Press the window's primary button (Insert, OK), with its first list set to `value` if given. */
async function answer(value?: string): Promise<void> {
  await tick();
  const d = document.querySelector<HTMLDialogElement>('dialog[open]')!;
  expect(d).toBeTruthy();
  if (value !== undefined) { const s = d.querySelector('select')!; s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); }
  d.querySelector<HTMLButtonElement>('button.primary')!.click();
  await tick();
}

describe('Document: a command through a window is one undo step', () => {
  for (const [where, caret] of [['in an empty paragraph', 'empty'], ['below a paragraph', 'text']] as const) {
    it(`Insert Caption ${where}: one Ctrl+Z takes out the caption, its numbering and its style`, async () => {
      const { dm, f } = await docMode({ runs: [{ text: 'Synthesis of the ketone\n' }], paras: [{}, {}] });
      f.ed.setCaret(caret === 'empty' ? f.ed.text.length : 5);
      const before = state(f), n0 = steps(f);
      dm.run('insert-caption');
      await answer();
      expect(state(f)).toContain('Caption');
      expect(steps(f) - n0).toBe(1);
      const after = state(f);
      dm.run('undo');
      expect(state(f)).toBe(before);
      dm.run('redo');
      expect(state(f)).toBe(after);
    }, 60000);
  }

  it('Cross-reference to a caption\'s page: one Ctrl+Z takes out the field and its hidden bookmark', async () => {
    const { dm, f } = await docMode({ runs: [{ text: 'A figure\nSee \n' }], paras: [{}, {}, {}] });
    f.ed.setCaret(0);
    dm.run('insert-caption');
    await answer();
    f.ed.setCaret(f.ed.text.indexOf('See ') + 4);
    const before = state(f), n0 = steps(f);
    dm.run('cross-reference');
    await tick();
    // refer to its page (which needs a bookmark on the caption's paragraph)
    const d = document.querySelector<HTMLDialogElement>('dialog[open]')!;
    const what = d.querySelectorAll('select')[1] as HTMLSelectElement;
    what.value = 'page';
    d.querySelector<HTMLButtonElement>('button.primary')!.click();
    await tick();
    expect(state(f)).toContain('_Cap');
    expect(steps(f) - n0).toBe(1);
    dm.run('undo');
    expect(state(f)).toBe(before);
    expect(state(f)).not.toContain('_Cap');
  }, 60000);
});

describe('Document: a cross-reference typed in a table cell is one undo step (F3 Needs Nate 8)', () => {
  it('one Ctrl+Z takes out the field and its bookmark; typing after it is a step of its own; Ctrl+Y brings it back', async () => {
    const { dm, f, ta } = await docMode({ runs: [{ text: 'A figure\nTable 1. ' }], paras: [{}, {}], objects: { 9: { kind: 'table', table: { cols: [100, 100], rows: [[{ runs: [{ text: 'Entry' }] }, { runs: [{ text: 'See ' }] }]], head: 1 } } } as never });
    f.ed.setCaret(0);
    dm.run('insert-caption');
    await answer();
    f.ed.update({ ...f.t, runs: [...f.t.runs, objectRun(9, {})] }, 'Insert table');
    const cell = () => rt.plainText((f.t.objects[9] as { table: { rows: { runs: never }[][] } }).table.rows[0][1].runs);
    (dm as never as { startCell(id: number, r: number, c: number): boolean }).startCell(9, 0, 1);
    const before = state(f);
    dm.run('cross-reference');
    await tick();
    const d = document.querySelector<HTMLDialogElement>('dialog[open]')!;
    (d.querySelectorAll('select')[1] as HTMLSelectElement).value = 'page';
    d.querySelector<HTMLButtonElement>('button.primary')!.click();
    await tick();
    expect(state(f)).toContain('_Cap');
    expect(cell()).toBe('See \ufffc');
    const withRef = state(f);
    // typing after it goes on in the cell, after the field
    type(ta, ' and');
    expect(cell()).toBe('See \ufffc and');
    dm.run('undo');
    expect(cell()).toBe('See \ufffc');
    // the next Ctrl+Z takes the field and its hidden bookmark out together
    dm.run('undo');
    expect(state(f)).toBe(before);
    expect(state(f)).not.toContain('_Cap');
    dm.run('redo');
    expect(state(f)).toBe(withRef);
  }, 60000);
});

describe('Canvas: the page is part of Undo', () => {
  const letter: PageSetup = { w: 540, h: 720, grow: true, name: 'letter', walls: { l: 0, t: 0 } };

  it('Page Setup is one step that Ctrl+Z takes back and Ctrl+Y brings again', () => {
    const doc = new Doc();
    doc.edit('Page Setup', () => doc.setPage(letter));
    expect(doc.page).toEqual(letter);
    expect(doc.undoLabel).toBe('Page Setup');
    doc.edit('Page Setup', () => doc.setPage({ ...letter, w: 720, h: 540, walls: { l: 0 } }));
    doc.undo();
    expect(doc.page).toEqual(letter);
    doc.undo();
    expect(doc.page).toBeNull();
    doc.redo();
    expect(doc.page).toEqual(letter);
  });

  it('the page kept in the undo step is a copy (a later change to the page in place does not reach it)', () => {
    const doc = new Doc();
    doc.edit('Page Setup', () => doc.setPage(letter));
    doc.edit('Fix Page Edge', () => doc.setPage({ ...doc.page!, walls: { ...doc.page!.walls, r: 2 } }));
    doc.page!.walls!.b = 3;
    doc.undo();
    expect(doc.page!.walls).toEqual({ l: 0, t: 0 });
  });

  it('choosing the page it already has makes no step', () => {
    const doc = new Doc();
    doc.edit('Page Setup', () => doc.setPage(letter));
    doc.edit('Page Setup', () => doc.setPage({ ...letter }));
    doc.undo();
    expect(doc.page).toBeNull();
    expect(doc.canUndo()).toBe(false);
  });
});
