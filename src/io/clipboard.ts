// Cut, copy and paste.
//
// A copy puts the selection on the clipboard in several forms, the most detailed first, so
// each program takes the best one it understands:
//   - the drawing whole, as this app holds it (JSON), so pasting into another window or a later
//     session here keeps everything, even what CDXML has no place for (audit G1-11);
//   - our own CDXML text, which older versions of this app read;
//   - the same drawing as CDX, ChemDraw's format, for pasting into ChemDraw;
//   - an EMF picture, which Word and PowerPoint paste as a sharp, scalable picture; the drawing
//     rides inside it, so copying the picture back out of Word brings back the structure;
//   - a bitmap, for programs that take neither (Paint, chat programs).
// Web pages can only put PNG pictures and text on the clipboard, so on Windows the desktop app
// hands the data to its own clipboard commands (src-tauri/src/clipboard.rs). Elsewhere the
// page's clipboard gets a PNG (and the drawing in a web format where the browser takes one),
// and the drawing itself is kept in memory: pasting that same picture back here gives the drawing.

import { remapField, remapFrames, remapStep, type IdMaps } from './remap-refs';
import { soundContents, soundStyle } from './clip-check';
import { freshGroups } from '../editor/groups';
import { frameMembers } from '../editor/frames';
import { pastedTable, tableHtml, tableTsv, type PastedRows } from './table-clip';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Doc, applyBase, type MorphStep, type TableData } from '../model';
import type { Vec } from '../geom';
import type { Selection } from '../editor/editor';
import { readCdxml } from './cdxml';
import { writeCdxml } from './cdxml-write';
import { cdxmlToCdx, cdxToCdxml, isCdx } from './cdx';
import { chemdrawInObject } from './ole-object';
import { measureText } from '../render/renderer';
import { fitPasted, typicalBondLength } from './fit-drawing';

export { fitPasted, typicalBondLength };
import { recordPicture, pictureEmf, pictureEmfWithPictures, pictureSvg, pictureCanvas, canvasPng, canvasDib } from '../render/picture';
import { emfToSvg } from '../render/emf-read';
import type { Item } from '../render/vector';
import { itemsToEmf, withDrawing, drawingInEmf, type EmfBox } from '../render/emf';
import { imageSize, fromDataUrl } from '../render/images';
import { cxSmiles, isReactionSmiles, reactionSmiles } from '../chem/reaction-io';
import { plainMeasure, reactionSteps, schemeItems } from '../chem/reaction';
import { stepMembers } from '../chem/species';
import { toMolfile } from '../chem/molfile';
import { writeMolFile } from './chem-formats';

/** Our own clipboard format: the drawing as CDXML text. */
export const OWN_FORMAT = 'Chem Illustrator CDXML';
/**
 * Our drawing whole, as this app holds it (JSON: its style, page colour and every atom, bond,
 * caption, arrow and shape with all their settings). Read before CDXML, so a copy pasted into
 * another window or a later session loses nothing (audit G1-11). A registered Windows clipboard
 * format; on the web, a format of the page's own where the browser takes one.
 */
export const NATIVE_FORMAT = 'Chemweave Drawing';
export const WEB_NATIVE_FORMAT = 'web application/x-chemweave-drawing';
const NATIVE_VERSION = 1;
/** ChemDraw's clipboard format (a CDX file). */
export const CDX_FORMAT = 'ChemDraw Interchange Format';
/** The formats holding a drawing, best first: ours whole, ours as CDXML, ChemDraw's. */
export const DRAWING_FORMATS = [NATIVE_FORMAT, OWN_FORMAT, CDX_FORMAT];
/** Our drawing on a web page's clipboard, where the browser takes formats of the page's own (Chrome, Edge). */
export const WEB_FORMAT = 'web application/x-chem-illustrator-cdxml';

/** Dots per inch of the picture a browser copy puts on the clipboard (see copyDrawing). */
const WEB_COPY_DPI = 150;

/** True in the Windows desktop app, where the app's own clipboard commands are used. */
export const nativeClipboard = isTauri() && /Windows/i.test(navigator.userAgent);

// ---------------------------------------------------------------- copying part of a drawing

/** The selected things (everything when `sel` is null) as a drawing of their own. */
export function extractDrawing(doc: Doc, sel: Selection | null): Doc {
  if (sel) sel = withFrameMembers(doc, sel);
  const out = new Doc();
  out.style = { ...doc.style };
  out.background = doc.background;
  const atoms = new Set<number>(sel ? sel.atoms : doc.atoms.keys());
  const bonds = new Set<number>(sel ? sel.bonds : doc.bonds.keys());
  // a selected bond brings its atoms, and selected atoms bring the bonds between them
  for (const id of bonds) {
    const b = doc.bonds.get(id);
    if (b) { atoms.add(b.a1); atoms.add(b.a2); }
  }
  // a ring's middle comes with its atoms; and with the ring and the metal bonded to it, it comes too
  for (const id of [...atoms]) for (const m of doc.atoms.get(id)?.multi ?? []) atoms.add(m);
  if (sel) for (const id of [...atoms]) for (const c of doc.centresOf.get(id) ?? []) {
    const ca = doc.atoms.get(c);
    if (ca?.multi?.every((m) => atoms.has(m)) && doc.neighbors(c).some((n) => atoms.has(n.id))) atoms.add(c);
  }
  if (sel) for (const b of doc.bonds.values()) if (atoms.has(b.a1) && atoms.has(b.a2)) bonds.add(b.id);
  let maxId = 0;
  const seen = (id: number) => { if (id > maxId) maxId = id; };
  out.bulk(() => {
    for (const id of atoms) {
      const a = doc.atoms.get(id);
      if (!a) continue;
      const copy = structuredClone(a);
      if (copy.multi) copy.multi = copy.multi.filter((m) => atoms.has(m));
      // (a variable attachment's ring, copied only with its ring; review F108)
      if (copy.ringOf) { copy.ringOf = copy.ringOf.filter((m) => atoms.has(m)); if (copy.ringOf.length < 3) delete copy.ringOf; }
      out.addAtom(a.x, a.y, a.z, copy);
      seen(id);
    }
    for (const id of bonds) {
      const b = doc.bonds.get(id);
      if (b && out.atoms.has(b.a1) && out.atoms.has(b.a2)) { out.addBond(b.a1, b.a2, b.order, b.display, structuredClone(b)); seen(id); }
    }
    for (const id of sel ? sel.captions : doc.captions.keys()) {
      const c = doc.captions.get(id);
      if (!c) continue;
      const copy = structuredClone(c);
      if (copy.ph) {
        // a slide's title or text becomes plain text, formatted as it looked on the slide
        copy.runs = applyBase(copy.runs, doc.textStyles?.[copy.ph]);
        delete copy.ph;
        delete copy.boxH;
      }
      out.addCaption(copy);
      seen(id);
    }
    for (const id of sel ? sel.arrows : doc.arrows.keys()) {
      const r = doc.arrows.get(id);
      if (r) { out.addArrow(structuredClone(r)); seen(id); }
    }
    // ring fills come along with their rings, picked or not
    const shapes = new Set<number>(sel ? sel.shapes : doc.shapes.keys());
    if (sel) for (const s of doc.shapes.values()) if (s.kind === 'ring' && s.ring?.length && s.ring.every((a) => atoms.has(a))) shapes.add(s.id);
    for (const id of shapes) {
      const s = doc.shapes.get(id);
      // a placeholder for a picture from ChemDraw has no picture in it to copy
      if (!s || s.picture) continue;
      const copy = structuredClone(s);
      // a ring fill copied without its ring keeps the ring's shape, where the atoms were
      if (copy.kind === 'ring' && copy.ring && !copy.ring.every((a) => atoms.has(a))) {
        copy.poly = copy.ring.every((a) => doc.atoms.has(a)) ? copy.ring.map((a) => { const at = doc.atoms.get(a)!; return { x: at.x, y: at.y }; }) : copy.poly;
        delete copy.ring;
      }
      out.addShape(copy);
      seen(id);
    }
  });
  out.reserveIds(maxId);
  return out;
}

/**
 * A selection with what its frames hold: an energy diagram (or any framed group) picked by its
 * frame copies as the diagram, not as its invisible frame alone.
 */
function withFrameMembers(doc: Doc, sel: Selection): Selection {
  if (![...sel.shapes].some((id) => doc.shapes.get(id)?.frame)) return sel;
  const out: Selection = { atoms: new Set(sel.atoms), bonds: new Set(sel.bonds), captions: new Set(sel.captions), arrows: new Set(sel.arrows), shapes: new Set(sel.shapes) };
  const todo = [...sel.shapes];
  while (todo.length) {
    const f = doc.shapes.get(todo.pop()!)?.frame;
    if (!f) continue;
    const m = frameMembers(doc, f);
    for (const k of ['atoms', 'bonds', 'captions', 'arrows'] as const) for (const id of m[k]) out[k].add(id);
    for (const id of m.shapes) if (!out.shapes.has(id)) { out.shapes.add(id); todo.push(id); }
  }
  return out;
}

/** True when a drawing has nothing in it. */
export function isEmpty(doc: Doc): boolean {
  return !doc.atoms.size && !doc.captions.size && !doc.arrows.size && !doc.shapes.size;
}

/** The table, when a drawing is one table and nothing else. */
export function soleTable(doc: Doc): TableData | null {
  if (doc.atoms.size || doc.captions.size || doc.arrows.size || doc.shapes.size !== 1) return null;
  const s = doc.shapes.values().next().value!;
  return s.kind === 'table' && s.table ? s.table : null;
}

/**
 * Add everything in `src` to `doc` as one undoable step, centred on `center`, and return the
 * new things (to select them).
 */
export function insertDrawing(doc: Doc, src: Doc, center: Vec, label = 'Paste'): Selection {
  const sel: Selection = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() };
  const b = src.bounds();
  if (!b) return sel;
  const dx = center.x - (b.x1 + b.x2) / 2, dy = center.y - (b.y1 + b.y2) / 2;
  const ids = new Map<number, number>();
  const maps: IdMaps = { atoms: ids, captions: new Map(), shapes: new Map(), arrows: new Map() };
  doc.edit(label, () => {
    // (multicentre points after the atoms they stand for, so they can point at the new ones)
    const atoms = [...src.atoms.values()];
    for (const a of [...atoms.filter((x) => !x.multi), ...atoms.filter((x) => x.multi)]) {
      const { id, ...rest } = structuredClone(a);
      if (rest.multi) {
        rest.multi = rest.multi.map((m) => ids.get(m)).filter((m): m is number => m !== undefined);
        if (rest.multi.length < 2) continue;
      }
      // a variable attachment's ring is the copy of its ring (review F108)
      if (rest.ringOf) {
        rest.ringOf = rest.ringOf.map((m) => ids.get(m)).filter((m): m is number => m !== undefined);
        if (rest.ringOf.length < 3) delete rest.ringOf;
      }
      const n = doc.addAtom(a.x + dx, a.y + dy, a.z, { ...rest, x: a.x + dx, y: a.y + dy });
      ids.set(id, n.id);
      sel.atoms.add(n.id);
    }
    const bondIds = new Map<number, number>();
    for (const bd of src.bonds.values()) {
      const a1 = ids.get(bd.a1), a2 = ids.get(bd.a2);
      if (a1 === undefined || a2 === undefined) continue;
      const { id: _id, ...rest } = structuredClone(bd);
      const nb = doc.addBond(a1, a2, bd.order, bd.display, { ...rest, a1, a2 });
      bondIds.set(bd.id, nb.id);
      sel.bonds.add(nb.id);
    }
    // the bonds a file said each one crosses are the copies of them
    for (const [from, to] of bondIds) {
      const list = src.bonds.get(from)!.crossing;
      if (list) doc.updateBond(to, { crossing: list.map((x) => bondIds.get(x)).filter((x): x is number => x !== undefined) });
    }
    for (const c of src.captions.values()) {
      const { id: cid, ...rest } = structuredClone(c);
      // a tied caption follows the copy of its structure, not the original
      if (rest.attach) {
        const atoms = rest.attach.atoms.map((x) => ids.get(x)).filter((x): x is number => x !== undefined);
        if (atoms.length) rest.attach.atoms = atoms; else rest.attach = undefined;
      }
      const nc = doc.addCaption({ ...rest, x: c.x + dx, y: c.y + dy });
      maps.captions.set(cid, nc.id);
      sel.captions.add(nc.id);
    }
    for (const s of src.shapes.values()) {
      const { id: sid, ...rest } = structuredClone(s);
      // a ring fill sits on the new copies of its ring's atoms
      const ring = rest.ring?.map((a) => ids.get(a));
      if (rest.ring) rest.ring = ring!.every((a) => a !== undefined) ? (ring as number[]) : undefined;
      if (rest.pin) {
        const ref = rest.pin.ref.map((x) => ids.get(x));
        // (where it was put goes with it, so it isn't taken as moved by hand: review F1d-R03)
        rest.pin = ref.every((x) => x !== undefined) ? { ...rest.pin, ref: ref as number[], ...(rest.pin.was ? { was: { x: rest.pin.was.x + dx, y: rest.pin.was.y + dy } } : {}) } : undefined;
      }
      if (rest.poly) rest.poly = rest.poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      const ns = doc.addShape({ ...rest, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy });
      maps.shapes.set(sid, ns.id);
      sel.shapes.add(ns.id);
    }
    for (const r of src.arrows.values()) {
      const { id: rid, ...rest } = structuredClone(r);
      // chosen roles (reaction steps, a Smart Scheme's order) name the copies
      if (rest.step) rest.step = remapStep(rest.step, maps);
      // pins and animation pairs point at the copies of the atoms, or are let go
      if (rest.pin) {
        for (const end of ['tail', 'head'] as const) {
          const pin = rest.pin[end];
          const ref = pin?.ref.map((x) => ids.get(x));
          if (pin && ref) { if (ref.every((x) => x !== undefined)) Object.assign(pin, { ref, ...(pin.was ? { was: { x: pin.was.x + dx, y: pin.was.y + dy } } : {}) }); else delete rest.pin[end]; }
        }
        if (!rest.pin.tail && !rest.pin.head) rest.pin = undefined;
      }
      // (its 1,2-shifts and sliding lines too; kept while any of them is left: review F552)
      if (rest.morph) {
        const m = remapField('r', 'morph', rest.morph, (k, id) => (k === 'a' ? ids.get(id) : undefined), false) as MorphStep;
        for (const k of ['pairs', 'shifts', 'slides'] as const) if (!m[k]?.length) delete m[k];
        rest.morph = m.pairs || m.shifts || m.slides ? m : undefined;
      }
      // a connector's glued ends stick to the copies of their shapes, or are let go (review F109)
      for (const end of ['from', 'to'] as const) {
        const g = rest[end];
        if (!g) continue;
        const shape = maps.shapes.get(g.shape);
        if (shape === undefined) delete rest[end]; else rest[end] = { ...g, shape };
      }
      // (a reagent arrow's main arrow, once every arrow is in, below)
      delete rest.reagentFor;
      const na = doc.addArrow({ ...rest, tail: { x: r.tail.x + dx, y: r.tail.y + dy }, head: { x: r.head.x + dx, y: r.head.y + dy } });
      maps.arrows.set(rid, na.id);
      sel.arrows.add(na.id);
    }
    for (const r of src.arrows.values()) {
      const to = r.reagentFor === undefined ? undefined : maps.arrows.get(r.reagentFor);
      if (to !== undefined) doc.updateArrow(maps.arrows.get(r.id)!, { reagentFor: to });
    }
    remapFrames(doc, maps);
    // a pasted group is a new group, not part of the one it was copied from
    freshGroups(doc, sel);
  });
  return sel;
}

// ---------------------------------------------------------------- the block sent to the desktop app

/**
 * Several clipboard formats in one block of bytes: a count, then each format's name and data,
 * each preceded by its length (32-bit little-endian). The desktop app reads the same layout.
 */
export function packFormats(items: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const names = items.map(([n]) => enc.encode(n));
  const size = 4 + items.reduce((s, [, d], i) => s + 8 + names[i].length + d.length, 0);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let at = 0;
  v.setUint32(at, items.length, true); at += 4;
  items.forEach(([, data], i) => {
    v.setUint32(at, names[i].length, true); at += 4;
    out.set(names[i], at); at += names[i].length;
    v.setUint32(at, data.length, true); at += 4;
    out.set(data, at); at += data.length;
  });
  return out;
}

export function unpackFormats(block: Uint8Array): [string, Uint8Array][] {
  if (!block.length) return [];
  const v = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const dec = new TextDecoder();
  let at = 0;
  const take = (n: number) => {
    if (at + n > block.length) throw new Error('clipboard data is cut short');
    at += n;
    return block.subarray(at - n, at);
  };
  const u32 = () => { take(4); return v.getUint32(at - 4, true); };
  const out: [string, Uint8Array][] = [];
  for (let i = u32(); i > 0; i--) {
    const name = dec.decode(take(u32()));
    out.push([name, take(u32()).slice()]);
  }
  return out;
}

// ---------------------------------------------------------------- copy and paste

/** The last drawing copied, for pasting back where the clipboard cannot hold it (web pages). */
let lastCopy: string | null = null;
/**
 * The last drawing copied as it is held here (audit G1-11): pasting our own copy back into this
 * window takes this rather than reading the CDXML again, so nothing the file cannot hold (a
 * caption's strikethrough, a shape's transparency, a picture's look) is lost on the way.
 */
let lastPart: Doc | null = null;

/**
 * Our own drawing on the clipboard: when it is the copy made here last, that drawing itself (a
 * fresh copy of it, so it can be pasted again), else the drawing read from its CDXML (a copy made
 * in another window or an earlier session).
 */
export function ownDrawing(cdxml: string): Doc {
  if (lastPart && lastCopy !== null && cdxml === lastCopy) {
    const d = new Doc();
    d.style = { ...lastPart.style };
    d.background = lastPart.background;
    d.restoreContents(lastPart.contents());
    return d;
  }
  return readCdxml(cdxml).doc;
}
/** A drawing as the NATIVE_FORMAT's text. */
export function nativeDrawingText(part: Doc): string {
  return JSON.stringify({ app: 'Chemweave', v: NATIVE_VERSION, style: part.style, background: part.background, contents: part.contents() });
}

/**
 * The drawing in a NATIVE_FORMAT text, or null when it isn't one, is damaged, or comes from a
 * later version of this program (review F1b-R05). The rule for versions: `v` is the layout's
 * version; a later program that changes the layout raises it, and a program that doesn't know
 * that version pastes the CDXML written beside it instead (which is why CDXML is still written).
 * The data is checked before it is taken, field by field (clip-check.ts soundContents; review
 * F1b-R05, F1c-R05, F1d-R03): anything unsound and the CDXML beside it is pasted instead.
 * Settings this version doesn't know are kept on the objects as they are.
 */
export function nativeDrawing(text: string): Doc | null {
  try {
    const j = JSON.parse(text) as { app?: unknown; v?: unknown; style?: unknown; background?: unknown; contents?: Record<string, unknown> };
    if (j?.app !== 'Chemweave' || !Number.isInteger(j.v) || (j.v as number) < 1 || (j.v as number) > NATIVE_VERSION) return null;
    if (!j.contents || typeof j.contents !== 'object') return null;
    const contents = soundContents(j.contents);
    if (!contents) return null;
    type Obj = Record<string, unknown>;
    const d = new Doc();
    // (style settings only where they have the type and range a fresh drawing's have)
    if (j.style && typeof j.style === 'object' && !Array.isArray(j.style)) Object.assign(d.style, soundStyle(j.style as Obj, d.style as unknown as Obj));
    if (typeof j.background === 'string') d.background = j.background;
    d.restoreContents(contents);
    return d;
  } catch {
    return null;
  }
}

/**
 * The drawing on the Windows clipboard, our own whole first: when that is missing, damaged or from
 * a later version, our CDXML, then ChemDraw's CDX (review F1b-R06). Null when there is none.
 * `more` adds formats to try after ours (Word's "Embed Source" for the canvas paste).
 */
export async function nativeClipboardDrawing(more: string[] = []): Promise<Doc | null> {
  const whole = await nativeFirst([NATIVE_FORMAT]);
  const fromWhole = whole ? nativeDrawing(new TextDecoder().decode(whole[1]).replace(/\0+$/, '')) : null;
  const beside = async () => { const drawing = await nativeFirst([OWN_FORMAT, ...more, CDX_FORMAT]); return drawing ? clipboardDrawing(...drawing) : null; };
  if (fromWhole) { setPasteFallback(fromWhole, beside); return fromWhole; }
  return beside();
}

/** For a drawing read from our whole-drawing format: how to read the CDXML copied beside it. */
const fallbacks = new WeakMap<Doc, () => Promise<Doc | null>>();
/** Say how to get the CDXML drawing copied beside `d` (the whole-drawing format's), for pasteDrawing. */
export function setPasteFallback(d: Doc, get: () => Promise<Doc | null>): void { fallbacks.set(d, get); }

/**
 * Paste drawing `src` into `doc` as one step (insertDrawing at `at()`, then `after` with what was
 * pasted), with a safety
 * net (review F1e-R01): if anything throws on the way, what was changed is undone and, for a
 * drawing read from our whole-drawing format, the CDXML copied beside it is pasted instead
 * (`prepare` fits it first), with a note. The error when nothing could be pasted.
 */
export async function pasteDrawing(doc: Doc, src: Doc, at: () => Vec, after?: (sel: Selection) => void, prepare?: (d: Doc) => void): Promise<{ sel: Selection; note?: string } | { error: string }> {
  const put = (d: Doc): Selection => {
    doc.begin('Paste');
    try {
      const sel = insertDrawing(doc, d, at());
      after?.(sel);
      doc.commit();
      return sel;
    } catch (err) {
      doc.abandon();
      throw err;
    }
  };
  try {
    return { sel: put(src) };
  } catch (err) {
    const alt = await fallbacks.get(src)?.().catch(() => null);
    if (!alt || isEmpty(alt)) return { error: `Could not paste: ${err instanceof Error ? err.message : String(err)}` };
    prepare?.(alt);
    try {
      return { sel: put(alt), note: 'Part of the copied drawing couldn\'t be read, so its CDXML copy was pasted instead.' };
    } catch (err2) {
      return { error: `Could not paste: ${err2 instanceof Error ? err2.message : String(err2)}` };
    }
  }
}

/** The drawing in one of the DRAWING_FORMATS (as nativeFirst hands it over), or null when it can't be read. */
export function clipboardDrawing(name: string, data: Uint8Array): Doc | null {
  const text = name === CDX_FORMAT ? '' : new TextDecoder().decode(data).replace(/\0+$/, '');
  if (name === NATIVE_FORMAT) return nativeDrawing(text);
  try {
    return name === CDX_FORMAT ? readCdxml(cdxToCdxml(data)).doc : ownDrawing(text);
  } catch {
    return null;
  }
}

/**
 * Makes a structure's SMILES from its molfile: set by the app once the chemistry engine is there,
 * so a copy also carries the structure as text, as ChemDraw's does (audit G1-20).
 */
let smilesMaker: ((molblock: string) => Promise<string | null>) | null = null;
export function setSmilesMaker(f: ((molblock: string) => Promise<string | null>) | null): void {
  smilesMaker = f;
}
/** The SMILES put on the clipboard with the last drawing copied, to know it again when it is pasted back. */
let lastText: string | null = null;

/**
 * A copied reaction scheme's reaction SMILES (reactants>agents>products, as Edit ▸ Copy As ▸
 * Reaction SMILES writes it; Daylight's reaction SMILES): one line for each step, or null when the
 * copy has no step or a species can't be written (then the plain structures' SMILES go instead).
 * Reagents written over or under the arrow (DMSO, Me₂SO) are read as the compounds they name;
 * other conditions text is left out.
 */
export async function reactionSmilesOf(part: Doc): Promise<string | null> {
  if (!smilesMaker) return null;
  const m = plainMeasure(part);
  const items = schemeItems(part, m);
  const steps = reactionSteps(part, items);
  if (!steps.length) return null;
  const lines: string[] = [];
  for (const step of steps) {
    const parts: Record<'reactants' | 'agents' | 'products', string[]> = { reactants: [], agents: [], products: [] };
    for (const w of stepMembers(part, step.roles, items, m)) {
      if (w.role === 'Conditions') continue;
      const ex = toMolfile(part, new Set(w.atoms), '', { species: w.species });
      if (ex.generic.length) return null;
      const sm = (await smilesMaker!(ex.molblock).catch(() => null))?.trim();
      if (!sm) return null;
      parts[w.role === 'Starting material' ? 'reactants' : w.role === 'Reagent' ? 'agents' : 'products'].push(sm);
    }
    if (!parts.reactants.length && !parts.products.length) return null;
    lines.push(reactionSmiles(parts));
  }
  return lines.join('\n');
}

/** The structures' SMILES in a drawing, or null (no structures, generic labels, no engine yet); a reaction scheme's reaction SMILES. */
async function structureSmiles(part: Doc): Promise<string | null> {
  if (!smilesMaker || !part.atoms.size) return null;
  try {
    const rxn = await reactionSmilesOf(part).catch(() => null);
    if (rxn) return rxn;
    const ex = toMolfile(part, part.atoms.keys(), '');
    return ex.generic.length ? null : (await smilesMaker(ex.molblock))?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * ChemDraw's MDLCT clipboard format: a molfile with each line as a byte giving its length and
 * then its characters, no line ends (MDL's clipboard form of a CTfile). Null when the drawing has
 * no structures.
 */
export function mdlctOf(part: Doc): Uint8Array | null {
  if (!part.atoms.size) return null;
  try {
    const lines = writeMolFile(part).text.replace(/\r/g, '').split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const out: number[] = [];
    for (const l of lines) {
      const bytes = [...l.slice(0, 255)].map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 63));
      out.push(bytes.length, ...bytes);
    }
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

/** A table copied here as tab-separated text, to know it again when it is pasted back (web pages). */
let lastTableText: string | null = null;

/**
 * Whether drawings go on the clipboard as editable objects for Word, PowerPoint and Excel as
 * well as pictures (Windows, once the object type is registered: see src-tauri/src/ole.rs).
 */
let wordObjects = false;
export function setWordObjects(on: boolean): void {
  wordObjects = on;
}

/** "Object Descriptor" data for the Windows app: the picture's size in hundredths of a millimetre (from the EMF's frame). */
function objectSize(emf: Uint8Array): Uint8Array {
  const v = new DataView(emf.buffer, emf.byteOffset, emf.byteLength);
  const out = new DataView(new ArrayBuffer(8));
  if (emf.byteLength >= 40) {
    out.setInt32(0, v.getInt32(32, true) - v.getInt32(24, true), true);
    out.setInt32(4, v.getInt32(36, true) - v.getInt32(28, true), true);
  }
  return new Uint8Array(out.buffer);
}

/** The picture of a whole drawing that Word shows for it, with the drawing inside (for drawings edited for Word). */
export function embeddedPicture(doc: Doc, cdxml: string): Uint8Array {
  const pic = recordPicture(doc);
  return pic ? withDrawing(pictureEmf(pic), cdxml) : new Uint8Array();
}
/** The size in pixels of the picture of the last drawing copied (web pages), to know it again when it is pasted back. */
let lastPictureSize: { w: number; h: number } | null = null;

/**
 * Put the selection (everything when nothing is selected) on the clipboard. Returns a short
 * message for the user. Call it straight from the key press or menu click: browsers only let
 * a page use the clipboard right after the user does something.
 */
export async function copyDrawing(doc: Doc, sel: Selection | null): Promise<string> {
  const part = extractDrawing(doc, sel);
  const pic = isEmpty(part) ? null : recordPicture(part);
  if (!pic) return 'There is nothing to copy.';
  // our own copy keeps pictures in any format, and their cropping; ChemDraw's gets what it reads
  const own = writeCdxml(part, { name: 'Clipboard.cdxml', textMeasure: measureText, own: true });
  const cdxml = hasPictures(part) ? writeCdxml(part, { name: 'Clipboard.cdxml', textMeasure: measureText, cdx: true }) : own;
  lastCopy = own;
  lastPart = part;
  lastText = null;
  const what = sel ? 'Copied' : 'Copied the whole drawing';
  // a table on its own also goes out as cells, so Word and Excel paste a table they can edit
  // (Paste Special still offers the picture)
  const table = soleTable(part);
  const tsv = table ? tableTsv(table) : null;
  lastTableText = tsv;
  if (nativeClipboard) {
    const { canvas, dpi } = pictureCanvas(part, pic);
    const enc = new TextEncoder();
    // (photos and other pictures in the drawing go in the EMF too: an Office paste, and a pasted object's
    // picture, shows the metafile when there is one rather than the bitmap beside it)
    const emf = withDrawing(await pictureEmfWithPictures(pic), own);
    // the structures as text too, for an ELN, a search box or a text editor (after the pictures,
    // so Word and PowerPoint still paste the picture)
    const smiles = table ? null : await structureSmiles(part);
    const mdlct = table ? null : mdlctOf(part);
    lastText = smiles;
    const text: [string, Uint8Array][] = [
      ...(mdlct ? [['MDLCT', mdlct]] as [string, Uint8Array][] : []),
      ...(smiles ? [['SMILES', enc.encode(smiles)], ['CF_UNICODETEXT', enc.encode(smiles)]] as [string, Uint8Array][] : []),
    ];
    // Word, PowerPoint and Excel paste an object they can send back here to edit (a table stays cells)
    const object: [string, Uint8Array][] = wordObjects && !table ? [['Embed Source', enc.encode(own)], ['Object Descriptor', objectSize(emf)]] : [];
    const block = packFormats([
      [NATIVE_FORMAT, enc.encode(nativeDrawingText(part))],
      [OWN_FORMAT, enc.encode(own)],
      [CDX_FORMAT, cdxmlToCdx(cdxml)],
      ...object,
      ...(table ? [['HTML Format', cfHtml(tableHtml(table))], ['CF_UNICODETEXT', enc.encode(tsv!)]] as [string, Uint8Array][] : []),
      ['CF_ENHMETAFILE', emf],
      ['CF_DIB', canvasDib(canvas, dpi)],
      ...text,
    ]);
    await invoke('clipboard_write', block);
    return table ? `${what}. Paste into Word or Excel for a table, or into PowerPoint for a picture.`
      : wordObjects ? `${what}. In Word or PowerPoint, double-click the pasted drawing to edit it here.` : `${what}. Paste into Word or PowerPoint for a picture.`;
  }
  // The PNG goes in as a promise so the clipboard is asked straight away, while the key press
  // still counts (Safari insists on this).
  // A browser's clipboard picture carries no size, so ChemDraw and Office size it from its pixels:
  // at 300 dpi a drawing pasted two to three times too big (and a big crystal structure slowed
  // ChemDraw to a crawl). At 150 dpi it pastes near its own size and stays sharp enough.
  const { canvas } = pictureCanvas(part, pic, WEB_COPY_DPI);
  lastPictureSize = { w: canvas.width, h: canvas.height };
  // (on white, as the desktop app's bitmap is: ChemDraw shows a PNG's see-through parts as black)
  const png = canvasPng(canvas, '#ffffff');
  try {
    const formats: Record<string, Blob | Promise<Blob>> = { 'image/png': png };
    if (table) {
      formats['text/html'] = new Blob([tableHtml(table)], { type: 'text/html' });
      formats['text/plain'] = new Blob([tsv!], { type: 'text/plain' });
    }
    if (webFormatOk()) {
      formats[WEB_NATIVE_FORMAT] = new Blob([nativeDrawingText(part)], { type: WEB_NATIVE_FORMAT.slice(4) });
      formats[WEB_FORMAT] = new Blob([own], { type: WEB_FORMAT.slice(4) });
    }
    // the structures' SMILES as text (as ChemDraw's copy has), worked out while the clipboard waits
    if (!table && smilesMaker && part.atoms.size) {
      formats['text/plain'] = structureSmiles(part).then((sm) => { lastText = sm; return new Blob([sm ?? ''], { type: 'text/plain' }); });
    }
    try {
      await navigator.clipboard.write([new ClipboardItem(formats)]);
    } catch (err) {
      // (a browser that won't take text worked out later still gets the picture)
      if (!formats['text/plain'] || table) throw err;
      delete formats['text/plain'];
      lastText = null;
      await navigator.clipboard.write([new ClipboardItem(formats)]);
    }
  } catch {
    return `${what} for pasting here. This browser would not take the picture.`;
  }
  return table ? `${what} as a table and a picture.` : `${what}. Paste here for the drawing, or elsewhere for a picture.`;
}

/**
 * Copy a picture made of recorded shapes (a chart, say): on Windows as a metafile and a bitmap,
 * so Word and PowerPoint paste it sharp at any size; elsewhere as a PNG.
 */
export async function copyPictureItems(items: Item[], box: EmfBox, canvas: HTMLCanvasElement, dpi: number): Promise<string> {
  forgetCopy();
  if (nativeClipboard) {
    await invoke('clipboard_write', packFormats([['CF_ENHMETAFILE', itemsToEmf(items, box)], ['CF_DIB', canvasDib(canvas, dpi)]]));
    return 'Copied as a picture. Paste into Word, PowerPoint or a slide here.';
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasPng(canvas, '#ffffff') })]);
  } catch {
    return 'This browser would not take the picture. Use Save as Picture instead.';
  }
  return 'Copied as a picture.';
}

/**
 * Put an SVG picture on the clipboard as SVG, which Word, PowerPoint, Inkscape and Illustrator
 * paste as a picture they can scale (and ungroup into shapes). Not also as text: ChemDraw, which
 * reads no SVG, would paste the markup. Browsers that can't hand other programs SVG get the text.
 */
export async function copySvg(svg: string): Promise<string> {
  forgetCopy();
  const bytes = new TextEncoder().encode(svg);
  if (nativeClipboard) {
    await invoke('clipboard_write', packFormats([['image/svg+xml', bytes]]));
    return 'Copied as SVG.';
  }
  const formats: Record<string, Blob> = svgFormatOk() ? { 'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }) } : { 'text/plain': new Blob([svg], { type: 'text/plain' }) };
  try {
    await navigator.clipboard.write([new ClipboardItem(formats)]);
  } catch {
    try {
      await navigator.clipboard.writeText(svg);
    } catch {
      return 'This browser would not take the SVG. Use Save as Picture instead.';
    }
  }
  return formats['image/svg+xml'] ? 'Copied as SVG.' : 'Copied as SVG text. This browser can only hand other programs the text.';
}

/**
 * The selected things (everything when `sel` is null) as an SVG picture, or null when there is
 * nothing to show. A picture made as SVG here (a crystal structure, say) picked on its own goes
 * out as that SVG itself, so other programs get its shapes rather than a picture inside a picture.
 */
export function drawingSvg(doc: Doc, sel: Selection | null): string | null {
  const part = extractDrawing(doc, sel);
  if (isEmpty(part)) return null;
  const only = part.shapes.size === 1 && part.atoms.size + part.captions.size + part.arrows.size === 0 ? [...part.shapes.values()][0] : null;
  if (only?.kind === 'picture' && only.src && /^data:image\/svg\+xml/.test(only.src) && !only.rot && !only.crop) {
    try {
      const text = new TextDecoder().decode(fromDataUrl(only.src).bytes);
      const w = Math.abs(only.x2 - only.x1), h = Math.abs(only.y2 - only.y1);
      // (sized as placed, in points)
      return text.replace(/<svg\b([^>]*?)\swidth="[^"]*"([^>]*?)\sheight="[^"]*"/, `<svg$1 width="${+w.toFixed(2)}pt"$2 height="${+h.toFixed(2)}pt"`);
    } catch { /* drawn below instead */ }
  }
  const pic = recordPicture(part);
  return pic ? pictureSvg(pic) : null;
}

/**
 * Something other than a drawing was copied here (cells, a document's text, a picture): the last
 * drawing copied is forgotten, so a paste that finds nothing it can read doesn't bring it back.
 */
export function forgetCopy(): void {
  lastCopy = null;
  lastPart = null;
  lastText = null;
  lastTableText = null;
  lastPictureSize = null;
}

/** Copy a picture (any image a browser can show, as a URL) as a PNG; on Windows as a PNG and a bitmap. */
export async function copyImage(src: string): Promise<string> {
  forgetCopy();
  const canvas = new Promise<HTMLCanvasElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, img.naturalWidth);
      c.height = Math.max(1, img.naturalHeight);
      c.getContext('2d')!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error('this picture can\'t be shown'));
    img.src = src;
  });
  if (nativeClipboard) {
    const c = await canvas;
    const png = new Uint8Array(await (await canvasPng(c)).arrayBuffer());
    await invoke('clipboard_write', packFormats([['PNG', png], ['CF_DIB', canvasDib(c, 96)]]));
    return 'Copied the picture.';
  }
  try {
    // (the PNG goes in as a promise, so the clipboard is asked while the key press still counts)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvas.then(canvasPng) })]);
  } catch {
    return 'This browser would not take the picture.';
  }
  return 'Copied the picture.';
}

/** Is this the table last copied here (so the copy with its title and column widths can be pasted)? */
const ownTable = (text: string) => !!lastCopy && lastTableText !== null && text.replace(/\r\n/g, '\n').trim() === lastTableText.replace(/\r\n/g, '\n').trim();
/** Is this the SMILES put on the clipboard with the last drawing copied here (so the drawing itself is pasted)? */
const ownSmiles = (text: string) => !!lastCopy && !!lastText && text.trim() === lastText;

const hasPictures = (d: Doc) => [...d.shapes.values()].some((s) => s.kind === 'picture');

/** Whether this browser takes a format of the page's own on the clipboard. */
function svgFormatOk(): boolean {
  try {
    return typeof ClipboardItem !== 'undefined' && !!(ClipboardItem as unknown as { supports?: (t: string) => boolean }).supports?.('image/svg+xml');
  } catch {
    return false;
  }
}

function webFormatOk(): boolean {
  try {
    return typeof ClipboardItem !== 'undefined' && !!(ClipboardItem as unknown as { supports?: (t: string) => boolean }).supports?.(WEB_FORMAT);
  } catch {
    return false;
  }
}

/**
 * Is this pasted picture the one copied here last? Browsers hand back their own copy of a picture
 * (the same size, not the same bytes), so the size is what is compared.
 */
export function isOwnPicture(bytes: Uint8Array, mime: string): boolean {
  if (!lastCopy || !lastPictureSize) return false;
  const px = imageSize(bytes, mime);
  return !!px && px.w === lastPictureSize.w && px.h === lastPictureSize.h;
}

/** The drawing inside a picture copied from here (a metafile, as Word and PowerPoint copy it), or null. */
export function pictureDrawing(bytes: Uint8Array, mime: string): Doc | null {
  if (mime !== 'image/x-emf') return null;
  const cdxml = drawingInEmf(bytes);
  if (!cdxml) return null;
  try {
    return ownDrawing(cdxml);
  } catch {
    return null;
  }
}

/**
 * The drawing in a ChemDraw object (PowerPoint's or Word's copy of one, a compound file whose
 * CONTENTS stream is ChemDraw's CDX), or null when the object isn't ChemDraw's or can't be read.
 */
export function chemdrawObjectDrawing(object: Uint8Array): Doc | null {
  const data = chemdrawInObject(object);
  if (!data) return null;
  try {
    const text = isCdx(data) ? cdxToCdxml(data) : new TextDecoder().decode(data);
    if (!looksLikeCdxml(text)) return null;
    const doc = readCdxml(text).doc;
    return isEmpty(doc) ? null : doc;
  } catch {
    return null;
  }
}

/** A pasted picture: the drawing it came from, when it is a copy of one made here, else the picture. */
function picturePasted(bytes: Uint8Array, mime: string): Pasted {
  const inside = pictureDrawing(bytes, mime);
  if (inside) return { kind: 'drawing', doc: inside };
  if (isOwnPicture(bytes, mime)) return { kind: 'drawing', doc: ownDrawing(lastCopy!) };
  return { kind: 'picture', mime, bytes };
}

/** What a paste found on the clipboard. */
export type Pasted =
  | { kind: 'drawing'; doc: Doc }
  | { kind: 'text'; text: string; html?: string }
  | { kind: 'picture'; mime: string; bytes: Uint8Array }
  | { kind: 'table'; rows: PastedRows }
  | { kind: 'nothing' };

/**
 * One word made only of what a SMILES string is made of (OpenSMILES: the organic-subset atoms B C
 * N O P S F Cl Br I, aromatic b c n o p s, * , atoms in brackets, bonds, branches, ring closures
 * and dots), with an atom in it: "Yield", "picture.png" or a web address isn't one (review F553).
 */
function smilesShaped(t: string): boolean {
  const part = /Cl|Br|[BCNOPSFIbcnops*]|\[[^[\]]*\]|%\d\d|[\d\-=#$:/\\.~()@+]/y;
  let atom = false;
  part.lastIndex = 0;
  while (part.lastIndex < t.length) {
    const m = part.exec(t);
    if (!m) return false;
    if (/^(?:Cl|Br|[A-Za-z*]|\[)/.test(m[0])) atom = true;
  }
  return atom;
}

/** Text that could be a structure (a molfile, one word that could be SMILES, or a CXSMILES with its |…| extras). */
export function looksLikeChemistry(text: string): boolean {
  const t = text.trim();
  return t.includes('M  END') || isReactionSmiles(t) || !!cxSmiles(t) || (!!t && !/\s/.test(t) && smilesShaped(t));
}

/** A Windows bitmap from the clipboard (no file header) as a .bmp file a web page can show. */
export function dibToBmp(dib: Uint8Array): Uint8Array {
  const v = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const headerSize = v.getUint32(0, true);
  const bits = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  let colors = v.getUint32(32, true);
  if (!colors && bits <= 8) colors = 1 << bits;
  // three colour masks follow a plain header when the bits are packed by masks
  const masks = headerSize === 40 && compression === 3 ? 12 : 0;
  const out = new Uint8Array(14 + dib.length);
  const o = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d; // "BM"
  o.setUint32(2, out.length, true);
  o.setUint32(10, 14 + headerSize + masks + colors * 4, true);
  out.set(dib, 14);
  return out;
}

export function looksLikeCdxml(text: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?(<!DOCTYPE[^>]*>\s*)?<CDXML[\s>]/i.test(text);
}

/** Text from the clipboard (with its HTML, for its bold, italics and so on, when it came with some). */
function fromText(text: string, html?: string | null): Pasted {
  if (looksLikeCdxml(text)) return { kind: 'drawing', doc: ownDrawing(text) };
  return html ? { kind: 'text', text: text.trim(), html } : { kind: 'text', text: text.trim() };
}

/** The first of these formats on the Windows clipboard. */
export async function nativeFirst(names: string[]): Promise<[string, Uint8Array] | null> {
  const res = await invoke<ArrayBuffer>('clipboard_read', { names });
  return unpackFormats(new Uint8Array(res))[0] ?? null;
}

/**
 * Read the Windows clipboard through the desktop app: a drawing (ours or ChemDraw's, or a ChemDraw object copied in PowerPoint or Word) first,
 * then text that could be a structure, then a picture (PNG, SVG, a Windows metafile as
 * MestReNova and Office copy, or a bitmap), then any other text.
 */
export async function readNativeClipboard(): Promise<Pasted> {
  // our drawing whole first (a copy from another window or session loses nothing), then as CDXML
  // ("Embed Source" is a drawing from here copied back out of Word: the app reads only its own objects)
  const drawing = await nativeClipboardDrawing(['Embed Source']);
  if (drawing) return { kind: 'drawing', doc: drawing };
  // a ChemDraw object copied in PowerPoint or Word: no ChemDraw data of its own on the clipboard,
  // but the object (a compound file) holds ChemDraw's drawing; its picture is only the fallback
  const object = await nativeFirst(['Embedded Object']).catch(() => null);
  const fromObject = object ? chemdrawObjectDrawing(object[1]) : null;
  if (fromObject) return { kind: 'drawing', doc: fromObject };
  // a picture of a drawing copied from here, copied back out of Word or PowerPoint: the drawing rides inside it
  const emf = await nativeFirst(['CF_ENHMETAFILE']);
  const inside = emf ? pictureDrawing(emf[1], 'image/x-emf') : null;
  if (inside) return { kind: 'drawing', doc: inside };
  const t = await nativeFirst(['CF_UNICODETEXT']);
  const text = t ? new TextDecoder().decode(t[1]).replace(/\0+$/, '') : '';
  // a table copied here, then cells from Excel, Word or a sheet here, before a word that could be
  // SMILES: a one-cell table's word is the table's (review F553); Excel also puts a picture of them on the clipboard
  if (ownTable(text)) return { kind: 'drawing', doc: ownDrawing(lastCopy!) };
  const html = await nativeFirst(['HTML Format']);
  const table = pastedTable(html ? fromCfHtml(html[1]) : null, text);
  if (table) return { kind: 'table', rows: table };
  if (looksLikeChemistry(text)) return fromText(text);
  // a metafile with lines and text (a spectrum or chart from MestReNova or Excel) stays sharp, so it
  // beats a PNG of the same thing; a metafile that only wraps a photo, or can't be shown, does not
  if (emf && (emfToSvg(emf[1])?.vectors ?? 0) > 0) return { kind: 'picture', mime: 'image/x-emf', bytes: emf[1] };
  const pic = await nativeFirst(['PNG', 'image/svg+xml', 'CF_ENHMETAFILE', 'CF_DIB']);
  if (pic) {
    const [name, data] = pic;
    if (name === 'PNG') return { kind: 'picture', mime: 'image/png', bytes: data };
    if (name === 'image/svg+xml') return { kind: 'picture', mime: 'image/svg+xml', bytes: data };
    if (name === 'CF_ENHMETAFILE') return { kind: 'picture', mime: 'image/x-emf', bytes: data };
    return { kind: 'picture', mime: 'image/bmp', bytes: dibToBmp(data) };
  }
  return text.trim() ? fromText(text, html ? fromCfHtml(html[1]) : null) : { kind: 'nothing' };
}

/**
 * Whether a paste event's text is only a drawing's structure as SMILES, put on the clipboard
 * beside the drawing itself: the SMILES of the last drawing copied here, or a one-word SMILES
 * (or molfile) with a picture and no formatted text, as ChemDraw copies (a text box then takes
 * the drawing, not the text).
 */
export function pasteHoldsDrawing(e: ClipboardEvent): boolean {
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (!text.trim()) return false;
  if (ownSmiles(text)) return true;
  const html = e.clipboardData?.getData('text/html') ?? '';
  const picture = [...(e.clipboardData?.files ?? [])].some((f) => f.type.startsWith('image/')) || [...(e.clipboardData?.types ?? [])].includes('Files');
  return !html.trim() && picture && looksLikeChemistry(text);
}

/**
 * What a browser paste event holds: a drawing or structure text, else a picture, else other
 * text, else the last drawing copied here.
 */
export async function readPasteEvent(e: ClipboardEvent): Promise<Pasted> {
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (ownSmiles(text)) return { kind: 'drawing', doc: ownDrawing(lastCopy!) };
  // (a table copied here first: one cell's word would otherwise pass for a structure; review F553)
  if (ownTable(text)) return { kind: 'drawing', doc: ownDrawing(lastCopy!) };
  if (looksLikeCdxml(text)) return fromText(text);
  const table = pastedTable(e.clipboardData?.getData('text/html'), text);
  if (table) return { kind: 'table', rows: table };
  if (looksLikeChemistry(text)) return fromText(text);
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (file) return picturePasted(new Uint8Array(await file.arrayBuffer()), file.type);
  if (text.trim()) return fromText(text, e.clipboardData?.getData('text/html'));
  return lastCopy ? { kind: 'drawing', doc: ownDrawing(lastCopy) } : { kind: 'nothing' };
}

/** For the Paste menu item in a browser, which gets no paste event. */
export async function readWebClipboard(): Promise<Pasted> {
  const text = await navigator.clipboard.readText().catch(() => '');
  if (ownSmiles(text)) return { kind: 'drawing', doc: ownDrawing(lastCopy!) };
  // (a table copied here first: one cell's word would otherwise pass for a structure; review F553)
  if (ownTable(text)) return { kind: 'drawing', doc: ownDrawing(lastCopy!) };
  if (looksLikeCdxml(text) || looksLikeChemistry(text)) return fromText(text);
  // a picture (when the browser lets the page see it)
  const items = await navigator.clipboard.read?.().catch(() => []) ?? [];
  // our drawing, where the browser kept a format of our own: whole first, then as CDXML
  const whole = items.find((it) => it.types.includes(WEB_NATIVE_FORMAT));
  const wholeText = whole ? await (await whole.getType(WEB_NATIVE_FORMAT)).text().catch(() => '') : '';
  const fromWhole = wholeText ? nativeDrawing(wholeText) : null;
  const own = items.find((it) => it.types.includes(WEB_FORMAT));
  const ownText = own ? await (await own.getType(WEB_FORMAT)).text().catch(() => '') : '';
  if (fromWhole) {
    if (looksLikeCdxml(ownText)) setPasteFallback(fromWhole, async () => readCdxml(ownText).doc);
    return { kind: 'drawing', doc: fromWhole };
  }
  if (looksLikeCdxml(ownText)) return fromText(ownText);
  const htmlItem = items.find((it) => it.types.includes('text/html'));
  const html = htmlItem ? await (await htmlItem.getType('text/html')).text() : null;
  const table = pastedTable(html, text);
  if (table) return { kind: 'table', rows: table };
  for (const it of items) {
    const type = it.types.find((t) => t.startsWith('image/'));
    if (type) return picturePasted(new Uint8Array(await (await it.getType(type)).arrayBuffer()), type);
  }
  if (text.trim()) return fromText(text, html);
  return lastCopy ? { kind: 'drawing', doc: ownDrawing(lastCopy) } : { kind: 'nothing' };
}

/** The clipboard's plain text, ignoring any drawing on it (Paste SMILES). */
export async function readClipboardText(): Promise<string> {
  if (nativeClipboard) {
    const res = await invoke<ArrayBuffer>('clipboard_read', { names: ['CF_UNICODETEXT'] });
    const [item] = unpackFormats(new Uint8Array(res));
    return item ? new TextDecoder().decode(item[1]).replace(/\0+$/, '') : '';
  }
  return navigator.clipboard.readText();
}

/** Names of the formats on the Windows clipboard (to see what another program copied). */
export async function clipboardFormats(): Promise<string[]> {
  return nativeClipboard ? invoke<string[]>('clipboard_formats') : [];
}

/** Put these formats on the Windows clipboard (most detailed first). */
export async function writeNativeFormats(items: [string, Uint8Array][]): Promise<void> {
  await invoke('clipboard_write', packFormats(items));
}

/** Our own copy of sheet cells on the clipboard. */
export const CELLS_FORMAT = 'Chem Illustrator Cells';

/**
 * HTML for the Windows clipboard ("HTML Format"): a header giving where the page and the copied
 * part start and end, counted in bytes of UTF-8, as Word and Excel read it.
 */
export function cfHtml(fragment: string): Uint8Array {
  const enc = new TextEncoder();
  const pre = '<html><head><meta charset="utf-8"></head><body><!--StartFragment-->';
  const post = '<!--EndFragment--></body></html>';
  const head = (a: number, b: number, c: number, d: number) =>
    `Version:0.9\r\nStartHTML:${pad(a)}\r\nEndHTML:${pad(b)}\r\nStartFragment:${pad(c)}\r\nEndFragment:${pad(d)}\r\n`;
  const pad = (n: number) => String(n).padStart(10, '0');
  const h = head(0, 0, 0, 0).length;
  const startFrag = h + enc.encode(pre).length;
  const endFrag = startFrag + enc.encode(fragment).length;
  const end = endFrag + enc.encode(post).length;
  return enc.encode(head(h, end, startFrag, endFrag) + pre + fragment + post);
}

/** The HTML inside "HTML Format" clipboard data. */
export function fromCfHtml(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  const m = /StartHTML:(\d+)/.exec(text);
  const start = m ? Number(m[1]) : -1;
  if (start > 0) return new TextDecoder().decode(bytes.subarray(start));
  return text.slice(text.indexOf('<'));
}
