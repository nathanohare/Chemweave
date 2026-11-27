// @vitest-environment jsdom
//
// Review batch 03 (2026-11-26 code review, ChemDraw files): reading and saving CDXML and CDX.
// Every file here is built in the test from the CDX/CDXML specification (Revvity/PerkinElmer,
// "CDX File Format" and its CDXML pages); nothing comes from ChemDraw.

import { describe, it, expect } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { ACS_1996 } from '../src/style';
import { readCdxml, applyLineEnds, takeFrameTexts } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from '../src/io/cdx';
import { withoutDoctype } from '../src/io/xml';
import { tableBorders, linesFromBorders, applyTableTag, type TableTag } from '../src/io/cdxml-table';
import type { TableData } from '../src/model';

const parse = (xml: string) => new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml');
const wrap = (body: string, page = true) => `<?xml version="1.0" encoding="UTF-8" ?><CDXML BondLength="14.40">${page ? `<page id="500">${body}</page>` : body}</CDXML>`;
const ARROW: Omit<Arrow, 'id'> = { tail: { x: 0, y: 60 }, head: { x: 50, y: 60 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 };

describe('reading damaged or crafted files (F106, F626)', () => {
  it('F106: a file with a parse error is refused, not opened in part', () => {
    // Chromium keeps the tree read before the error with a <parsererror> element inside the root
    expect(() => readCdxml(wrap('<fragment id="1"><n id="2" p="0 0"/></fragment><parsererror>line 1</parsererror>'))).toThrow(/damaged/);
    // and a file cut off in the middle of a fragment
    expect(() => readCdxml(wrap('<fragment id="1"><n id="2" p="0 0"/>').slice(0, -20))).toThrow(/damaged/);
    // not a CDXML file at all: said as before
    expect(() => readCdxml('hello')).toThrow(/does not look like a CDXML file/);
  });

  it('F626: many unclosed "<!DOCTYPE[" are refused at once, not after minutes', () => {
    const t0 = performance.now();
    expect(() => withoutDoctype('<!DOCTYPE['.repeat(20000))).toThrow(/entities/);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('F626: a DOCTYPE, internal subset and all, is still taken out; an entity elsewhere refused', () => {
    // XML 1.0 (W3C), 2.8: doctypedecl ::= '<!DOCTYPE' S Name (S ExternalID)? S? ('[' intSubset ']' S?)? '>'
    expect(withoutDoctype('<?xml version="1.0"?><!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd"><CDXML/>')).toBe('<?xml version="1.0"?><CDXML/>');
    expect(withoutDoctype('<!DOCTYPE x [<!ENTITY a "]>">]><x/>')).toBe('<x/>');
    expect(() => withoutDoctype('<x><!ENTITY a "b"></x>')).toThrow(/entities/);
    expect(() => withoutDoctype('<!DOCTYPE x [<!ENTITY a "b"><x/>')).toThrow(/entities/);
  });
});

describe('labels and captions (F543, F544)', () => {
  it('F543: a charge the label shows as a hyphen and digits ("O-2") is shown', () => {
    // CDXML spec, Node: Charge is the formal charge; the label text is what ChemDraw shows
    const d = readCdxml(wrap('<fragment id="1"><n id="2" p="0 0" Element="8" Charge="-2" NumHydrogens="0"><t p="0 0"><s>O-2</s></t></n></fragment>')).doc;
    const o = [...d.atoms.values()][0];
    expect(o.charge).toBe(-2);
    expect(o.hideCharge).toBeFalsy();
  });

  it('F544: line starts counted in characters (older ChemDraw) are read as characters', () => {
    // CDXML spec, LineStarts: where each line starts, the last entry the length of the text.
    // "é abc de" is 8 characters (9 bytes of UTF-8, é taking two); the second line starts at character 6.
    const d = readCdxml(wrap('<t id="3" p="0 0" LineStarts="6 8"><s font="3" size="10">é abc de</s></t>')).doc;
    expect([...d.captions.values()][0].runs.map((r) => r.text).join('')).toBe('é abc\nde');
    // counted in bytes (ChemDraw 25), the same break is at byte 7
    const runs = [{ text: 'é abc de' }];
    applyLineEnds(runs, [7, 9]);
    expect(runs[0].text).toBe('é abc\nde');
  });
});

describe('frames (F546)', () => {
  it('a text added in ChemDraw inside a frame does not count as matching the frame', () => {
    const d = new Doc();
    let id = 0;
    d.bulk(() => {
      const a = d.addCaption({ x: 0, y: 0, runs: [{ text: 'lane 1' }], justify: 'left' });
      const b = d.addCaption({ x: 0, y: 20, runs: [{ text: 'added' }], justify: 'left' });
      id = d.addShape({ kind: 'geo', geo: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, frame: { atoms: [], captions: [a.id, b.id], arrows: [], shapes: [], padX: 0, padY: 0, fit: false } } as never).id;
    });
    // written with one text, now two: not matched one to one
    d.bulk(() => { expect(takeFrameTexts(d, d.shapes.get(id)!, ['lane 1'])).toBe(false); });
    d.bulk(() => { expect(takeFrameTexts(d, d.shapes.get(id)!, ['lane 1', 'added'])).toBe(true); });
  });
});

describe('tables (F102, F539)', () => {
  const cell = (text = '') => ({ runs: text ? [{ text }] : [] });
  const table = (rows: number, cols: number, head: number, lines: TableData['lines']): TableData => ({
    cols: Array.from({ length: cols }, () => 40), rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => cell('x'))), head, lines,
  });

  it('F102: two heading rows with a heading joined over three of four columns keep both', () => {
    const t = table(4, 4, 2, 'acs');
    t.rows[0][1] = { ...t.rows[0][1], span: 3 };
    const b = tableBorders(t, 1);
    expect(linesFromBorders(b)).toEqual({ lines: 'acs', head: 2 });
  });

  it('F102: a heading joined across the whole table: the tag\'s two heading rows count', () => {
    const t = table(4, 4, 2, 'acs');
    t.rows[0][0] = { ...t.rows[0][0], span: 4 };
    const b = tableBorders(t, 1);
    const tag: TableTag = { v: 1, head: 2, lines: 'acs', spans: [[0, 0, 4]] };
    const plain = table(4, 4, 0, 'acs');
    expect(applyTableTag(plain, tag, linesFromBorders(b), b).head).toBe(2);
  });

  it('F539: a one-column table with every border is read as boxed', () => {
    const t = table(3, 1, 1, 'grid');
    expect(linesFromBorders(tableBorders(t, 1)).lines).toBe('grid');
    // and an ACS one stays ACS
    expect(linesFromBorders(tableBorders(table(3, 1, 1, 'acs'), 1)).lines).toBe('acs');
  });
});

// a seven-membered ring with a circle (tropylium), as in tests/charge-sign-cdxml.test.ts
const ring = '<n id="85" p="267.97 163.56" Charge="1"/><n id="86" p="280.87 157.17"/><n id="87" p="283.92 143.10"/><n id="88" p="274.83 131.94"/><n id="89" p="260.43 132.10"/><n id="90" p="251.58 143.44"/><n id="91" p="254.93 157.46"/>'
  + '<b id="92" B="85" E="86" Order="1.5"/><b id="93" B="86" E="87" Order="1.5"/><b id="94" B="87" E="88" Order="1.5"/><b id="95" B="88" E="89" Order="1.5"/><b id="96" B="89" E="90" Order="1.5"/><b id="97" B="90" E="91" Order="1.5"/><b id="98" B="91" E="85" Order="1.5"/>';
const circle = '<graphic id="101" BoundingBox="277.06 146.97 267.79 146.97" GraphicType="Orbital" OvalType="Circle" OrbitalType="s" Center3D="267.79 146.97 0" MajorAxisEnd3D="277.06 146.97 0" MinorAxisEnd3D="267.79 156.23 0"/>';
const plus = '<graphic id="99" GraphicType="Symbol" SymbolType="Plus" BoundingBox="267.97 147.75 267.97 153.51"><represent attribute="Charge" object="85"/></graphic>';

describe('ring circles and charge signs (F103, F542)', () => {
  it('F103: a ring scaled about its centre gets a circle of its new size', () => {
    const { doc } = readCdxml(wrap(`<fragment id="100">${ring}${circle}</fragment>`));
    const atoms = [...doc.atoms.values()];
    const cx = atoms.reduce((t, a) => t + a.x, 0) / atoms.length, cy = atoms.reduce((t, a) => t + a.y, 0) / atoms.length;
    doc.edit('Scale', () => { for (const a of atoms) doc.updateAtom(a.id, { x: cx + 2 * (a.x - cx), y: cy + 2 * (a.y - cy) }); });
    const g = [...parse(writeCdxml(doc)).getElementsByTagName('graphic')].find((e) => e.getAttribute('GraphicType') === 'Orbital')!;
    const [x, y] = g.getAttribute('Center3D')!.split(' ').map(Number), [mx, my] = g.getAttribute('MajorAxisEnd3D')!.split(' ').map(Number);
    // the file's circle had a radius of 9.27 (277.06 − 267.79); twice the ring, about twice the circle
    expect(Math.hypot(mx - x, my - y)).toBeGreaterThan(1.5 * 9.27);
  });

  it('F542: a file not changed here, its + before the circle, is saved exactly as it was', () => {
    const text = wrap(`<fragment id="100">${ring}${plus}${circle}</fragment>`);
    expect(writeCdxml(readCdxml(text).doc)).toBe(text);
  });
});

describe('shapes that change form, and arrows (F104, F105, F540, F541)', () => {
  it('F104: a ring fill whose shadow is taken off leaves no old group behind', () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => {
      const L = 14.4, ids: number[] = [];
      for (let i = 0; i < 6; i++) ids.push(d.addAtom(100 + L * Math.cos((i * Math.PI) / 3), 100 + L * Math.sin((i * Math.PI) / 3)).id);
      for (let i = 0; i < 6; i++) d.addBond(ids[i], ids[(i + 1) % 6], i % 2 ? 2 : 1);
      d.addShape({ kind: 'ring', ring: ids, filled: true, fillColor: '#ffd966', shadow: true, x1: 85, y1: 85, x2: 115, y2: 115 } as never);
    });
    const first = readCdxml(writeCdxml(d)).doc;
    const fill = [...first.shapes.values()].find((s) => s.kind === 'ring')!;
    expect(fill.shadow).toBe(true);
    first.edit('No Shadow', () => first.updateShape(fill.id, { shadow: undefined }));
    const out = writeCdxml(first);
    const again = readCdxml(out).doc;
    expect([...again.shapes.values()].filter((s) => s.kind === 'ring')).toHaveLength(1);
    expect([...again.shapes.values()].find((s) => s.kind === 'ring')!.shadow).toBeFalsy();
  });

  it('F105: a curved arrow keeps its Auto-Animate piece through CDXML and CDX', () => {
    const d = new Doc();
    d.bulk(() => { d.addArrow({ ...ARROW, bez: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: -0.3 }], piece: 3 }); });
    const xml = writeCdxml(d);
    expect([...readCdxml(xml).doc.arrows.values()][0].piece).toBe(3);
    expect([...readCdxml(cdxToCdxml(cdxmlToCdx(xml))).doc.arrows.values()][0].piece).toBe(3);
  });

  it('F540: a page added to a file that had none takes an id no object has', () => {
    const text = '<?xml version="1.0" encoding="UTF-8" ?><CDXML BondLength="14.40"><fragment id="1"><n id="2" p="0 0"/><n id="3" p="14.4 0"/><b id="4" B="2" E="3"/></fragment></CDXML>';
    const { doc } = readCdxml(text);
    const a = [...doc.atoms.values()][0];
    doc.edit('Move', () => doc.updateAtom(a.id, { x: a.x + 5 }));
    const ids = [...parse(writeCdxml(doc)).getElementsByTagName('*')].map((e) => e.getAttribute('id')).filter((x): x is string => !!x);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('F541: an arc arrow made straight takes its older copy (an Arc graphic) with it', () => {
    // CDX spec, Graphic: GraphicType Line or Arc; an arc's box is its head then its centre, a line's its two ends
    const d = new Doc();
    d.bulk(() => { d.addArrow({ ...ARROW, sweep: 90 }); });
    const xml = writeCdxml(d);
    const dom = parse(xml);
    const arrow = dom.getElementsByTagName('arrow')[0];
    const legacy = dom.createElement('graphic');
    for (const [k, v] of Object.entries({ id: '900', SupersededBy: arrow.getAttribute('id')!, BoundingBox: '50 60 25 35', GraphicType: 'Arc', ArrowType: 'FullHead', AngularSize: '90' })) legacy.setAttribute(k, v);
    arrow.parentNode!.insertBefore(legacy, arrow);
    const { doc } = readCdxml(new XMLSerializer().serializeToString(dom));
    const r = [...doc.arrows.values()][0];
    expect(r.sweep).toBeTruthy();
    doc.edit('Straight', () => doc.updateArrow(r.id, { sweep: 0 }));
    const g = [...parse(writeCdxml(doc)).getElementsByTagName('graphic')].find((e) => e.getAttribute('SupersededBy'));
    expect(g?.getAttribute('GraphicType')).toBe('Line');
    expect(g?.hasAttribute('AngularSize')).toBe(false);
    expect(g?.getAttribute('BoundingBox')?.split(' ').map(Number)).toEqual([50, 60, 0, 60]);
  });
});
