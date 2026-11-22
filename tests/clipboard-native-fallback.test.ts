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

import { nativeDrawing, nativeDrawingText, nativeClipboardDrawing, NATIVE_FORMAT, OWN_FORMAT } from '../src/io/clipboard';
import { writeCdxml } from '../src/io/cdxml-write';
import { Doc } from '../src/model';
import { putPlate, newPlate } from '../src/design/plates';
import { POINTS } from '../src/editor/arrange';
import { addChiralFlag } from '../src/chem/chiral-flag';

function ethanol(): Doc {
  const d = new Doc();
  d.bulk(() => {
    const c1 = d.addAtom(0, 0), c2 = d.addAtom(12.5, -7.2), o = d.addAtom(25, 0, 8);
    d.addBond(c1.id, c2.id); d.addBond(c2.id, o.id);
    d.addCaption({ x: 0, y: 30, runs: [{ text: 'ethanol', strike: true }], justify: 'left' });
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
    // (read from CDXML: the strikethrough CDXML has no place for is gone, so this is the fallback)
    expect([...got!.captions.values()][0].runs[0].strike).toBeFalsy();
    // and a sound copy is taken whole
    board.set(NATIVE_FORMAT, new TextEncoder().encode(nativeDrawingText(ethanol())));
    expect([...(await nativeClipboardDrawing())!.captions.values()][0].runs[0].strike).toBe(true);
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
