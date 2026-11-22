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
  if (isText(a) || isText(b)) return sa === sb ? [] : [firstDifference(sa, sb)];
  return a.length === b.length && a.every((x, i) => x === b[i]) ? [] : [`bytes differ (${a.length} and ${b.length} bytes)`];
}

const isText = (b: Uint8Array) => !b.subarray(0, 512).some((x) => x === 0);

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
  { name: 'Scheme.mol', make: () => drawingFile('Scheme.mol') },
  { name: 'Scheme.rxn', make: () => drawingFile('Scheme.rxn', reaction) },
  { name: 'Scheme.mrv', make: () => drawingFile('Scheme.mrv') },
  { name: 'Scheme.ket', make: () => drawingFile('Scheme.ket') },
  { name: 'Scheme.cml', make: () => drawingFile('Scheme.cml') },
  { name: 'Scheme.json', make: () => drawingFile('Scheme.json') },
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
 * Formats whose unchanged save differs today (found when this test was added, 2026-11-22), with
 * what differs. Each is a bug to fix; the test fails when one starts to match, so its line goes.
 */
const KNOWN_DIFFERENT: Record<string, string> = {
  // Exchange formats: the first save writes the NMe₃ label as atoms; opened, those are ordinary
  // atoms, so the second save lists the bonds in drawing order and places the methyls where the
  // file had them rather than where the label's layout puts them (about 0.05 Å apart).
  'Scheme.mol': 'bonds come back in another order (the NMe₃ label\'s bonds first, then the rest)',
  'Scheme.mrv': 'bonds come back in another order, and the NMe₃ methyls move by about 0.05',
  'Scheme.cml': 'bonds come back in another order (the NMe₃ label\'s bonds first, then the rest)',
  'Scheme.ket': 'bonds come back in another order (the NMe₃ label\'s bonds first, then the rest)',
  'Scheme.json': 'bonds come back in another order (the NMe₃ label\'s bonds first, then the rest)',
  'Scheme.rxn': 'the product moves closer to the starting material (from 13.9 to 7.1 Å along, measured from the first atom)',
  'Reagents.sdf': "the cell's structure is rebuilt from the drawing, so its coordinates move by about 0.1 Å (audit gap G1-07, being fixed in phase F1)",
  'Talk.pptx': 'the slide drawing\'s CDXML gains CaptionLineHeight="variable" on its caption',
  'Poster.pptx': 'the design\'s CDXML gains CaptionLineHeight="variable" on its caption',
};

describe('open, save unchanged, compare (R2)', () => {
  for (const f of FILES) {
    it(`${f.name} comes back the same`, async () => {
      const first = await f.make();
      const second = await openAndSave(first, f.name);
      const diff = differences(f.name, first, second);
      if (KNOWN_DIFFERENT[f.name]) {
        expect(diff.length, `${f.name} now saves unchanged: delete it from KNOWN_DIFFERENT`).toBeGreaterThan(0);
        return;
      }
      expect(diff.join('\n'), `${f.name} changed on an unchanged save: fix the writer or reader, or (only for a difference that is not a change) add a normalisation with the reason`).toBe('');
    }, 60_000);
  }
});
