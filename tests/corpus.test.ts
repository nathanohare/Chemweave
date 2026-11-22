// @vitest-environment jsdom
//
// Standing rule R1: check the writers against files saved by the real ChemDraw, Word, PowerPoint
// and Excel. Those files can't be in the repository (CONTRIBUTING: nothing made by a commercial
// program), so this suite reads them from a folder on the computer it runs on, named by the
// environment variable CHEMWEAVE_CORPUS, and is skipped (with a message) where it isn't set, in CI
// too. Nothing is copied from the folder; it is only read. How to run it: docs/developers.md
// ("Checking against real files").
//
// For each .cdxml, .cdx, .pptx, .docx and .xlsx file in the folder and the folders inside it:
//   1. it opens through the app's own Open, and its drawings draw (every structure, slide drawing,
//      figure and cell structure gives a picture with no missing or NaN coordinates);
//   2. Save keeps what it holds: saved and opened again, it has the same atoms, bonds, text,
//      arrows and shapes (counts, and the text itself), the same slides, sheets or paragraphs;
//   3. an Office file keeps the parts Chemweave doesn't use: every part of the original is still in
//      the saved file, and every part Chemweave does not write itself (pictures, embedded objects,
//      fonts, custom XML) is byte for byte the same as the real program's;
//   4. a CDXML file keeps what ChemDraw wrote: every element and attribute name in the original
//      (such as <fragment> or <b Display=…>) is still in the saved file, and names now written
//      fewer times are listed (printed, not failed, since ChemDraw writes some things more than once);
//   5. a second save is the same file as the first (R2's open, save unchanged, compare, on our own
//      save of a real file, with the normalisations of tests/open-save-compare.test.ts).
// CHEM_TEST_FILES (used by tests/cdx.test.ts, stereo-files and warnings-files) is a different
// folder: ChemDraw files whose chemistry (stereo labels, warnings, CDX reading) is compared with
// what ChemDraw shows. The same folder can serve both; CHEMWEAVE_CORPUS also takes Office files.
// Big files need more memory than Node gives by default: set NODE_OPTIONS=--max-old-space-size=8192.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc, type Contents } from '../src/model';
import { Workspace, type WorkspaceHooks, type Tab } from '../src/workspace';
import { recordPicture } from '../src/render/picture';
import { type PptxOptions } from '../src/io/pptx-write';
import { readSheetFile, writeSheetFile, type SheetFileDeps } from '../src/io/sheet-files';
import { readDocumentFile, writeDocumentFile } from '../src/io/doc-files';
import { type DocxDeps } from '../src/io/docx';
import * as rt from '../src/richtext';
import { realFilesMissing } from './real-files';

const DIR = process.env.CHEMWEAVE_CORPUS ?? '';
const KINDS = ['.cdxml', '.cdx', '.pptx', '.docx', '.xlsx'];

/** Every file of the kinds above in the folder and the folders inside it. */
function corpusFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (KINDS.includes(extname(f).toLowerCase()) && !f.startsWith('~$')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

const missing = realFilesMissing('Real-program corpus (R1)', !DIR, 'CHEMWEAVE_CORPUS to a folder of files saved by ChemDraw, Word, PowerPoint and Excel');
const noFolder = !missing && (!existsSync(DIR) || !statSync(DIR).isDirectory());
const files = missing || noFolder ? [] : corpusFiles(DIR);

/**
 * Parts Chemweave writes itself when it saves (so they may differ from the real program's): the
 * package lists, the document properties and the main XML of each format. Every other part of the
 * original must come back byte for byte.
 */
const REWRITTEN = /^(?:\[Content_Types\]\.xml|_rels\/.*|docProps\/(?:app|core)\.xml|docProps\/thumbnail\.\w+|(?:word|ppt|xl)\/(?:.*\/)?[^/]+\.(?:xml|rels))$/;

/** How many times each element and each element@attribute name appears in an XML text. */
function xmlNames(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (k: string) => out.set(k, (out.get(k) ?? 0) + 1);
  for (const m of xml.matchAll(/<([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g)) {
    bump(`<${m[1]}>`);
    for (const a of m[2].matchAll(/([\w:.-]+)\s*=/g)) bump(`<${m[1]} ${a[1]}>`);
  }
  return out;
}

/**
 * What a CDXML save dropped compared with ChemDraw's file: names gone entirely, and names now
 * written fewer times (with the counts).
 */
function cdxmlDropped(original: string, saved: string): { gone: string[]; fewer: string[] } {
  const a = xmlNames(original), b = xmlNames(saved);
  const gone: string[] = [], fewer: string[] = [];
  for (const [k, n] of a) {
    const m = b.get(k) ?? 0;
    if (!m) gone.push(`${k} (${n} in the original)`);
    else if (m < n) fewer.push(`${k} ${n} → ${m}`);
  }
  return { gone: gone.sort(), fewer: fewer.sort() };
}

/**
 * Names Chemweave may leave out of a saved CDXML file, each with its reason. Empty to start: add a
 * name only once a corpus run shows it and the reason is checked (such as a window position that
 * ChemDraw keeps for itself). Anything else that is gone fails the run.
 */
const CDXML_MAY_DROP: { name: string; why: string }[] = [];

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const pptx: PptxOptions = { async picture(d) { const b = d.bounds(); return b ? { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: b } : null; }, async svgToPng() { return PNG; } };
const docx: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const sheets: SheetFileDeps = { box: () => ({ w: 60, h: 40 }), picture: async () => PNG, settled: async () => {} };

function workspace(): Workspace {
  const hooks: WorkspaceHooks = {
    leave: () => {}, enter: () => {}, changed: () => {}, flash: () => {},
    pptx,
    measure: (t: string, s: number) => t.length * s * 0.5,
    sheets: { read: (b, name) => readSheetFile(b, name, sheets), write: (book, name) => writeSheetFile(book, name, sheets) },
    documents: { read: (b, name) => readDocumentFile(b, name, {}), write: (t, name) => writeDocumentFile(t, name, docx) },
  };
  return new Workspace(new Doc(), hooks);
}

const bytesOf = (d: string | Uint8Array) => (typeof d === 'string' ? new TextEncoder().encode(d) : d);

async function open(bytes: Uint8Array, name: string): Promise<{ ws: Workspace; tab: Tab }> {
  const ws = workspace();
  expect(await ws.openBytes(bytes, name), `${name} opens`).toBe(true);
  return { ws, tab: ws.active };
}

/** Every drawing a tab holds: the canvas, each slide, each figure, each cell structure. */
function drawingsOf(ws: Workspace, tab: Tab): Contents[] {
  if (tab.deck) return tab.deck.slides.map((_, i) => tab.deck!.docOf(i).contents());
  if (tab.book) return tab.book.sheets.flatMap((s) => [...s.cells.values()].map((c) => c.structure?.contents).filter((c): c is Contents => !!c));
  if (tab.document) return Object.values(tab.document.t.objects).flatMap((o) => (o.kind === 'drawing' ? [o.contents] : []));
  return [ws.host.contents()];
}

/** What a drawing holds, to compare before and after a save: counts and the text itself. */
function summary(c: Contents): string {
  const text = c.captions.map((x) => rt.plainText(x.runs)).sort().join(' | ');
  const labels = c.atoms.map((a) => a.label ?? String(a.z)).sort().join(',');
  return `${c.atoms.length} atoms (${labels}), ${c.bonds.length} bonds, ${c.arrows.length} arrows, ${c.shapes.length} shapes, text: ${text}`;
}

/** What a tab holds beyond its drawings: slides, sheets and cells, paragraphs. */
function outline(tab: Tab): string {
  if (tab.deck) return `${tab.deck.slides.length} slides; notes: ${tab.deck.slides.map((s) => s.notes).join(' | ')}`;
  if (tab.book) return tab.book.sheets.map((s) => `${s.name}: ${s.cells.size} cells`).join('; ');
  if (tab.document) return `${tab.document.t.paras.length} paragraphs: ${rt.plainText(tab.document.t.runs).replace(/￼/g, '').slice(0, 2000)}`;
  return '';
}

/** Every number in a picture's items is a real number. */
function finite(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finite);
  if (v && typeof v === 'object') return Object.values(v).every(finite);
  return true;
}

/** A picture of each drawing, checked for missing or NaN coordinates. Returns the problems. */
function drawProblems(drawings: Contents[]): string[] {
  const out: string[] = [];
  drawings.forEach((c, i) => {
    // (an empty slide placeholder draws nothing, rightly)
    if (!c.atoms.length && !c.captions.some((x) => rt.plainText(x.runs).trim()) && !c.shapes.length && !c.arrows.length) return;
    const d = new Doc();
    d.restoreContents(c);
    let pic;
    try { pic = recordPicture(d); } catch (e) { out.push(`drawing ${i + 1}: drawing it threw ${String(e).slice(0, 200)}`); return; }
    if (!pic) { out.push(`drawing ${i + 1}: drew nothing`); return; }
    if (!finite(pic.items)) out.push(`drawing ${i + 1}: a coordinate is missing or not a number`);
  });
  return out;
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;

describe.skipIf(missing)('real-program files (R1)', () => {
  it('finds the folder', () => {
    expect(noFolder, `CHEMWEAVE_CORPUS is set to "${DIR}", which is not a folder on this computer. Set it to the folder that holds the real files, or unset it to skip this suite.`).toBe(false);
  });

  it.skipIf(noFolder)('finds files to check', () => {
    expect(files.length, `no ${KINDS.join(', ')} files in ${DIR}`).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = relative(DIR, file);
    it(`${name}: opens and draws, keeps what it holds and its unknown parts, and saves the same twice`, async () => {
      const original = new Uint8Array(readFileSync(file));
      const base = file.replace(/^.*[\\/]/, '');
      const problems: string[] = [];

      // 1. opens and draws
      const a = await open(original, base);
      const before = drawingsOf(a.ws, a.tab);
      problems.push(...drawProblems(before));

      // 2. a save keeps what it holds (CDX is saved as CDXML, the way the app saves it by default)
      const saveName = base.replace(/\.cdx$/i, '.cdxml');
      const first = bytesOf((await a.ws.encode(a.tab, saveName)).data);
      const b = await open(first, saveName);
      const after = drawingsOf(b.ws, b.tab);
      if (before.length !== after.length) problems.push(`${before.length} drawings before the save, ${after.length} after`);
      before.forEach((c, i) => {
        const s1 = summary(c), s2 = after[i] ? summary(after[i]) : '(gone)';
        if (s1 !== s2) problems.push(`drawing ${i + 1} changed: ${s1}\n    now: ${s2}`);
      });
      if (outline(a.tab) !== outline(b.tab)) problems.push(`changed: ${outline(a.tab).slice(0, 300)}\n    now: ${outline(b.tab).slice(0, 300)}`);

      // 3. an Office file's parts are all still there, and the ones Chemweave doesn't write are untouched
      if (isZip(original) && isZip(first)) {
        const zo = unzipSync(original), zf = unzipSync(first);
        const lost = Object.keys(zo).filter((p) => !zf[p] && !/^docProps\/thumbnail\./.test(p));
        if (lost.length) problems.push(`parts not kept: ${lost.join(', ')}`);
        const changed = Object.keys(zo).filter((p) => zf[p] && !REWRITTEN.test(p) && (zo[p].length !== zf[p].length || zo[p].some((x, i) => x !== zf[p][i])));
        if (changed.length) problems.push(`parts Chemweave doesn't write that changed (they should come back byte for byte): ${changed.join(', ')}`);
      }

      // 4. a CDXML file keeps every element and attribute ChemDraw wrote
      if (/\.cdxml$/i.test(base)) {
        const { gone, fewer } = cdxmlDropped(new TextDecoder().decode(original), new TextDecoder().decode(first));
        const lost = gone.filter((g) => !CDXML_MAY_DROP.some((d) => g.startsWith(d.name + ' ')));
        if (lost.length) problems.push(`dropped from ChemDraw's file (element or attribute names no longer written):\n    ${lost.join('\n    ')}`);
        if (fewer.length) console.log(`${name}: written fewer times than in ChemDraw's file:\n  ${fewer.slice(0, 40).join('\n  ')}${fewer.length > 40 ? `\n  … and ${fewer.length - 40} more` : ''}`);
      }

      // 5. a second save is the same file
      const second = bytesOf((await b.ws.encode(b.tab, saveName)).data);
      if (isZip(first)) {
        const z1 = unzipSync(first), z2 = unzipSync(second);
        for (const p of Object.keys(z1)) {
          if (!z2[p]) { problems.push(`second save: ${p} is gone`); continue; }
          const t1 = strFromU8(z1[p]).replace(/<cp:revision>\d+<\/cp:revision>|(<dcterms:(?:created|modified)[^>]*>)[^<]*/g, '$1').replace(/-?\d+\.\d{9,}/g, (n) => String(Math.round(Number(n) * 1e6) / 1e6));
          const t2 = strFromU8(z2[p]).replace(/<cp:revision>\d+<\/cp:revision>|(<dcterms:(?:created|modified)[^>]*>)[^<]*/g, '$1').replace(/-?\d+\.\d{9,}/g, (n) => String(Math.round(Number(n) * 1e6) / 1e6));
          if (t1 !== t2) problems.push(`second save: ${p} differs from the first`);
        }
      } else if (new TextDecoder().decode(first) !== new TextDecoder().decode(second)) problems.push('second save differs from the first');

      expect(problems.join('\n'), `${name}: see docs/developers.md ("Checking against real files")`).toBe('');
    }, 300_000);
  }
});

// The comparisons themselves, on small made-up texts, so they are checked where no corpus is set.
describe('the corpus comparisons', () => {
  it('lists element and attribute names a CDXML save dropped, and ones written fewer times', () => {
    const chemdraw = '<CDXML><page WidthPages="1"><fragment><n id="1" Element="7"/><n id="2"/></fragment><t Warning="x"/></page></CDXML>';
    const saved = '<CDXML><page><fragment><n id="1"/></fragment></page></CDXML>';
    const { gone, fewer } = cdxmlDropped(chemdraw, saved);
    expect(gone).toEqual(['<n Element> (1 in the original)', '<page WidthPages> (1 in the original)', '<t Warning> (1 in the original)', '<t> (1 in the original)']);
    expect(fewer).toEqual(['<n id> 2 → 1', '<n> 2 → 1']);
    expect(cdxmlDropped(chemdraw, chemdraw)).toEqual({ gone: [], fewer: [] });
  });

  it('expects the parts Chemweave does not write to come back byte for byte', () => {
    for (const p of ['word/document.xml', 'word/_rels/document.xml.rels', 'ppt/slides/slide3.xml', 'xl/worksheets/sheet1.xml', '[Content_Types].xml', 'docProps/core.xml'])
      expect(REWRITTEN.test(p), p).toBe(true);
    for (const p of ['word/media/image1.png', 'ppt/embeddings/oleObject1.bin', 'customXml/item1.xml', 'docProps/custom.xml', 'xl/vbaProject.bin', 'word/fonts/font1.odttf'])
      expect(REWRITTEN.test(p), p).toBe(false);
  });
});
