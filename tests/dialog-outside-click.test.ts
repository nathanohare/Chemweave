// @vitest-environment jsdom
// Nate (2026-11-25): clicking outside a window should close it when nothing in it was changed,
// with no question; when something was changed, ask whether to discard the changes or keep
// working. Every window opened with showModal() gets this (src/ui/outside-click.ts, through
// src/ui/modal-guard.ts); windows showing work in progress are left open.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Guard = typeof import('../src/ui/modal-guard');
type Outside = typeof import('../src/ui/outside-click');
let g: Guard;
let o: Outside;

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  // jsdom has no showModal: a stand-in that opens the window as the browser's would
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void };
  if (typeof proto.showModal !== 'function') {
    // (as a browser does, opening puts the cursor in the window's first field)
    proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); this.querySelector('input, select')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); };
    proto.show = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    proto.close = function (this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
  g = await import('../src/ui/modal-guard');
  g.installModalGuard();
  o = await import('../src/ui/outside-click');
});

afterEach(() => {
  for (const d of document.querySelectorAll('dialog')) d.close();
  document.body.replaceChildren();
});

/** A window like the Orbital one: a list, a typed box and a tick box, Cancel and Insert. */
function orbital(): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.innerHTML = '<form method="dialog"><h2>Orbital<button class="info-tip" type="button">i</button></h2>'
    + '<select name="kind"><option>p</option><option>d</option></select>'
    + '<input name="rot" value="Auto"><label><input type="checkbox" name="swap"> Swap the phases</label>'
    + '<p class="ask-buttons"><button value="cancel">Cancel</button><button value="ok">Insert</button></p></form>';
  // (jsdom lays nothing out: the window's box, as a browser would place it)
  d.getBoundingClientRect = () => new DOMRect(300, 100, 400, 300);
  document.body.append(d);
  d.showModal();
  return d;
}

/** A click as the browser sends it: press and release at a point, aimed at `on`. */
function clickAt(on: Element, x: number, y: number): void {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    on.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }
}
/** A click on the dimmed program beside the window (the browser aims it at the window itself). */
const clickOutside = (d: HTMLDialogElement) => clickAt(d, 20, 20);

/** Go to a field and change it, as a person would. */
function edit(el: HTMLInputElement | HTMLSelectElement, change: () => void): void {
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  change();
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const question = () => [...document.querySelectorAll('dialog[open]')].find((x) => x.querySelector('h2')?.textContent === 'Discard Changes?');

describe('clicking outside a window', () => {
  it('closes it at once when nothing in it was changed, running its own Cancel', async () => {
    const d = orbital();
    let cancelled = 0;
    d.addEventListener('cancel', () => cancelled++);
    // (going to a field without changing it isn't a change)
    d.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    clickOutside(d);
    await tick();
    expect(question()).toBeUndefined();
    expect(cancelled).toBe(1);
    expect(d.open).toBe(false);
  });

  it('a click inside the window, or on its padding, leaves it open', async () => {
    const d = orbital();
    clickAt(d.querySelector('h2')!, 400, 120);
    clickAt(d, 310, 110);
    await tick();
    expect(d.open).toBe(true);
  });

  it('a press inside that is let go outside (selecting text) leaves it open', async () => {
    const d = orbital();
    d.querySelector('h2')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 120 }));
    d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    await tick();
    expect(d.open).toBe(true);
  });

  it('asks first when a field was changed; Keep Working leaves it open with the change', async () => {
    const d = orbital();
    const rot = d.querySelector<HTMLInputElement>('input[name="rot"]')!;
    edit(rot, () => { rot.value = '45'; });
    clickOutside(d);
    await tick();
    const q = question();
    expect(q).toBeDefined();
    expect(q!.textContent).toContain('You changed something in Orbital.');
    const keep = [...q!.querySelectorAll('button')].find((b) => b.textContent === 'Keep Working')!;
    expect(keep.classList.contains('primary')).toBe(true);
    keep.click();
    await tick();
    expect(d.open).toBe(true);
    expect(rot.value).toBe('45');
  });

  it('Discard closes the window through its own Cancel', async () => {
    const d = orbital();
    let cancelled = 0;
    d.addEventListener('cancel', () => cancelled++);
    const kind = d.querySelector('select')!;
    edit(kind, () => { kind.selectedIndex = 1; });
    clickOutside(d);
    await tick();
    [...question()!.querySelectorAll('button')].find((b) => b.textContent === 'Discard')!.click();
    await tick();
    expect(cancelled).toBe(1);
    expect(d.open).toBe(false);
  });

  it('a change put back as it was is no change: no question', async () => {
    const d = orbital();
    const box = d.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    edit(box, () => { box.checked = true; });
    edit(box, () => { box.checked = false; });
    clickOutside(d);
    await tick();
    expect(question()).toBeUndefined();
    expect(d.open).toBe(false);
  });

  it('a tick box ticked by its label counts as a change', async () => {
    const d = orbital();
    const label = d.querySelector('label')!;
    label.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (label.control as HTMLInputElement).checked = true;
    clickOutside(d);
    await tick();
    expect(question()).toBeDefined();
  });

  it('a window can say it was changed in a way its fields do not show', async () => {
    const d = orbital();
    o.markDialogChanged(d);
    clickOutside(d);
    await tick();
    expect(question()).toBeDefined();
  });

  it('values filled in by the program after the window opened are not changes', async () => {
    const d = orbital();
    d.querySelector<HTMLInputElement>('input[name="rot"]')!.value = '90';
    clickOutside(d);
    await tick();
    expect(question()).toBeUndefined();
    expect(d.open).toBe(false);
  });

  it('a window opened again starts with no changes', async () => {
    const d = orbital();
    const rot = d.querySelector<HTMLInputElement>('input[name="rot"]')!;
    edit(rot, () => { rot.value = '45'; });
    d.close();
    d.showModal();
    clickOutside(d);
    await tick();
    expect(question()).toBeUndefined();
    expect(d.open).toBe(false);
  });

  it('a window showing work in progress stays open', async () => {
    const d = orbital();
    d.dataset.outsideClick = 'keep';
    let cancelled = 0;
    d.addEventListener('cancel', () => cancelled++);
    clickOutside(d);
    await tick();
    expect(cancelled).toBe(0);
    expect(d.open).toBe(true);
  });

  it('a window that asks about its own changes is not asked about twice', async () => {
    const d = orbital();
    d.dataset.outsideClick = 'cancel';
    // (Settings: its Cancel asks, so it keeps the window open itself)
    let cancelled = 0;
    d.addEventListener('cancel', (e) => { cancelled++; e.preventDefault(); });
    const rot = d.querySelector<HTMLInputElement>('input[name="rot"]')!;
    edit(rot, () => { rot.value = '45'; });
    clickOutside(d);
    await tick();
    expect(question()).toBeUndefined();
    expect(cancelled).toBe(1);
    expect(d.open).toBe(true);
  });

  it('a click outside while a drop-down list is open closes only the list', async () => {
    const d = orbital();
    const list = document.createElement('div');
    list.className = 'combo-list';
    d.append(list);
    clickOutside(d);
    await tick();
    expect(d.open).toBe(true);
  });

  it('the question itself closes on a click outside, keeping the window and its changes', async () => {
    const d = orbital();
    const rot = d.querySelector<HTMLInputElement>('input[name="rot"]')!;
    edit(rot, () => { rot.value = '45'; });
    clickOutside(d);
    await tick();
    const q = question() as HTMLDialogElement;
    q.getBoundingClientRect = () => new DOMRect(400, 200, 200, 100);
    clickOutside(q);
    await tick();
    expect(question()).toBeUndefined();
    expect(d.open).toBe(true);
    expect(rot.value).toBe('45');
  });

  it('a window only shown (not modal) is left alone', async () => {
    const d = document.createElement('dialog');
    d.getBoundingClientRect = () => new DOMRect(300, 100, 400, 300);
    document.body.append(d);
    d.show();
    clickOutside(d);
    await tick();
    expect(d.open).toBe(true);
  });

  it('progress windows are marked to stay open, and Settings asks about its own changes', () => {
    for (const f of ['src/ui/si-progress.ts', 'src/ui/si-import-dialog.ts', 'src/ui/import-structures.ts']) {
      expect(readFileSync(resolve(f), 'utf8'), f).toMatch(/dataset\.outsideClick = 'keep'/);
    }
    expect(readFileSync(resolve('src/ui/settings-window.ts'), 'utf8')).toMatch(/dataset\.outsideClick = 'cancel'/);
    expect(readFileSync(resolve('src/ui/modal-guard.ts'), 'utf8')).toMatch(/watchOutsideClick\(this, !this\.open\);\s*own\.call\(this\);/);
  });
  it("a pick from a box's drop-down list in the field the window opened in counts as a change", async () => {
    const d = orbital();
    // (the first field had the cursor from the start; the list's pick is set by the program)
    const kind = d.querySelector('select')!;
    kind.selectedIndex = 1;
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    clickOutside(d);
    await tick();
    expect(question()).toBeDefined();
  });

  it('a changed row that the window rebuilt is still a change', async () => {
    const d = orbital();
    const rot = d.querySelector<HTMLInputElement>('input[name="rot"]')!;
    edit(rot, () => { rot.value = '45'; });
    // (TLC Plate: + Spot redraws the table, replacing every box)
    const fresh = document.createElement('input');
    fresh.value = '45';
    rot.replaceWith(fresh);
    clickOutside(d);
    await tick();
    expect(question()).toBeDefined();
  });

  it('a window opened again while still open keeps its changes', async () => {
    const d = orbital();
    const rot = d.querySelector<HTMLInputElement>('input[name="rot"]')!;
    edit(rot, () => { rot.value = '45'; });
    d.showModal();
    clickOutside(d);
    await tick();
    expect(question()).toBeDefined();
  });

  it('a color palette that closes itself as the press begins still keeps the window open', async () => {
    const d = orbital();
    const pop = document.createElement('div');
    pop.className = 'colour-pop';
    d.append(pop);
    // (as colour-picker.ts does: a capturing listener on the page takes the palette away first)
    const shut = () => pop.remove();
    document.addEventListener('pointerdown', shut, true);
    clickOutside(d);
    document.removeEventListener('pointerdown', shut, true);
    await tick();
    expect(pop.isConnected).toBe(false);
    expect(d.open).toBe(true);
  });

  it('a right-button press on the backdrop is not a click outside', async () => {
    const d = orbital();
    d.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2, clientX: 20, clientY: 20 }));
    d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    await tick();
    expect(d.open).toBe(true);
  });

  it('typing in a search box is not a change', async () => {
    const d = orbital();
    const find = document.createElement('input');
    find.type = 'search';
    d.querySelector('form')!.prepend(find);
    edit(find, () => { find.value = 'benzene'; });
    clickOutside(d);
    await tick();
    expect(question()).toBeUndefined();
    expect(d.open).toBe(false);
  });

  it('buttons that change something count; Cancel, Close, an "i", a tab or a fold do not', () => {
    const b = (html: string) => { const box = document.createElement('div'); box.innerHTML = html; return box.firstElementChild as HTMLElement; };
    for (const yes of ['<button>+ Spot</button>', '<button>Delete</button>', '<button class="colour-cell" aria-label="Red"></button>', '<button aria-pressed="false">Ball and Stick</button>']) {
      expect(o.changingButton(b(yes)), yes).toBe(true);
    }
    for (const no of ['<button>Cancel</button>', '<button>Close</button>', '<button aria-label="Close">×</button>', 
      '<button class="info-icon">i</button>', '<button role="tab">Style</button>', '<button aria-expanded="false">More</button>', '<button data-no-change>Copy</button>']) {
      expect(o.changingButton(b(no)), no).toBe(false);
    }
    const form = document.createElement('form');
    form.innerHTML = '<button type="submit">Insert</button>';
    expect(o.changingButton(form.querySelector('button')!)).toBe(false);
  });

  it('Send Feedback keeps its draft when closed, so it closes without asking', () => {
    expect(readFileSync(resolve('src/ui/feedback-dialog.ts'), 'utf8')).toMatch(/dataset\.outsideClick = 'cancel'/);
  });
});
