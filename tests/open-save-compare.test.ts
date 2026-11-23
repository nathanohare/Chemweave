// @vitest-environment jsdom
//
// Standing rule R2: open a file and save it without changing anything, and the same file comes
// back. For every format Chemweave saves, a file is made here in code (never a file from a
// commercial program: CONTRIBUTING), opened through the app's own Open (Workspace.openBytes) and
// saved through its own Save (Workspace.encode), and the two files are compared byte for byte, or
// after the written normalisations below (each says why that difference is not a change).
//
// The same comparison runs on real ChemDraw, Word, PowerPoint and Excel files on the laptop:
// tests/corpus.test.ts with CHEMWEAVE_CORPUS set (docs/developers.md).
//
// Run alone: npx vitest run tests/open-save-compare.test.ts

import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { unzipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { chemRuns } from '../src/text/chemtext';
import { Workspace, type WorkspaceHooks } from '../src/workspace';
import { type PptxOptions } from '../src/io/pptx-write';
import { Workbook } from '../src/sheet/workbook';
import { readSheetFile, writeSheetFile, type SheetFileDeps } from '../src/io/sheet-files';
import { readDocumentFile, writeDocumentFile } from '../src/io/doc-files';
import { type DocxDeps } from '../src/io/docx';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import * as rt from '../src/richtext';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const pptx: PptxOptions = { async picture(d) { const b = d.bounds(); return b ? { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: b } : null; }, async svgToPng() { return PNG; } };
const docx: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const sheets: SheetFileDeps = { box: () => ({ w: 60, h: 40 }), picture: async () => PNG, settled: async () => {} };

/** The app's shell with the real file code for every kind of tab (as src/main.ts gives it). */
function workspace(): { ws: Workspace; host: Doc } {
  const hooks: WorkspaceHooks = {
    leave: () => {}, enter: () => {}, changed: () => {}, flash: () => {},
    pptx,
    measure: (t: string, s: number) => t.length * s * 0.5,
    sheets: { read: (b, name) => readSheetFile(b, name, sheets), write: (book, name) => writeSheetFile(book, name, sheets) },
    documents: { read: (b, name) => readDocumentFile(b, name, {}), write: (t, name) => writeDocumentFile(t, name, docx) },
  };
  const host = new Doc();
  return { ws: new Workspace(host, hooks), host };
}

const bytesOf = (d: string | Uint8Array) => (typeof d === 'string' ? new TextEncoder().encode(d) : d);

/** Open `bytes` as `name` and save it again unchanged, as the app's Open and Save do. */
async function openAndSave(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const { ws } = workspace();
  expect(await ws.openBytes(bytes, name), `${name} opens`).toBe(true);
  return bytesOf((await ws.encode(ws.active, name)).data);
}

// ---------------------------------------------------------------------------------------------
// What may differ between the two saves, and why

/**
 * Normalisations, per file kind, applied to both files before comparing. Each is a difference that
 * is not a change to the person's work. Keep this list short: anything else that differs is a bug.
 */
const NORMALISE: { kind: RegExp; part?: RegExp; why: string; fix: (s: string) => string }[] = [
  {
    kind: /\.(pptx|xlsx|docx)$/, part: /^docProps\/core\.xml$/,
    why: 'Office files count their saves and keep when they were saved (PowerPoint and Word do the same)',
    fix: (s) => s.replace(/<cp:revision>\d+<\/cp:revision>/, '<cp:revision/>').replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*/g, '$1'),
  },
  {
    kind: /\.(pptx|xlsx|docx)$/,
    why: 'floating-point noise from layout arithmetic (237.78000000000003 against 237.77999999999997): the same number',
    fix: (s) => s.replace(/-?\d+\.\d{9,}/g, (n) => String(Math.round(Number(n) * 1e6) / 1e6)),
  },
  {
    kind: /\.rxn$/,
    why: 'the header lines that name the program that saved the file (RXN line 3, each molfile\'s line 2) say who saved it, not what it holds',
    fix: (s) => s.replace(/^(\$RXN[^\n]*\n[^\n]*\n)[^\n]*/m, '$1<program>').replace(/(\$MOL\n[^\n]*\n)[^\n]*/g, '$1<program>'),
  },
  {
    kind: /\.(mol|rxn|mrv|ket|cml|json|sdf)$/,
    why: 'these formats have no page, so where the whole drawing sits is not part of it: coordinates are compared from the first atom',
    fix: (s) => fromFirstAtom(s),
  },
];

/**
 * Coordinates moved so the first atom is at 0, 0: molfile atom lines (fixed
 * columns), x2/y2 attributes (Marvin, CML), Ketcher's location arrays and ChemDoodle's x/y. (Rounded
 * to 0.1, as the files keep 3 or 4 decimals of different units.)
 */
function fromFirstAtom(s: string): string {
  const pairs: { re: RegExp; at: (m: RegExpMatchArray) => [number, number]; put: (m: RegExpMatchArray, x: string, y: string) => string }[] = [
    { re: /^( *)(-?\d+\.\d{4})( +)(-?\d+\.\d{4})( +-?\d+\.\d{4} [A-Z*][a-z]? .*)$/gm, at: (m) => [Number(m[2]), Number(m[4])], put: (m, x, y) => `${x} ${y}${m[5]}` },
    { re: /x2="(-?[\d.]+)" y2="(-?[\d.]+)"/g, at: (m) => [Number(m[1]), Number(m[2])], put: (_m, x, y) => `x2="${x}" y2="${y}"` },
    { re: /"x": (-?[\d.]+),(\s*)"y": (-?[\d.]+)/g, at: (m) => [Number(m[1]), Number(m[3])], put: (m, x, y) => `"x": ${x},${m[2]}"y": ${y}` },
    { re: /"location": \[(\s*)(-?[\d.]+),(\s*)(-?[\d.]+),/g, at: (m) => [Number(m[2]), Number(m[4])], put: (m, x, y) => `"location": [${m[1]}${x},${m[3]}${y},` },
    { re: /"x":(-?[\d.]+),"y":(-?[\d.]+)/g, at: (m) => [Number(m[1]), Number(m[2])], put: (_m, x, y) => `"x":${x},"y":${y}` },
  ];
  const r = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  for (const p of pairs) {
    const all = [...s.matchAll(p.re)];
    if (!all.length) continue;
    const [x0, y0] = p.at(all[0]);
    s = s.replace(p.re, (...args) => { const m = args.slice(0, -2) as unknown as RegExpMatchArray; const [x, y] = p.at(m); return p.put(m, r(x - x0), r(y - y0)); });
  }
  return s;
}

function normalise(kind: string, part: string, text: string): string {
  let t = text;
  for (const n of NORMALISE) if (n.kind.test(kind) && (!n.part || n.part.test(part))) t = n.fix(t);
  return t;
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;

/** The differences between two files, part by part for zipped (Office) files; empty when the same. */
function differences(kind: string, a: Uint8Array, b: Uint8Array): string[] {
  if (isZip(a) && isZip(b)) {
    const za = unzipSync(a), zb = unzipSync(b);
    const out: string[] = [];
    const names = [...new Set([...Object.keys(za), ...Object.keys(zb)])].sort();
    for (const n of names) {
      if (!za[n]) { out.push(`${n}: only in the second save`); continue; }
      if (!zb[n]) { out.push(`${n}: only in the first save`); continue; }
      const text = /\.(xml|rels|json|txt|vml)$/i.test(n);
      if (!text) { if (za[n].length !== zb[n].length || za[n].some((x, i) => x !== zb[n][i])) out.push(`${n}: bytes differ`); continue; }
      const sa = normalise(kind, n, strFromU8(za[n])), sb = normalise(kind, n, strFromU8(zb[n]));
      if (sa !== sb) out.push(`${n}: ${firstDifference(sa, sb)}`);
    }
    return out;
  }
  const sa = normalise(kind, '', new TextDecoder().decode(a)), sb = normalise(kind, '', new TextDecoder().decode(b));
  if (isText(a) || isText(b)) return sa === sb ? [] : lineDifferences(sa, sb);
  return a.length === b.length && a.every((x, i) => x === b[i]) ? [] : [`bytes differ (${a.length} and ${b.length} bytes)`];
}

const isText = (b: Uint8Array) => !b.subarray(0, 512).some((x) => x === 0);

/** Each line that differs (when both have as many lines), else where the texts first differ. */
function lineDifferences(a: string, b: string): string[] {
  const la = a.split('\n'), lb = b.split('\n');
  if (la.length !== lb.length) return [firstDifference(a, b)];
  return la.flatMap((x, i) => (x === lb[i] ? [] : [`line ${i + 1}: ${JSON.stringify(x.slice(0, 120))} then ${JSON.stringify(lb[i].slice(0, 120))}`]));
}

/** Where two texts first differ, with a little of each around it. */
function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const cut = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 40), i + 60));
  return `first difference at character ${i}: ${cut(a)} then ${cut(b)}`;
}

// ---------------------------------------------------------------------------------------------
// The files, made in code

/** A drawing with a bit of everything: a structure with a label, charge and wedge, a caption with formula text, an arrow and a box. */
function drawing(): Doc {
  const doc = new Doc();
  doc.edit('Draw', () => {
    const L = doc.style.bondLength;
    const a = doc.addAtom(100, 100).id;
    const b = doc.addAtom(100 + L * 0.866, 100 - L / 2).id;
    const c = doc.addAtom(100 + L * 1.732, 100).id;
    const o = doc.addAtom(100 + L * 0.866, 100 - L * 1.5, 8).id;
    const n = doc.addAtom(100 + L * 2.6, 100 - L / 2, 7, { charge: 1, label: 'NMe3' }).id;
    doc.addBond(a, b);
    doc.addBond(b, c);
    doc.addBond(b, o, 2);
    doc.addBond(c, n, 1, 'wedge');
    doc.addCaption({ x: 90, y: 160, runs: chemRuns('CH2Cl2, 25 °C'), justify: 'left' });
    doc.addArrow({ headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5, tail: { x: 200, y: 100 }, head: { x: 260, y: 100 } });
    doc.addShape({ kind: 'rect', x1: 80, y1: 60, x2: 300, y2: 180 });
  });
  return doc;
}

/**
 * The same drawing with no abbreviation label: the ammonium written out as N⁺ and three methyl
 * carbons, so exchange formats (which have no labels) compare exactly. Label expansion is its own case.
 */
function plainDrawing(): Doc {
  const doc = new Doc();
  doc.edit('Draw', () => {
    const L = doc.style.bondLength;
    const a = doc.addAtom(100, 100).id;
    const b = doc.addAtom(100 + L * 0.866, 100 - L / 2).id;
    const c = doc.addAtom(100 + L * 1.732, 100).id;
    const o = doc.addAtom(100 + L * 0.866, 100 - L * 1.5, 8).id;
    const n = doc.addAtom(100 + L * 2.598, 100 - L / 2, 7, { charge: 1 }).id;
    const m1 = doc.addAtom(100 + L * 3.464, 100).id, m2 = doc.addAtom(100 + L * 2.598, 100 - L * 1.5).id, m3 = doc.addAtom(100 + L * 3.464, 100 - L).id;
    doc.addBond(a, b);
    doc.addBond(b, c);
    doc.addBond(b, o, 2);
    doc.addBond(c, n, 1, 'wedge');
    doc.addBond(n, m1); doc.addBond(n, m2); doc.addBond(n, m3);
  });
  return doc;
}

/** A reaction: ethanol to acetaldehyde, an arrow between, set as one step (for RXN files). */
function reaction(): Doc {
  const doc = new Doc();
  doc.edit('Draw', () => {
    const L = doc.style.bondLength;
    const c1 = doc.addAtom(100, 100).id, c2 = doc.addAtom(100 + L * 0.866, 100 - L / 2).id, o1 = doc.addAtom(100 + L * 1.732, 100, 8).id;
    doc.addBond(c1, c2); doc.addBond(c2, o1);
    const d1 = doc.addAtom(300, 100).id, d2 = doc.addAtom(300 + L * 0.866, 100 - L / 2).id, o2 = doc.addAtom(300 + L * 1.732, 100, 8).id;
    doc.addBond(d1, d2); doc.addBond(d2, o2, 2);
    doc.addArrow({ headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5, tail: { x: 180, y: 95 }, head: { x: 270, y: 95 }, step: { reactants: [`a${c1}`], products: [`a${d1}`], above: [], below: [] } });
  });
  return doc;
}

/**
 * An RXN file as another program writes one: this program's own, with its header lines naming
 * another program (made up here, never a file another program made: CONTRIBUTING). Its
 * molecules stand where they were drawn, so they are kept there (F7b Needs Nate 1).
 */
async function otherRxn(): Promise<Uint8Array> {
  const text = new TextDecoder().decode(await drawingFile('Other.rxn', reaction));
  return bytesOf(text.replace(/^(\$RXN[^\n]*\n[^\n]*\n)[^\n]*/m, '$1      OtherProg').replace(/(\$MOL\n[^\n]*\n)[^\n]*/g, '$1  OtherPrg11232622002D'));
}

/** A drawing saved as `name` by the app's own Save. */
async function drawingFile(name: string, make: () => Doc = drawing): Promise<Uint8Array> {
  // the first tab's drawing is the shell's own Doc
  const { ws, host } = workspace();
  host.edit('Draw', () => host.restoreContents(make().contents()));
  return bytesOf((await ws.encode(ws.active, name)).data);
}

/** A presentation (a title slide and a slide with the drawing), or a design, saved by the app's own Save. */
async function slidesFile(design = false): Promise<Uint8Array> {
  const { ws, host } = workspace();
  if (design) ws.newDesign({ w: 720, h: 540 });
  else { const t = ws.newSlides(); t.deck!.addSlide('blank'); }
  host.edit('Draw', () => host.restoreContents(drawing().contents()));
  return bytesOf((await ws.encode(ws.active, 'Talk.pptx')).data);
}

/**
 * A file as ChemDraw writes one, typed here by hand (never a file ChemDraw made: CONTRIBUTING):
 * R-group labels in ChemDraw's own faces, R1 all in formula style and R with a raised 1, an OMe
 * label, a text and two crossing bonds with ChemDraw's Z. Everything this program reads from it
 * is what ChemDraw's attributes say, so saving it unchanged adds no settings tag (review F7b-R01).
 */
const CHEMDRAW_STYLE = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >
<CDXML CreationProgram="ChemDraw 23.1.1.3" BoundingBox="40 40 200 120" LabelFont="3" LabelSize="10" LabelFace="96" CaptionFont="3" CaptionSize="10" BondLength="14.4"><fonttable>
<font id="3" charset="iso-8859-1" name="Arial"/>
</fonttable><page id="1" BoundingBox="0 0 540 720"><fragment id="2" BoundingBox="40 40 140 80"><n id="3" Z="1" p="50 50" NodeType="GenericNickname" GenericNickname="R1"><t id="4" p="46.4 53.6" LabelJustification="Left" LabelAlignment="Left"><s font="3" size="10" face="96">R1</s></t></n><n id="5" Z="2" p="62.47 57.2"/><n id="6" Z="3" p="74.94 50" NodeType="GenericNickname" GenericNickname="R1"><t id="7" p="71.34 53.6" LabelJustification="Left" LabelAlignment="Left"><s font="3" size="10" face="96">R</s><s font="3" size="10" face="64">1</s></t></n><n id="8" Z="4" p="62.47 71.6" NodeType="Fragment"><t id="9" p="58.87 75.2" LabelJustification="Left" LabelAlignment="Left"><s font="3" size="10" face="96">OMe</s></t></n><b id="10" Z="5" B="3" E="5"/><b id="11" Z="6" B="5" E="6"/><b id="12" Z="7" B="5" E="8"/></fragment><fragment id="13" BoundingBox="100 40 140 80"><n id="14" Z="8" p="100 60"/><n id="15" Z="9" p="140 60"/><n id="16" Z="10" p="120 40"/><n id="17" Z="11" p="120 80"/><b id="18" Z="13" B="14" E="15" CrossingBonds="19"/><b id="19" Z="12" B="16" E="17" CrossingBonds="18"/></fragment><t id="20" p="60 110" BoundingBox="60 101 120 112" Justification="Center"><s font="3" size="10" face="0">made up text</s></t></page></CDXML>
`;

/** A workbook or document saved by the app's own Save. */
async function tabFile(name: string): Promise<Uint8Array> {
  const { ws } = workspace();
  if (/\.(xlsx|csv|sdf)$/.test(name)) ws.newSheet(workbook());
  else ws.newDocument(documentText());
  return bytesOf((await ws.encode(ws.active, name)).data);
}

/** Ethanol, for a structure cell. */
function ethanol(): Doc {
  const doc = new Doc();
  doc.bulk(() => { const a = doc.addAtom(0, 0).id, b = doc.addAtom(13, -7.5).id, o = doc.addAtom(26, 0, 8).id; doc.addBond(a, b); doc.addBond(b, o); });
  return doc;
}

function workbook(): Workbook {
  const wb = new Workbook(['Reagents']);
  wb.build(() => {
    wb.sheet.setInput(0, 0, 'Reagent');
    wb.sheet.setInput(0, 1, 'Equiv');
    wb.sheet.setInput(0, 2, 'MW');
    wb.sheet.setInput(1, 0, 'Benzaldehyde');
    wb.sheet.setInput(1, 1, '1');
    wb.sheet.setInput(1, 2, '106.12'); // PubChem CID 240, molecular weight 106.12 g/mol
    wb.sheet.setInput(2, 0, 'Total');
    wb.sheet.setInput(2, 2, '=SUM(C2:C2)');
    wb.sheet.setInput(0, 3, 'Structure');
    wb.sheet.setStructure(1, 3, ethanol().contents());
  });
  return wb;
}

function documentText(): DocText {
  const base = newDocument();
  const n = runStyleOf(base.styles.Normal);
  const N = paraFromStyle(base.styles.Normal, {});
  return { ...base, runs: rt.normalizeRuns([{ ...n, text: 'Synthesis of ' }, { ...n, text: 'benzaldehyde', italic: true }, { ...n, text: '\nThe crude product was purified by flash chromatography.' }]), paras: [N, N] };
}

/** Every format, with how its first file is made. */
const FILES: { name: string; make: () => Promise<Uint8Array> }[] = [
  { name: 'Scheme.cdxml', make: () => drawingFile('Scheme.cdxml') },
  { name: 'Scheme.cdx', make: () => drawingFile('Scheme.cdx') },
  { name: 'Scheme.mol', make: () => drawingFile('Scheme.mol', plainDrawing) },
  { name: 'Scheme.rxn', make: () => drawingFile('Scheme.rxn', reaction) },
  // (as another program writes one: its molecules stay where they stand)
  { name: 'Other.rxn', make: otherRxn },
  { name: 'Scheme.mrv', make: () => drawingFile('Scheme.mrv', plainDrawing) },
  { name: 'Scheme.ket', make: () => drawingFile('Scheme.ket', plainDrawing) },
  { name: 'Scheme.cml', make: () => drawingFile('Scheme.cml', plainDrawing) },
  { name: 'Scheme.json', make: () => drawingFile('Scheme.json', plainDrawing) },
  // (an abbreviation label, NMe3, written out as atoms by a format with no labels)
  { name: 'Labels.mol', make: () => drawingFile('Labels.mol') },
  // (not saved here first: as another program writes one, with R-group labels read from its own faces)
  { name: 'RGroups.cdxml', make: async () => bytesOf(CHEMDRAW_STYLE) },
  { name: 'Talk.pptx', make: () => slidesFile() },
  { name: 'Poster.pptx', make: () => slidesFile(true) },
  { name: 'Reagents.xlsx', make: () => tabFile('Reagents.xlsx') },
  { name: 'Reagents.csv', make: () => tabFile('Reagents.csv') },
  { name: 'Reagents.sdf', make: () => tabFile('Reagents.sdf') },
  { name: 'Report.docx', make: () => tabFile('Report.docx') },
  { name: 'Report.odt', make: () => tabFile('Report.odt') },
  { name: 'Report.rtf', make: () => tabFile('Report.rtf') },
];

/**
 * Formats whose unchanged save differs today (found when this test was added, 2026-11-22). Each
 * entry says why and gives a pattern that every difference line must match, so any other change in
 * the same file still fails. Each is a bug to fix; the test fails when the file starts to match, so
 * its entry goes.
 */
const KNOWN_DIFFERENT: Record<string, { why: string; each: RegExp }> = {};

describe('open, save unchanged, compare (R2)', () => {
  for (const f of FILES) {
    it(`${f.name} comes back the same`, async () => {
      const first = await f.make();
      const second = await openAndSave(first, f.name);
      const diff = differences(f.name, first, second);
      const known = KNOWN_DIFFERENT[f.name];
      if (known) {
        expect(diff.length, `${f.name} now saves unchanged: delete it from KNOWN_DIFFERENT`).toBeGreaterThan(0);
        const other = diff.filter((d) => !known.each.test(d));
        expect(other.join('\n'), `${f.name} changed in a way other than the known one (${known.why})`).toBe('');
        return;
      }
      expect(diff.join('\n'), `${f.name} changed on an unchanged save: fix the writer or reader, or (only for a difference that is not a change) add a normalisation with the reason`).toBe('');
    }, 60_000);
  }
});
