// @vitest-environment jsdom
//
// What made an unchanged save differ from the file opened (standing rule R2): an RXN file written
// here was laid out afresh on opening, moving the products; a one-line text saved as CDXML with no
// line height came back as ChemDraw's variable spacing; and a drawing kept in a PowerPoint slide
// was merged in again with its shapes before its arrows, so their ids (and the CDXML's element
// ids) swapped. Drawings are built here in code.

import { describe, it, expect } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { readRxnFile, sceneToDoc, writeRxnFile } from '../src/io/chem-formats';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { mergeDrawing } from '../src/io/ole-kept';

const ARROW: Omit<Arrow, 'id'> = { tail: { x: 180, y: 95 }, head: { x: 270, y: 95 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 };

/** Ethanol to acetaldehyde, drawn far apart. */
function reaction(): Doc {
  const d = new Doc();
  d.edit('Draw', () => {
    const L = d.style.bondLength;
    const c1 = d.addAtom(100, 100).id, c2 = d.addAtom(100 + L * 0.866, 100 - L / 2).id, o1 = d.addAtom(100 + L * 1.732, 100, 8).id;
    d.addBond(c1, c2); d.addBond(c2, o1);
    const d1 = d.addAtom(300, 100).id, d2 = d.addAtom(300 + L * 0.866, 100 - L / 2).id, o2 = d.addAtom(300 + L * 1.732, 100, 8).id;
    d.addBond(d1, d2); d.addBond(d2, o2, 2);
    d.addArrow({ ...ARROW, step: { reactants: [`a${c1}`], products: [`a${d1}`], above: [], below: [] } });
  });
  return d;
}

const reopen = (text: string, style: Doc['style']) => sceneToDoc(readRxnFile(text)!, style).doc;

describe('an RXN file written here (R2)', () => {
  it('opens with its molecules where they were, and saves the same', () => {
    const d = reaction();
    const first = writeRxnFile(d).text;
    const back = reopen(first, d.style);
    // (the same places, wherever the drawing as a whole is put on opening)
    const places = (t: string) => {
      const xy = [...t.matchAll(/^\s+(-?\d+\.\d{4})\s+(-?\d+\.\d{4})\s+0\.0000 /gm)].map((m) => [Number(m[1]), Number(m[2])]);
      return xy.map(([x, y]) => [+(x - xy[0][0]).toFixed(3), +(y - xy[0][1]).toFixed(3)]);
    };
    expect(places(writeRxnFile(back).text)).toEqual(places(first));
    expect(places(first)).toHaveLength(6);
    // the arrow between them
    const r = [...back.arrows.values()][0];
    const xs = [...back.atoms.values()].map((a) => a.x).sort((a, b) => a - b);
    expect(r.tail.x).toBeGreaterThan(xs[2]);
    expect(r.head.x).toBeLessThan(xs[3]);
  });
  it('is laid out afresh when its molecules overlap', () => {
    const d = reaction();
    // the product moved on top of the starting material
    d.edit('Move', () => { for (const a of [...d.atoms.values()].slice(3)) d.updateAtom(a.id, { x: a.x - 200 }); });
    const back = reopen(writeRxnFile(d).text, d.style);
    const atoms = [...back.atoms.values()];
    expect(Math.min(...atoms.slice(3).map((a) => a.x))).toBeGreaterThan(Math.max(...atoms.slice(0, 3).map((a) => a.x)));
  });
});

describe('a one-line text saved as CDXML (R2)', () => {
  it('does not come back with ChemDraw\'s variable spacing', () => {
    const d = new Doc();
    d.bulk(() => d.addCaption({ x: 0, y: 0, runs: [{ text: 'CH2Cl2, 25 °C' }], justify: 'left' }));
    const c = [...readCdxml(writeCdxml(d)).doc.captions.values()][0];
    expect(c.inkLines).toBeUndefined();
  });
  it('keeps ChemDraw\'s variable spacing where it had it', () => {
    const d = new Doc();
    d.bulk(() => d.addCaption({ x: 0, y: 0, runs: [{ text: 'one line' }], justify: 'left', inkLines: true }));
    expect([...readCdxml(writeCdxml(d)).doc.captions.values()][0].inkLines).toBe(true);
  });
});

describe('a drawing merged into another', () => {
  it('keeps its texts, shapes and arrows in their own order', () => {
    const src = new Doc();
    src.bulk(() => {
      src.addCaption({ x: 0, y: 0, runs: [{ text: 'a' }], justify: 'left' });
      src.addArrow({ ...ARROW });
      src.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 10, y2: 10 });
      src.addCaption({ x: 0, y: 20, runs: [{ text: 'b' }], justify: 'left' });
    });
    const order = (d: Doc) => [...d.captions.values(), ...d.arrows.values(), ...d.shapes.values()].sort((a, b) => a.id - b.id).map((o) => ('runs' in o ? 'c' : 'tail' in o ? 'r' : 's'));
    const into = new Doc();
    into.bulk(() => mergeDrawing(into, src, (p) => p));
    expect(order(into)).toEqual(order(src));
  });
});
