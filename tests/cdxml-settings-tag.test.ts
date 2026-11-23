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
    // (a structure's depths and bond places in one tag on its fragment, F7b R09)
    expect(new Set(tags.map((t) => t.parentElement?.nodeName))).toEqual(new Set(['fragment', 'n', 't', 'arrow', 'graphic']));
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

  // ChemDraw's own edits, made here on the saved XML the way ChemDraw writes them (review F7b-R03)
  const edited = (change: (doc: Document) => void) => {
    const doc = parse(writeCdxml(drawing(), { name: 't.cdxml' }));
    change(doc);
    return readCdxml(new XMLSerializer().serializeToString(doc)).doc;
  };
  const tagged = (doc: Document, name: string) => [...doc.getElementsByTagName(name)].filter((e) => [...e.children].some((k) => k.getAttribute('Name') === MORE_TAG));

  it('lets ChemDraw\'s Z win over a kept place among crossing bonds once ChemDraw changed it', () => {
    expect([...edited(() => {}).bonds.values()].map((b) => b.z)).toContain(4);
    const back = edited((doc) => {
      const f = tagged(doc, 'fragment')[0];
      // (the tag's bond places: [place among the bonds, id, Z, print] each)
      const v = JSON.parse([...f.children].find((k) => k.getAttribute('Name') === MORE_TAG)!.getAttribute('Value')!) as { z: [number, string, number, string][] };
      const b = [...f.children].filter((k) => k.nodeName === 'b')[v.z[0][0]];
      b.setAttribute('Z', String(Number(b.getAttribute('Z') ?? 0) + 50)); });
    expect([...back.bonds.values()].map((b) => b.z)).not.toContain(4);
  });

  it('lets ChemDraw\'s order win for every bond it crosses after Bring to Front on one (review F7b2-R01)', () => {
    const d = new Doc();
    d.bulk(() => {
      const a = d.addAtom(0, 0), b = d.addAtom(40, 0), c = d.addAtom(20, -20), e = d.addAtom(20, 20);
      d.addBond(a.id, b.id, 1, 'solid', { z: 9 });
      d.addBond(c.id, e.id, 1, 'solid', { z: 3 });
    });
    const xml = parse(writeCdxml(d, { name: 't.cdxml' }));
    const front = [...readCdxml(new XMLSerializer().serializeToString(xml)).doc.bonds.values()];
    expect(front.map((b) => b.z)).toEqual([9, 3]);
    // Bring to Front in ChemDraw on the lower bond: only its own Z changes, above the other's
    const bonds = [...xml.getElementsByTagName('b')];
    const top = Math.max(...bonds.map((b) => Number(b.getAttribute('Z'))));
    bonds[1].setAttribute('Z', String(top + 1));
    const [upper, lower] = [...readCdxml(new XMLSerializer().serializeToString(xml)).doc.bonds.values()];
    expect(lower.z!).toBeGreaterThan(upper.z!);
  });

  it('keeps a text width when ChemDraw writes the same layout differently (review F7b2-R03)', () => {
    const d = new Doc();
    d.bulk(() => {
      d.addCaption({ x: 0, y: 0, runs: [{ text: 'left text' }], justify: 'left', width: 120 });
      d.addCaption({ x: 0, y: 80, runs: [{ text: 'wrapped text here' }], justify: 'left', wrap: 80, width: 100 });
    });
    const doc = parse(writeCdxml(d, { name: 't.cdxml' }));
    const [t1, t2] = [...doc.getElementsByTagName('t')];
    t1.setAttribute('Justification', 'Left');
    expect(t2.getAttribute('WordWrapWidth')).toBe('80.00');
    t2.setAttribute('WordWrapWidth', '80');
    const back = [...readCdxml(new XMLSerializer().serializeToString(doc)).doc.captions.values()];
    expect(back.map((c) => c.width)).toEqual([120, 100]);
  });

  it('lets ChemDraw\'s justification win over a kept text width once ChemDraw changed it', () => {
    const back = edited((doc) => { const t = tagged(doc, 't')[0]; t.setAttribute('Justification', 'Center'); t.setAttribute('BoundingBox', '50 31 90 42'); });
    const c = [...back.captions.values()][0];
    expect(c.width).not.toBe(120);
    expect([c.cols, c.colGap, c.fit]).toEqual([2, 9, 'shrink']);
  });

  it('lets ChemDraw\'s faces win over kept label marks and raised digits once ChemDraw changed them', () => {
    const label = (doc: Document, text: string) => [...doc.getElementsByTagName('t')].find((t) => t.textContent === text)!;
    // OMe with a raised O typed here (marks ^==): Me set in formula style in ChemDraw
    const marks = edited((doc) => { label(doc, 'OMe').getElementsByTagName('s')[1].setAttribute('face', '96'); });
    expect([...marks.atoms.values()].find((a) => a.x === 300)?.labelMarks).not.toBe('^==');
    // R1 kept on the line here (supDigits false) is written on the line, as ChemDraw shows it (F7b-R13):
    // its 1 raised in ChemDraw reads raised
    const raised = edited((doc) => {
      const t = label(doc, 'R1'), s0 = t.getElementsByTagName('s')[0];
      expect(t.getElementsByTagName('s').length).toBe(1);
      s0.textContent = 'R';
      const one = s0.cloneNode() as Element;
      one.textContent = '1';
      one.setAttribute('face', '64');
      t.appendChild(one);
    });
    expect([...raised.atoms.values()].find((a) => a.x === 340)?.supDigits).toBe(true);
  });

  it('adds no tag for labels whose raised digits and marks ChemDraw\'s faces already say (review F7b-R01)', () => {
    const file = '<?xml version="1.0" encoding="UTF-8" ?><CDXML LabelFont="3" LabelSize="10" LabelFace="96"><fonttable><font id="3" name="Arial"/></fonttable><page id="1"><fragment id="2">'
      + '<n id="3" p="50 50" NodeType="GenericNickname" GenericNickname="R1"><t id="4" p="46 54"><s font="3" size="10" face="96">R1</s></t></n><n id="5" p="62 57"/>'
      + '<n id="6" p="75 50" NodeType="GenericNickname" GenericNickname="R1"><t id="7" p="71 54"><s font="3" size="10" face="96">R</s><s font="3" size="10" face="64">1</s></t></n>'
      + '<b id="8" B="3" E="5"/><b id="9" B="5" E="6"/></fragment></page></CDXML>';
    const { doc } = readCdxml(file);
    expect([...doc.atoms.values()].map((a) => a.supDigits).filter((x) => x !== undefined).sort()).toEqual([false, true]);
    // saved unchanged (tests/open-save-compare.test.ts checks the whole file stays byte for byte the same)
    expect(writeCdxml(doc, { name: 't.cdxml' })).not.toContain(MORE_TAG);
  });

  it('keeps a ChemDraw label in bold without formula style as face 1 (review F7b-R11)', () => {
    const file = '<?xml version="1.0" encoding="UTF-8" ?><CDXML LabelFont="3" LabelSize="10" LabelFace="96"><fonttable><font id="3" name="Arial"/></fonttable><page id="1"><fragment id="2">'
      + '<n id="3" p="50 50"/><n id="4" p="62 57" NodeType="Fragment"><t id="5" p="58 61"><s font="3" size="10" face="1">CH2Br</s></t></n><b id="6" B="3" E="4"/></fragment></page></CDXML>';
    const { doc } = readCdxml(file);
    const a = [...doc.atoms.values()].find((x) => x.label === 'CH2Br')!;
    expect([a.face, a.fileLabel]).toEqual([1, true]);
    doc.bulk(() => doc.updateAtom(a.id, { x: a.x + 10 }));
    const t = [...parse(writeCdxml(doc, { name: 't.cdxml' })).getElementsByTagName('t')].find((e) => e.textContent === 'CH2Br')!;
    expect([...t.getElementsByTagName('s')].map((x) => x.getAttribute('face'))).toEqual(['1']);
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
  it('leave out which font a sign is in when ChemDraw\'s fonts say so already', () => {
    // a Greek letter in ChemDraw's Symbol font, and an α typed in Arial
    const file = '<?xml version="1.0" encoding="UTF-8" ?><CDXML><fonttable><font id="3" name="Arial"/><font id="23" name="Symbol"/></fonttable><page id="1"><t id="5" p="100 100">'
      + '<s font="23" size="10" face="0">a</s><s font="3" size="10" face="0">-helix, </s><s font="3" size="10" face="0">α in Arial</s></t></page></CDXML>';
    const { doc } = readCdxml(file);
    expect([...doc.captions.values()][0].runs.find((r) => r.text.includes('Arial'))?.symbolFont).toBe(false);
    doc.source = null;
    const xml = writeCdxml(doc, { name: 't.cdxml' });
    expect(xml).not.toContain('Chem Illustrator text');
    expect([...readCdxml(xml).doc.captions.values()][0].runs.find((r) => r.text.includes('Arial'))?.symbolFont).toBe(false);
  });
});
