// @vitest-environment jsdom
//
// Where compound structures go in the compiled SI and how the text wraps round them (Position and
// Wrap Text: si/placement.ts): the project's choice and each structure's own, kept in project.json;
// the compiled document (the structure floating from the line under the title, the next compound
// starting below it); the layout of a figure lined up in the margins and of a paragraph that
// clears the figures beside it; and both going to Word and back. Figures float with their
// captions in a frame (ParaStyle.frame, Word's text frame): the same, for them.

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, type CompiledSi } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import * as rt from '../src/richtext';
import { OBJECT_CHAR, newDocument, objectRun, paraFromStyle, runStyleOf, floatOf as docFloatOf, type DocObject, type DocText } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { CLEAR_PARA } from '../src/io/docx-write';
import { editParas } from '../src/text/paragraphs';
import { withFloats } from '../src/document/arrange';
import type { TextRun } from '../src/model';
import {
  DEFAULT_PLACEMENT, DEFAULT_FIGURE_PLACEMENT, clearOwnPlacements, figureFrame, figureKey, floatOf, ownPlacement, ownPlacementCount, placementOf, projectPlacement,
  storeOwnPlacement, storeProjectPlacement, structureKey,
} from '../src/si/placement';
import { framePrXml } from '../src/io/docx-write';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

function folder(dir: string): MemoryFolder {
  const root = join(__dirname, 'fixtures', dir);
  const f = new MemoryFolder(dir);
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(root, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  return f;
}

async function compile(change?: (s: Json) => void): Promise<{ got: CompiledSi; p: SiProject }> {
  const p = await SiProject.open(folder('si-example'));
  change?.(p.settings);
  const got = await compileSi(p, {
    contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
    sizeOf: () => ({ w: 100, h: 50 }),
    facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
  });
  return { got, p };
}

/** Each paragraph's text and settings. */
const paragraphs = (t: DocText) => plainText(t.runs).split('\n').map((text, i) => ({ text, ps: t.paras[i] ?? {} }));
/** The object at the start of a paragraph's text. */
function objectAt(t: DocText, para: number): DocObject | undefined {
  let p = 0;
  let atStart = true;
  for (const r of t.runs) {
    if (p === para && atStart && r.obj !== undefined) return t.objects[r.obj];
    for (const ch of r.text) { if (ch === '\n') { p++; atStart = true; } else atStart = false; }
    if (p > para) break;
  }
  return undefined;
}

describe('the project’s and a structure’s own placement', () => {
  it('starts at the left with the text wrapping square, the title above (Nate, 2026-11-24)', () => {
    expect(projectPlacement({})).toEqual({ position: 'left', wrap: 'square', top: 'below', gap: 0.3 });
    expect(placementOf({}, structureKey('c-1'))).toEqual(DEFAULT_PLACEMENT);
  });

  it('keeps a structure’s own choice only where it differs from the project’s', () => {
    const s: Json = {};
    storeOwnPlacement(s, structureKey('c-1'), { position: 'right', wrap: 'square' });
    expect(ownPlacement(s, structureKey('c-1'))).toEqual({ position: 'right' });
    expect(placementOf(s, structureKey('c-1')).position).toBe('right');
    expect(placementOf(s, structureKey('c-2')).position).toBe('left');
    expect(ownPlacementCount(s)).toBe(1);
    // back to the project's: nothing of its own kept
    storeOwnPlacement(s, structureKey('c-1'), null);
    expect(s.chemweave_layout).toEqual({});
  });

  it('a change to the project’s moves every structure without a choice of its own', () => {
    const s: Json = {};
    storeOwnPlacement(s, structureKey('c-1'), { wrap: 'topBottom' });
    storeProjectPlacement(s, { ...DEFAULT_PLACEMENT, position: 'inline' });
    expect(placementOf(s, structureKey('c-2')).position).toBe('inline');
    expect(placementOf(s, structureKey('c-1')).wrap).toBe('topBottom');
    clearOwnPlacements(s);
    expect(ownPlacementCount(s)).toBe(0);
    expect(placementOf(s, structureKey('c-1')).wrap).toBe('square');
  });

  it('reads only choices it knows, and keeps the room to the text within reason', () => {
    const s: Json = { chemweave_layout: { structures: { position: 'diagonal', wrap: 'tight', top: 'below', gap: 99 }, items: { 'c:c-1': { position: 7 } } } };
    expect(projectPlacement(s)).toEqual({ ...DEFAULT_PLACEMENT, gap: 5 });
    expect(ownPlacement(s, 'c:c-1')).toEqual({});
  });

  it('places a figure in the margins as Word lines it up, with the room beside it', () => {
    expect(floatOf({ ...DEFAULT_PLACEMENT, position: 'inline' }, 100, 468)).toBeUndefined();
    // 0.3 cm = 8.5 pt (72 pt to the inch, 2.54 cm to the inch)
    expect(floatOf(DEFAULT_PLACEMENT, 100, 468)).toEqual({ wrap: 'square', x: 0, y: 0, align: 'left', gap: 8.5, gapTop: 0, gapBottom: 4.25 });
    expect(floatOf({ ...DEFAULT_PLACEMENT, position: 'right' }, 100, 468)?.x).toBe(368);
    expect(floatOf({ ...DEFAULT_PLACEMENT, position: 'center' }, 100, 468)?.x).toBe(184);
  });
});

describe('structures in the compiled SI', () => {
  it('floats each structure at the left from the first line under its title, and starts the next compound below it', async () => {
    const { got } = await compile();
    const ps = paragraphs(got.doc);
    const a = ps.findIndex((x) => x.text === '1-Phenylethan-1-ol (2a).');
    expect(ps[a + 1].text.startsWith(`${OBJECT_CHAR}Prepared according to General Procedure A`)).toBe(true);
    const s = objectAt(got.doc, a + 1)!;
    expect(s.kind).toBe('drawing');
    expect(docFloatOf(s)).toMatchObject({ wrap: 'square', align: 'left', x: 0, y: 0, name: 'Compound structure 2a' });
    // the next compound's title starts below it
    const b = ps.findIndex((x) => x.text === '1-(4-Methoxyphenyl)ethan-1-ol (2b).');
    expect(ps[b].ps.clear).toBe(true);
    expect(ps[a].ps.clear).toBeFalsy();
    // and the Live Preview knows which object is which compound's
    const ref = got.structures.find((x) => got.doc.objects[x.obj] === s);
    expect(ref?.compound).toBe('c-26c39a99');
  });

  it('puts a structure in the line, centered on a line of its own, as SI Assistant prints it', async () => {
    const { got } = await compile((s) => storeProjectPlacement(s, { ...DEFAULT_PLACEMENT, position: 'inline' }));
    const ps = paragraphs(got.doc);
    const a = ps.findIndex((x) => x.text === '1-Phenylethan-1-ol (2a).');
    expect(ps[a + 1].text).toBe(OBJECT_CHAR);
    expect(ps[a + 1].ps.align).toBe('center');
    expect(docFloatOf(objectAt(got.doc, a + 1))).toBeUndefined();
    expect(ps.some((x) => x.ps.clear)).toBe(false);
    expect(got.structures.length).toBeGreaterThan(0);
  });

  it('floats a structure from its title, or on its own side, when it says so', async () => {
    const { got } = await compile((s) => {
      storeOwnPlacement(s, structureKey('c-26c39a99'), { top: 'title', position: 'right', wrap: 'topBottom' });
    });
    const ps = paragraphs(got.doc);
    const a = ps.findIndex((x) => x.text === `${OBJECT_CHAR}1-Phenylethan-1-ol (2a).`);
    expect(a).toBeGreaterThan(0);
    expect(docFloatOf(objectAt(got.doc, a))).toMatchObject({ wrap: 'topBottom', align: 'right' });
    // the others keep the project's
    const b = ps.findIndex((x) => x.text === '1-(4-Methoxyphenyl)ethan-1-ol (2b).');
    expect(docFloatOf(objectAt(got.doc, b + 1))).toMatchObject({ align: 'left', wrap: 'square' });
  });
});

// ---------------------------------------------------------------- the layout, and Word

const measure = (t: string, size: number) => t.length * size * 0.5;
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 80, h: 40 }) });
const WORDS = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp ';
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };

/** Paragraphs of text, the first starting with a picture 144 × 72 pt floating as `float` says. */
function doc(paras: string[], float: Extract<DocObject, { kind: 'picture' }>['float'], clear?: number): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  const runs: TextRun[] = [];
  paras.forEach((text, i) => {
    if (i) runs.push({ ...n, text: '\n' });
    if (i === 0) runs.push(objectRun(1, n));
    runs.push({ ...n, text });
  });
  const N = paraFromStyle(d.styles.Normal, {});
  return { ...d, runs: rt.normalizeRuns(runs), paras: paras.map((_, i) => (i === clear ? { ...N, clear: true } : N)), objects: { 1: { kind: 'picture', src: DOT, w: 144, h: 72, px: { w: 1, h: 1 }, float } } };
}

describe('a figure lined up in the margins, and text that clears it', () => {
  it('lines the figure up at the right of the margins whatever its x', () => {
    const t = doc([WORDS, WORDS], { wrap: 'square', x: 5, y: 0, align: 'right' });
    const o = layouter().layout(t).objects.find((x) => x.id === 1)!;
    expect(o.x + o.w).toBeCloseTo(t.page.w - t.page.right);
    const c = doc([WORDS], { wrap: 'square', x: 5, y: 0, align: 'center' });
    const oc = layouter().layout(c).objects.find((x) => x.id === 1)!;
    expect(oc.x + oc.w / 2).toBeCloseTo((c.page.left + c.page.w - c.page.right) / 2);
  });

  it('starts a clearing paragraph below the figure the short text beside it wraps round', () => {
    const short = 'aaaa bbbb';
    const plain = layouterLines(doc([short, WORDS], { wrap: 'square', x: 0, y: 0, align: 'left', gapBottom: 4 }));
    const cleared = layouterLines(doc([short, WORDS], { wrap: 'square', x: 0, y: 0, align: 'left', gapBottom: 4 }, 1));
    // without: the second paragraph starts beside the figure; with: at the margin, below it (72 pt + 4 pt)
    expect(plain.second.x).toBeGreaterThan(plain.left + 100);
    expect(cleared.second.x).toBeCloseTo(cleared.left);
    expect(cleared.second.top).toBeGreaterThanOrEqual(cleared.figBottom + 4 - 0.01);
  });

  it('a paragraph split by Enter leaves the clearing with its first part', () => {
    const out = editParas([{ clear: true }], 'abc', 1, 1, '\n');
    expect(out[0].clear).toBe(true);
    expect(out[1].clear).toBeUndefined();
  });

  it('a figure moved to a place of its own is no longer lined up', () => {
    const t = doc([WORDS], { wrap: 'square', x: 0, y: 0, align: 'left' });
    expect(docFloatOf(withFloats(t, [[1, { x: 40 }]]).objects[1])?.align).toBeUndefined();
    expect(docFloatOf(withFloats(t, [[1, { y: 40 }]]).objects[1])?.align).toBe('left');
  });

  it('goes to Word as an aligned anchor and a clearing break, and comes back the same', async () => {
    const t = doc([WORDS, 'second', 'third'], { wrap: 'square', x: 0, y: 0, align: 'left' }, 1);
    const bytes = await writeDocx(t, deps);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>');
    expect(xml).toContain('<wp:wrapSquare wrapText="largest"/>');
    // the clearing paragraph comes just before the second paragraph, once
    expect(xml.split(CLEAR_PARA).length).toBe(2);
    expect(xml.indexOf(CLEAR_PARA)).toBeLessThan(xml.indexOf('second'));
    expect(xml.indexOf(CLEAR_PARA)).toBeGreaterThan(xml.indexOf('pppp'));
    const back = (await readDocx(bytes, deps)).doc;
    const ps = paragraphs(back);
    expect(ps.map((x) => x.text.replace(OBJECT_CHAR, ''))).toEqual([WORDS, 'second', 'third']);
    expect(ps.map((x) => !!x.ps.clear)).toEqual([false, true, false]);
    const fl = Object.values(back.objects).map(docFloatOf).find(Boolean);
    expect(fl).toMatchObject({ wrap: 'square', align: 'left' });
  });
});

function layouterLines(t: DocText): { second: { x: number; top: number }; left: number; figBottom: number } {
  const lay = layouter().layout(t);
  const text = plainText(t.runs);
  const at = text.indexOf('\n') + 1;
  const line = lay.text.lines.find((l) => l.start <= at && at <= l.end && l.start >= at - 1)!;
  const o = lay.objects.find((x) => x.id === 1)!;
  return { second: { x: line.x, top: line.y - (line.above ?? line.ascent) }, left: t.page.left, figBottom: o.y + o.h };
}

/** The example project with a figure (a 60 × 40 pt picture, 5 cm wide) at the end of its Reaction Optimization text, then a paragraph and a heading after it. */
async function withFigure(change?: (s: Json) => void): Promise<{ got: CompiledSi; paras: { text: string; ps: DocText['paras'][number] }[] }> {
  const f = folder('si-example');
  const p = await SiProject.open(f);
  const s = p.sections.find((x) => x.type === 'text' && x.folder.includes('reaction-optimizatio'))!;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60pt" height="40pt" viewBox="0 0 60 40"><path d="M0 0L60 40"/></svg>';
  const rel = await p.addSectionPicture(s, 'structure.svg', new TextEncoder().encode(svg));
  s.data.figures = { ...((s.data.figures as Json) ?? {}), 'f-0000abcd': { file: rel, width: 5 } };
  await p.saveSection(s);
  await p.writeSectionText(s, `${(await p.readSectionText(s)).trimEnd()}\n!figure{f-0000abcd} Structure of the product\nText beside the figure.\n# A heading after it`);
  const again = await SiProject.open(f);
  change?.(again.settings);
  const got = await compileSi(again, { contentsOf: () => null, sizeOf: () => null, facts: async (m) => m.map(() => null) });
  return { got, paras: paragraphs(got.doc) };
}

describe('figures with their captions', () => {
  it('keep their own choices apart from the structures, with only the wraps a frame has', () => {
    const s: Json = {};
    expect(projectPlacement(s, 'figures')).toEqual(DEFAULT_FIGURE_PLACEMENT);
    storeOwnPlacement(s, figureKey('f-1'), { position: 'right', wrap: 'behind' });
    // (Behind Text isn't kept for a figure: its caption is text in a frame)
    expect(ownPlacement(s, figureKey('f-1'))).toEqual({ position: 'right' });
    storeOwnPlacement(s, structureKey('c1'), { position: 'center' });
    expect(ownPlacementCount(s, 'figures')).toBe(1);
    expect(ownPlacementCount(s)).toBe(1);
    clearOwnPlacements(s, 'figures');
    expect(ownPlacementCount(s, 'figures')).toBe(0);
    expect(ownPlacement(s, structureKey('c1'))).toEqual({ position: 'center' });
    storeProjectPlacement(s, { ...DEFAULT_FIGURE_PLACEMENT, position: 'left' }, 'figures');
    expect(placementOf(s, figureKey('f-2')).position).toBe('left');
    expect(placementOf(s, structureKey('c2')).position).toBe(DEFAULT_PLACEMENT.position);
  });

  it('frames a figure: the picture\'s width (2 inches at least), Top and Bottom in the middle', () => {
    const p = { ...DEFAULT_FIGURE_PLACEMENT, position: 'right' as const };
    expect(figureFrame(DEFAULT_FIGURE_PLACEMENT, 200, 468)).toBeUndefined();
    expect(figureFrame(p, 200, 468)).toEqual({ w: 200, align: 'right', wrap: 'square', gap: 8.5 });
    expect(figureFrame(p, 60, 468)?.w).toBe(144);
    expect(figureFrame(p, 600, 468)?.w).toBe(468);
    expect(figureFrame({ ...p, position: 'center' }, 200, 468)?.wrap).toBe('topBottom');
  });

  it('prints in the line by default, as before', async () => {
    const { paras } = await withFigure();
    expect(paras.some((x) => x.ps.frame)).toBe(false);
  });

  it('floats with its caption when placed, the heading after it starting below', async () => {
    const { got, paras } = await withFigure((s) => storeOwnPlacement(s, figureKey('f-0000abcd'), { position: 'left' }));
    const fig = paras.findIndex((x) => x.text === OBJECT_CHAR && x.ps.frame);
    expect(fig).toBeGreaterThan(-1);
    const frame = paras[fig].ps.frame!;
    // 5 cm wide picture (141.73 pt): the frame 2 inches (144 pt)
    expect(frame).toEqual({ w: 144, align: 'left', wrap: 'square', gap: 8.5 });
    expect(paras[fig + 1].text).toMatch(/Structure of the product/);
    expect(paras[fig + 1].ps.frame).toEqual(frame);
    expect(paras[fig + 2].text).toBe('Text beside the figure.');
    expect(paras[fig + 2].ps.frame).toBeUndefined();
    expect(paras[fig + 2].ps.clear).toBeUndefined();
    expect(paras[fig + 3].text).toMatch(/A heading after it/);
    expect(paras[fig + 3].ps.clear).toBe(true);
    // picked in the Live Preview by its key
    expect(got.structures.some((x) => x.key === figureKey('f-0000abcd') && got.doc.objects[x.obj]?.kind === 'picture')).toBe(true);
  });

  it('is laid out at the right with the caption under the picture and the text beside them', () => {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const N = paraFromStyle(d.styles.Normal, {});
    const frame = { w: 150, align: 'right' as const, wrap: 'square' as const, gap: 6 };
    const runs = rt.normalizeRuns([objectRun(1, n), { ...n, text: '\nFigure 1. A caption long enough to need two lines in the frame\n' + WORDS.repeat(16) }]);
    const t: DocText = { ...d, runs, paras: [{ ...N, frame }, { ...N, frame }, N], objects: { 1: { kind: 'picture', src: DOT, w: 140, h: 72, px: { w: 1, h: 1 } } } };
    const lay = layouter().layout(t);
    const text = plainText(t.runs);
    const W = lay.textW, left = t.page.left;
    const lineOf = (at: number) => lay.text.lines.filter((l) => l.start <= at && at <= l.end)[0];
    const pic = lay.objects.find((o) => o.id === 1)!;
    // the picture at the left of the frame (its paragraph is left-aligned), the frame at the right of the margins
    expect(pic.x).toBeCloseTo(left + W - 150, 0);
    // the caption in the frame, under the picture, on two lines or more
    const capStart = text.indexOf('Figure 1.'), capEnd = text.indexOf(WORDS) - 1;
    const capLines = lay.text.lines.filter((l) => l.start >= capStart && l.end <= capEnd);
    expect(capLines.length).toBeGreaterThan(1);
    for (const l of capLines) expect(l.x).toBeGreaterThanOrEqual(left + W - 150 - 0.5);
    expect(capLines[0].y).toBeGreaterThan(pic.y + pic.h);
    // the text after it beside the frame from the frame's top, then the whole width below it
    const first = lineOf(text.indexOf(WORDS));
    expect(first.y).toBeLessThan(pic.y + pic.h);
    const frameBottom = Math.max(...capLines.map((l) => l.y));
    const all = lay.text.lines.filter((l) => l.start >= text.indexOf(WORDS));
    const beside = all.filter((l) => l.y < frameBottom);
    expect(beside.length).toBeGreaterThan(2);
    for (const l of beside) expect(l.x + l.width).toBeLessThanOrEqual(left + W - 150 - 6 + 0.5);
    expect(all.some((l) => l.y > frameBottom + 30 && l.width > W - 150)).toBe(true);
  });

  it('goes to Word as a text frame and comes back the same', async () => {
    const frame = { w: 150, align: 'right' as const, wrap: 'square' as const, gap: 6 };
    expect(framePrXml(frame)).toBe('<w:framePr w:w="3000" w:hSpace="120" w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:xAlign="right"/>');
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const N = paraFromStyle(d.styles.Normal, {});
    const t: DocText = { ...d, runs: rt.normalizeRuns([objectRun(1, n), { ...n, text: '\nFigure 1. A caption\n' + WORDS }]), paras: [{ ...N, frame }, { ...N, frame }, N], objects: { 1: { kind: 'picture', src: DOT, w: 140, h: 72, px: { w: 1, h: 1 } } } };
    const bytes = await writeDocx(t, deps);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml.split(framePrXml(frame)).length).toBe(3);
    const back = paragraphs((await readDocx(bytes, deps)).doc);
    expect(back.map((x) => x.ps.frame)).toEqual([frame, frame, undefined]);
    // (no copy of Word's frame kept beside it, to be written twice)
    expect(back[0].ps.wpx ?? '').not.toContain('framePr');
  });
});
