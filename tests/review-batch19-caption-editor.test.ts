// @vitest-environment jsdom
//
// Review batch 19, text typed on a turned caption (F678): the right-click menu for a formatting slip
// (or a misspelled word) found the word from the unturned point, so a caption turned 90° offered
// nothing, or the fix for another word.

import { describe, expect, it } from 'vitest';
import { CaptionEditor, type EditorHost } from '../src/ui/caption-editor';
import { turnAbout } from '../src/geom';
import { setTypingPrefs } from '../src/text/typing';

function open(turn: number) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const h: EditorHost = { host, view: { scale: 1 }, toScreen: (p) => p, measure: (t, size) => t.length * size * 0.5, defaultSize: 10, redraw: () => {} };
  const ed = new CaptionEditor(h, { x: 0, y: 0 }, { runs: [{ text: 'H2O and NH3' }] }, {}, () => {}, turn);
  ed.ed.setCaret(5); // between the two formulas, so neither counts as still being typed
  return ed;
}
const menu = () => [...document.querySelectorAll<HTMLButtonElement>('.text-menu button')].map((b) => b.textContent);

describe('F678: the right-click menu on turned text', () => {
  it('offers the fix for the formula under the pointer, as it does for text that is not turned', () => {
    setTypingPrefs({ spelling: true });
    // the point is on "NH3" (characters 8 to 11); each character is 5 points wide (size 10 × 0.5)
    const local = { x: 47.5, y: -3 };
    const plain = open(0);
    plain.contextMenu(local, 0, 0);
    const wanted = menu();
    expect(wanted.some((t) => /change to NH₃/.test(t ?? ''))).toBe(true);
    document.querySelectorAll('.text-menu').forEach((m) => m.remove());
    const turned = open(90);
    // the same place on the page after the caption is turned 90° clockwise about where it starts
    turned.contextMenu(turnAbout(local, { x: 0, y: 0 }, 90), 0, 0);
    expect(menu()).toEqual(wanted); // the fix for NH₃, not for H₂O
  });
});
