// @vitest-environment jsdom
//
// Review batch 19, the References window and its two small windows:
//   F173: every click, arrow key and search keystroke made every row of every file again and counted
//         every file's uses again.
//   F772: custom bibliography text filled itself again while it was being cleared.
//   F773: Insert Citation kept references that Manage References had deleted.
//   F775: Enter and Delete on a focused button ran Edit or Delete instead of the button.
//   F776: dragging a row that was not picked made the list again inside dragstart.
//   F778: Add by DOI could add the reference to another file than the one named.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/ask', () => ({ ask: vi.fn(async () => ({ doi: '10.1000/xyz123' })) }));

import { ReferencesDialog, chooseReferences, editReference, type RefHolder } from '../src/ui/references-dialog';
import { blankRef, type Reference } from '../src/document/references';
import { newDocument } from '../src/document/document';
import { citeFormat } from '../src/document/cite-styles';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); };
(HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView ??= () => {};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const ref = (id: string, title: string, over: Partial<Reference> = {}): Reference => ({ ...blankRef('article', id), title, year: '2020', journal: 'J. Test', authors: ['Doe, Jane'], ...over });

function holder(key: string, name: string, refs: Reference[], counts = { uses: 0 }): RefHolder & { list: Reference[] } {
  const h = {
    key, name, kind: 'Document', list: refs,
    refs: () => h.list,
    setRefs: (_l: string, r: Reference[]) => { h.list = r; },
    citeStyle: () => 'acs' as const, citeOptions: () => undefined, setStyle: () => {},
    uses: () => { counts.uses++; return new Map<string, number>(); },
    useText: () => 'not cited', deleteNote: () => '',
  };
  return h as never;
}
function open(holders: RefHolder[], extra: Partial<ConstructorParameters<typeof ReferencesDialog>[0]> = {}) {
  document.body.replaceChildren();
  const w = new ReferencesDialog({ holders: () => holders, current: () => holders[0].key, flash: () => {}, pickFile: async () => null, ...extra });
  void w.open();
  const d = document.querySelector<HTMLDialogElement>('dialog.refs-dialog')!;
  const rows = () => [...d.querySelectorAll<HTMLTableRowElement>('tr[data-id]')];
  return { w, d, rows };
}

describe('F173 and F776: picking rows does not make the list again', () => {
  it('marks the rows in place, with no recount of uses', () => {
    const counts = { uses: 0 };
    const { d, rows } = open([holder('1', 'A.docx', [ref('a', 'One'), ref('b', 'Two'), ref('c', 'Three')], counts)]);
    const before = rows();
    const n = counts.uses;
    before[1].click();
    expect(rows()[1]).toBe(before[1]); // the very same row
    expect(before[1].classList.contains('picked')).toBe(true);
    // the arrow key moves the pick, also in place
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(before[2].classList.contains('picked')).toBe(true);
    expect(before[1].classList.contains('picked')).toBe(false);
    expect(rows().every((r, i) => r === before[i])).toBe(true);
    expect(counts.uses).toBe(n);
  });
  it('leaves the row in the page when a drag starts on a row that was not picked', () => {
    const { rows } = open([holder('1', 'A.docx', [ref('a', 'One'), ref('b', 'Two')]), holder('2', 'B.docx', [])]);
    const row = rows()[1];
    const e = new Event('dragstart', { bubbles: true }) as Event & { dataTransfer: unknown };
    e.dataTransfer = { setData: () => {}, types: [], effectAllowed: '' };
    row.dispatchEvent(e);
    expect(row.isConnected).toBe(true);
    expect(row.classList.contains('picked')).toBe(true);
  });
  it('waits for a pause in typing to search, and counts the uses anew for it', async () => {
    const h = holder('1', 'A.docx', [ref('a', 'Palladium catalysis'), ref('b', 'Nickel catalysis'), ref('c', 'Boron')]);
    const { d, rows } = open([h]);
    const search = d.querySelector<HTMLInputElement>('input[type=search]')!;
    // a citation is inserted in the document while the window is open (nothing tells the window)
    h.uses = () => new Map([['b', 2]]);
    h.useText = (n: number) => (n ? `cited ${n} times` : 'not cited');
    search.value = 'nick';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows()).toHaveLength(3); // not yet
    await tick(250);
    expect(rows().map((r) => r.dataset.id)).toEqual(['b']);
    expect(rows()[0].textContent).toContain('cited 2 times'); // not the count from before
  });
  it('counts the uses anew when a file is folded', () => {
    const h = holder('1', 'A.docx', [ref('b', 'Nickel catalysis')]);
    const { d, rows } = open([h]);
    h.uses = () => new Map([['b', 3]]);
    h.useText = (n: number) => (n ? `cited ${n} times` : 'not cited');
    const head = () => d.querySelector<HTMLElement>('tr[data-group]')!;
    head().click(); // fold
    expect(rows()).toHaveLength(0);
    head().click(); // show again
    expect(rows()[0].textContent).toContain('cited 3 times');
  });
});

describe('F775: Enter on a button is the button\'s own; the arrows and Delete still work', () => {
  it('does not open Edit Reference when Enter is pressed on a focused button', () => {
    const { d, rows } = open([holder('1', 'A.docx', [ref('a', 'One')])]);
    rows()[0].click();
    const del = [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete…')!;
    del.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(document.querySelector('dialog.ref-edit')).toBeNull();
    // and on the dialog itself it still edits
    d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(document.querySelector('dialog.ref-edit')).not.toBeNull();
    document.querySelector('dialog.ref-edit')!.remove();
  });
  it('still moves the pick with the arrow keys while a button has focus', () => {
    const { d, rows } = open([holder('1', 'A.docx', [ref('a', 'One'), ref('b', 'Two')])]);
    rows()[0].click();
    const edit = [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Edit…')!;
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(rows()[1].classList.contains('picked')).toBe(true);
    expect(rows()[0].classList.contains('picked')).toBe(false);
  });
});

describe('F778: Add by DOI goes to the file it said', () => {
  it('adds to the file picked when it was asked, even if another file was clicked while Crossref answered', async () => {
    const A = holder('1', 'A.docx', [ref('a', 'In A')]);
    const B = holder('2', 'B.docx', [ref('b', 'In B')]);
    let answer!: (r: Reference) => void;
    const lookup = () => new Promise<Reference>((r) => { answer = r; });
    const { d, rows } = open([A, B], { lookup });
    // A's group is the one picked: Add by DOI
    [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Add by DOI…')!.click();
    await tick();
    // while Crossref is answering the person clicks a reference in B
    rows().find((r) => r.dataset.holder === '2')!.click();
    answer(ref('new', 'Fresh from Crossref', { doi: '10.1000/xyz123' }));
    await tick(10);
    const edit = document.querySelector<HTMLDialogElement>('dialog.ref-edit')!;
    expect(edit).not.toBeNull();
    edit.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await tick(10);
    expect(A.list.map((r) => r.title)).toEqual(['In A', 'Fresh from Crossref']);
    expect(B.list.map((r) => r.title)).toEqual(['In B']);
  });
});

describe('F772: custom bibliography text can be cleared', () => {
  it('stays empty while it is cleared, and the reference then uses the automatic text', async () => {
    document.body.replaceChildren();
    const got = editReference(ref('a', 'A title'), 'Edit Reference', citeFormat('acs'), async () => ref('x', 'x'));
    const d = document.querySelector<HTMLDialogElement>('dialog.ref-edit')!;
    const own = d.querySelector<HTMLInputElement>('.ref-own input')!;
    const typed = d.querySelector<HTMLTextAreaElement>('textarea[rows="3"]')!;
    own.checked = true;
    own.dispatchEvent(new Event('change', { bubbles: true }));
    expect(typed.value).not.toBe(''); // the automatic text is offered as a start
    typed.value = '';
    typed.dispatchEvent(new Event('input', { bubbles: true }));
    expect(typed.value).toBe('');
    d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect((await got)!.typed).toBeUndefined();
  });
});

describe('F773: Insert Citation after Manage References', () => {
  it('no longer has a reference that was deleted there checked', async () => {
    const A = ref('a', 'Alpha'), B = ref('b', 'Beta');
    const t = { ...newDocument(), references: [A, B] };
    document.body.replaceChildren();
    const got = chooseReferences(t, [], async () => ({ ...t, references: [B] }));
    const d = document.querySelector<HTMLDialogElement>('dialog.cite-pick')!;
    const box = () => d.querySelector<HTMLInputElement>('.cite-row input')!;
    box().checked = true;
    box().dispatchEvent(new Event('change', { bubbles: true }));
    const insert = [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Insert')!;
    expect(insert.disabled).toBe(false);
    [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Manage References…')!.click();
    await tick(5);
    expect(d.querySelectorAll('.cite-row')).toHaveLength(1);
    expect(insert.disabled).toBe(true);
    box().checked = true;
    box().dispatchEvent(new Event('change', { bubbles: true }));
    d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(await got).toEqual(['b']);
  });
});
