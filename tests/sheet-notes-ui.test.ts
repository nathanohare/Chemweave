// @vitest-environment jsdom
//
// Sheet notes being typed: a new note on another cell keeps the one being typed and starts its
// own, and a note's card sits clear of the cells beside its cell.

import { describe, it, expect, beforeEach } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { SheetNotes } from '../src/ui/sheet-notes-ui';
import { setReviewAuthor } from '../src/document/revisions';
import type { SheetView } from '../src/ui/sheet-view';

const W = 64, H = 20;

function setUp() {
  const wb = new Workbook(['Sheet1']);
  const sheet = wb.sheets[0];
  const view = {
    sheet,
    sel: { active: { r: 0, c: 0 } },
    commitEdit() {},
    reveal() {},
    focus() { (document.activeElement as HTMLElement | null)?.blur?.(); },
    refresh() {},
    screenRect: (r: number, c: number) => new DOMRect(44 + c * W, 22 + r * H, W, H),
  };
  const notes = new SheetNotes({ view: view as unknown as SheetView, edit: (_l, fn) => fn(sheet), flash() {}, askName: async () => true });
  return { sheet, view, notes };
}

// (the note's box is a rich text box: what is typed reaches it as its text and an input event)
const typeInto = (text: string) => {
  const ta = document.querySelector<HTMLElement>('.sh-note-input')!;
  ta.textContent = text;
  ta.dispatchEvent(new Event('input'));
  return ta;
};

describe('sheet notes', () => {
  beforeEach(() => { document.body.replaceChildren(); setReviewAuthor('Nate'); });

  it('New Note on another cell keeps the note being typed and opens one on the new cell', async () => {
    const { sheet, view, notes } = setUp();
    await notes.newNote();
    await Promise.resolve();
    typeInto('Note on A1');
    view.sel.active = { r: 1, c: 1 };
    await notes.newNote();
    await Promise.resolve();
    expect(sheet.noteAt(0, 0)?.text).toBe('Note on A1');
    expect(document.querySelectorAll('.sh-note-input')).toHaveLength(1);
    typeInto('Note on B2').blur();
    expect(sheet.noteAt(1, 1)?.text).toBe('Note on B2');
    expect(sheet.noteAt(0, 0)?.text).toBe('Note on A1');
  });

  it("puts a note's card past the next column, so the cells beside it can be clicked", async () => {
    const { notes } = setUp();
    await notes.newNote();
    const card = document.querySelector<HTMLElement>('.sh-note-card')!;
    expect(parseFloat(card.style.left)).toBeGreaterThanOrEqual(44 + 2 * W);
  });
});

describe('formatting in a note (F3 Needs Nate 5, F8b)', () => {
  beforeEach(() => { document.body.replaceChildren(); setReviewAuthor('Nate'); });

  it('shows a note\'s bold and subscripts on its card', () => {
    const { sheet, notes } = setUp();
    sheet.setNote(0, 0, { kind: 'note', author: 'Nate', date: '', text: 'CH2Cl2 dry', runs: [{ text: 'CH' }, { text: '2', sub: true }, { text: 'Cl' }, { text: '2', sub: true }, { text: ' ' }, { text: 'dry', bold: true }] });
    notes.hover({ r: 0, c: 0 }, new DOMRect(44, 22, W, H));
    const text = document.querySelector('.sh-note-text')!;
    expect(text.querySelectorAll('sub')).toHaveLength(2);
    expect([...text.querySelectorAll<HTMLElement>('span')].find((x) => x.textContent === 'dry')?.style.fontWeight).toBe('bold');
  });

  it('keeps the looks when the note is opened and saved unchanged', async () => {
    const { sheet, notes } = setUp();
    sheet.setNote(0, 0, { kind: 'note', author: 'Nate', date: '', text: 'Na2SO4', runs: [{ text: 'Na' }, { text: '2', sub: true }, { text: 'SO' }, { text: '4', sub: true }] });
    notes.edit();
    await Promise.resolve();
    const box = document.querySelector<HTMLElement>('.sh-note-input')!;
    expect(box.getAttribute('contenteditable')).not.toBe('false');
    // (the box draws a subscript as a lowered span, as a cell being typed in does)
    expect([...box.querySelectorAll<HTMLElement>('span')].filter((x) => x.style.verticalAlign === 'sub').map((x) => x.textContent)).toEqual(['2', '4']);
    box.blur();
    // nothing changed: the same note
    expect(sheet.noteAt(0, 0)?.runs).toEqual([{ text: 'Na' }, { text: '2', sub: true }, { text: 'SO' }, { text: '4', sub: true }]);
  });

  it('Ctrl+B on selected words in the box makes them bold, saved as the note\'s runs', async () => {
    const { sheet, notes } = setUp();
    sheet.setNote(0, 0, { kind: 'note', author: 'Nate', date: '', text: 'dry ice' });
    notes.edit();
    await Promise.resolve();
    const box = document.querySelector<HTMLElement>('.sh-note-input')!;
    box.focus();
    const range = document.createRange();
    const first = box.querySelector('span')!.firstChild!;
    range.setStart(first, 0); range.setEnd(first, 3);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    box.blur();
    expect(sheet.noteAt(0, 0)?.text).toBe('dry ice');
    expect(sheet.noteAt(0, 0)?.runs).toEqual([{ text: 'dry', bold: true }, { text: ' ice' }]);
  });
});
