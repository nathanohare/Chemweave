// @vitest-environment jsdom
//
// Smart Schemes that branch (2026-11-18): a side product off a line, two routes coming together,
// one species leading to several. Nothing about the branches is stored: they are read from the
// step arrows. So a scheme that branches is live after every file it goes through (CDXML,
// PowerPoint, Word, Excel), and one drawn by hand or saved before this becomes live too.

import { describe, expect, it } from 'vitest';
import { Doc, type Contents } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { addBranch, arrangeSmart, branchSpots, fanSteps, insertSlot, layoutFits, makeSmart, readSmart, refitSmart, removeBranch, removeSlot, reverseStep, setSlotText, slotName, smartIsFree, smartIsTidy, smartLayoutOf, smartMarks } from '../src/chem/smart-scheme';
import type { Selection } from '../src/editor/arrange';
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
const ARROW = { headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 } as const;

/** Species at these places joined by these steps, drawn by hand (not yet a Smart Scheme). */
function drawn(species: [string, number, number][], steps: [number, number][]) {
  const doc = new Doc();
  const m = plainMeasure(doc);
  const s = sel();
  doc.edit('draw', () => {
    const caps = species.map(([t, x, y]) => doc.addCaption({ x, y, runs: [{ text: t }], justify: 'center' }));
    for (const c of caps) s.captions.add(c.id);
    for (const [a, b] of steps) {
      const p = { x: species[a][1], y: species[a][2] }, q = { x: species[b][1], y: species[b][2] };
      const r = doc.addArrow({ ...ARROW, tail: { x: p.x + (q.x - p.x) * 0.3, y: p.y + (q.y - p.y) * 0.3 }, head: { x: p.x + (q.x - p.x) * 0.7, y: p.y + (q.y - p.y) * 0.7 }, step: { reactants: ['c' + caps[a].id], products: ['c' + caps[b].id], above: [], below: [], manual: true } });
      s.arrows.add(r.id);
    }
  });
  return { doc, m, s };
}

/** A → B → C in a line, as a Smart Scheme. */
function line() {
  const { doc, m, s } = drawn([['A', 0, 0], ['B', 120, 0], ['C', 240, 0]], [[0, 1], [1, 2]]);
  let id = 0;
  doc.edit('smart', () => { id = makeSmart(doc, m, s)!; arrangeSmart(doc, m, id); });
  return { doc, m, id };
}

const name = (doc: Doc, m: ReturnType<typeof plainMeasure>, id: number, k: number) => slotName(doc, readSmart(doc, m, id)!.slots[k]);
const slotOf = (doc: Doc, m: ReturnType<typeof plainMeasure>, id: number, text: string) => readSmart(doc, m, id)!.slots.findIndex((sl) => slotName(doc, sl) === text);
const centre = (doc: Doc, m: ReturnType<typeof plainMeasure>, id: number, text: string) => { const b = readSmart(doc, m, id)!.slots[slotOf(doc, m, id, text)].box; return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }; };

/** What a scheme that branches is, however it is drawn: its routes by name. */
function shape(doc: Doc) {
  const frame = [...doc.shapes.values()].find((s) => s.smart)!;
  const m = plainMeasure(doc);
  const read = readSmart(doc, m, frame.id)!;
  const nm = (k: number) => slotName(doc, read.slots[k]);
  return {
    layout: smartLayoutOf(frame.smart!, read),
    free: smartIsFree(frame.smart!, read),
    routes: read.tree?.runs.map((r) => ({ species: r.slots.map(nm), ...(r.at !== undefined ? { at: nm(r.at), dir: r.dir } : {}) })),
    equilibria: read.links.filter((l) => l.arrow.equilibrium).length,
  };
}

describe('branches on a Smart Scheme in a line', () => {
  it('adds a side product leading away, a fragment leading in, and a species in equilibrium', () => {
    const { doc, m, id } = line();
    doc.edit('branches', () => {
      expect(addBranch(doc, m, id, 1, 'out', 'side product')).not.toBeNull();
      expect(addBranch(doc, m, id, slotOf(doc, m, id, 'C'), 'in', 'fragment')).not.toBeNull();
      expect(addBranch(doc, m, id, slotOf(doc, m, id, 'A'), 'both', 'resting state')).not.toBeNull();
    });
    const got = shape(doc);
    expect(got.layout).toBe('line');
    expect(got.free).toBe(false);
    // the main route is still A, B, C
    expect(got.routes![0].species).toEqual(['A', 'B', 'C']);
    expect(got.routes!.slice(1)).toEqual(expect.arrayContaining([
      { species: ['side product'], at: 'B', dir: 'out' },
      { species: ['fragment'], at: 'C', dir: 'in' },
      { species: ['resting state'], at: 'A', dir: 'out' },
    ]));
    expect(got.equilibria).toBe(1);
    // the main route stayed in its line, and each branch sits squarely beside the species it joins
    expect(centre(doc, m, id, 'B').y).toBeCloseTo(centre(doc, m, id, 'A').y, 3);
    expect(centre(doc, m, id, 'C').y).toBeCloseTo(centre(doc, m, id, 'A').y, 3);
    expect(centre(doc, m, id, 'side product').x).toBeCloseTo(centre(doc, m, id, 'B').x, 3);
    expect(Math.abs(centre(doc, m, id, 'side product').y - centre(doc, m, id, 'B').y)).toBeGreaterThan(10);
    // every arrow is straight
    expect([...doc.arrows.values()].every((r) => !r.sweep && !r.bez?.length)).toBe(true);
  });

  it('puts a branch on the side it is asked for, and keeps it there when laid out again', () => {
    const { doc, m, id } = line();
    doc.edit('up', () => { addBranch(doc, m, id, 1, 'out', 'above', -1); });
    expect(centre(doc, m, id, 'above').y).toBeLessThan(centre(doc, m, id, 'B').y);
    doc.edit('down', () => { addBranch(doc, m, id, slotOf(doc, m, id, 'B'), 'out', 'below', 1); });
    expect(centre(doc, m, id, 'below').y).toBeGreaterThan(centre(doc, m, id, 'B').y);
    doc.edit('again', () => { arrangeSmart(doc, m, id); });
    expect(centre(doc, m, id, 'above').y).toBeLessThan(centre(doc, m, id, 'B').y);
    expect(centre(doc, m, id, 'below').y).toBeGreaterThan(centre(doc, m, id, 'B').y);
  });

  it('takes Line, Down and Tree but not Rows, Snake or Cycle', () => {
    const { doc, m, id } = line();
    doc.edit('branch', () => { addBranch(doc, m, id, 1, 'out', 'D'); });
    const read = readSmart(doc, m, id)!;
    expect((['line', 'rows', 'snake', 'down', 'tree', 'cycle'] as const).map((l) => layoutFits(l, read))).toEqual([true, false, false, true, true, false]);
    doc.edit('rows', () => { expect(arrangeSmart(doc, m, id, { layout: 'rows' })).toBe(false); });
    expect(shape(doc).layout).toBe('line');
    // a tree: the branch a column on from B, level with C or off to one side, on a slanted arrow
    doc.edit('tree', () => { expect(arrangeSmart(doc, m, id, { layout: 'tree' })).toBe(true); });
    expect(shape(doc).layout).toBe('tree');
    expect(centre(doc, m, id, 'D').x).toBeGreaterThan(centre(doc, m, id, 'B').x + 10);
    expect(Math.abs(centre(doc, m, id, 'D').y - centre(doc, m, id, 'B').y)).toBeGreaterThan(10);
    expect(shape(doc).routes![0].species).toEqual(['A', 'B', 'C']);
    // down the page: the branch beside B
    doc.edit('down', () => { expect(arrangeSmart(doc, m, id, { layout: 'down' })).toBe(true); });
    expect(centre(doc, m, id, 'C').y).toBeGreaterThan(centre(doc, m, id, 'B').y + 10);
    expect(centre(doc, m, id, 'D').y).toBeCloseTo(centre(doc, m, id, 'B').y, 3);
    expect(shape(doc).routes![0].species).toEqual(['A', 'B', 'C']);
  });

  it('grows a branch, puts a species on one of its steps, and takes species and branches out', () => {
    const { doc, m, id } = line();
    doc.edit('branch', () => {
      addBranch(doc, m, id, 1, 'out', 'D');
      // on from D
      expect(insertSlot(doc, m, id, slotOf(doc, m, id, 'D'), 'E')).not.toBeNull();
    });
    expect(shape(doc).routes![1]).toEqual({ species: ['D', 'E'], at: 'B', dir: 'out' });
    doc.edit('on step', () => {
      const read = readSmart(doc, m, id)!;
      const d = slotOf(doc, m, id, 'D');
      expect(insertSlot(doc, m, id, d, 'between', read.links.findIndex((l) => l.from === d))).not.toBeNull();
    });
    expect(shape(doc).routes![1].species).toEqual(['D', 'between', 'E']);
    doc.edit('out', () => { expect(removeSlot(doc, m, id, slotOf(doc, m, id, 'between'))).toBe(true); });
    expect(shape(doc).routes![1].species).toEqual(['D', 'E']);
    // B joins three steps: it can't go while its branch is there
    doc.edit('fork', () => { expect(removeSlot(doc, m, id, slotOf(doc, m, id, 'B'))).toBe(false); });
    doc.edit('branch out', () => { expect(removeBranch(doc, m, id, 1)).toBe(true); });
    const after = shape(doc);
    expect(after.routes).toBeUndefined();
    expect(readSmart(doc, m, id)!.chain).toBe(true);
    expect(readSmart(doc, m, id)!.slots.map((sl) => slotName(doc, sl))).toEqual(['A', 'B', 'C']);
  });

  it('turns a step round, but not when the steps would then lead round in a loop', () => {
    const { doc, m, id } = line();
    doc.edit('branch', () => { addBranch(doc, m, id, 1, 'out', 'D'); });
    const via = () => readSmart(doc, m, id)!.tree!.runs[1].via!;
    doc.edit('turn', () => { expect(reverseStep(doc, m, id, via())).toBe(true); });
    expect(shape(doc).routes![1]).toEqual({ species: ['D'], at: 'B', dir: 'in' });
    doc.edit('back', () => { expect(reverseStep(doc, m, id, via())).toBe(true); });
    expect(shape(doc).routes![1]).toEqual({ species: ['D'], at: 'B', dir: 'out' });
    // A → B → C with a step straight from A to C as well: turned round, that one would close a loop
    const d = drawn([['A', 0, 0], ['B', 120, 0], ['C', 240, 0]], [[0, 1], [1, 2], [0, 2]]);
    let id2 = 0;
    d.doc.edit('smart', () => { id2 = makeSmart(d.doc, d.m, d.s)!; });
    const read = readSmart(d.doc, d.m, id2)!;
    const ac = read.links.findIndex((l) => slotName(d.doc, read.slots[l.from]) === 'A' && slotName(d.doc, read.slots[l.to]) === 'C');
    d.doc.edit('turn', () => { expect(reverseStep(d.doc, d.m, id2, ac)).toBe(false); });
  });

  it('offers a + on every step, beyond every end and before every start, and two beside a picked species', () => {
    const { doc, m, id } = line();
    // a line: before the first, after each
    expect(smartMarks(doc, m, id)!.adds.map((a) => a.after).sort()).toEqual([-1, 0, 1, 2]);
    expect(branchSpots(doc, m, id, 1).map((b) => b.side).sort()).toEqual([-1, 1]);
    doc.edit('branch', () => { addBranch(doc, m, id, 1, 'out', 'D'); });
    const read = readSmart(doc, m, id)!;
    const marks = smartMarks(doc, m, id)!;
    expect(marks.boxes).toHaveLength(4);
    // one on each of the three steps
    expect(marks.adds.filter((a) => a.link !== undefined).map((a) => a.link).sort()).toEqual([0, 1, 2]);
    // one beyond C and one beyond D, one leading into A
    const ends = marks.adds.filter((a) => a.link === undefined && !a.lead).map((a) => slotName(doc, read.slots[a.after])).sort();
    expect(ends).toEqual(['C', 'D']);
    expect(marks.adds.filter((a) => a.lead).map((a) => slotName(doc, read.slots[a.after]))).toEqual(['A']);
  });
});

describe('schemes that branch made from what is drawn', () => {
  it('makes one drawn by hand live, in the layout it is drawn in', () => {
    // fanned: A leads to B, C and D in a column
    const fan = drawn([['A', 0, 0], ['B', 150, -60], ['C', 150, 0], ['D', 150, 60]], [[0, 1], [0, 2], [0, 3]]);
    fan.doc.edit('smart', () => { makeSmart(fan.doc, fan.m, fan.s); });
    expect(shape(fan.doc)).toMatchObject({ layout: 'tree', free: false });
    expect(shape(fan.doc).routes).toHaveLength(3);
    // a side product squarely below a line
    const comb = drawn([['A', 0, 0], ['B', 120, 0], ['C', 240, 0], ['D', 120, 70]], [[0, 1], [1, 2], [1, 3]]);
    comb.doc.edit('smart', () => { makeSmart(comb.doc, comb.m, comb.s); });
    expect(shape(comb.doc)).toMatchObject({ layout: 'line', free: false });
    expect(shape(comb.doc).routes![0].species).toEqual(['A', 'B', 'C']);
    // down the page
    const down = drawn([['A', 0, 0], ['B', 0, 70], ['C', 0, 140], ['D', 110, 70]], [[0, 1], [1, 2], [1, 3]]);
    down.doc.edit('smart', () => { makeSmart(down.doc, down.m, down.s); });
    expect(shape(down.doc)).toMatchObject({ layout: 'down', free: false });
    expect(shape(down.doc).routes![0].species).toEqual(['A', 'B', 'C']);
  });

  it('makes a scheme saved as "laid out by hand" because it branched live again', () => {
    const { doc, m, s } = drawn([['A', 0, 0], ['B', 120, 0], ['C', 240, 0], ['D', 120, 70]], [[0, 1], [1, 2], [1, 3]]);
    let id = 0;
    doc.edit('smart', () => { id = makeSmart(doc, m, s)!; doc.updateShape(id, { smart: { layout: 'line', free: true } }); });
    const frame = doc.shapes.get(id)!;
    const read = readSmart(doc, m, id)!;
    expect(smartIsFree(frame.smart!, read)).toBe(false);
    doc.edit('lay out', () => { expect(arrangeSmart(doc, m, id)).toBe(true); });
    expect(doc.shapes.get(id)!.smart!.free).toBeUndefined();
    expect(shape(doc).routes![1]).toEqual({ species: ['D'], at: 'B', dir: 'out' });
  });

  it('makes a tree of structures with no steps: the first leads to each of the others', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const s = sel();
    let id = 0;
    const firsts: number[] = [];
    doc.edit('smart', () => {
      // four structures (ethanes): one at the left, three in a column to its right
      for (const [x, y] of [[0, 0], [150, -60], [150, 0], [150, 60]]) {
        const a = doc.addAtom(x - 7, y), b = doc.addAtom(x + 7, y);
        doc.addBond(a.id, b.id, 1);
        s.atoms.add(a.id); s.atoms.add(b.id);
        firsts.push(a.id);
      }
      id = makeSmart(doc, m, s, { layout: 'tree' })!;
      expect(fanSteps(doc, m, id)).toBe(true);
      expect(arrangeSmart(doc, m, id, { layout: 'tree' })).toBe(true);
    });
    const read = readSmart(doc, m, id)!;
    expect(smartLayoutOf(doc.shapes.get(id)!.smart!, read)).toBe('tree');
    expect(read.tree!.runs).toHaveLength(3);
    // every step leads away from the structure that was at the left
    const start = read.slots.findIndex((sl) => sl.items.some((it) => it.atoms.includes(firsts[0])));
    expect(read.links).toHaveLength(3);
    expect(read.links.every((l) => l.from === start)).toBe(true);
    expect(read.tree!.runs.slice(1).every((r) => r.at === start && r.dir === 'out')).toBe(true);
  });
});

describe('retyping a species', () => {
  /** The gaps between each species and the arrows either side of it, along a line. */
  const gaps = (doc: Doc, m: ReturnType<typeof plainMeasure>, id: number) => {
    const read = readSmart(doc, m, id)!;
    return read.links.flatMap((l) => [Math.min(l.arrow.tail.x, l.arrow.head.x) - read.slots[l.from].box.x2, read.slots[l.to].box.x1 - Math.max(l.arrow.tail.x, l.arrow.head.x)]);
  };

  it('lays a tidy scheme out again, so the spacing stays even', () => {
    const { doc, m, id } = line();
    doc.beforeCommit = (before) => refitSmart(doc, before, m);
    expect(smartIsTidy(doc, m, id)).toBe(true);
    const was = gaps(doc, m, id);
    doc.edit('retype', () => { setSlotText(doc, m, id, 1, '4-bromo-2-(trifluoromethyl)benzaldehyde'); });
    const now = gaps(doc, m, id);
    for (let i = 0; i < was.length; i++) expect(now[i]).toBeCloseTo(was[i], 3);
    expect(smartIsTidy(doc, m, id)).toBe(true);
  });

  it('leaves a scheme arranged by hand where it is', () => {
    const { doc, m, id } = line();
    doc.beforeCommit = (before) => refitSmart(doc, before, m);
    // C dragged well out of line
    doc.edit('drag', () => { const c = doc.captions.get(readSmart(doc, m, id)!.slots[2].caption!)!; doc.updateCaption(c.id, { x: c.x + 40, y: c.y + 90 }); });
    expect(smartIsTidy(doc, m, id)).toBe(false);
    const at = centre(doc, m, id, 'C'), a = centre(doc, m, id, 'A');
    doc.edit('retype', () => { setSlotText(doc, m, id, 1, 'a much longer name than B'); });
    expect(centre(doc, m, id, 'C')).toEqual(at);
    expect(centre(doc, m, id, 'A')).toEqual(a);
  });
});

describe('a scheme that branches through every file', () => {
  const { doc, m, id } = line();
  doc.edit('branches', () => {
    addBranch(doc, m, id, 1, 'out', 'side product');
    insertSlot(doc, m, id, slotOf(doc, m, id, 'side product'), 'further on');
    addBranch(doc, m, id, slotOf(doc, m, id, 'C'), 'in', 'fragment');
    addBranch(doc, m, id, slotOf(doc, m, id, 'A'), 'both', 'resting state');
    addBranch(doc, m, id, slotOf(doc, m, id, 'side product'), 'out', 'twig');
  });
  const want = shape(doc);

  function expectKept(c: Contents | Doc): void {
    const d = c instanceof Doc ? c : (() => { const x = new Doc(); x.restoreContents(c); return x; })();
    expect(shape(d)).toEqual(want);
    // and it is live: a branch can be added and taken out, and it lays out again as the same scheme
    const frame = [...d.shapes.values()].find((s) => s.smart)!;
    const dm = plainMeasure(d);
    d.edit('change', () => {
      expect(addBranch(d, dm, frame.id, slotOf(d, dm, frame.id, 'B'), 'in', 'new')).not.toBeNull();
      expect(arrangeSmart(d, dm, frame.id, { layout: 'tree' })).toBe(true);
    });
    const after = shape(d);
    expect(after.layout).toBe('tree');
    expect(after.routes).toHaveLength(want.routes!.length + 1);
    expect(after.routes![0]).toEqual(want.routes![0]);
    d.edit('fewer', () => { expect(removeBranch(d, dm, frame.id, readSmart(d, dm, frame.id)!.tree!.runs.findIndex((r) => r.slots.some((k) => name(d, dm, frame.id, k) === 'new')))).toBe(true); });
    expect(shape(d).routes).toHaveLength(want.routes!.length);
  }

  it('is a main route with four branches, one of them off another', () => {
    expect(want.layout).toBe('line');
    expect(want.free).toBe(false);
    expect(want.routes![0].species).toEqual(['A', 'B', 'C']);
    expect(want.routes).toHaveLength(5);
    expect(want.routes).toEqual(expect.arrayContaining([
      { species: ['side product', 'further on'], at: 'B', dir: 'out' },
      { species: ['twig'], at: 'side product', dir: 'out' },
      { species: ['fragment'], at: 'C', dir: 'in' },
    ]));
    expect(want.equilibria).toBe(1);
  });

  it('CDXML', () => {
    expectKept(readCdxml(writeCdxml(doc)).doc);
  });

  it('PowerPoint', async () => {
    const d = Deck.design(new Doc(), { w: 720, h: 405 });
    const slide = d.docOf(0);
    slide.restoreContents(doc.contents());
    const bytes = await writePptx({ size: d.size, master: d.master, slides: [{ layout: 'blank', doc: slide, notes: '' }] }, pptx);
    expectKept(readPptx(bytes).slides[0].contents);
  });

  it('Word', async () => {
    const base = newDocument();
    const n = runStyleOf(base.styles.Normal);
    const N = paraFromStyle(base.styles.Normal, {});
    const t: DocText = { ...base, runs: rt.normalizeRuns([{ ...n, text: 'Scheme\n' }, objectRun(1, n)]), paras: [N, N], objects: { 1: { kind: 'drawing', contents: doc.contents() } } };
    const back = (await readDocx(await writeDocx(t, docx))).doc;
    const o = Object.values(back.objects).find((x) => x.kind === 'drawing');
    expect(o && o.kind === 'drawing').toBe(true);
    expectKept((o as { contents: Contents }).contents);
  });

  it('Excel', async () => {
    const wb = new Workbook(['Schemes']);
    wb.build(() => { wb.sheet.setStructure(0, 0, doc.contents()); });
    const back = (await readXlsx(await writeXlsx(wb, xlsx))).book;
    const s = back.sheet.cell(0, 0)?.structure;
    expect(s).toBeTruthy();
    expectKept(s!.contents);
  });
});
