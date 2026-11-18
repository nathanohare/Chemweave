// @vitest-environment jsdom
//
// Catalytic cycles of several loops, read from their steps (feature request VI, 2026-11-17: Smart
// Schemes and the catalytic cycle tool as one). The loops, how they are joined, and the species
// off the cycle are worked out from the arrows, so a cycle from an older file is live too.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { CYCLE_PRESETS, buildCycle, type CycleSpec } from '../src/chem/cycles';
import { addBranch, addLoop, arrangeSmart, canRemoveSlot, insertSlot, makeSmart, moveSlot, readSmart, refitSmart, removeLoop, removeSlot, setLoopMiddle, setStepNames, slotName, smartIsFree, smartLayoutOf, stepNamesNow } from '../src/chem/smart-scheme';
import { layoutNet, readNet, type NetLink } from '../src/chem/cycle-net';
import type { Selection } from '../src/editor/arrange';
import { plainText } from '../src/richtext';
import { arrowMid } from '../src/objects';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';

const ring = (ids: number[]): NetLink[] => ids.map((a, k) => ({ from: a, to: ids[(k + 1) % ids.length] }));
const sel = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });

/** A cycle drawn from a spec, made a Smart Scheme. */
function smart(spec: CycleSpec, data: Record<string, unknown> = {}) {
  const doc = new Doc();
  const m = plainMeasure(doc);
  let id = 0;
  doc.edit('cycle', () => {
    const made = buildCycle(doc, m, spec, { names: 'short', reagentArrows: true }, { x: 400, y: 400 });
    const s = sel();
    for (const c of made.captions) s.captions.add(c);
    for (const r of made.arrows) s.arrows.add(r);
    id = makeSmart(doc, m, s, { layout: 'cycle', reagentArrows: true, ...data })!;
  });
  return { doc, m, id };
}
const preset = (id: string) => CYCLE_PRESETS.find((p) => p.id === id)!.spec;
const names = (doc: Doc, m: ReturnType<typeof plainMeasure>, id: number) => readSmart(doc, m, id)!.slots.map((sl) => slotName(doc, sl));
const st = (short: string, name = short, inn = '', out = '') => ({ short, name, inn, out });
const FUSED: CycleSpec = {
  loops: [
    { stations: ['Pd0', 'ArPdX', 'A1', 'A2'], steps: [st('OA'), st('a'), st('b'), st('c')], middle: 'neutral' },
    { stations: ['Pd0', 'ArPdX', 'B1', 'B2', 'B3'], steps: [st('OA'), st('d'), st('e'), st('f'), st('g')], middle: 'cationic' },
  ],
  joins: [{ kind: 'fused', loop: 1, to: 0, a: 0, b: 0, span: 2 }],
};

describe('reading loops from steps', () => {
  it('one loop with a branch in and a branch out', () => {
    const net = readNet(6, [...ring([0, 1, 2, 3]), { from: 4, to: 0 }, { from: 1, to: 5 }])!;
    expect(net.loops).toHaveLength(1);
    expect(net.tails.map((t) => [t.at, t.nodes])).toEqual([[0, [4]], [1, [5]]]);
    expect(net.order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('two loops that share a species (a figure of eight)', () => {
    const net = readNet(5, [...ring([0, 1, 2]), ...ring([0, 3, 4])])!;
    expect(net.loops).toHaveLength(2);
    expect(net.joins).toEqual([{ kind: 'share', parent: 0, child: 1, node: 0 }]);
    // the second loop starts with its own species, the shared one last
    expect(net.loops[1].nodes).toEqual([3, 4, 0]);
  });

  it('two loops that share a stretch of two species and the step between them', () => {
    const links = [...ring([0, 1, 2, 3]), { from: 1, to: 4 }, { from: 4, to: 5 }, { from: 5, to: 0 }];
    const net = readNet(6, links)!;
    expect(net.loops).toHaveLength(2);
    expect(net.joins).toEqual([{ kind: 'fused', parent: 0, child: 1, path: [0, 1] }]);
    expect(net.loops[1].nodes).toEqual([4, 5, 0, 1]);
  });

  it('two loops with nothing in common turn together where it is told they meet, or sit beside each other', () => {
    const links = [...ring([0, 1, 2]), ...ring([3, 4])];
    expect(readNet(5, links, undefined, [[1, 4]])!.joins).toEqual([{ kind: 'mesh', parent: 0, child: 1, a: 1, b: 4 }]);
    expect(readNet(5, links)!.joins).toEqual([{ kind: 'beside', parent: 0, child: 1 }]);
  });

  it('three loops in a row, each joined to the one before', () => {
    const links = [...ring([0, 1, 2]), ...ring([2, 3, 4]), ...ring([5, 6, 7])];
    const net = readNet(8, links, undefined, [[4, 7]])!;
    expect(net.joins.map((j) => j.kind)).toEqual(['share', 'mesh']);
    expect(net.joins[1]).toMatchObject({ parent: 1, child: 2 });
  });

  it('says no to steps that are not loops: a line, a tree, a path from one loop to another', () => {
    expect(readNet(3, [{ from: 0, to: 1 }, { from: 1, to: 2 }])).toBeNull();
    expect(readNet(4, [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 0, to: 3 }])).toBeNull();
    expect(readNet(7, [...ring([0, 1, 2]), ...ring([3, 4, 5]), { from: 0, to: 6 }, { from: 6, to: 3 }])).toBeNull();
  });
});

describe('laying loops out', () => {
  const sizes = (n: number, links: NetLink[]) => ({ boxes: Array.from({ length: n }, () => ({ w: 40, h: 14 })), need: links.map(() => 40) });
  const opts = { bond: 14.4, gap: 5 };

  it('a shared stretch runs straight between two loops that bulge away from each other', () => {
    const links = [...ring([0, 1, 2, 3]), { from: 1, to: 4 }, { from: 4, to: 5 }, { from: 5, to: 0 }];
    const net = readNet(6, links)!;
    const p = layoutNet(net, links, sizes(6, links), opts);
    expect(p.steps[0]).toMatchObject({ kind: 'line', shared: true });
    expect(p.steps.filter((s) => s?.kind === 'arc')).toHaveLength(6);
    // the loops turn opposite ways, and their middles are on opposite sides of the shared step
    expect(p.rings[0].sign).toBe(-p.rings[1].sign);
    const a = p.at[0], b = p.at[1];
    const side = (c: { x: number; y: number }) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    expect(side(p.rings[0].c)).toBe(-side(p.rings[1].c));
    // the second loop's own species are on its circle
    for (const i of [4, 5]) expect(Math.hypot(p.at[i].x - p.rings[1].c.x, p.at[i].y - p.rings[1].c.y)).toBeCloseTo(p.rings[1].R, 6);
  });

  it('loops that turn together face each other across a small gap', () => {
    const links = [...ring([0, 1, 2]), ...ring([3, 4])];
    const net = readNet(5, links, undefined, [[1, 4]])!;
    const p = layoutNet(net, links, sizes(5, links), opts);
    const d = Math.hypot(p.rings[0].c.x - p.rings[1].c.x, p.rings[0].c.y - p.rings[1].c.y);
    expect(d).toBeCloseTo(p.rings[0].R + p.rings[1].R + 1.6 * opts.bond, 6);
    expect(p.steps[1]).toMatchObject({ kind: 'arc', crowded: true });
    expect(p.steps[4]).toMatchObject({ kind: 'arc', crowded: true });
  });

  it('a branch leads straight out from its loop', () => {
    const links = [...ring([0, 1, 2, 3]), { from: 4, to: 0 }];
    const net = readNet(5, links)!;
    const p = layoutNet(net, links, sizes(5, links), opts);
    const out = Math.hypot(p.at[4].x, p.at[4].y);
    expect(out).toBeGreaterThan(p.rings[0].R + 40);
    // species 0 is at the top, so the branch is straight above it, its arrow pointing down into the loop
    expect(p.at[4].x).toBeCloseTo(p.at[0].x, 6);
    const s = p.steps[4]!;
    expect(s.kind).toBe('line');
    expect(s.head.y).toBeGreaterThan(s.tail.y);
  });
});

describe('ready-made cycles of several loops', () => {
  it('Sonogashira is two loops turning together, and stays so when laid out again', () => {
    const { doc, m, id } = smart(preset('sonogashira'));
    const read = readSmart(doc, m, id)!;
    expect(read.net?.loops.map((lp) => lp.slots.length)).toEqual([3, 2]);
    expect(read.net?.joins[0].kind).toBe('mesh');
    expect(doc.shapes.get(id)!.smart!.free).toBeUndefined();
    const before = names(doc, m, id);
    const mids = () => readSmart(doc, m, id)!.links.map((l) => arrowMid(l.arrow));
    const was = mids();
    doc.edit('again', () => { expect(arrangeSmart(doc, m, id)).toBe(true); });
    expect(names(doc, m, id)).toEqual(before);
    expect(readSmart(doc, m, id)!.net?.joins[0].kind).toBe('mesh');
    mids().forEach((p, k) => { expect(p.x).toBeCloseTo(was[k].x, 3); expect(p.y).toBeCloseTo(was[k].y, 3); });
  });

  it('a cycle marked as laid out by hand (an older file) is live all the same', () => {
    const { doc, m, id } = smart(preset('heck-two'), { free: true });
    const data = doc.shapes.get(id)!.smart!;
    const read = readSmart(doc, m, id)!;
    expect(data.free).toBe(true);
    expect(smartIsFree(data, read)).toBe(false);
    expect(smartLayoutOf({ ...data, layout: 'line' }, read)).toBe('cycle');
    expect(read.net?.joins[0]).toMatchObject({ kind: 'share' });
    // nothing moves until it is changed; adding a species works, and clears the old mark
    let cap: number | null = null;
    doc.edit('add', () => { cap = insertSlot(doc, m, id, 0, 'new one', read.net!.loops[1].links[0]); });
    expect(cap).not.toBeNull();
    expect(doc.shapes.get(id)!.smart!.free).toBeUndefined();
    expect(readSmart(doc, m, id)!.net!.loops[1].own).toHaveLength(5);
  });

  it('survives CDXML with its loops', () => {
    const { doc } = smart(FUSED);
    const back = readCdxml(writeCdxml(doc)).doc;
    const frame = [...back.shapes.values()].find((s) => s.smart)!;
    const read = readSmart(back, plainMeasure(back), frame.id)!;
    expect(read.net?.joins[0]).toMatchObject({ kind: 'fused' });
    expect(read.net?.loops.map((lp) => lp.own.length)).toEqual([4, 3]);
  });
});

describe('changing a cycle of several loops', () => {
  it('adds a loop that shares a species, one that shares a stretch, one that turns with a step, and one beside', () => {
    const { doc, m, id } = smart(preset('suzuki'));
    expect(readSmart(doc, m, id)!.net).toBeUndefined();
    doc.edit('share', () => { expect(addLoop(doc, m, id, { kind: 'share', slot: 1 }, 2)).toHaveLength(2); });
    let read = readSmart(doc, m, id)!;
    expect(read.net?.joins.map((j) => j.kind)).toEqual(['share']);
    expect(read.slots).toHaveLength(6);
    doc.edit('fused', () => { expect(addLoop(doc, m, id, { kind: 'fused', from: 2, to: 3 }, 3)).toHaveLength(3); });
    read = readSmart(doc, m, id)!;
    expect(read.net?.joins.map((j) => j.kind).sort()).toEqual(['fused', 'share']);
    const tm = read.links.findIndex((l) => l.inside.some((it) => plainText(doc.captions.get(it.caption!)!.runs) === 'OA'));
    doc.edit('mesh', () => { expect(addLoop(doc, m, id, { kind: 'mesh', link: tm }, 3)).toHaveLength(3); });
    doc.edit('beside', () => { expect(addLoop(doc, m, id, { kind: 'beside' }, 2)).toHaveLength(2); });
    read = readSmart(doc, m, id)!;
    expect(read.net?.loops).toHaveLength(5);
    expect(read.net?.joins.map((j) => j.kind).sort()).toEqual(['beside', 'fused', 'mesh', 'share']);
    // laid out again from where things are now, it is the same cycle
    doc.edit('again', () => { arrangeSmart(doc, m, id); });
    expect(readSmart(doc, m, id)!.net?.joins.map((j) => j.kind).sort()).toEqual(['beside', 'fused', 'mesh', 'share']);
  });

  it('takes a loop out again, with what was in its middle', () => {
    const { doc, m, id } = smart(preset('sonogashira'));
    const captions = doc.captions.size;
    doc.edit('remove', () => { expect(removeLoop(doc, m, id, 1)).toBe(true); });
    const read = readSmart(doc, m, id)!;
    expect(read.net).toBeUndefined();
    expect(read.chain && read.closed).toBe(true);
    expect(names(doc, m, id)).toHaveLength(3);
    expect([...doc.captions.values()].some((c) => plainText(c.runs) === 'Cu')).toBe(false);
    expect(doc.captions.size).toBeLessThan(captions);
    // the first loop can't be taken out
    const two = smart(preset('sonogashira'));
    two.doc.edit('remove', () => { expect(removeLoop(two.doc, two.m, two.id, 0)).toBe(false); });
  });

  it('adds and removes species in any loop, but not one two loops share', () => {
    const { doc, m, id } = smart(FUSED);
    let read = readSmart(doc, m, id)!;
    expect(names(doc, m, id).slice(0, 4).sort()).toEqual(['A1', 'A2', 'ArPdX', 'Pd0']);
    const shared = read.net!.joins[0].kind === 'fused' ? read.net!.joins[0].path : [];
    for (const k of shared) expect(canRemoveSlot(read, k)).toBe(false);
    const own = read.net!.loops[1].own;
    expect(canRemoveSlot(read, own[1])).toBe(true);
    doc.edit('remove', () => { expect(removeSlot(doc, m, id, own[1])).toBe(true); });
    read = readSmart(doc, m, id)!;
    expect(read.net!.loops[1].own).toHaveLength(2);
    doc.edit('add', () => { expect(insertSlot(doc, m, id, 0, 'X', read.net!.loops[0].links[2])).not.toBeNull(); });
    expect(readSmart(doc, m, id)!.net!.loops[0].slots).toHaveLength(5);
  });

  it('moves a species to another place among its loop\'s own', () => {
    const { doc, m, id } = smart(FUSED);
    const read = readSmart(doc, m, id)!;
    const own = read.net!.loops[1].own;
    expect(own.map((k) => slotName(doc, read.slots[k]))).toEqual(['B1', 'B2', 'B3']);
    doc.edit('move', () => { expect(moveSlot(doc, m, id, own[0], own[2])).toBe(true); });
    const now = readSmart(doc, m, id)!;
    expect(now.net!.loops[1].own.map((k) => slotName(doc, now.slots[k]))).toEqual(['B2', 'B3', 'B1']);
    // not across loops
    doc.edit('move', () => { expect(moveSlot(doc, m, id, now.net!.loops[0].own[2], now.net!.loops[1].own[0])).toBe(false); });
  });

  it('adds species off the cycle: coming in, going out, in equilibrium', () => {
    const { doc, m, id } = smart(preset('suzuki'));
    doc.edit('in', () => { expect(addBranch(doc, m, id, 0, 'in', 'Pd(OAc)2')).not.toBeNull(); });
    doc.edit('both', () => { expect(addBranch(doc, m, id, 1, 'both', 'dimer')).not.toBeNull(); });
    const read = readSmart(doc, m, id)!;
    expect(read.net?.loops).toHaveLength(1);
    expect(read.net?.tails).toHaveLength(2);
    expect(names(doc, m, id).slice(4)).toEqual(['Pd(OAc)2', 'dimer']);
    const eq = read.links[read.net!.tails[1].links[0]].arrow;
    expect(eq.equilibrium).toBe(true);
    expect(eq.sweep).toBe(0);
    // and one goes again
    doc.edit('x', () => { expect(removeSlot(doc, m, id, 5)).toBe(true); });
    expect(readSmart(doc, m, id)!.net?.tails).toHaveLength(1);
  });

  it('writes the middle of a loop, and step names short or in full', () => {
    const { doc, m, id } = smart(preset('sonogashira'));
    doc.edit('mid', () => { expect(setLoopMiddle(doc, m, id, 1, [{ text: 'copper' }])).toBe(true); });
    expect([...doc.captions.values()].some((c) => plainText(c.runs) === 'copper')).toBe(true);
    expect([...doc.captions.values()].some((c) => plainText(c.runs) === 'Cu')).toBe(false);
    expect(stepNamesNow(doc, readSmart(doc, m, id)!)).toBe('short');
    doc.edit('full', () => { expect(setStepNames(doc, m, id, 'full')).toBe(true); });
    expect([...doc.captions.values()].filter((c) => plainText(c.runs) === 'transmetalation')).toHaveLength(2);
    expect(stepNamesNow(doc, readSmart(doc, m, id)!)).toBe('full');
    expect(readSmart(doc, m, id)!.net?.joins[0].kind).toBe('mesh');
  });

  it('a species dragged in one loop leaves the other loop\'s arrows alone', () => {
    const { doc, m, id } = smart(preset('sonogashira'));
    const read = readSmart(doc, m, id)!;
    const other = read.net!.loops[1].links.map((li) => ({ ...read.links[li].arrow }));
    const mine = read.net!.loops[0].links.map((li) => read.links[li].arrow.id);
    const cap = read.slots[read.net!.loops[0].slots[0]].caption!;
    doc.edit('drag', () => { const c = doc.captions.get(cap)!; doc.updateCaption(cap, { x: c.x - 30, y: c.y - 20 }); });
    doc.edit('refit', () => {
      const c = doc.captions.get(cap)!;
      refitSmart(doc, new Map([['c' + cap, { ...c, x: c.x + 30, y: c.y + 20 }]]), m);
    });
    for (const r of other) expect(doc.arrows.get(r.id)).toMatchObject({ tail: r.tail, head: r.head, sweep: r.sweep });
    // its own loop runs along one smooth path through the species again
    for (const idA of mine) expect(doc.arrows.get(idA)!.bez?.length).toBeGreaterThan(0);
  });
});
