// @vitest-environment jsdom
//
// Review batch 19, File ▸ Drawing Style (the style window):
//   F176: a custom style the window said it saved was thrown away when the window was cancelled.
//   F799: Margin width 0 stayed in the box but the style kept the old margin.

import { describe, expect, it } from 'vitest';
import { editDrawingStyle } from '../src/ui/style-dialog';
import { STYLE_PRESETS } from '../src/drawing-styles';
import type { DocStyle } from '../src/style';

(HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function (this: HTMLDialogElement) { this.open = true; };
(HTMLDialogElement.prototype as unknown as { close: () => void }).close = function (this: HTMLDialogElement) { this.open = false; };
globalThis.requestAnimationFrame ??= ((f: FrameRequestCallback) => setTimeout(() => f(0), 0)) as never;

const base = (): DocStyle => ({ ...STYLE_PRESETS[0].style });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((b) => b.textContent === label)!;
const type = (input: HTMLInputElement, v: string) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
const open = (own: DocStyle[], saveOwn?: (o: DocStyle[]) => void) => {
  document.body.replaceChildren();
  const got = editDrawingStyle({ current: base(), own, kindPlural: 'drawings', where: 'this drawing', isDefault: false, hasStructures: false, ...(saveOwn ? { saveOwn } : {}) });
  const dlg = document.querySelector<HTMLDialogElement>('dialog.style-dialog')!;
  return { got, dlg };
};
const nameBox = (dlg: HTMLElement) => dlg.querySelector<HTMLInputElement>('input[placeholder^="e.g. My group"]')!;

describe('F176: Save keeps the style even when the window is cancelled', () => {
  it('hands the saved style to the program at once', async () => {
    const kept: DocStyle[][] = [];
    const { got, dlg } = open([], (o) => kept.push(o));
    type(nameBox(dlg), 'My group style');
    button('Save').click();
    expect(kept).toHaveLength(1);
    expect(kept[0].map((s) => s.name)).toEqual(['My group style']);
    button('Cancel').click();
    expect(await got).toBeNull();
    // (still kept: the program was told when Save was clicked)
    expect(kept[0][0].name).toBe('My group style');
  });
  it('keeps a delete that Apply has not made final out of what Save hands over', async () => {
    const mine: DocStyle = { ...base(), name: 'Old one' };
    const kept: DocStyle[][] = [];
    const { got, dlg } = open([mine], (o) => kept.push(o));
    // pick the style, delete it (not final yet), then save another
    const pick = dlg.querySelector<HTMLSelectElement>('select')!;
    pick.value = 'own:Old one';
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    button('Delete').click();
    expect(dlg.textContent).toContain('Cancel keeps it');
    type(nameBox(dlg), 'New one');
    button('Save').click();
    expect(kept.at(-1)!.map((s) => s.name).sort()).toEqual(['New one', 'Old one']);
    button('Cancel').click();
    await got;
  });
  it('still returns the changed list on Apply', async () => {
    const { got, dlg } = open([]);
    type(nameBox(dlg), 'Another');
    button('Save').click();
    dlg.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect((await got)!.own.map((s) => s.name)).toEqual(['Another']);
  });
});

describe('F799: a margin width of 0 is applied', () => {
  it('returns 0, not the old margin width', async () => {
    const start = { ...base(), marginWidth: 2 };
    document.body.replaceChildren();
    const got = editDrawingStyle({ current: start, own: [], kindPlural: 'drawings', where: 'this drawing', isDefault: false, hasStructures: false });
    const dlg = document.querySelector<HTMLDialogElement>('dialog.style-dialog')!;
    const margin = [...dlg.querySelectorAll<HTMLLabelElement>('label.md-row')].find((l) => l.textContent!.startsWith('Margin width'))!.querySelector('input')!;
    expect(margin.value).toBe('2');
    type(margin, '0');
    dlg.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect((await got)!.style.marginWidth).toBe(0);
  });
  it('still brings a number below another box\'s range up to the lowest allowed', async () => {
    document.body.replaceChildren();
    const got = editDrawingStyle({ current: base(), own: [], kindPlural: 'drawings', where: 'this drawing', isDefault: false, hasStructures: false });
    const dlg = document.querySelector<HTMLDialogElement>('dialog.style-dialog')!;
    const bond = [...dlg.querySelectorAll<HTMLLabelElement>('label.md-row')].find((l) => l.textContent!.startsWith('Bond length'))!.querySelector('input')!;
    type(bond, '1');
    dlg.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect((await got)!.style.bondLength).toBe(4); // the box's range is 4 to 72
  });
});
