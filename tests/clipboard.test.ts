// @vitest-environment jsdom
//
// Cut, copy and paste: taking part of a drawing, putting it back somewhere else, the block of
// formats sent to the Windows app, and the bitmap for programs that cannot take EMF.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import type { Selection } from '../src/editor/editor';
import { extractDrawing, insertDrawing, packFormats, unpackFormats, isEmpty, copyDrawing, forgetCopy, readPasteEvent, readWebClipboard, ownDrawing, mdlctOf, setSmilesMaker, nativeDrawing, nativeDrawingText, clipboardDrawing, NATIVE_FORMAT, OWN_FORMAT, WEB_NATIVE_FORMAT, DRAWING_FORMATS } from '../src/io/clipboard';
import { rgbaToDib } from '../src/render/picture';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';

/** Two structures, a caption, an arrow and a picture placeholder. */
function sample() {
  const doc = new Doc();
  let first: number[] = [], second: number[] = [];
  const ids = { caption: 0, arrow: 0, box: 0, picture: 0, ethanolOH: 0 };
  doc.bulk(() => {
    // benzene with an OMe
    const ring = [0, 1, 2, 3, 4, 5].map((i) => doc.addAtom(100 + 14.4 * Math.cos((Math.PI / 3) * i), 100 + 14.4 * Math.sin((Math.PI / 3) * i)));
    ring.forEach((a, i) => doc.addBond(a.id, ring[(i + 1) % 6].id, i % 2 ? 2 : 1));
    const ome = doc.addAtom(128.8, 100, 6, { label: 'OMe' });
    doc.addBond(ring[0].id, ome.id);
    first = [...ring.map((a) => a.id), ome.id];
    // ethanol
    const c1 = doc.addAtom(220, 100), c2 = doc.addAtom(232.5, 92.8), o = doc.addAtom(245, 100, 8, { charge: -1 });
    doc.addBond(c1.id, c2.id);
    doc.addBond(c2.id, o.id, 1, 'wedge');
    second = [c1.id, c2.id, o.id];
    ids.ethanolOH = o.id;
    ids.caption = doc.addCaption({ x: 90, y: 140, runs: [{ text: 'Yield ' }, { text: '92%', bold: true }], justify: 'left' }).id;
    ids.arrow = doc.addArrow({ tail: { x: 140, y: 100 }, head: { x: 180, y: 100 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 }).id;
    ids.box = doc.addShape({ kind: 'rect', x1: 60, y1: 70, x2: 190, y2: 150, rounded: true, shadow: true }).id;
    ids.picture = doc.addShape({ kind: 'rect', x1: 300, y1: 70, x2: 340, y2: 110, dashed: true, picture: true }).id;
  });
  return { doc, first, second, ids };
}

const emptySel = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });

describe('copying part of a drawing', () => {
  it('copies the selected things and nothing else', () => {
    const { doc, first, ids } = sample();
    const sel = emptySel();
    for (const id of first) { sel.atoms.add(id); for (const b of doc.adj.get(id)!) sel.bonds.add(b); }
    sel.captions.add(ids.caption);
    const part = extractDrawing(doc, sel);
    expect(part.atoms.size).toBe(7);
    expect(part.bonds.size).toBe(7);
    expect(part.captions.size).toBe(1);
    expect(part.arrows.size + part.shapes.size).toBe(0);
    expect([...part.atoms.values()].find((a) => a.label === 'OMe')).toBeTruthy();
    expect(part.style).toEqual(doc.style);
  });

  it('brings the atoms of a selected bond, and the bonds between selected atoms', () => {
    const { doc, second } = sample();
    const sel = emptySel();
    sel.bonds.add(doc.bondBetween(second[0], second[1])!.id);
    expect(extractDrawing(doc, sel).atoms.size).toBe(2);
    const sel2 = emptySel();
    for (const id of second) sel2.atoms.add(id);
    const part = extractDrawing(doc, sel2);
    expect(part.bonds.size).toBe(2);
    expect([...part.bonds.values()].some((b) => b.display === 'wedge')).toBe(true);
  });

  it('copies everything when nothing is selected, except picture placeholders', () => {
    const { doc, ids } = sample();
    const part = extractDrawing(doc, null);
    expect(part.atoms.size).toBe(doc.atoms.size);
    expect(part.bonds.size).toBe(doc.bonds.size);
    expect(part.shapes.has(ids.box)).toBe(true);
    expect(part.shapes.has(ids.picture)).toBe(false);
    // the copy is separate from the drawing
    part.edit('change', () => part.updateAtom(ids.ethanolOH, { charge: 0 }));
    expect(doc.atoms.get(ids.ethanolOH)!.charge).toBe(-1);
    expect(isEmpty(part)).toBe(false);
    expect(isEmpty(extractDrawing(doc, emptySel()))).toBe(true);
  });
});

describe('pasting', () => {
  it('adds the pasted things with new numbers, centred where asked, as one undo step', () => {
    const { doc, first } = sample();
    const sel = emptySel();
    for (const id of first) { sel.atoms.add(id); for (const b of doc.adj.get(id)!) sel.bonds.add(b); }
    const part = extractDrawing(doc, sel);
    const before = { atoms: doc.atoms.size, bonds: doc.bonds.size };
    const got = insertDrawing(doc, part, { x: 500, y: 400 });
    expect(doc.atoms.size).toBe(before.atoms + 7);
    expect(doc.bonds.size).toBe(before.bonds + 7);
    expect(got.atoms.size).toBe(7);
    expect(got.bonds.size).toBe(7);
    for (const id of got.atoms) expect(first).not.toContain(id);
    // centred on the point
    const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2;
    const xs = [...got.atoms].map((id) => doc.atoms.get(id)!.x), ys = [...got.atoms].map((id) => doc.atoms.get(id)!.y);
    const b = part.bounds()!;
    expect(mid(xs)).toBeCloseTo(500 + mid([...part.atoms.values()].map((a) => a.x)) - (b.x1 + b.x2) / 2, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * 14.4 * Math.sin(Math.PI / 3), 6);
    // bonds join the new atoms, not the old ones
    for (const id of got.bonds) {
      const bd = doc.bonds.get(id)!;
      expect(got.atoms.has(bd.a1) && got.atoms.has(bd.a2)).toBe(true);
    }
    doc.undo();
    expect(doc.atoms.size).toBe(before.atoms);
    expect(doc.bonds.size).toBe(before.bonds);
  });

  it('moves captions, arrows and shapes with the structures', () => {
    const { doc, ids } = sample();
    const part = extractDrawing(doc, null);
    const b = part.bounds()!;
    const dx = 1000 - (b.x1 + b.x2) / 2, dy = 1000 - (b.y1 + b.y2) / 2;
    const got = insertDrawing(doc, part, { x: 1000, y: 1000 });
    const cap = doc.captions.get([...got.captions][0])!;
    expect(cap.x).toBeCloseTo(90 + dx, 6);
    expect(cap.runs.map((r) => r.text).join('')).toBe('Yield 92%');
    const arr = doc.arrows.get([...got.arrows][0])!;
    expect(arr.head.x - arr.tail.x).toBeCloseTo(40, 6);
    expect(arr.tail.y).toBeCloseTo(100 + dy, 6);
    const box = [...got.shapes].map((id) => doc.shapes.get(id)!).find((s) => s.shadow)!;
    expect(box.x1).toBeCloseTo(60 + dx, 6);
    expect(doc.shapes.get(ids.box)!.x1).toBe(60);
  });

  it('pastes a copy that went through the clipboard as CDXML', () => {
    const { doc, second } = sample();
    const sel = emptySel();
    for (const id of second) sel.atoms.add(id);
    const text = writeCdxml(extractDrawing(doc, sel), { name: 'Clipboard.cdxml' });
    const back = readCdxml(text).doc;
    const target = new Doc();
    const got = insertDrawing(target, back, { x: 50, y: 50 });
    expect(got.atoms.size).toBe(3);
    expect([...target.atoms.values()].find((a) => a.z === 8)!.charge).toBe(-1);
    expect([...target.bonds.values()].some((b) => b.display === 'wedge')).toBe(true);
  });
});

describe('the block of formats sent to the Windows app', () => {
  it('lays out names and data with their lengths, as the app reads them', () => {
    const block = packFormats([['PNG', new Uint8Array([1, 2, 3])]]);
    // the same bytes the app's own test packs
    expect([...block]).toEqual([1, 0, 0, 0, 3, 0, 0, 0, 80, 78, 71, 3, 0, 0, 0, 1, 2, 3]);
    const two = packFormats([['Chem Illustrator CDXML', new TextEncoder().encode('<CDXML/>')], ['CF_ENHMETAFILE', new Uint8Array(0)]]);
    const back = unpackFormats(two);
    expect(back.map(([n]) => n)).toEqual(['Chem Illustrator CDXML', 'CF_ENHMETAFILE']);
    expect(new TextDecoder().decode(back[0][1])).toBe('<CDXML/>');
    expect(back[1][1].length).toBe(0);
    expect(unpackFormats(new Uint8Array(0))).toEqual([]);
    expect(() => unpackFormats(block.subarray(0, block.length - 1))).toThrow();
  });
});

describe('the bitmap for programs that cannot take EMF', () => {
  it('writes a bottom-up, blue-green-red bitmap on white', () => {
    // 3 x 2 pixels: top row red, green, see-through; bottom row blue, half-transparent black, white
    const px = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 128, 255, 255, 255, 255];
    const dib = rgbaToDib(px, 3, 2, 300);
    const v = new DataView(dib.buffer);
    expect(v.getUint32(0, true)).toBe(40);
    expect(v.getInt32(4, true)).toBe(3);
    expect(v.getInt32(8, true)).toBe(2);
    expect(v.getUint16(14, true)).toBe(24);
    expect(v.getUint32(20, true)).toBe(24); // two rows of 9 bytes, each padded to 12
    expect(v.getInt32(24, true)).toBe(11811); // 300 dots per inch in dots per metre
    expect(dib.length).toBe(40 + 24);
    const row = (r: number) => [...dib.subarray(40 + r * 12, 40 + r * 12 + 9)];
    // the first row stored is the bottom one
    expect(row(0)).toEqual([255, 0, 0, 127, 127, 127, 255, 255, 255]);
    expect(row(1)).toEqual([0, 0, 255, 0, 255, 0, 255, 255, 255]);
  });
});

describe('pasting things that point at atoms', () => {
  it('ties a pasted caption and a pinned arrow to the copy, not the original', () => {
    const { doc, first } = sample();
    doc.bulk(() => doc.addCaption({ x: 90, y: 160, runs: [{ text: 'C7' }], justify: 'left', attach: { atoms: [first[0]], side: 'below', gap: 4, shift: 0, role: 'caption' } }));
    const sel = emptySel();
    for (const id of first) sel.atoms.add(id);
    for (const c of doc.captions.values()) sel.captions.add(c.id);
    const part = extractDrawing(doc, sel);
    const made = insertDrawing(doc, part, { x: 400, y: 400 });
    const tied = [...made.captions].map((id) => doc.captions.get(id)!).find((c) => c.attach);
    expect(tied).toBeTruthy();
    expect(tied!.attach!.atoms.every((a) => made.atoms.has(a))).toBe(true);
  });
});

describe('the last drawing copied, for a paste that finds nothing else', () => {
  const emptyPaste = () => ({ clipboardData: { getData: () => '', files: [] } }) as unknown as ClipboardEvent;
  it('is forgotten once something else is copied (cells, a document\'s text, a picture)', async () => {
    // (jsdom has no canvas: a stand-in that measures text and draws nothing; the picture then
    // fails to go on the clipboard, which comes after the drawing is kept)
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const real = proto.getContext;
    const ctx: unknown = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (t: string) => ({ width: t.length * 5, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }) : () => ctx), set: () => true });
    proto.getContext = () => ctx;
    try {
      await copyDrawing(sample().doc, null).catch(() => '');
    } finally {
      proto.getContext = real;
    }
    expect((await readPasteEvent(emptyPaste())).kind).toBe('drawing');
    forgetCopy();
    expect((await readPasteEvent(emptyPaste())).kind).toBe('nothing');
  });
});

describe('our own drawing pasted back into this window (G1-11)', () => {
  it('is the drawing as it was held, not as CDXML could carry it', async () => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const real = proto.getContext;
    const ctx: unknown = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (t: string) => ({ width: t.length * 5, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }) : () => ctx), set: () => true });
    proto.getContext = () => ctx;
    const { doc, ids } = sample();
    // things the CDXML copy does not carry: a struck-through run and a see-through box
    doc.captions.get(ids.caption)!.runs[1].strike = true;
    doc.shapes.get(ids.box)!.transparency = 0.5;
    try {
      await copyDrawing(doc, null).catch(() => '');
    } finally {
      proto.getContext = real;
    }
    const emptyPaste = () => ({ clipboardData: { getData: () => '', files: [] } }) as unknown as ClipboardEvent;
    const got = await readPasteEvent(emptyPaste());
    expect(got.kind).toBe('drawing');
    const pasted = (got as { doc: Doc }).doc;
    expect(pasted.captions.get(ids.caption)?.runs[1].strike).toBe(true);
    expect(pasted.shapes.get(ids.box)?.transparency).toBe(0.5);
    // each paste is a copy of its own: changing one leaves the next alone
    pasted.shapes.get(ids.box)!.transparency = 0.1;
    expect((((await readPasteEvent(emptyPaste())) as { doc: Doc }).doc).shapes.get(ids.box)?.transparency).toBe(0.5);
    // CDXML from somewhere else is read as CDXML
    const other = writeCdxml(sample().doc, { name: 'x.cdxml' });
    expect(ownDrawing(other).captions.size).toBe(1);
    forgetCopy();
  });
});

describe('our own drawing pasted into another window or a later session (G1-11)', () => {
  const lossy = () => {
    const { doc, ids } = sample();
    // things CDXML does not carry: a struck-through run and a see-through box
    doc.captions.get(ids.caption)!.runs[1].strike = true;
    doc.shapes.get(ids.box)!.transparency = 0.5;
    return { doc, ids };
  };
  it('goes on the clipboard whole, as JSON, and comes back whole, read before the CDXML', () => {
    const { doc, ids } = lossy();
    const text = nativeDrawingText(doc);
    const back = nativeDrawing(text)!;
    expect(back.captions.get(ids.caption)?.runs[1].strike).toBe(true);
    expect(back.shapes.get(ids.box)?.transparency).toBe(0.5);
    expect(back.atoms.size).toBe(doc.atoms.size);
    expect(back.style.bondLength).toBe(doc.style.bondLength);
    expect(DRAWING_FORMATS[0]).toBe(NATIVE_FORMAT);
    expect(clipboardDrawing(NATIVE_FORMAT, new TextEncoder().encode(text + '\0'))?.shapes.get(ids.box)?.transparency).toBe(0.5);
    // damaged or someone else's JSON is not taken (the paste reads the CDXML beside it)
    expect(nativeDrawing(text.slice(0, -5))).toBeNull();
    expect(nativeDrawing('{"app":"other","v":1,"contents":{}}')).toBeNull();
    expect(clipboardDrawing(OWN_FORMAT, new TextEncoder().encode(writeCdxml(sample().doc, { name: 'x.cdxml' })))?.captions.size).toBe(1);
    // a bond to an atom that isn't there is left out
    const j = JSON.parse(text);
    j.contents.bonds.push({ ...j.contents.bonds[0], id: 9999, a2: 123456 });
    expect(nativeDrawing(JSON.stringify(j))!.bonds.size).toBe(doc.bonds.size);
  });
  it('on the web, a copy pasted after this window forgot it is still the drawing whole', async () => {
    const written: Record<string, unknown>[] = [];
    const nav = navigator as unknown as { clipboard?: unknown };
    const realClip = nav.clipboard;
    const g = globalThis as unknown as { ClipboardItem?: unknown };
    const realItem = g.ClipboardItem;
    g.ClipboardItem = class { static supports() { return true; } constructor(public items: Record<string, unknown>) { written.push(items); } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async () => {} } });
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const real = proto.getContext;
    const ctx: unknown = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (t: string) => ({ width: t.length * 5, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }) : () => ctx), set: () => true });
    proto.getContext = () => ctx;
    const gp = globalThis as unknown as { Path2D?: unknown };
    const realPath = gp.Path2D;
    gp.Path2D ??= class { constructor() { return new Proxy(this, { get: () => () => {} }); } };
    try {
      const { doc, ids } = lossy();
      expect(await copyDrawing(doc, null)).toMatch(/^Copied/);
      const blob = written.at(-1)?.[WEB_NATIVE_FORMAT] as Blob;
      expect(blob).toBeDefined();
      const json = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsText(blob); });
      // another window, or this one after a restart: nothing held in memory
      forgetCopy();
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        readText: async () => '',
        read: async () => [{ types: [WEB_NATIVE_FORMAT, 'image/png'], getType: async () => ({ text: async () => json }) }],
      } });
      const got = await readWebClipboard();
      expect(got.kind).toBe('drawing');
      const pasted = (got as { doc: Doc }).doc;
      expect(pasted.captions.get(ids.caption)?.runs[1].strike).toBe(true);
      expect(pasted.shapes.get(ids.box)?.transparency).toBe(0.5);
    } finally {
      proto.getContext = real;
      gp.Path2D = realPath;
      g.ClipboardItem = realItem;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: realClip });
      forgetCopy();
    }
  });
});

describe('the structures as text on the clipboard (G1-20)', () => {
  it('go as MDLCT: the molfile with each line as a length byte and its characters', () => {
    const { doc } = sample();
    const bytes = mdlctOf(doc)!;
    // read the lines back
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 1 + bytes[i]) lines.push(String.fromCharCode(...bytes.subarray(i + 1, i + 1 + bytes[i])));
    expect(lines.at(-1)).toBe('M  END');
    expect(lines[1].slice(2, 10)).toBe('Chemweav');
    expect(mdlctOf(new Doc())).toBeNull();
  });

  it('as SMILES, pasted back here, bring the drawing itself rather than a structure from the SMILES', async () => {
    const written: Record<string, unknown>[] = [];
    const nav = navigator as unknown as { clipboard?: unknown };
    const realClip = nav.clipboard;
    const g = globalThis as unknown as { ClipboardItem?: unknown };
    const realItem = g.ClipboardItem;
    g.ClipboardItem = class { constructor(public items: Record<string, unknown>) { written.push(items); } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async () => {} } });
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown; toBlob: unknown };
    const real = proto.getContext;
    const ctx: unknown = new Proxy({}, { get: (_, k) => (k === 'measureText' ? (t: string) => ({ width: t.length * 5, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }) : () => ctx), set: () => true });
    proto.getContext = () => ctx;
    const gp = globalThis as unknown as { Path2D?: unknown };
    const realPath = gp.Path2D;
    gp.Path2D ??= class { constructor() { return new Proxy(this, { get: () => () => {} }); } };
    // (a stand-in engine: any SMILES will do, the test only checks it is recognised)
    setSmilesMaker(async () => 'COc1ccccc1.CC[O-]');
    try {
      const { doc } = sample();
      const msg = await copyDrawing(doc, null).catch((e) => String(e));
      expect(msg).toMatch(/^Copied/);
      const text = written.at(-1)?.['text/plain'] as Promise<Blob> | undefined;
      expect(text).toBeDefined();
      const blob = await text!;
      // (the sample is a reaction scheme, so its text is a reaction SMILES: F8a, F1 Needs Nate 8)
      const copied = await new Promise<string>((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsText(blob); });
      expect(copied).toBe('COc1ccccc1.CC[O-]>>COc1ccccc1.CC[O-]');
      const paste = { clipboardData: { getData: (t: string) => (t === 'text/plain' ? copied : ''), files: [] } } as unknown as ClipboardEvent;
      const got = await readPasteEvent(paste);
      expect(got.kind).toBe('drawing');
      expect((got as { doc: Doc }).doc.captions.size).toBe(doc.captions.size);
    } finally {
      setSmilesMaker(null);
      proto.getContext = real;
      gp.Path2D = realPath;
      g.ClipboardItem = realItem;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: realClip });
      forgetCopy();
    }
  });
});
