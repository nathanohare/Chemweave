// @vitest-environment jsdom
//
// Review batch 03 (2026-11-26 code review): other chemistry formats (Marvin, CML, ChemDoodle),
// pasting, Batch Convert's names, the Save dialog's extension, pasted tables and workspace
// files. Every file is built here in the test.

import { describe, it, expect } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { ACS_1996 } from '../src/style';
import { writeMrvFile, writeCmlFile, writeChemDoodleJson, readMrv, readCmlFile, readScene } from '../src/io/chem-formats';
import { insertDrawing, extractDrawing, looksLikeChemistry, readPasteEvent } from '../src/io/clipboard';
import { splitSdf, uniqueName, readBatchFile } from '../src/io/batch-convert';
import { readCml, CML_NS } from '../src/io/cml';
import { savedPath } from '../src/io/files';
import { fitPasted } from '../src/io/fit-drawing';
import { parseHtmlTable } from '../src/io/table-clip';
import { parseWorkspace } from '../src/io/workspace-file';
import { cdObjectPicture } from '../src/io/chemdraw-objects';

const L = ACS_1996.bondLength;
const ARROW: Omit<Arrow, 'id'> = { tail: { x: 0, y: 0 }, head: { x: 50, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 };
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

/** Ethane on the left, propane on the right (both as a chain of carbons), and a reaction arrow between. */
function reaction(d: Doc): void {
  const chain = (x: number, n: number) => { let prev = d.addAtom(x, 0); for (let i = 1; i < n; i++) { const a = d.addAtom(x + i * L, 0); d.addBond(prev.id, a.id); prev = a; } };
  chain(0, 2);
  d.addArrow({ ...ARROW, tail: { x: 40, y: 0 }, head: { x: 90, y: 0 } });
  chain(110, 3);
}

describe('Marvin, CML and ChemDoodle files (F107, F547, F548, F549)', () => {
  it('F107: the reaction\'s own arrow is written as its arrow, not the first arrow drawn', () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    // a resonance arrow (a full head at each end) drawn first, far below the reaction
    d.bulk(() => { d.addArrow({ ...ARROW, tail: { x: 300, y: 200 }, head: { x: 350, y: 200 }, tailStyle: 'full' }); reaction(d); });
    const dom = parse(writeMrvFile(d).text);
    const arrow = dom.getElementsByTagName('arrow')[0];
    expect(arrow.getAttribute('type')).toBe('DEFAULT');
    const polys = [...dom.getElementsByTagName('MPolyline')];
    expect(polys).toHaveLength(1);
    // the reaction arrow starts left of the resonance arrow, which stays a plain line
    const lineX = Number(polys[0].getElementsByTagName('MPoint')[0].getAttribute('x'));
    expect(Number(arrow.getAttribute('x1'))).toBeLessThan(lineX);
  });

  it('F548: a wavy bond stays wavy through Marvin and CML', () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => { const a = d.addAtom(0, 0), b = d.addAtom(L, 0), c = d.addAtom(2 * L, L / 2); d.addBond(a.id, b.id, 1, 'wavy'); d.addBond(b.id, c.id); });
    for (const [text, read] of [[writeMrvFile(d).text, readMrv], [writeCmlFile(d).text, readCmlFile]] as const) {
      // Marvin Documents format: bondStereo with convention MDL, conventionValue 4 (the molfile's "either")
      expect(text).toContain('conventionValue="4"');
      expect(read(text)!.mols[0].bonds.some((b) => b.stereo === 'wavy')).toBe(true);
    }
  });

  it('F549: a text holding "]]>" comes back exactly from Marvin', () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => { d.addCaption({ x: 0, y: 0, runs: [{ text: 'a]]>b' }], justify: 'left' }); });
    expect(readMrv(writeMrvFile(d).text)!.texts.map((t) => t.text)).toContain('a]]>b');
  });

  it('F550: a singlet radical saved as ChemDoodle JSON is said, as it opens again as a triplet', () => {
    // BIOVIA CTfile Formats, M  RAD: 1 singlet, 2 doublet, 3 triplet
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => { const c = d.addAtom(0, 0); const h = d.addAtom(L, 0, 1); d.addBond(c.id, h.id); d.updateAtom(c.id, { radical: 'singlet' }); });
    const w = writeChemDoodleJson(d);
    expect((w.notes ?? []).join(' ')).toMatch(/singlet/);
  });

  it('F547: a hydrogen bond written as a single bond is said', () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => { const o = d.addAtom(0, 0, 8), h = d.addAtom(L, 0, 1), n = d.addAtom(2 * L, 0, 7); d.addBond(o.id, h.id); d.addBond(h.id, n.id, 1, 'hydrogen'); });
    for (const w of [writeMrvFile(d), writeCmlFile(d), writeChemDoodleJson(d)]) expect((w.notes ?? []).join(' ')).toMatch(/hydrogen bond/);
  });
});

describe('paste (F108, F109, F552, F553)', () => {
  it('F108: a pasted variable attachment sits on the copy of its ring', () => {
    const d = new Doc();
    const ring: number[] = [];
    d.bulk(() => {
      for (let i = 0; i < 6; i++) ring.push(d.addAtom(100 + L * Math.cos((i * Math.PI) / 3), 100 + L * Math.sin((i * Math.PI) / 3)).id);
      for (let i = 0; i < 6; i++) d.addBond(ring[i], ring[(i + 1) % 6], 1.5);
      const m = d.addAtom(100, 100, 0, { multi: [ring[0], ring[1]], ringOf: [...ring] });
      const r = d.addAtom(100, 130, 8);
      d.addBond(m.id, r.id);
    });
    const sel = insertDrawing(d, extractDrawing(d, null), { x: 300, y: 300 });
    const copy = [...sel.atoms].map((id) => d.atoms.get(id)!).find((a) => a.multi)!;
    expect(copy.ringOf).toHaveLength(6);
    for (const id of copy.ringOf!) expect(sel.atoms.has(id)).toBe(true);
  });

  it('F109: a pasted connector is glued to the pasted shapes, and a reagent arrow to the pasted arrow', () => {
    const d = new Doc();
    let rid = 0;
    d.bulk(() => {
      const a = d.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 20, y2: 20 });
      const b = d.addShape({ kind: 'rect', x1: 100, y1: 0, x2: 120, y2: 20 });
      d.addArrow({ ...ARROW, tail: { x: 20, y: 10 }, head: { x: 100, y: 10 }, from: { shape: a.id, port: 1 }, to: { shape: b.id, port: 3 } });
      rid = d.addArrow({ ...ARROW, tail: { x: 0, y: 60 }, head: { x: 50, y: 60 } }).id;
      d.addArrow({ ...ARROW, tail: { x: 0, y: 80 }, head: { x: 50, y: 80 }, reagentFor: rid });
    });
    const sel = insertDrawing(d, extractDrawing(d, null), { x: 300, y: 300 });
    const arrows = [...sel.arrows].map((id) => d.arrows.get(id)!);
    const glued = arrows.find((r) => r.from)!;
    expect(sel.shapes.has(glued.from!.shape)).toBe(true);
    expect(sel.shapes.has(glued.to!.shape)).toBe(true);
    const reagent = arrows.find((r) => r.reagentFor !== undefined)!;
    expect(sel.arrows.has(reagent.reagentFor!)).toBe(true);
    // and the paste is one undo step
    const before = d.arrows.size;
    d.undo();
    expect(d.arrows.size).toBe(before - 3);
  });

  it('F552: a pasted arrow keeps its animation\'s 1,2-shifts and sliding lines', () => {
    const d = new Doc();
    d.bulk(() => {
      const a = d.addAtom(0, 0), b = d.addAtom(L, 0), c = d.addAtom(2 * L, 0);
      d.addBond(a.id, b.id); d.addBond(b.id, c.id);
      d.addArrow({ ...ARROW, tail: { x: 0, y: 60 }, head: { x: 50, y: 60 }, morph: { shifts: [[a.id, b.id, c.id]], slides: [[[a.id, b.id], [b.id, c.id]]] } });
    });
    const sel = insertDrawing(d, extractDrawing(d, null), { x: 300, y: 300 });
    const m = d.arrows.get([...sel.arrows][0])!.morph!;
    expect(m.shifts).toHaveLength(1);
    expect(m.slides).toHaveLength(1);
    for (const id of [...m.shifts![0], ...m.slides![0].flat()]) expect(sel.atoms.has(id)).toBe(true);
  });

  it('F553: a web address, a file name or a word is not taken as a structure', () => {
    for (const t of ['https://example.org/picture.png', 'example.com/pic.png', 'picture.png', 'Yield']) expect(looksLikeChemistry(t), t).toBe(false);
    // OpenSMILES: organic-subset atoms, brackets, bonds, branches, ring closures
    for (const t of ['CCO', 'Cl/C=C/Br', '[NH4+].[Cl-]', 'C1CC%10CC1']) expect(looksLikeChemistry(t), t).toBe(true);
    // SMILES still are (OpenSMILES: ring closures, aromatic atoms, charges)
    expect(looksLikeChemistry('c1ccccc1O')).toBe(true);
  });

  /** A browser paste event holding these formats. */
  const pasteEvent = (data: Record<string, string>, files: File[] = []) => ({
    clipboardData: { getData: (t: string) => data[t] ?? '', files, types: [...Object.keys(data), ...(files.length ? ['Files'] : [])] },
  }) as unknown as ClipboardEvent;

  it('F553: a paste of a word with a picture gives the picture; with cells, the table; SMILES stays text', async () => {
    // (a stand-in for a File: jsdom's has no arrayBuffer)
    const png = { type: 'image/png', arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer } as unknown as File;
    expect((await readPasteEvent(pasteEvent({ 'text/plain': 'picture.png' }, [png]))).kind).toBe('picture');
    const cells = '<table><tr><td>Yield</td><td>95%</td></tr></table>';
    expect((await readPasteEvent(pasteEvent({ 'text/plain': 'Yield', 'text/html': cells }))).kind).toBe('table');
    expect(await readPasteEvent(pasteEvent({ 'text/plain': 'CCO' }, [png]))).toEqual({ kind: 'text', text: 'CCO' });
  });
});

describe('Batch Convert (F533, F534, F535)', () => {
  // BIOVIA CTfile Formats: a V2000 molfile ends with "M  END"; SD records end with "$$$$"
  const methane = 'methane\n  test\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\nM  END\n';
  it('F533: a record cut off before "M  END" is counted as failed', async () => {
    const sdf = `${methane}$$$$\ncut off\n  test\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n$$$$\n`;
    expect(splitSdf(sdf)).toHaveLength(2);
    const got = await readBatchFile('a.sdf', new TextEncoder().encode(sdf), { style: ACS_1996, smilesToMol: async () => null, molToSmiles: async () => null });
    expect(got.items).toHaveLength(1);
    expect(got.failed).toBe(1);
  });

  it('F534: names Windows can\'t use are made safe', () => {
    // Microsoft, "Naming Files, Paths, and Namespaces": CON, NUL, COM1 … are reserved, and a name may not end in a dot or space
    const used = new Set<string>();
    expect(uniqueName('CON', 'png', used)).toBe('_CON.png');
    expect(uniqueName('nul.tar', 'png', used)).toBe('_nul.tar.png');
    const long = uniqueName('a'.repeat(119) + ' b', 'png', used);
    expect(long).toBe('a'.repeat(119) + '.png');
  });

  it('F535: many equal names are numbered without counting up from 2 each time', () => {
    // (the names looked up are counted, not timed)
    let looks = 0;
    class Counted extends Set<string> { has(v: string): boolean { looks++; return super.has(v); } }
    const used = new Counted();
    let last = '';
    for (let i = 0; i < 2000; i++) last = uniqueName('compound', 'mol', used);
    expect(last).toBe('compound (2000).mol');
    expect(looks).toBeLessThan(3 * 2000);
  });
});

describe('CML, Save dialog, fitting, tables, workspaces, plates (F554, F575, F576, F603, F604, F551)', () => {
  it('F554: a CML atom with no place at all is left out and counted, not put at 0, 0', () => {
    const cml = `<cml xmlns="${CML_NS}"><molecule id="m1"><atomArray><atom id="a1" elementType="C" x2="1" y2="1"/><atom id="a2" elementType="O" x2="2.5" y2="1"/><atom id="a3" elementType="N"/></atomArray>`
      + '<bondArray><bond atomRefs2="a1 a2" order="1"/><bond atomRefs2="a2 a3" order="1"/></bondArray></molecule></cml>';
    const s = readScene('cml', cml)!;
    expect(s.mols[0].atoms.map((a) => a.sym)).toEqual(['C', 'O']);
    expect(s.mols[0].bonds).toHaveLength(1);
    expect(s.leftOut).toBe(1);
  });

  it('F554: atoms with only 3D coordinates are not piled up at the origin (Chem4Word)', () => {
    const cml = `<cml xmlns="${CML_NS}"><molecule id="m1"><atomArray><atom id="a1" elementType="C" x2="1" y2="1"/><atom id="a2" elementType="O" x3="1" y3="2" z3="0"/></atomArray></molecule></cml>`;
    const c = readCml(cml)!;
    expect(c.atoms).toHaveLength(1);
    expect(c.atoms[0].z).toBe(6);
  });

  it('F575: a name with a dot in it still gets the extension', () => {
    const types = [{ extension: 'cdxml' }, { extension: 'cdx' }];
    expect(savedPath('/home/x/Compound 1.5', types)).toBe('/home/x/Compound 1.5.cdxml');
    expect(savedPath('/home/x/Scheme.CDX', types)).toBe('/home/x/Scheme.CDX');
  });

  it('F576: a pasted bold arrow\'s own bold width and dash length are resized with it', () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => { const a = d.addAtom(0, 0), b = d.addAtom(L, 0); d.addBond(a.id, b.id); d.addArrow({ ...ARROW, boldWidth: 2, hashSpacing: 3 }); });
    fitPasted(d, { ...ACS_1996 }, 2 * L);
    const r = [...d.arrows.values()][0];
    expect(r.boldWidth).toBeCloseTo(4, 6);
    expect(r.hashSpacing).toBeCloseTo(6, 6);
  });

  it('F603: a table inside a cell doesn\'t move the cells a joined-down cell reaches', () => {
    const html = '<table><tr><td rowspan="2">A</td><td><table><tr><td>i</td></tr><tr><td>j</td></tr></table></td></tr><tr><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>';
    const rows = parseHtmlTable(html)!;
    const text = (r: number, c: number) => rows[r][c]?.runs.map((x) => x.text).join('') ?? '';
    // row 2: the place under A is kept, B in the second column
    expect([text(1, 0), text(1, 1)]).toEqual(['', 'B']);
    expect([text(2, 0), text(2, 1)]).toEqual(['C', 'D']);
  });

  it('F604: a workspace entry left out doesn\'t move the active or split tab', () => {
    const w = parseWorkspace(JSON.stringify({ kind: 'workspace', tabs: [{ file: '' }, { file: 'a.cdxml' }, { file: 'b.cdxml', beside: 1 }], active: 2 }));
    expect(w.tabs.map((t) => t.file)).toEqual(['a.cdxml', 'b.cdxml']);
    expect(w.active).toBe(1);
    expect(w.tabs[1].beside).toBe(0);
  });

  it('F551: two subscripts side by side sit level, and the text after them goes back up', () => {
    // CDXML spec, TLC Plate: tlcplate corners, tlclane, tlcspot with Rf and ShowRf; face 32 is subscript
    const xml = '<tlcplate TopLeft="0 0" TopRight="100 0" BottomRight="100 100" BottomLeft="0 100"><tlclane><tlcspot Rf="0.5" ShowRf="yes">'
      + '<objecttag Name="rf"><t p="10 10"><s size="7.5">R</s><s size="7.5" face="32">f</s><s size="7.5" face="32">2</s><s size="7.5"> = 0.50</s></t></objecttag></tlcspot></tlclane></tlcplate>';
    const el = parse(xml).documentElement;
    const svg = cdObjectPicture(el, { color: () => undefined, lineWidth: 0.6 })!.svg;
    const spans = [...parse(svg).getElementsByTagName('tspan')];
    // SVG 1.1, 10.5: a tspan's dy moves it from where the text before it ended
    let at = 0;
    const heights = spans.map((s) => (at += Number(s.getAttribute('dy') ?? 0)));
    expect(heights[0]).toBe(0);
    expect(heights[1]).toBeGreaterThan(0);
    expect(heights[2]).toBeCloseTo(heights[1], 6);
    expect(heights[3]).toBeCloseTo(0, 6);
  });
});
