// @vitest-environment jsdom
//
// Review batch 19, the Style panel:
//   F802: the Charge and point-of-attachment Number boxes stored a fraction typed into them.
//   F804: Expected Count ▸ Other… left a bare number box in place of the list when the offered number
//         was accepted without being changed.
//
// (Plumbing tests: the numbers are invented; none is chemistry from a source.)

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { StylePanel } from '../src/ui/style-panel';
import type { Selection } from '../src/editor/editor';
import { countElectrons } from '../src/chem/electrons';

const sel = (atoms: Iterable<number>): Selection => ({ atoms: new Set(atoms), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() }) as Selection;
function panel(doc: Doc, atoms: Iterable<number>) {
  const section = document.createElement('section'), body = document.createElement('div');
  section.append(Object.assign(document.createElement('h2'), { textContent: 'Style' }));
  document.body.replaceChildren(section, body);
  const ids = [...atoms];
  const p = new StylePanel(section, body, doc, () => sel(ids), () => p.refresh());
  p.refresh(true);
  return { p, body };
}
const row = (body: HTMLElement, name: string) => [...body.querySelectorAll('.style-row')].find((r) => r.firstElementChild?.firstChild?.textContent === name)!;
const change = (el: HTMLElement) => el.dispatchEvent(new Event('change', { bubbles: true }));

describe('F802: whole-number boxes keep whole numbers', () => {
  it('rounds a charge typed with a fraction', () => {
    const doc = new Doc();
    const id = doc.edit('a', () => doc.addAtom(0, 0, 7).id);
    const { body } = panel(doc, [id]);
    const q = row(body, 'Charge').querySelector('input')!;
    q.value = '1.6';
    change(q);
    expect(doc.atoms.get(id)!.charge).toBe(2);
    expect(Number.isInteger(doc.atoms.get(id)!.charge)).toBe(true);
  });
  it('rounds the number of a point of attachment', () => {
    const doc = new Doc();
    const id = doc.edit('a', () => doc.addAtom(0, 0, 6, { attach: 'Unspecified', attachNum: 1 }).id);
    const { body } = panel(doc, [id]);
    const n = row(body, 'Number').querySelector('input')!;
    n.value = '2.4';
    change(n);
    expect(doc.atoms.get(id)!.attachNum).toBe(2);
  });
});

describe('F804: Expected Count ▸ Other… takes the number offered', () => {
  function rhodium() {
    const doc = new Doc();
    const m = doc.edit('m', () => {
      const metal = doc.addAtom(0, 0, 45);
      [['PPh3', 0], ['PPh3', 2], ['PPh3', 4], ['Cl', 5]].forEach(([l, i]) => { const a = (Number(i) / 6) * 2 * Math.PI; doc.addBond(metal.id, doc.addAtom(30 * Math.cos(a), 30 * Math.sin(a), 6, { label: String(l) }).id); });
      return metal.id;
    });
    return { doc, m, ...panel(doc, doc.fragmentOf(m)) };
  }
  const openOther = (body: HTMLElement) => {
    const exp = row(body, 'Expected Count').querySelector('select')!;
    exp.value = 'other';
    change(exp);
    return row(body, 'Expected Count').querySelector<HTMLInputElement>('input[type=number]')!;
  };

  it('stores the number and puts the list back when Enter is pressed without a change', () => {
    const { doc, m, body } = rhodium();
    expect(countElectrons(doc, m)[0].expected.value).toBe(16); // (an invented complex; the offered number is whatever is shown)
    const n = openOther(body);
    const offered = Number(n.value);
    n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(doc.atoms.get(m)!.ecount?.expect).toBe(offered);
    expect(row(body, 'Expected Count').querySelector('input[type=number]')).toBeNull();
    expect(row(body, 'Expected Count').querySelector('select')).not.toBeNull();
  });
  it('puts the list back when the box is clicked away from unchanged', () => {
    const { doc, m, body } = rhodium();
    const n = openOther(body);
    n.focus();
    n.blur();
    expect(row(body, 'Expected Count').querySelector('input[type=number]')).toBeNull();
    expect(row(body, 'Expected Count').querySelector('select')).not.toBeNull();
    expect(doc.atoms.get(m)!.ecount?.expect).toBe(16);
  });
  it('takes nothing on Escape', () => {
    const { doc, m, body } = rhodium();
    const n = openOther(body);
    n.value = '12';
    n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(doc.atoms.get(m)!.ecount?.expect).toBeUndefined();
    expect(row(body, 'Expected Count').querySelector('select')).not.toBeNull();
  });
});
