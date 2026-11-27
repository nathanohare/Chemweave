// @vitest-environment jsdom
//
// Review batch 19, Insert ▸ Reference… (F720): a reference checked before Manage References and then
// deleted there stayed picked with no row to clear, and Insert placed it; one edited there was
// inserted in its old wording.

import { describe, expect, it } from 'vitest';
import { chooseRefsToInsert, type RefGroup } from '../src/ui/insert-ref-dialog';
import { blankRef, type Reference } from '../src/document/references';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; };

const ref = (id: string, title: string): Reference => ({ ...blankRef('article', id), title, year: '2020' });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('F720: Manage References and what was checked', () => {
  it('drops a reference deleted there and inserts an edited one as it is now', async () => {
    const A = ref('a', 'Alpha paper'), B = ref('b', 'Beta paper'), C = ref('c', 'Gamma paper');
    const B2 = { ...B, title: 'Beta paper, corrected' };
    document.body.replaceChildren();
    const got = chooseRefsToInsert([{ name: 'File', refs: [A, B, C] }],
      async () => null,
      async (): Promise<RefGroup[]> => [{ name: 'File', refs: [B2, C] }]); // A deleted, B edited (a new object)
    const d = document.querySelector<HTMLDialogElement>('dialog.insert-refs-dialog')!;
    const boxes = () => [...d.querySelectorAll<HTMLInputElement>('.slide-refs-row input')];
    for (const b of boxes().slice(0, 2)) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); } // A and B
    [...d.querySelectorAll<HTMLButtonElement>('.ask-buttons button')].find((b) => b.textContent === 'Manage References…')!.click();
    await tick();
    expect(boxes()).toHaveLength(2);
    expect(boxes().map((b) => b.checked)).toEqual([true, false]); // B (as edited) still checked, C not
    expect(d.querySelector('.slide-refs-preview')!.textContent).toContain('Beta paper, corrected');
    expect(d.querySelector('.slide-refs-preview')!.textContent).not.toContain('Alpha');
    d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    const r = (await got)!;
    expect(r.refs).toEqual([B2]);
    expect(r.refs[0]).toBe(B2);
  });
  it('comes back to the window when Manage References fails', async () => {
    const A = ref('a', 'Alpha paper');
    document.body.replaceChildren();
    const got = chooseRefsToInsert([{ name: 'File', refs: [A] }], async () => null, async () => { throw new Error('no'); });
    const d = document.querySelector<HTMLDialogElement>('dialog.insert-refs-dialog')!;
    d.querySelector<HTMLInputElement>('.slide-refs-row input')!.click();
    [...d.querySelectorAll<HTMLButtonElement>('.ask-buttons button')].find((b) => b.textContent === 'Manage References…')!.click();
    await tick();
    expect(d.open).toBe(true);
    expect(d.querySelectorAll('.slide-refs-row')).toHaveLength(1);
    [...d.querySelectorAll<HTMLButtonElement>('.ask-buttons button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(await got).toBeNull();
  });
  it('keeps a reference with the file it came from when two files have the same name and ids', async () => {
    const first = ref('r1', 'From the first file'), second = ref('r1', 'From the second file');
    const second2 = { ...second, title: 'From the second file, corrected' };
    document.body.replaceChildren();
    const got = chooseRefsToInsert([{ key: '1', name: 'Untitled', refs: [first] }, { key: '2', name: 'Untitled', refs: [second] }],
      async () => null,
      async (): Promise<RefGroup[]> => [{ key: '1', name: 'Untitled', refs: [first] }, { key: '2', name: 'Untitled', refs: [second2] }]);
    const d = document.querySelector<HTMLDialogElement>('dialog.insert-refs-dialog')!;
    const boxes = () => [...d.querySelectorAll<HTMLInputElement>('.slide-refs-row input')];
    boxes()[1].checked = true; // the second file's reference
    boxes()[1].dispatchEvent(new Event('change', { bubbles: true }));
    [...d.querySelectorAll<HTMLButtonElement>('.ask-buttons button')].find((b) => b.textContent === 'Manage References…')!.click();
    await tick();
    expect(boxes().map((b) => b.checked)).toEqual([false, true]);
    d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    const r = (await got)!;
    expect(r.refs).toEqual([second2]);
  });
});
