// @vitest-environment jsdom
// Formula style on SI text keeps the bold, italic and underline round it (review of F5, F5b-R04):
// only the numbers and charges are wrapped, where they are.
import { describe, expect, it } from 'vitest';
import { formulaStyleRange } from '../src/ui/si-formula';

function box(html: string): HTMLElement {
  const d = document.createElement('div');
  d.contentEditable = 'true';
  d.innerHTML = html;
  document.body.replaceChildren(d);
  return d;
}
const all = (el: Node) => { const r = document.createRange(); r.selectNodeContents(el); return r; };

describe('SI Formula style (F5b-R04)', () => {
  it('keeps bold, italic and underline on a selection that spans them', () => {
    const d = box('<b><i>CH2Cl2</i></b> <b>with</b> <u>K2CO3</u> base');
    expect(formulaStyleRange(all(d))).toBe(true);
    expect(d.innerHTML).toBe('<b><i>CH<sub>2</sub>Cl<sub>2</sub></i></b> <b>with</b> <u>K<sub>2</sub>CO<sub>3</sub></u> base');
    expect(d.textContent).toBe('CH2Cl2 with K2CO3 base');
    // a charge is raised inside its formatting too
    const ion = box('<b>PF6-</b>');
    formulaStyleRange(all(ion));
    expect(ion.innerHTML).toBe('<b>PF<sub>6</sub><sup>-</sup></b>');
  });

  it('changes only the selected part of a text node', () => {
    const d = box('<b>dried over Na2SO4 and</b>');
    const t = d.querySelector('b')!.firstChild as Text;
    const r = document.createRange();
    r.setStart(t, 'dried over '.length);
    r.setEnd(t, 'dried over Na2SO4'.length);
    formulaStyleRange(r);
    expect(d.innerHTML).toBe('<b>dried over Na<sub>2</sub>SO<sub>4</sub> and</b>');
    // the selection still covers the formula
    expect(r.toString()).toBe('Na2SO4');
  });

  it('leaves text already lowered alone, and says when nothing changed', () => {
    const d = box('CH<sub>2</sub>Cl<sub>2</sub>');
    expect(formulaStyleRange(all(d))).toBe(false);
    expect(d.innerHTML).toBe('CH<sub>2</sub>Cl<sub>2</sub>');
    expect(formulaStyleRange(all(box('<b>with stirring</b>')))).toBe(false);
  });
});
