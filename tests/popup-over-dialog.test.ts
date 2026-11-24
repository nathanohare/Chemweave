// @vitest-environment jsdom
// Laptop bench: in the Orbital window, the Pointing box's list of angles opened under the window,
// greyed by its backdrop. A window opened with showModal() sits in the browser's top layer, above
// every z-index, and the rest of the page can't be clicked; a pop-up added to the page itself is
// drawn under it. Every pop-up that can open from a window goes inside that window (popupHost).

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeCombo } from '../src/ui/combo';
import { showContextMenu, closeContextMenu } from '../src/ui/context-menu';
import { popupHost } from '../src/ui/popup-host';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** An open modal window, as ask() and showDialog() make them. */
function modal(): HTMLDialogElement {
  const d = document.createElement('dialog');
  document.body.append(d);
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  return d;
}

afterEach(() => { closeContextMenu(); document.body.replaceChildren(); });

describe('pop-ups over a window', () => {
  it("a typed box's drop-down list opens inside its window", async () => {
    const d = modal();
    const dl = document.createElement('datalist');
    dl.id = 'angles';
    for (const v of ['Auto', '0', '45']) dl.append(new Option(v));
    const input = document.createElement('input');
    input.setAttribute('list', 'angles');
    d.append(input, dl);
    makeCombo(input);
    input.focus();
    await tick();
    const list = document.querySelector('.combo-list');
    expect(list).not.toBeNull();
    expect(list!.parentElement).toBe(d);
  });

  it('a drop-down list outside any window still goes on the page', async () => {
    const dl = document.createElement('datalist');
    dl.id = 'sizes';
    dl.append(new Option('11'));
    const input = document.createElement('input');
    input.setAttribute('list', 'sizes');
    document.body.append(input, dl);
    makeCombo(input);
    input.focus();
    await tick();
    expect(document.querySelector('.combo-list')!.parentElement).toBe(document.body);
  });

  it('a right-click menu opened while a modal window is up goes inside it', () => {
    const d = modal();
    const box = document.createElement('input');
    d.append(box);
    box.focus();
    showContextMenu(10, 10, [{ cmd: 'cut', label: 'Cut' }], { run: () => {}, key: () => undefined });
    expect(document.querySelector('.context-menu')!.parentElement).toBe(d);
  });

  it('popupHost picks the window an element is in, else the page', () => {
    const d = modal();
    const inner = document.createElement('span');
    d.append(inner);
    expect(popupHost(inner)).toBe(d);
    expect(popupHost(document.createElement('span'))).toBe(d.matches(':modal') ? d : document.body);
  });

  it('pop-up code never adds a drop-down list or menu straight to the page', () => {
    // the shared pop-ups that open from windows: each must ask popupHost (or its own window) where to go
    for (const f of ['combo.ts', 'context-menu.ts', 'popup-menu.ts']) {
      const src = readFileSync(resolve('src/ui', f), 'utf8');
      expect(src, f).toMatch(/popupHost\(/);
      expect(src, f).not.toMatch(/document\.body\.append(Child)?\(/);
    }
    expect(readdirSync(resolve('src/ui'))).toContain('popup-host.ts');
  });
});
