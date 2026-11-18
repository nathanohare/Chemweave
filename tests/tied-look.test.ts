// @vitest-environment jsdom
//
// ID labels and linked captions take their look and place from the drawing style (Nate's feature
// list, Captions and IDs): new ones are made in it, linked text is given it as if made as a label,
// a new style passes it on to labels that still have the old one, and it is saved in CDXML.

import { describe, it, expect } from 'vitest';
import { Doc, type Caption } from '../src/model';
import type { Measure } from '../src/editor/arrange';
import { POINTS } from '../src/editor/arrange';
import { placeAttached, refitAttached, structureBox } from '../src/editor/attached';
import { cleanTiedLook, fullLook, lookCaption, lookPatch, lookRuns, looksLikeId, restyleTied } from '../src/editor/tied-look';
import { applyStyle, cleanStyle, sameLook, scaleStyle } from '../src/drawing-styles';
import { writeCdxml } from '../src/io/cdxml-write';
import { setFocal } from '../src/chem/focal';
import { readCdxml } from '../src/io/cdxml';

// captions 4 pt a letter wide and 8 pt high, so lining up edges shows
const M: Measure = { ...POINTS, captionBox: (c: Caption) => ({ x1: c.x, y1: c.y, x2: c.x + 4 * c.runs.map((r) => r.text).join('').length, y2: c.y + 8 }) };

function chain(): { doc: Doc; atoms: number[] } {
  const doc = new Doc();
  doc.beforeCommit = (before) => refitAttached(doc, before, M);
  const atoms: number[] = [];
  doc.edit('Draw', () => {
    const a = doc.addAtom(0, 0), b = doc.addAtom(30, 0), c = doc.addAtom(30, 12);
    doc.addBond(a.id, b.id);
    doc.addBond(b.id, c.id);
    atoms.push(a.id, b.id, c.id);
  });
  return { doc, atoms };
}

describe('the look a drawing style gives tied text', () => {
  it('is the usual one when the style sets nothing: ID labels bold, all centered a third of a bond below', () => {
    const { doc, atoms } = chain();
    const id = lookCaption(doc, 'label', atoms, [{ text: '12' }]);
    expect(id.runs).toEqual([{ text: '12', bold: true }]);
    expect(id.justify).toBe('center');
    expect(id.attach).toEqual({ atoms, side: 'below', gap: Math.round(doc.style.bondLength * 3) / 10, shift: 0, role: 'label' });
    const cap = lookCaption(doc, 'caption', atoms, [{ text: 'crude' }]);
    expect(cap.runs).toEqual([{ text: 'crude' }]);
  });

  it('gives new labels the style\'s font, size, color, side, gap and alignment', () => {
    const { doc, atoms } = chain();
    doc.style = { ...doc.style, idLook: { font: 'Helvetica', size: 9, bold: false, italic: true, color: '#aa0000', side: 'above', align: 'left', gap: 6 } };
    const id = lookCaption(doc, 'label', atoms, [{ text: '3a' }]);
    expect(id.runs).toEqual([{ text: '3a', font: 'Helvetica', size: 9, italic: true, color: '#aa0000' }]);
    expect(id.justify).toBe('left');
    expect(id.attach).toMatchObject({ side: 'above', gap: 6, shift: 0, align: 'left' });
    // a font and size the same as the captions' are left to follow them
    doc.style = { ...doc.style, idLook: { font: doc.style.captionFont, size: doc.style.captionSize } };
    expect(lookCaption(doc, 'label', atoms, [{ text: '3a' }]).runs).toEqual([{ text: '3a', bold: true }]);
    // beside the structure, the lines line up towards it
    doc.style = { ...doc.style, tiedLook: { side: 'right', align: 'center' } };
    const side = lookCaption(doc, 'caption', atoms, [{ text: 'x' }]);
    expect(side.justify).toBe('left');
    expect(side.attach.align).toBeUndefined();
  });

  it('sits where the style says once placed', () => {
    const { doc, atoms } = chain();
    doc.style = { ...doc.style, idLook: { align: 'left', gap: 7 } };
    let id = 0;
    doc.edit('Label', () => { const c = doc.addCaption(lookCaption(doc, 'label', atoms, [{ text: '15' }])); placeAttached(doc, c, M); id = c.id; });
    const s = structureBox(doc, new Set(atoms), M)!, b = M.captionBox(doc.captions.get(id)!);
    expect(b.x1).toBeCloseTo(s.x1, 6);
    expect(b.y1).toBeCloseTo(s.y2 + 7, 6);
  });

  it('replaces the whole-text font, size, bold and color of linked text, and keeps what is set inside it', () => {
    const { doc } = chain();
    doc.style = { ...doc.style, tiedLook: { size: 8, bold: true } };
    const runs = lookRuns([{ text: 'n', italic: true, size: 14, color: '#00ff00' }, { text: '-Bu', size: 14 }, { text: '2', sub: true }], doc.style, 'caption');
    expect(runs).toEqual([{ text: 'n', italic: true, size: 8, bold: true }, { text: '-Bu', size: 8, bold: true }, { text: '2', sub: true, size: 8, bold: true }]);
    // made from other parts (descriptors, names), the look is only added
    doc.style = { ...doc.style, tiedLook: {} };
    expect(lookRuns([{ text: 'HRMS', bold: true }, { text: ' 123' }], doc.style, 'caption', true)).toEqual([{ text: 'HRMS', bold: true }, { text: ' 123' }]);
  });

  it('tells an ID from other text', () => {
    for (const t of ['12', '3a', 'S4', '12′', 'iv', 'IV', 'B', '(±)-7', '10ab', ' 7 ']) expect(looksLikeId(t), t).toBe(true);
    for (const t of ['crude', 'n-BuLi', '87% yield', '', '3 steps', 'THF', 'Ph']) expect(looksLikeId(t), t).toBe(false);
  });
});

describe('a structure with a focal point', () => {
  it('has its ID label centered under the focal point, and moved there when the focal point moves', () => {
    const { doc, atoms } = chain();
    let id = 0;
    doc.edit('Label', () => { const c = doc.addCaption(lookCaption(doc, 'label', atoms, [{ text: '15' }])); placeAttached(doc, c, M); id = c.id; });
    const mid = () => { const b = M.captionBox(doc.captions.get(id)!); return (b.x1 + b.x2) / 2; };
    expect(mid()).toBeCloseTo(15, 6);
    doc.edit('Focal point', () => setFocal(doc, [atoms[0]]));
    expect(mid()).toBeCloseTo(0, 6);
    expect(M.captionBox(doc.captions.get(id)!).y1).toBeCloseTo(12 + doc.captions.get(id)!.attach!.gap, 6);
  });
});

describe('linking text to a structure', () => {
  it('makes it an ID label in the ID look and place when it reads as an ID, else a caption', () => {
    const { doc, atoms } = chain();
    let id = 0, cap = 0;
    doc.edit('Text', () => {
      id = doc.addCaption({ x: 80, y: 40, runs: [{ text: '7', size: 18 }], justify: 'left' }).id;
      cap = doc.addCaption({ x: -60, y: -30, runs: [{ text: 'crude' }], justify: 'right' }).id;
    });
    doc.edit('Link', () => {
      for (const x of [id, cap]) doc.updateCaption(x, lookPatch(doc, doc.captions.get(x)!, atoms));
    });
    const l = doc.captions.get(id)!, c = doc.captions.get(cap)!;
    expect(l.attach!.role).toBe('label');
    expect(l.runs).toEqual([{ text: '7', bold: true }]);
    expect(l.justify).toBe('center');
    expect(c.attach!.role).toBe('caption');
    // centered under the structure: the label, then the caption below it
    const s = structureBox(doc, new Set(atoms), M)!, lb = M.captionBox(l), cb = M.captionBox(c);
    expect((lb.x1 + lb.x2) / 2).toBeCloseTo((s.x1 + s.x2) / 2, 6);
    expect(lb.y1).toBeCloseTo(s.y2 + l.attach!.gap, 6);
    expect(cb.y1).toBeCloseTo(lb.y2 + c.attach!.gap, 6);
  });

  it('keeps a tied caption\'s role and descriptor settings when its look is reset', () => {
    const { doc, atoms } = chain();
    const c = { id: 1, ...lookCaption(doc, 'descriptors', atoms, [{ text: 'C9H8O' }], { show: ['formula'], adduct: '[M+Na]+' }) };
    c.attach = { ...c.attach, side: 'left', gap: 20, shift: 5 };
    const p = lookPatch(doc, c as Caption, atoms);
    expect(p.attach).toMatchObject({ role: 'descriptors', show: ['formula'], adduct: '[M+Na]+', side: 'below', shift: 0 });
  });
});

describe('a new drawing style', () => {
  it('passes its looks on to labels that still have the old one, and not to ones changed by hand', () => {
    const { doc, atoms } = chain();
    let plain = 0, changed = 0;
    doc.edit('Labels', () => {
      plain = doc.addCaption(lookCaption(doc, 'label', atoms, [{ text: '1' }])).id;
      changed = doc.addCaption({ ...lookCaption(doc, 'label', atoms, [{ text: '2' }]), runs: [{ text: '2', bold: true, color: '#0000ff' }] }).id;
    });
    const next = { ...doc.style, idLook: { bold: false, size: 12, side: 'above' as const } };
    doc.edit('Style', () => applyStyle(doc, next, 'restyle'));
    expect(doc.captions.get(plain)!.runs).toEqual([{ text: '1', size: 12 }]);
    expect(doc.captions.get(plain)!.attach!.side).toBe('above');
    expect(doc.captions.get(changed)!.runs).toEqual([{ text: '2', bold: true, color: '#0000ff' }]);
    // a style kept as it was ("new-only") leaves them be
    const d2 = chain();
    let k = 0;
    d2.doc.edit('L', () => { k = d2.doc.addCaption(lookCaption(d2.doc, 'label', d2.atoms, [{ text: '1' }])).id; });
    d2.doc.edit('Style', () => applyStyle(d2.doc, next, 'new-only'));
    expect(d2.doc.captions.get(k)!.runs[0].bold).toBe(true);
    expect(d2.doc.captions.get(k)!.attach!.side).toBe('below');
  });

  it('moves labels at the usual gap with the bond length', () => {
    const { doc, atoms } = chain();
    let id = 0;
    doc.edit('L', () => { id = doc.addCaption(lookCaption(doc, 'label', atoms, [{ text: '1' }])).id; });
    const done = new Set<number>();
    doc.edit('Style', () => { for (const x of restyleTied(doc, doc.style, { ...doc.style, bondLength: 20 })) done.add(x); });
    expect(doc.captions.get(id)!.attach!.gap).toBe(6);
    expect(done.size).toBe(1);
  });

  it('is told apart by its looks, scales them, and reads them back from settings sensibly', () => {
    const a = { ...cleanStyle({ ...doc0(), name: 'A' })! };
    const b = { ...a, idLook: { size: 9 } };
    expect(sameLook(a, b)).toBe(false);
    expect(scaleStyle(b, 2).idLook).toEqual({ size: 18 });
    expect(cleanStyle({ ...b, tiedLook: { gap: 3, side: 'left', color: 'red', size: 900 } })!.tiedLook).toEqual({ gap: 3, side: 'left' });
    expect(cleanTiedLook({ align: 'middle', bold: 'yes' })).toBeUndefined();
    expect(fullLook(b, 'label')).toMatchObject({ size: 9, bold: true, side: 'below', align: 'center' });
  });
});

function doc0() { return new Doc().style; }

describe('saved in CDXML', () => {
  it('keeps the ID label and caption looks (ChemDraw passes over them)', () => {
    const { doc } = chain();
    doc.style = { ...doc.style, idLook: { size: 9, side: 'above', align: 'right', gap: 4 }, tiedLook: { italic: true, color: '#123456' } };
    const back = readCdxml(writeCdxml(doc)).doc;
    expect(back.style.idLook).toEqual({ size: 9, side: 'above', align: 'right', gap: 4 });
    expect(back.style.tiedLook).toEqual({ italic: true, color: '#123456' });
  });
});
