// @vitest-environment jsdom
// The structure card that shows while the pointer rests on a compound's name (Solvents, pKa Values)
// never gets stuck: redrawing the rows (a filter picked), a click, a focus change, scrolling and
// Escape all put it away.

import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeBaseWindow, type KnowledgeBaseHost } from '../src/ui/knowledge-base';

const host: KnowledgeBaseHost = {
  flash: () => {}, readImported: async () => null, writeImported: async () => {}, pickTable: async () => null, copyText: async () => {}, openUrl: () => {},
  canonical: async () => null, contains: async () => [],
};

async function openOn(title: string): Promise<KnowledgeBaseWindow> {
  if (!HTMLDialogElement.prototype.show) HTMLDialogElement.prototype.show = function () { this.open = true; };
  // jsdom lays nothing out: a range has no box to place the card by
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  const kb = new KnowledgeBaseWindow(host);
  await kb.open();
  [...document.querySelectorAll<HTMLButtonElement>('.kb-window .kb-tab')].find((b) => b.firstElementChild?.textContent === title)!.click();
  return kb;
}

const pop = () => document.querySelector('.kb-structure-pop');
const rest = () => {
  const name = document.querySelector<HTMLElement>('.kb-window td.kb-structure-name')!;
  name.dispatchEvent(new Event('pointerenter'));
  return name;
};

describe('the structure card beside a name', { timeout: 30000 }, () => {
  afterEach(() => { document.body.replaceChildren(); });

  it('shows while the pointer rests on the name and goes when it leaves', async () => {
    await openOn('pKa Values');
    const name = rest();
    expect(pop()).not.toBeNull();
    name.dispatchEvent(new Event('pointerleave'));
    expect(pop()).toBeNull();
  });

  it('goes when a filter redraws the rows under it (the name never gets its pointerleave)', async () => {
    await openOn('pKa Values');
    rest();
    expect(pop()).not.toBeNull();
    const select = [...document.querySelectorAll<HTMLSelectElement>('.kb-window .kb-filters select')].at(-1)!;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    expect(pop()).toBeNull();
    expect(document.querySelectorAll('.kb-structure-pop')).toHaveLength(0);
  });

  it('goes on a click, a focus change, a scroll and Escape', async () => {
    await openOn('pKa Values');
    const d = document.querySelector<HTMLElement>('.kb-window')!;
    const wrap = document.querySelector<HTMLElement>('.kb-window .kb-table-wrap')!;
    const select = document.querySelector<HTMLSelectElement>('.kb-window .kb-filters select')!;
    for (const away of [
      () => select.dispatchEvent(new Event('pointerdown', { bubbles: true })),
      () => select.dispatchEvent(new FocusEvent('focusin', { bubbles: true })),
      () => wrap.dispatchEvent(new Event('scroll')),
      () => d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
      () => window.dispatchEvent(new Event('blur')),
    ]) {
      rest();
      expect(pop()).not.toBeNull();
      away();
      expect(pop()).toBeNull();
    }
  });

  it('goes when the window closes', async () => {
    const kb = await openOn('Solvents');
    rest();
    expect(pop()).not.toBeNull();
    kb.close();
    expect(pop()).toBeNull();
  });
});
