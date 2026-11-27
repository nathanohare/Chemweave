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
import { cdxmlToCdx, cdxToCdxml, hexText, hexBytes } from '../src/io/cdx';
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
    // bytes after the drawing ends (an embedded object's stream padded with NULs) are left off
    const padded = readCdxml(wrap('<fragment id="1"><n id="2" p="0 0"/></fragment>') + '\0\0\0\0');
    expect(padded.doc.atoms.size).toBe(1);
    // not a CDXML file at all: said as before
    expect(() => readCdxml('hello')).toThrow(/does not look like a CDXML file/);
  });

  it('F626: many unclosed "<!DOCTYPE[" are refused at once, not after minutes', () => {
    const t0 = performance.now();
    expect(() => withoutDoctype('<!DOCTYPE['.repeat(20000))).toThrow(/entities/);
    // (a generous limit: the old pattern took many seconds on this text)
    expect(performance.now() - t0).toBeLessThan(4000);
  });

  it('F626: a DOCTYPE, internal subset and all, is still taken out; an entity elsewhere refused', () => {
    // XML 1.0 (W3C), 2.8: doctypedecl ::= '<!DOCTYPE' S Name (S ExternalID)? S? ('[' intSubset ']' S?)? '>'
    expect(withoutDoctype('<?xml version="1.0"?><!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd"><CDXML/>')).toBe('<?xml version="1.0"?><CDXML/>');
    expect(withoutDoctype('<!DOCTYPE x [<!ENTITY a "]>">]><x/>')).toBe('<x/>');
    expect(() => withoutDoctype('<x><!ENTITY a "b"></x>')).toThrow(/entities/);
    // (U+0130 lower-cases to two characters: the DOCTYPE is still found where it is)
    expect(withoutDoctype('<!-- İİİ --><!DOCTYPE CDXML SYSTEM "x.dtd"><CDXML/>')).toBe('<!-- İİİ --><CDXML/>');
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

  it('F102: a rule under most of a row high up doesn\'t give way to the full rule lower down', () => {
    // four columns: a rule under three cells of row 1, a full one under row 3 (above the last)
    const none = () => ({ left: 0, top: 0, bottom: 0, right: 0 });
    const b = Array.from({ length: 5 }, () => Array.from({ length: 4 }, none));
    for (let c = 0; c < 4; c++) { b[0][c].top = 1; b[4][c].bottom = 1; b[2][c].bottom = 1; }
    for (let c = 0; c < 3; c++) b[0][c].bottom = 1;
    expect(linesFromBorders(b)).toEqual({ lines: 'acs', head: 1 });
  });

  it('F102, F539: the tables of the Steps come back from a CDXML save', () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    const acs = table(4, 4, 2, 'acs');
    acs.rows[0][1] = { ...acs.rows[0][1], span: 3 };
    const grid = table(3, 1, 1, 'grid');
    d.bulk(() => {
      d.addShape({ kind: 'table', x1: 0, y1: 0, x2: 160, y2: 60, table: acs } as never);
      d.addShape({ kind: 'table', x1: 0, y1: 200, x2: 40, y2: 245, table: grid } as never);
    });
    const back = [...readCdxml(writeCdxml(d)).doc.shapes.values()].filter((s) => s.table).map((s) => s.table!);
    const wide = back.find((t) => t.cols.length === 4)!, narrow = back.find((t) => t.cols.length === 1)!;
    expect([wide.lines, wide.head]).toEqual(['acs', 2]);
    expect(narrow.lines).toBe('grid');
  });

  it('F539: a one-column table with every border is read as boxed', () => {
    const t = table(3, 1, 1, 'grid');
    expect(linesFromBorders(tableBorders(t, 1)).lines).toBe('grid');
    // and an ACS one stays ACS
    expect(linesFromBorders(tableBorders(table(3, 1, 1, 'acs'), 1)).lines).toBe('acs');
  });
});

// A regular seven-membered ring (tropylium) of 14.4 pt bonds round (200, 150), its circle and a
// charge sign made here: a regular n-gon of side a has circumradius a / (2 sin(π/n)).
const RC = { x: 200, y: 150 }, RR = 14.4 / (2 * Math.sin(Math.PI / 7));
const f2 = (v: number) => v.toFixed(2);
const ringAt = () => Array.from({ length: 7 }, (_, k) => {
  const t = (2 * Math.PI * k) / 7;
  return `<n id="${85 + k}" p="${f2(RC.x + RR * Math.sin(t))} ${f2(RC.y - RR * Math.cos(t))}"${k === 0 ? ' Charge="1"' : ''}/>`;
}).join('') + Array.from({ length: 7 }, (_, k) => `<b id="${92 + k}" B="${85 + k}" E="${85 + ((k + 1) % 7)}" Order="1.5"/>`).join('');
const ring = ringAt();
/** The ring's circle, its centre `off` points right of the ring's middle, radius 9. */
const circleAt = (off = 0) => `<graphic id="101" BoundingBox="${f2(RC.x + off + 9)} ${f2(RC.y)} ${f2(RC.x + off)} ${f2(RC.y)}" GraphicType="Orbital" OvalType="Circle" OrbitalType="s" Center3D="${f2(RC.x + off)} ${f2(RC.y)} 0" MajorAxisEnd3D="${f2(RC.x + off + 9)} ${f2(RC.y)} 0" MinorAxisEnd3D="${f2(RC.x + off)} ${f2(RC.y + 9)} 0"/>`;
const circle = circleAt();
const plus = `<graphic id="99" GraphicType="Symbol" SymbolType="Plus" BoundingBox="${f2(RC.x)} ${f2(RC.y)} ${f2(RC.x)} ${f2(RC.y + 5.76)}"><represent attribute="Charge" object="85"/></graphic>`;
const centerOf = (xml: string) => [...parse(xml).getElementsByTagName('graphic')].find((e) => e.getAttribute('GraphicType') === 'Orbital')!.getAttribute('Center3D')!.split(' ').map(Number);

describe('ring circles and charge signs (F103, F542)', () => {
  it('F103: a ring scaled about its centre gets a circle of its new size', () => {
    const { doc } = readCdxml(wrap(`<fragment id="100">${ring}${circle}</fragment>`));
    const atoms = [...doc.atoms.values()];
    const cx = atoms.reduce((t, a) => t + a.x, 0) / atoms.length, cy = atoms.reduce((t, a) => t + a.y, 0) / atoms.length;
    doc.edit('Scale', () => { for (const a of atoms) doc.updateAtom(a.id, { x: cx + 2 * (a.x - cx), y: cy + 2 * (a.y - cy) }); });
    const g = [...parse(writeCdxml(doc)).getElementsByTagName('graphic')].find((e) => e.getAttribute('GraphicType') === 'Orbital')!;
    const [x, y] = g.getAttribute('Center3D')!.split(' ').map(Number), [mx, my] = g.getAttribute('MajorAxisEnd3D')!.split(' ').map(Number);
    // the file's circle had a radius of 9; twice the ring, about twice the circle
    expect(Math.hypot(mx - x, my - y)).toBeGreaterThan(1.5 * 9);
  });

  it('F542: a circle a little off its ring\'s middle stays put while its ring stays, and moves with it', () => {
    const text = wrap(`<fragment id="100">${ring}${circleAt(0.5)}</fragment><fragment id="200"><n id="201" p="0 0"/><n id="202" p="14.4 0"/><b id="203" B="201" E="202"/></fragment>`);
    // something else edited: the circle is where the file had it
    let { doc } = readCdxml(text);
    const other = [...doc.atoms.values()].find((a) => a.x === 0)!;
    doc.edit('Move', () => doc.updateAtom(other.id, { y: 30 }));
    expect(centerOf(writeCdxml(doc))[0]).toBeCloseTo(RC.x + 0.5, 2);
    // the ring moved 10 to the right: the circle with it, still 0.5 off
    ({ doc } = readCdxml(text));
    const ringAtoms = [...doc.atoms.values()].filter((a) => a.x > 100);
    doc.edit('Move', () => { for (const a of ringAtoms) doc.updateAtom(a.id, { x: a.x + 10 }); });
    expect(centerOf(writeCdxml(doc))[0]).toBeCloseTo(RC.x + 10.5, 2);
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

  it('F104: a closed curve made plain again leaves no old group behind', () => {
    const d = new Doc();
    // a closed path: its start, then two handles and a point for each of four segments, back at the start
    const geo = 'path:0,0,3333,0,6667,0,10000,0,10000,3333,10000,6667,10000,10000,6667,10000,3333,10000,0,10000,0,6667,0,3333,0,0';
    d.bulk(() => { d.addShape({ kind: 'geo', geo, x1: 0, y1: 0, x2: 40, y2: 40, filled: true, transparency: 0.5 } as never); });
    const first = readCdxml(writeCdxml(d)).doc;
    const s0 = [...first.shapes.values()][0];
    expect(s0.transparency).toBe(0.5);
    first.edit('Solid', () => first.updateShape(s0.id, { transparency: undefined }));
    const out = writeCdxml(first);
    expect(parse(out).getElementsByTagName('curve')).toHaveLength(1);
    expect([...readCdxml(out).doc.shapes.values()]).toHaveLength(1);
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

describe('hex data in CDX (F537)', () => {
  it('goes to hex text and back byte for byte', () => {
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 37) & 0xff);
    const hex = hexText(bytes);
    expect(hex.slice(0, 8)).toBe('00254A6F');
    expect(hexBytes(hex)).toEqual(bytes);
    expect(hexBytes(hex.toLowerCase())).toEqual(bytes);
  });
  it('reads an odd last digit and bad digits as parseInt reads a pair', () => {
    expect([...hexBytes('ABC')]).toEqual([0xab]);
    expect([...hexBytes('G1')]).toEqual([Number.isNaN(parseInt('G1', 16)) ? 0 : parseInt('G1', 16)]);
    expect([...hexBytes('1G')]).toEqual([parseInt('1G', 16)]);
    expect([...hexBytes('')]).toEqual([]);
  });
});
