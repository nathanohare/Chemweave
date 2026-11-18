// @vitest-environment jsdom
//
// A catalytic cycle of several loops (feature request VI, 2026-11-17) through every file it can go
// into: CDXML, PowerPoint, Word and Excel. Nothing about the loops is stored: they are read from
// the step arrows, so what has to come back is the arrows with their steps, the species and the
// Smart Scheme round them. A cycle that comes back is live: it can be changed and laid out again.

import { describe, expect, it } from 'vitest';
import { Doc, type Contents } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { CYCLE_PRESETS, buildCycle } from '../src/chem/cycles';
import { addBranch, addLoop, arrangeSmart, insertSlot, makeSmart, readSmart, removeLoop, slotName, smartIsFree, smartLayoutOf } from '../src/chem/smart-scheme';
import { crowdedLinks } from '../src/chem/cycle-net';
import type { Selection } from '../src/editor/arrange';
import { plainText } from '../src/richtext';
import * as rt from '../src/richtext';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { Workbook } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
const pptx: PptxOptions = { async picture(d) { const b = d.bounds(); return b ? { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: b } : null; }, async svgToPng() { return PNG; } };
const docx: DocxDeps = { async picture() { return { png: PNG, w: 80, h: 40 }; }, async svgToPng() { return PNG; } };
const xlsx: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => PNG };

const sel = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });

/** The Suzuki cycle with a loop joined each way, a precatalyst coming in and a resting state. */
function cycle(): { doc: Doc; id: number } {
  const doc = new Doc();
  const m = plainMeasure(doc);
  let id = 0;
  doc.edit('cycle', () => {
    const made = buildCycle(doc, m, CYCLE_PRESETS.find((p) => p.id === 'suzuki')!.spec, { names: 'short', reagentArrows: true }, { x: 400, y: 400 });
    const s = sel();
    for (const c of made.captions) s.captions.add(c);
    for (const r of made.arrows) s.arrows.add(r);
    id = makeSmart(doc, m, s, { layout: 'cycle', reagentArrows: true })!;
  });
  doc.edit('loops', () => {
    expect(addLoop(doc, m, id, { kind: 'share', slot: 1 }, 2)).not.toBeNull();
    expect(addLoop(doc, m, id, { kind: 'fused', from: 2, to: 3 }, 3)).not.toBeNull();
    const oa = readSmart(doc, m, id)!.links.findIndex((l) => l.inside.some((it) => plainText(doc.captions.get(it.caption!)!.runs) === 'OA'));
    expect(addLoop(doc, m, id, { kind: 'mesh', link: oa }, 3)).not.toBeNull();
    expect(addLoop(doc, m, id, { kind: 'beside' }, 2)).not.toBeNull();
    expect(addBranch(doc, m, id, 0, 'in', 'Pd(OAc)2 + L')).not.toBeNull();
    expect(addBranch(doc, m, id, 2, 'both', 'resting state')).not.toBeNull();
  });
  return { doc, id };
}

/** What a cycle is, however it is drawn: its species, loops, joins and branches. */
function shape(doc: Doc) {
  const frame = [...doc.shapes.values()].find((s) => s.smart)!;
  const m = plainMeasure(doc);
  const read = readSmart(doc, m, frame.id)!;
  return {
    layout: smartLayoutOf(frame.smart!, read),
    free: smartIsFree(frame.smart!, read),
    species: read.slots.map((sl) => slotName(doc, sl)),
    loops: read.net?.loops.map((lp) => lp.slots.map((k) => slotName(doc, read.slots[k]))),
    joins: read.net?.joins.map((j) => j.kind).sort(),
    tails: read.net?.tails.map((t) => [slotName(doc, read.slots[t.at]), t.slots.map((k) => slotName(doc, read.slots[k]))]),
    equilibria: read.links.filter((l) => l.arrow.equilibrium).length,
  };
}

function expectKept(c: Contents | Doc, want: ReturnType<typeof shape>): void {
  const doc = c instanceof Doc ? c : (() => { const d = new Doc(); d.restoreContents(c); return d; })();
  expect(shape(doc)).toEqual(want);
  // and it is live: a species can be added, a loop taken out, and it lays out again as the same cycle
  const frame = [...doc.shapes.values()].find((s) => s.smart)!;
  const m = plainMeasure(doc);
  const read = readSmart(doc, m, frame.id)!;
  doc.edit('change', () => {
    expect(insertSlot(doc, m, frame.id, 0, 'new species', read.net!.loops[0].links[0])).not.toBeNull();
    expect(arrangeSmart(doc, m, frame.id)).toBe(true);
  });
  const after = shape(doc);
  expect(after.species).toHaveLength(want.species.length + 1);
  expect(after.joins).toEqual(want.joins);
  doc.edit('fewer', () => { expect(removeLoop(doc, m, frame.id, 1)).toBe(true); });
  expect(shape(doc).loops!.length).toBeLessThan(want.loops!.length);
}

describe('a cycle of several loops through every file', () => {
  const { doc } = cycle();
  const want = shape(doc);

  it('is five loops joined four ways, with two species off the cycle', () => {
    expect(want.layout).toBe('cycle');
    expect(want.free).toBe(false);
    expect(want.loops).toHaveLength(5);
    expect(want.joins).toEqual(['beside', 'fused', 'mesh', 'share']);
    expect(want.tails).toHaveLength(2);
    expect(want.equilibria).toBe(1);
  });

  it('CDXML', () => {
    expectKept(readCdxml(writeCdxml(doc)).doc, want);
  });

  it('PowerPoint', async () => {
    const d = Deck.design(new Doc(), { w: 720, h: 405 });
    const slide = d.docOf(0);
    slide.restoreContents(doc.contents());
    const bytes = await writePptx({ size: d.size, master: d.master, slides: [{ layout: 'blank', doc: slide, notes: '' }] }, pptx);
    expectKept(readPptx(bytes).slides[0].contents, want);
  });

  it('Word', async () => {
    const base = newDocument();
    const n = runStyleOf(base.styles.Normal);
    const N = paraFromStyle(base.styles.Normal, {});
    const t: DocText = { ...base, runs: rt.normalizeRuns([{ ...n, text: 'Cycle\n' }, objectRun(1, n)]), paras: [N, N], objects: { 1: { kind: 'drawing', contents: doc.contents() } } };
    const back = (await readDocx(await writeDocx(t, docx))).doc;
    const o = Object.values(back.objects).find((x) => x.kind === 'drawing');
    expect(o && o.kind === 'drawing').toBe(true);
    expectKept((o as { contents: Contents }).contents, want);
  });

  it('Excel', async () => {
    const wb = new Workbook(['Cycles']);
    wb.build(() => { wb.sheet.setStructure(0, 0, doc.contents()); });
    const back = (await readXlsx(await writeXlsx(wb, xlsx))).book;
    const s = back.sheet.cell(0, 0)?.structure;
    expect(s).toBeTruthy();
    expectKept(s!.contents, want);
  });
});

describe('what joins and leaves at a step with another loop on its far side', () => {
  const text = (doc: Doc, id?: number) => (id === undefined ? '' : plainText(doc.captions.get(id)!.runs));

  it('is marked + and − when a loop is added there, and unmarked when the loop is taken out', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    let id = 0;
    doc.edit('cycle', () => {
      const made = buildCycle(doc, m, CYCLE_PRESETS.find((p) => p.id === 'suzuki')!.spec, { names: 'short', reagentArrows: true }, { x: 400, y: 400 });
      const s = sel();
      for (const c of made.captions) s.captions.add(c);
      for (const r of made.arrows) s.arrows.add(r);
      id = makeSmart(doc, m, s, { layout: 'cycle', reagentArrows: true })!;
    });
    // ligand exchange (species 2 to species 3): −OR joins, X− leaves
    const le = () => readSmart(doc, m, id)!.links.find((l) => l.inside.some((it) => text(doc, it.caption) === 'LE'))!;
    expect(text(doc, le().above[0].caption)).toBe('−OR');
    expect(text(doc, le().below[0].caption)).toBe('X−');
    const small = () => [...doc.arrows.values()].filter((r) => r.reagentFor === le().arrow.id).length;
    expect(small()).toBe(2);
    doc.edit('loop', () => { addLoop(doc, m, id, { kind: 'share', slot: 2 }, 3); });
    const read = readSmart(doc, m, id)!;
    const crowd = crowdedLinks(read.net!.loops.map((lp) => ({ nodes: lp.slots, links: lp.links })), read.net!.joins);
    expect(crowd.has(read.links.findIndex((l) => l.arrow.id === le().arrow.id))).toBe(true);
    expect(text(doc, le().above[0].caption)).toBe('+ −OR');
    expect(text(doc, le().below[0].caption)).toBe('− X−');
    // (no small arrows there: the text is inside the loop)
    expect(small()).toBe(0);
    // a step with room outside keeps its small arrows and plain text
    const oa = read.links.find((l) => l.inside.some((it) => text(doc, it.caption) === 'OA'))!;
    expect(text(doc, oa.above[0].caption)).toBe('Ar–X');
    // laying out again doesn't mark it twice
    doc.edit('again', () => { arrangeSmart(doc, m, id); });
    expect(text(doc, le().above[0].caption)).toBe('+ −OR');
    doc.edit('out', () => { expect(removeLoop(doc, m, id, 1)).toBe(true); });
    expect(readSmart(doc, m, id)!.net).toBeUndefined();
    expect(text(doc, le().above[0].caption)).toBe('−OR');
    expect(text(doc, le().below[0].caption)).toBe('X−');
    expect(small()).toBe(2);
  });
});
