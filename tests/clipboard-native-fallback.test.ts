// @vitest-environment jsdom
//
// Our whole-drawing clipboard format (G1-11) is read only when it is ours, of a version this
// program knows, and sound; otherwise every paste (canvas, Spreadsheet, Document) takes the
// CDXML written beside it (review F1b-R05, F1b-R06). The desktop app's clipboard commands are
// stood in for here. A made-up drawing: ethanol C2H6O (PubChem CID 702) and a caption.

import { describe, it, expect, vi } from 'vitest';

/** The Windows clipboard as the stand-in holds it: format name → bytes. */
const board = new Map<string, Uint8Array>();
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: async (cmd: string, args: { names: string[] }) => {
    if (cmd !== 'clipboard_read') return new ArrayBuffer(0);
    const { packFormats } = await import('../src/io/clipboard');
    const name = args.names.find((n) => board.has(n));
    return name ? packFormats([[name, board.get(name)!]]).buffer : new ArrayBuffer(0);
  },
}));

import { nativeDrawing, nativeDrawingText, nativeClipboardDrawing, insertDrawing, pasteDrawing, setPasteFallback, NATIVE_FORMAT, OWN_FORMAT } from '../src/io/clipboard';
import { recordPicture, pictureSvg } from '../src/render/picture';
import { emptyTable } from '../src/table';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { Doc } from '../src/model';
import { putPlate, newPlate } from '../src/design/plates';
import { putEnergy, ENERGY_DEFAULTS, ENERGY_PRESETS, type EnergyData } from '../src/design/energy';
import { POINTS } from '../src/editor/arrange';
import { addChiralFlag } from '../src/chem/chiral-flag';

function ethanol(): Doc {
  const d = new Doc();
  d.bulk(() => {
    const c1 = d.addAtom(0, 0), c2 = d.addAtom(12.5, -7.2), o = d.addAtom(25, 0, 8);
    d.addBond(c1.id, c2.id); d.addBond(c2.id, o.id);
    d.addCaption({ x: 0, y: 30, runs: [{ text: 'ethanol', lang: 'en-GB', noProof: true }], justify: 'left' });
  });
  return d;
}
const edit = (f: (j: { v: unknown; style: Record<string, unknown>; contents: Record<string, Record<string, unknown>[]> }) => void) => {
  const j = JSON.parse(nativeDrawingText(ethanol()));
  f(j);
  return JSON.stringify(j);
};

describe('the whole-drawing format is checked before it is taken (F1b-R05)', () => {
  it('takes a sound copy of this version', () => {
    const d = nativeDrawing(nativeDrawingText(ethanol()))!;
    expect([d.atoms.size, d.bonds.size, d.captions.size]).toEqual([3, 2, 1]);
  });
  it('turns down a later or odd version, so the CDXML is pasted instead', () => {
    for (const v of [2, 99, 0, 0.5, '1', null]) expect(nativeDrawing(edit((j) => { j.v = v; })), String(v)).toBeNull();
  });
  it('turns down an atom, caption, arrow or shape without a place in numbers, or a caption without runs', () => {
    expect(nativeDrawing(edit((j) => { delete j.contents.atoms[0].x; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.atoms[0].x = 'abc'; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.atoms[0].y = null; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { delete j.contents.captions[0].runs; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.bonds[0].order = 'double'; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.shapes = [{ id: 99, kind: 'rect', x1: 0, y1: 0, x2: 'x', y2: 1 }]; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.arrows = [{ id: 98, tail: { x: 0, y: 0 } }]; }))).toBeNull();
    // contents in another shape (a later layout) read as nothing: not an empty drawing
    expect(nativeDrawing(edit((j) => { j.contents = { items: [] } as never; }))).toBeNull();
  });
  it('keeps the drawable style settings only when they have the expected type', () => {
    const d = nativeDrawing(edit((j) => { j.style.bondLength = 'abc'; j.style.lineWidth = 2; }))!;
    expect(typeof d.style.bondLength).toBe('number');
    expect(d.style.lineWidth).toBe(2);
    // a pasted drawing can always be saved
    expect(() => writeCdxml(d, { name: 'x.cdxml' })).not.toThrow();
  });
});

describe('every paste falls back to the CDXML beside it (F1b-R06)', () => {
  it('a damaged or later whole-drawing copy gives the CDXML drawing', async () => {
    const cdxml = writeCdxml(ethanol(), { name: 'Clipboard.cdxml' });
    board.clear();
    board.set(NATIVE_FORMAT, new TextEncoder().encode(edit((j) => { j.v = 2; })));
    board.set(OWN_FORMAT, new TextEncoder().encode(cdxml));
    const got = await nativeClipboardDrawing();
    expect(got?.atoms.size).toBe(3);
    // (read from CDXML: Do Not Check Spelling, which CDXML has no place for, is gone (field-round-trip.test.ts CANT_CARRY), so this is the fallback;
    // the language now rides in CDXML's settings tag, F8a item 8)
    expect([...got!.captions.values()][0].runs[0].noProof).toBeUndefined();
    expect([...got!.captions.values()][0].runs[0].lang).toBe('en-GB');
    // and a sound copy is taken whole
    board.set(NATIVE_FORMAT, new TextEncoder().encode(nativeDrawingText(ethanol())));
    expect([...(await nativeClipboardDrawing())!.captions.values()][0].runs[0].noProof).toBe(true);
    board.clear();
    expect(await nativeClipboardDrawing()).toBeNull();
  });
});

describe('nested parts and far places are checked too (F1c-R05)', () => {
  const withShape = (shape: Record<string, unknown>) => edit((j) => { j.contents.shapes = [{ id: 97, kind: 'geo', geo: 'rect', x1: 0, y1: 0, x2: 20, y2: 10, ...shape }]; });
  it('turns down what pasted or saved would throw or never finish', () => {
    // a shape's text without its runs; a run's size as a word
    expect(nativeDrawing(withShape({ text: { paras: [] } }))).toBeNull();
    expect(nativeDrawing(edit((j) => { (j.contents.captions[0].runs as Record<string, unknown>[])[0].size = 'big'; }))).toBeNull();
    // a frame that is not lists of members; a pin whose objects are not a list
    expect(nativeDrawing(withShape({ frame: 5 }))).toBeNull();
    expect(nativeDrawing(withShape({ frame: { atoms: 'all', captions: [], arrows: [], shapes: [] } }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.atoms[0].pin = { on: 'atom', ref: 3, at: { x: 0, y: 0 }, hand: 1 }; }))).toBeNull();
    // an atom ten million points out (saving it would not finish), or a number too big to be one
    expect(nativeDrawing(edit((j) => { j.contents.atoms[0].x = 10_000_000; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.atoms[0].x = 1; }).replace('"x":1,', '"x":1e400,'))).toBeNull();
  });
  it('still takes a sound copy with a frame, a pinned flag and pinned arrows, and it saves', () => {
    const d = ethanol();
    d.edit('TLC', () => { putPlate(d, POINTS, newPlate('tlc', d.style.bondLength), { x: 100, y: 0 }); });
    d.edit('Flag', () => { addChiralFlag(d, [...d.atoms.keys()].slice(0, 3), 'Absolute'); });
    const got = nativeDrawing(nativeDrawingText(d))!;
    expect(got).not.toBeNull();
    expect([...got.shapes.values()].some((s) => s.plate && s.frame)).toBe(true);
    expect([...got.shapes.values()].some((s) => s.symbol === 'Absolute' && s.pin?.on === 'atom')).toBe(true);
    expect(() => writeCdxml(got, { name: 'x.cdxml' })).not.toThrow();
  });
});

describe('the check is complete without a trial save, and quick (review F1d-R03)', () => {
  /** Ethanol with a wedge, a caption, an arrow, a TLC plate, an energy diagram and an Abs flag. */
  const rich = () => {
    const d = ethanol();
    d.edit('Wedge', () => { d.updateBond([...d.bonds.keys()][1], { display: 'wedge' }); });
    d.edit('Arrow', () => { d.addArrow({ tail: { x: 40, y: 0 }, head: { x: 90, y: 0 } } as never); });
    d.edit('TLC', () => { putPlate(d, POINTS, newPlate('tlc', d.style.bondLength), { x: 100, y: 0 }); });
    d.edit('E', () => { putEnergy(d, POINTS, { ...ENERGY_DEFAULTS, ...structuredClone(ENERGY_PRESETS[0].data), w: 200, h: 150 } as EnergyData, { x: 0, y: 200 }); });
    d.edit('Flag', () => { addChiralFlag(d, [...d.atoms.keys()].slice(0, 3), 'Absolute'); });
    d.edit('Table', () => { d.addShape({ kind: 'table', x1: 300, y1: 0, x2: 400, y2: 40, table: emptyTable(2, 2, 10) } as never); });
    d.edit('Look', () => {
      const [c] = d.captions.keys();
      d.updateCaption(c, { paras: [{ indent: 6, spaceAfter: 2 }] });
      const [a] = d.atoms.keys();
      d.updateAtom(a, { numberLabel: { dx: 3, dy: -3, size: 7 }, stereoLabel: { text: '(S)', dx: 4, dy: 4, size: 7 } });
      const [r] = d.arrows.keys();
      d.updateArrow(r, { step: { reactants: [], products: [], above: ['c1'], below: [] } });
    });
    return d;
  };
  /** Pasted, saved as CDXML and drawn as a picture (as copying it again does). */
  const pastesAndSaves = (got: Doc) => {
    const into = new Doc();
    into.style = { ...got.style };
    insertDrawing(into, got, { x: 0, y: 0 });
    writeCdxml(into, { name: 'x.cdxml' });
    const p = recordPicture(into);
    if (p) pictureSvg(p);
  };
  it('turns down a value outside its list, two objects with one id, and a pin without its place', () => {
    expect(nativeDrawing(edit((j) => { j.contents.bonds[0].display = 'zigzag'; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.captions[0].justify = 'middle'; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.atoms[1].id = j.contents.atoms[0].id; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.shapes = [{ id: 97, kind: 'star', x1: 0, y1: 0, x2: 20, y2: 10 }]; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.atoms[0].multi = 'all'; }))).toBeNull();
    expect(nativeDrawing(edit((j) => { j.contents.captions[0].attach = { atoms: 1 }; }))).toBeNull();
    const flagged = JSON.parse(nativeDrawingText(rich()));
    const flag = (flagged.contents.shapes as Record<string, Record<string, unknown>>[]).find((s) => s.symbol === 'Absolute')!;
    delete flag.pin.was;
    expect(nativeDrawing(JSON.stringify(flagged))).toBeNull();
  });
  it('lets go of references to nothing: a bond to a missing atom is left out, a frame member or pin to one is let go on paste', () => {
    const got = nativeDrawing(edit((j) => { j.contents.bonds[0].a2 = 999; }))!;
    expect(got.bonds.size).toBe(1);
    const d = rich();
    const j = JSON.parse(nativeDrawingText(d));
    const plate = (j.contents.shapes as Record<string, Record<string, number[]>>[]).find((s) => s.plate)!;
    plate.frame.captions.push(9999);
    const flag = (j.contents.shapes as Record<string, Record<string, unknown>>[]).find((s) => s.symbol === 'Absolute')!;
    (flag.pin as { ref: number[] }).ref = [8888];
    const taken = nativeDrawing(JSON.stringify(j))!;
    const into = new Doc();
    insertDrawing(into, taken, { x: 0, y: 0 });
    const f = [...into.shapes.values()].find((s) => s.plate)!.frame!;
    expect(f.captions.every((c) => into.captions.has(c))).toBe(true);
    // (the flag let go is stuck again to the structure it sits beside, as any loose flag is: review F1c-R07)
    const pin = [...into.shapes.values()].find((s) => s.symbol === 'Absolute')!.pin;
    expect(pin === undefined || into.atoms.has(pin.ref[0])).toBe(true);
    expect(pin?.ref).not.toEqual([8888]);
    expect(() => writeCdxml(into, { name: 'x.cdxml' })).not.toThrow();
  });
  it('an atom with no element and no label (z = 0) pastes and saves', () => {
    const got = nativeDrawing(edit((j) => { j.contents.atoms[2].z = 0; j.contents.atoms[2].label = null; }))!;
    expect(got).not.toBeNull();
    expect(() => pastesAndSaves(got)).not.toThrow();
  });
  it('a pasted Abs flag stays with the copy of its own structure, where it was put', () => {
    const d = rich();
    const into = new Doc();
    insertDrawing(into, nativeDrawing(nativeDrawingText(d))!, { x: 500, y: 500 });
    const flag = [...into.shapes.values()].find((s) => s.symbol === 'Absolute')!;
    const was = [...d.shapes.values()].find((s) => s.symbol === 'Absolute')!;
    expect(into.atoms.has(flag.pin!.ref[0])).toBe(true);
    // (moved with the paste by the same amount as everything else: the copy of the same atom)
    const dx = flag.x1 - was.x1, dy = flag.y1 - was.y1;
    const atom = into.atoms.get(flag.pin!.ref[0])!, from = d.atoms.get(was.pin!.ref[0])!;
    expect(atom.x - from.x).toBeCloseTo(dx, 6);
    expect(atom.y - from.y).toBeCloseTo(dy, 6);
    expect(flag.pin!.was.x).toBeCloseTo(was.pin!.was.x + dx, 6);
  });
  it('a small fuzz: 600 copies, each with one or two parts changed to a wrong value or left out; whatever is taken pastes and saves', () => {
    const base = JSON.parse(nativeDrawingText(rich()));
    let seed = 20261122;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const paths: (string | number)[][] = [];
    const walk = (v: unknown, p: (string | number)[]) => { paths.push(p); if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...p, Array.isArray(v) ? Number(k) : k]); };
    walk(base.contents, []);
    // (the fifth review's kinds of wrong value too: a word for a number, a list of the wrong things, 1e300, 1e-12)
    const wrong: unknown[] = ['x', 'zzz', -1, -5, 0, 0.5, 1e7, 1e300, 1e-12, null, [], {}, true, [1, 2], { x: 1 }, [{ indent: 'x', tabs: 5 }], { rows: 'x' }, { above: 5, below: 'x' }, 'leave out'];
    let taken = 0, refused = 0;
    const failed: string[] = [];
    for (let k = 0; k < 600; k++) {
      const j = structuredClone(base);
      let what = '';
      for (let m = 0; m < 1 + (k % 2); m++) {
        const p = paths[1 + Math.floor(rnd() * (paths.length - 1))];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let o: any = j.contents;
        for (const s of p.slice(0, -1)) o = o?.[s];
        if (!o || typeof o !== 'object') continue;
        const v = wrong[Math.floor(rnd() * wrong.length)];
        const last = p[p.length - 1];
        if (v === 'leave out') { if (Array.isArray(o)) o.splice(last as number, 1); else delete o[last]; } else o[last] = v;
        what += `${p.join('.')}=${JSON.stringify(v)} `;
      }
      const got = nativeDrawing(JSON.stringify(j));
      if (!got) { refused++; continue; }
      taken++;
      try { pastesAndSaves(got); } catch (e) { failed.push(`${what}: ${String(e).slice(0, 80)}`); }
    }
    expect(failed).toEqual([]);
    // (both ways taken: most changes are harmless, many are not)
    expect(taken).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(50);
  });
});

describe('the fifth review\'s cases, and the safety net (review F1e-R01)', () => {
  const with_ = (f: (j: { style: Record<string, unknown>; contents: Record<string, Record<string, unknown>[]> }) => void) => edit(f as never);
  it('turns down wrong inner parts without a rule of their own: step, paras, table, stereo and number labels', () => {
    const arrow = { id: 90, tail: { x: 40, y: 0 }, head: { x: 90, y: 0 } };
    expect(nativeDrawing(with_((j) => { j.contents.arrows = [{ ...arrow, step: { reactants: [], products: [], above: 5, below: 'x' } }]; }))).toBeNull();
    expect(nativeDrawing(with_((j) => { j.contents.captions[0].paras = [{ indent: 'x', tabs: 5 }]; }))).toBeNull();
    expect(nativeDrawing(with_((j) => { j.contents.shapes = [{ id: 97, kind: 'table', x1: 0, y1: 0, x2: 20, y2: 10, table: { rows: 'x' } }]; }))).toBeNull();
    expect(nativeDrawing(with_((j) => { j.contents.atoms[0].stereoLabel = { text: '(R)', size: 7 }; }))).toBeNull();
    expect(nativeDrawing(with_((j) => { j.contents.atoms[0].numberLabel = { dx: 'q', dy: 0, size: 7 }; }))).toBeNull();
  });
  it('turns down sizes out of range: a caption 1e300 wide, a dash spacing of 1e-12; a style size of 1e300 is left at the drawing\'s own', () => {
    expect(nativeDrawing(with_((j) => { j.contents.captions[0].width = 1e300; }))).toBeNull();
    expect(nativeDrawing(with_((j) => { j.contents.shapes = [{ id: 97, kind: 'rect', x1: 0, y1: 0, x2: 20, y2: 10, dashed: true, hashSpacing: 1e-12 }]; }))).toBeNull();
    const fresh = new Doc().style.captionSize;
    const got = nativeDrawing(with_((j) => { j.style.captionSize = 1e300; j.style.lineWidth = 0.6; }))!;
    expect(got.style.captionSize).toBe(fresh);
    expect(got.style.lineWidth).toBe(0.6);
  });
  it('a paste that still fails is undone and the CDXML beside it pasted instead, with a note', async () => {
    const into = ethanol();
    const before = [into.atoms.size, into.captions.size], top = into.topStep;
    const src = nativeDrawing(nativeDrawingText(ethanol()))!;
    setPasteFallback(src, async () => readCdxml(writeCdxml(ethanol(), { name: 'x.cdxml' })).doc);
    let first = true;
    // (the first try throws half way, after its atoms are in)
    const got = await pasteDrawing(into, src, () => ({ x: 200, y: 0 }), () => { if (first) { first = false; throw new Error('broken'); } });
    expect('sel' in got && got.note).toBe('Part of the copied drawing couldn\'t be read, so its CDXML copy was pasted instead.');
    expect([into.atoms.size, into.captions.size]).toEqual([before[0] + 3, before[1] + 1]);
    // one step, the CDXML copy's: one Undo gives the drawing as it was
    into.undo();
    expect([into.atoms.size, into.captions.size]).toEqual(before);
    expect(into.topStep).toBe(top);
  });
  it('with nothing beside it, a failed paste leaves the drawing as it was and says why', async () => {
    const into = ethanol();
    const before = [into.atoms.size, into.bonds.size], top = into.topStep;
    const got = await pasteDrawing(into, ethanol(), () => ({ x: 200, y: 0 }), () => { throw new Error('broken'); });
    expect(got).toEqual({ error: 'Could not paste: broken' });
    expect([into.atoms.size, into.bonds.size]).toEqual(before);
    expect(into.topStep).toBe(top);
  });
});
