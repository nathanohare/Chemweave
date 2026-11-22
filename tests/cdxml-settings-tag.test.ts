// @vitest-environment jsdom
//
// Settings ChemDraw has no place for, kept in one hidden "Chem Illustrator settings" tag on each
// object's own element (src/io/cdxml-more.ts, standing rule R3), through CDXML and through CDX,
// ChemDraw's binary form of the same file. Things a setting names (a frame's members, the arrow a
// reagent arrow feeds) are named by element ids and found again on reading. Settings written for
// a label or a stereo label are dropped once ChemDraw shows other text there. Also: run looks
// ChemDraw's text has no place for (src/text/chemdraw-text.ts), a table's merged rows and fills
// (src/io/cdxml-table.ts), and a lone bracket's own label. Drawings are built here in code.

import { describe, it, expect } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { MORE_TAG } from '../src/io/cdxml-more';

const viaCdxml = (d: Doc) => readCdxml(writeCdxml(d, { name: 't.cdxml' })).doc;
const viaCdx = (d: Doc) => readCdxml(cdxToCdxml(cdxmlToCdx(writeCdxml(d, { name: 't.cdxml' })))).doc;
const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/, ''), 'application/xml');

const ARROW: Omit<Arrow, 'id'> = { tail: { x: 0, y: 60 }, head: { x: 50, y: 60 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 };

function drawing(): Doc {
  const d = new Doc();
  d.bulk(() => {
    const a1 = d.addAtom(0, 0), a2 = d.addAtom(14.4, 0), a3 = d.addAtom(300, 0), a4 = d.addAtom(340, 0);
    d.addBond(a1.id, a2.id, 1, 'solid', { z: 4 });
    d.addBond(a3.id, a4.id);
    d.updateAtom(a1.id, { depth: 12 });
    d.updateAtom(a3.id, { label: 'OMe', labelMarks: '^==' });
    d.updateAtom(a4.id, { label: 'R1', supDigits: false });
    d.addCaption({ x: 0, y: 40, runs: [{ text: 'two columns' }], justify: 'left', cols: 2, colGap: 9, width: 120, fit: 'shrink' });
    const main = d.addArrow({ ...ARROW, bent: true });
    d.addArrow({ ...ARROW, tail: { x: 0, y: 90 }, head: { x: 50, y: 90 }, reagentFor: main.id });
    const box = d.addShape({ kind: 'rect', x1: 100, y1: 100, x2: 160, y2: 140, name: 'Box 1', hidden: true });
    d.addShape({ kind: 'rect', x1: -10, y1: -10, x2: 40, y2: 80, frame: { atoms: [a1.id, a2.id], captions: [], arrows: [main.id], shapes: [box.id], padX: 4, padY: 4, fit: false } });
  });
  return d;
}

describe('the settings tag (R3)', () => {
  for (const [name, trip] of [['CDXML', viaCdxml], ['CDX', viaCdx]] as const) {
    it(`carries atom, bond, text, arrow and shape settings through ${name}`, () => {
      const back = trip(drawing());
      const atoms = [...back.atoms.values()];
      expect(atoms.find((a) => a.x === 0 && a.y === 0)?.depth).toBe(12);
      expect(atoms.find((a) => a.x === 300)?.labelMarks).toBe('^==');
      expect(atoms.find((a) => a.x === 340)?.supDigits).toBe(false);
      expect([...back.bonds.values()].map((b) => b.z)).toContain(4);
      const c = [...back.captions.values()][0];
      expect([c.cols, c.colGap, c.width, c.fit]).toEqual([2, 9, 120, 'shrink']);
      const arrows = [...back.arrows.values()];
      const main = arrows.find((r) => r.bent);
      expect(main).toBeDefined();
      expect(arrows.find((r) => !r.bent)?.reagentFor).toBe(main!.id);
      const box = [...back.shapes.values()].find((s) => s.name === 'Box 1');
      expect(box?.hidden).toBe(true);
      const frame = [...back.shapes.values()].find((s) => s.frame)?.frame;
      expect(frame?.atoms).toHaveLength(2);
      expect(frame?.arrows).toEqual([main!.id]);
      expect(frame?.shapes).toEqual([box!.id]);
    });
  }

  it('rides on the object\'s own element, hidden', () => {
    const tags = [...parse(writeCdxml(drawing(), { name: 't.cdxml' })).getElementsByTagName('objecttag')].filter((t) => t.getAttribute('Name') === MORE_TAG);
    expect(new Set(tags.map((t) => t.parentElement?.nodeName))).toEqual(new Set(['n', 'b', 't', 'arrow', 'graphic']));
    expect(tags.every((t) => t.getAttribute('Visible') === 'no')).toBe(true);
  });

  it('is not written for what the element already says (a crossing bond\'s Z)', () => {
    const d = new Doc();
    d.bulk(() => { const a = d.addAtom(0, 0), b = d.addAtom(14.4, 0); d.addBond(a.id, b.id); });
    const xml = writeCdxml(d, { name: 't.cdxml' });
    expect(xml).not.toContain(MORE_TAG);
  });

  it('drops a label\'s settings once ChemDraw shows other text there', () => {
    const xml = writeCdxml(drawing(), { name: 't.cdxml' });
    const doc = parse(xml);
    const t = [...doc.getElementsByTagName('n')].map((n) => [...n.children].find((k) => k.nodeName === 't')).find(Boolean)!;
    const ss = [...t.getElementsByTagName('s')];
    ss.forEach((s, i) => { s.textContent = i ? '' : 'OEt'; });
    const back = readCdxml(new XMLSerializer().serializeToString(doc)).doc;
    expect([...back.atoms.values()].find((a) => a.x === 300)?.labelMarks).not.toBe('^==');
  });

  it('leaves a damaged tag alone', () => {
    const xml = writeCdxml(drawing(), { name: 't.cdxml' }).replace(/(Name="Chem Illustrator settings" Value=")[^"]*"/g, '$1{not json"');
    expect(() => readCdxml(xml)).not.toThrow();
  });
});

describe('run looks ChemDraw\'s text has no place for (R3)', () => {
  it('come back through the text tag', () => {
    const d = new Doc();
    d.bulk(() => d.addCaption({ x: 0, y: 0, runs: [{ text: 'struck', strike: true }, { text: ' wide', spacing: 2, shadow: true }], justify: 'left' }));
    const runs = [...viaCdxml(d).captions.values()][0].runs;
    expect(runs.find((r) => r.text.includes('struck'))?.strike).toBe(true);
    const wide = runs.find((r) => r.text.includes('wide'));
    expect([wide?.spacing, wide?.shadow]).toEqual([2, true]);
  });
});
