// @vitest-environment jsdom
//
// Speed of the work behind each mode, without a browser: `npm run bench:core`. These run in
// Node with jsdom, so the numbers are for comparing one version of the code with another, not
// for what a person sees (bench/baseline.mjs times the real app in Chromium).
// `npm run bench:core -- --outputJson bench/results/core.json` keeps the numbers;
// `--compare <that file>` shows what changed since.

import { bench, describe } from 'vitest';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { crossingGaps } from '../src/chem/crossing';
import { freeRing, placeRing } from '../src/chem/chemgeom';
import { Workbook } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import * as rt from '../src/richtext';
import type { TextRun } from '../src/model';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { allWarnings } from '../src/si/checks';
import { compileSi } from '../src/si/compile-doc';
import { molFacts, symmetryClasses, type MolFacts } from '../src/si/chem';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';

const L = 14.4;
const measure = (t: string, size: number) => t.length * size * 0.5;

/** n benzene-sized rings in rows, with long bonds across neighbours so there are crossings. */
function rings(n: number): Doc {
  const doc = new Doc();
  doc.edit('rings', () => {
    const out: number[][] = [];
    for (let i = 0; i < n; i++) out.push(placeRing(doc, freeRing({ x: (i % 40) * 2.2 * L, y: Math.floor(i / 40) * 2.2 * L }, 6, L), {}));
    for (let i = 0; i + 1 < n; i += 2) doc.addBond(out[i][0], out[i + 1][3], 1);
  });
  return doc;
}

describe('drawing (1,000 rings, 6,000 atoms)', () => {
  const doc = rings(1000);
  const text = writeCdxml(doc, { name: 'bench' });
  bench('save CDXML', () => { writeCdxml(doc, { name: 'bench' }); }, { iterations: 5 });
  bench('open CDXML', () => { readCdxml(text); }, { iterations: 5 });
  bench('crossing gaps for every bond, from scratch', () => { for (const b of doc.bonds.values()) crossingGaps(doc, b, 2); }, { iterations: 5 });
});

describe('sheet (20,000 formulas)', () => {
  const book = () => {
    const wb = new Workbook(['Data']);
    const s = wb.sheets[0];
    wb.edit('fill', () => {
      for (let r = 0; r < 5000; r++) {
        s.setInput(r, 0, String(r));
        s.setInput(r, 1, `=A${r + 1}*2`);
        s.setInput(r, 2, `=B${r + 1}+A${r + 1}`);
        s.setInput(r, 3, `=IF(C${r + 1}>100,"big","small")`);
        s.setInput(r, 4, `=SUM(A$1:A${r + 1})`);
      }
    });
    return wb;
  };
  const wb = book();
  let n = 0;
  bench('fill 20,000 formulas', () => { book(); }, { iterations: 3 });
  bench('type one value (recalculate what reads it)', () => { wb.edit('type', () => wb.sheets[0].setInput(2500, 0, String(n++))); }, { iterations: 20 });
  const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), async picture() { return 'data:image/png;base64,'; } };
  let bytes: Uint8Array;
  bench('save .xlsx', async () => { bytes = await writeXlsx(wb, pictures); }, { iterations: 3 });
  bench('open .xlsx', async () => { bytes ??= await writeXlsx(wb, pictures); await readXlsx(bytes); }, { iterations: 3 });
});

describe('document (60,000 words)', () => {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  const para = 'The crude product was purified by flash chromatography on silica gel (CH2Cl2/MeOH) to give 3a as a white solid. ';
  const runs: TextRun[] = [];
  const count = 1500;
  for (let i = 0; i < count; i++) { if (i) runs.push({ ...n, text: '\n' }); runs.push({ ...n, text: para.repeat(3) }); }
  const N = paraFromStyle(d.styles.Normal, {});
  const t: DocText = { ...d, runs: rt.normalizeRuns(runs), paras: Array.from({ length: count }, () => N), objects: {} };
  const deps: DocxDeps = { async picture() { return { png: new Uint8Array(), w: 1, h: 1 }; }, async svgToPng() { return new Uint8Array(); } };
  bench('lay out every page', () => { new DocLayouter({ measure, drawingSize: () => ({ w: 80, h: 40 }) }).layout(t); }, { iterations: 3 });
  let bytes: Uint8Array;
  bench('save .docx', async () => { bytes = await writeDocx(t, deps); }, { iterations: 3 });
  bench('open .docx', async () => { bytes ??= await writeDocx(t, deps); await readDocx(bytes); }, { iterations: 3 });
});

// (every import above is one the branch a pull request merges into has too: the speed check
// times this file against that branch's code)

/** tests/fixtures/si-example with its compounds copied until there are `n`, as one SI project folder. */
function siFolder(n: number): MemoryFolder {
  const root = join(__dirname, '..', 'tests', 'fixtures', 'si-example');
  const f = new MemoryFolder('si-bench');
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(root, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  const dec = new TextDecoder(), enc = new TextEncoder();
  const sectionPath = [...f.files.keys()].find((k) => /\/section\.json$/.test(k) && [...f.files.keys()].some((x) => x.startsWith(k.replace('section.json', 'compounds/c-'))))!;
  const dir = sectionPath.replace('section.json', 'compounds/');
  const section = JSON.parse(dec.decode(f.files.get(sectionPath)));
  const originals = [...new Set([...f.files.keys()].filter((k) => k.startsWith(dir + 'c-')).map((k) => k.slice(dir.length).split('/')[0]))];
  let have = [...f.files.keys()].filter((k) => k.endsWith('/compound.json')).length;
  for (let i = 0; have < n; i++, have++) {
    const from = originals[i % originals.length];
    const id = `c-${(0xb0000000 + i).toString(16)}`;
    for (const [k, v] of [...f.files]) {
      if (!k.startsWith(`${dir}${from}/`)) continue;
      const to = `${dir}${id}_copy/${k.split('/').pop()}`;
      if (k.endsWith('compound.json')) {
        const c = JSON.parse(dec.decode(v));
        c.id = id;
        c.id_override = '';
        f.files.set(to, enc.encode(JSON.stringify(c)));
      } else f.files.set(to, v);
    }
    section.compound_order.push(id);
  }
  f.files.set(sectionPath, enc.encode(JSON.stringify(section)));
  return f;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RDKit: any = await createRequire(import.meta.url)('@rdkit/rdkit')();

describe('SI project (300 compounds)', async () => {
  const folder = siFolder(300);
  const p = await SiProject.open(folder);
  // (each structure's facts worked out once: the chemistry engine is timed below)
  const facts = new Map<string, MolFacts | null>();
  const factsOf = (mol: string): MolFacts | null => {
    if (!facts.has(mol)) facts.set(mol, mol ? molFacts(RDKit, mol) : null);
    return facts.get(mol)!;
  };
  const mols = new Map<string, string>();
  for (const c of p.compounds) mols.set(c.id, await p.readStructure(c));
  bench('open', async () => { await SiProject.open(folder); }, { iterations: 5 });
  bench('check every compound', () => {
    const ids = p.idReport();
    for (const c of p.compounds) allWarnings(p, c, ids, factsOf(mols.get(c.id) ?? ''));
  }, { iterations: 5 });
  bench('compile into a document', async () => {
    await compileSi(p, {
      contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
      sizeOf: () => null,
      facts: async (list) => list.map((m) => (m ? factsOf(m) : null)),
    });
  }, { iterations: 3 });
});

/** A V2000 molfile of an unbranched chain of n carbons. */
function chainMolfile(n: number): string {
  const head = ['', '  bench', '', `${String(n).padStart(3)}${String(n - 1).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`];
  const atoms = Array.from({ length: n }, (_, i) => `${(i * 1.3).toFixed(4).padStart(10)}${((i % 2) * 0.75).toFixed(4).padStart(10)}${'0.0000'.padStart(10)} C   0  0  0  0  0  0  0  0  0  0  0  0`);
  const bonds = Array.from({ length: n - 1 }, (_, i) => `${String(i + 1).padStart(3)}${String(i + 2).padStart(3)}  1  0`);
  return [...head, ...atoms, ...bonds, 'M  END', ''].join('\n');
}

describe('chemistry engine (long chains)', () => {
  // (450 atoms: below where the chemistry engine runs out of stack writing SMILES, so the code
  // being merged into, which has no guard for that, takes the same path and the two compare)
  const chain = chainMolfile(450);
  bench('formula, masses and 13C count of a 450-atom chain', () => { molFacts(RDKit, chain); }, { iterations: 3, warmupIterations: 1 });
  const n = 1000;
  const atoms = Array.from({ length: n }, (_, i) => ({ z: 6, isotope: 0, impHs: i === 0 || i === n - 1 ? 3 : 2, chg: 0 }));
  const bonds = Array.from({ length: n - 1 }, (_, i): [number, number, number] => [i, i + 1, 1]);
  bench('13C symmetry classes of a 1,000-atom chain', () => { symmetryClasses(atoms, bonds); }, { iterations: 3, warmupIterations: 1 });
});

describe('slides (100 slides)', () => {
  const deck = new Deck();
  for (let i = 0; i < 100; i++) {
    deck.insertSlide(i, 'blank', (d) => {
      const r = placeRing(d, freeRing({ x: 200 + (i % 5) * 40, y: 200 }, 6, L), {});
      d.addBond(r[0], d.addAtom(d.atoms.get(r[0])!.x, d.atoms.get(r[0])!.y - L, 8).id, 1);
    });
  }
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const opts: PptxOptions = { async picture() { return { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: { x1: 190, y1: 170, x2: 420, y2: 230 } }; }, async svgToPng() { return PNG; } };
  const data = () => ({ size: deck.size, master: deck.master, slides: deck.slides.map((s) => ({ layout: s.layout, doc: s.doc, notes: s.notes })) });
  let bytes: Uint8Array;
  // (one warm-up run: under jsdom each open of the same file takes a little longer than the one before)
  bench('save .pptx', async () => { bytes = await writePptx(data(), opts); }, { iterations: 3, warmupIterations: 1 });
  bench('open .pptx', async () => { bytes ??= await writePptx(data(), opts); readPptx(bytes); }, { iterations: 3, warmupIterations: 1 });
});
