// Make Editable (Document mode): a picture of a structure turned into a structure, either drawn
// to look like the picture (Match Original Style: its bond length, line width and label size,
// measured from the picture, kept on the structure as ChemDraw keeps a structure's own settings)
// or in the document's drawing style (Use Default Style). The structure lies where the picture
// did, atom for atom, so the original can be shown over it to compare.

import { Doc, type Contents } from '../model';
import type { DocStyle } from '../style';
import type { StylePreset } from '../drawing-styles';
import { addMolfile } from '../chem/molfile';
import type { ReadGraph } from './molscribe';
import { inkBox, type Pixels } from './picture';
import { addReadAt, parseSymbol, readBonds } from './to-drawing';
import { leftover, leftoverPng, partPixels, type StructureInk } from './leftover';
import { withoutFrames } from './frames';
import { captionsFrom, findArrows, marksOf, rubOut, textRuns, type FoundText, type Mark, type ReadLine } from './scheme-extras';
import { bondLengthPx, labelSizePx, lineWidthPx, refineAtoms, strokeWidthPx, type MeasureBond } from './measure';

export type StyleChoice = 'match' | 'default';

/** How the picture was drawn, in points as it is shown on the page. */
export interface PictureLook {
  bondLength: number;
  /** Null when no plain line could be measured (the document's, scaled to the bond length, is used). */
  lineWidth: number | null;
  /** Font size of the labels; null when there are none to measure. */
  labelSize: number | null;
  /** A journal style it was drawn in (its name), when the measurements are that style's at some size. */
  preset?: string;
}

/** The pixels the reader read and how they sit in the picture: the reader's 0 to 1 is across `w` × `h` pixels from (x, y). */
export interface ReadFrame { x: number; y: number; w: number; h: number }

/** Where the reader's crop of `p` lies (cropWhite with 5 pixels of margin). */
export function readFrame(p: Pixels, pad = 5): ReadFrame {
  const b = inkBox(p);
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}

/**
 * How far the measurements may be from a journal style's (as a share) and still be taken as drawn
 * in it: line widths of a pixel or so measure up to about 12% off, label sizes about 5%.
 */
const SNAP_LINE = 0.15, SNAP_LABEL = 0.08;

/**
 * A journal style the picture looks drawn in, at some size: the one whose line width and label
 * size, for the bond length measured, are both close to those measured (SNAP_LINE, SNAP_LABEL). Its numbers, made
 * that size, replace the measured ones (which carry a pixel's error).
 */
export function snapLook(look: PictureLook, presets: StylePreset[]): PictureLook {
  let best: { dev: number; s: DocStyle } | null = null;
  for (const { style: s } of presets) {
    const k = look.bondLength / s.bondLength;
    const devs: number[] = [];
    if (look.lineWidth !== null) devs.push(Math.abs(look.lineWidth / (s.lineWidth * k) - 1) / SNAP_LINE);
    if (look.labelSize !== null) devs.push(Math.abs(look.labelSize / (s.labelSize * k) - 1) / SNAP_LABEL);
    if (!devs.length) continue;
    const dev = Math.max(...devs);
    if (dev <= 1 && (!best || dev < best.dev)) best = { dev, s };
  }
  if (!best) return look;
  const k = look.bondLength / best.s.bondLength;
  return { bondLength: look.bondLength, lineWidth: best.s.lineWidth * k, labelSize: look.labelSize === null ? null : best.s.labelSize * k, preset: best.s.name };
}

export interface Editable {
  contents: Contents;
  /** Where the whole picture lies in the drawing's points (to show the original over the structure). */
  at: { x: number; y: number; w: number; h: number };
  look: PictureLook;
  problems: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The structure's own settings for the look measured, over the document's style `ds` (as ChemDraw
 * keeps them on each bond and atom of a structure drawn at other settings).
 */
export function applyLook(doc: Doc, look: PictureLook, ds: DocStyle, only?: Set<number>): void {
  const k = look.bondLength / ds.bondLength;
  const lw = look.lineWidth ?? ds.lineWidth * k;
  const s = r2(lw / ds.lineWidth);
  const atomS = r2((look.labelSize ?? ds.labelSize * k) / ds.labelSize);
  for (const b of doc.bonds.values()) {
    if (only && !only.has(b.a1)) continue;
    doc.updateBond(b.id, { s, boldWidth: r2(ds.boldWidth * k), hashSpacing: r2(ds.hashSpacing * k), marginWidth: r2(ds.marginWidth * k), bondLength: r2(look.bondLength) });
  }
  for (const a of doc.atoms.values()) if (!only || only.has(a.id)) doc.updateAtom(a.id, { s: atomS });
}

/** Points per pixel of `p` as the picture is shown (`shownW` points wide). */
export const pointsPerPixel = (p: Pixels, shownW: number): number => shownW / p.width;

/**
 * What the reader read (atoms and their places), made a structure in the style chosen. `p` is the
 * picture as read, shown `ptPerPx` points to the pixel; `ds` the document's drawing style.
 */
export function editableFromGraph(g: ReadGraph, p: Pixels, frame: ReadFrame, ptPerPx: number, choice: StyleChoice, ds: DocStyle, presets: StylePreset[]): Editable {
  const m = measureGraph(g, p, frame, ptPerPx, presets);
  // the drawing's points: the picture's, or made the document's bond length
  const k = choice === 'match' ? ptPerPx : ds.bondLength / m.bondPx;
  const doc = new Doc();
  doc.style = { ...ds };
  let problems: string[] = [];
  doc.edit('Make Editable', () => {
    problems = addReadAt(doc, g, m.px.map(([x, y]) => [x * k, y * k])).problems;
    if (choice === 'match') applyLook(doc, m.look, ds);
  });
  return { contents: doc.contents(), at: { x: 0, y: 0, w: p.width * k, h: p.height * k }, look: m.look, problems };
}

/** A reading measured in its picture: the atoms moved onto their lines, and how it was drawn. */
interface Measured { px: [number, number][]; bonds: MeasureBond[]; labelled: boolean[]; bondPx: number; lwPx: number | null; look: PictureLook }

function measureGraph(g: ReadGraph, p: Pixels, frame: ReadFrame, ptPerPx: number, presets: StylePreset[]): Measured {
  const bonds: MeasureBond[] = readBonds(g).map(({ a, b, order, display }) => ({ a, b, order, display }));
  const labelled = g.symbols.map((sym) => { const a = parseSymbol(sym); return a.z === undefined || a.z !== 6 || a.charge !== 0 || !!a.isotope; });
  const rough = g.coords.map(([x, y]) => [frame.x + x * frame.w, frame.y + y * frame.h] as [number, number]);
  // the reader's grid is 64 steps across: an atom may be up to half a step off
  const reach = Math.max(1.5, Math.max(frame.w, frame.h) / 64);
  const px = refineAtoms(p, rough, bonds, labelled, reach);
  const bondPx = bondLengthPx(px, bonds) ?? Math.max(frame.w, frame.h) / 6;
  const lwPx = lineWidthPx(p, px, bonds);
  const labPx = labelSizePx(p, px, labelled, bondPx);
  const measured: PictureLook = { bondLength: bondPx * ptPerPx, lineWidth: lwPx === null ? null : lwPx * ptPerPx, labelSize: labPx === null ? null : labPx * ptPerPx };
  return { px, bonds, labelled, bondPx, lwPx, look: snapLook(measured, presets) };
}

/**
 * An AI model's reading (a molfile, laid out afresh, with no places in the picture), made a
 * structure: for Match Original Style, sized so it covers the picture's ink, with the line width
 * measured from the strokes; the original is put over it by their middles.
 */
export function editableFromMolfile(molblock: string, p: Pixels, ptPerPx: number, choice: StyleChoice, ds: DocStyle, presets: StylePreset[]): Editable {
  const doc = new Doc();
  doc.style = { ...ds };
  doc.edit('Make Editable', () => { addMolfile(doc, molblock, 0, 0); });
  const atoms = [...doc.atoms.values()];
  const xs = atoms.map((a) => a.x), ys = atoms.map((a) => a.y);
  const bw = atoms.length ? Math.max(...xs) - Math.min(...xs) : 0, bh = atoms.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const ink = inkBox(p);
  // the ink is the atoms' spread plus about a label on each side
  const fit = bw >= bh ? (ink.w * ptPerPx - ds.labelSize) / bw : (ink.h * ptPerPx - ds.labelSize) / bh;
  const scale = Number.isFinite(fit) && fit > 0 ? fit : 1;
  const lw = strokeWidthPx(p);
  const measured: PictureLook = { bondLength: ds.bondLength * scale, lineWidth: lw === null ? null : lw * ptPerPx, labelSize: null };
  const look = snapLook(measured, presets);
  const kk = choice === 'match' ? scale : 1;
  doc.edit('Make Editable', () => {
    for (const a of atoms) doc.updateAtom(a.id, { x: a.x * kk, y: a.y * kk });
    if (choice === 'match') applyLook(doc, look, ds);
  });
  // the picture over the structure, middle on middle, at the size that makes the ink cover the atoms
  const cx = atoms.length ? ((Math.min(...xs) + Math.max(...xs)) / 2) * kk : 0, cy = atoms.length ? ((Math.min(...ys) + Math.max(...ys)) / 2) * kk : 0;
  const pk = choice === 'match' ? ptPerPx : ptPerPx / scale;
  const at = { x: cx - (ink.x + ink.w / 2) * pk, y: cy - (ink.y + ink.h / 2) * pk, w: p.width * pk, h: p.height * pk };
  return { contents: doc.contents(), at, look, problems: [] };
}

/**
 * What the reader read in one part of the picture: `box` (the picture's pixels, with PART_PAD of
 * margin) where the part is, or none for the whole picture; then its atoms on the reader's grid
 * (`frame`, in the part's pixels), or an AI model's molfile.
 */
export type PartRead = { box?: ReadFrame } & ({ graph: ReadGraph; frame: ReadFrame } | { molblock: string });

export interface EditableParts extends Editable {
  /** What wasn't read (arrows, conditions, compound numbers), in the picture's pixels; null when nothing is left. */
  rest: Pixels | null;
}

/**
 * Each structure read in a picture (one read whole, or each drawing of a scheme read on its own),
 * made one drawing in the style chosen, every structure where it was in the picture; for Use
 * Default Style all are made the same size, the document's bond length for their middle one. What
 * the reader didn't read is kept as a picture behind them, in its place (`rest`, and a picture in
 * the drawing).
 */
/** How far a point is from a segment. */
function segDistance(x: number, y: number, [ax, ay]: [number, number], [bx, by]: [number, number]): number {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** Whether a caption's text is beside lines (not letters) left in the picture: within half a letter of a mark much longer than one. */
function touchesLines(c: FoundText, marks: Mark[]): boolean {
  const own = new Set(c.marks);
  const x1 = Math.min(...c.marks.map((m) => m.x1)), x2 = Math.max(...c.marks.map((m) => m.x2));
  const y1 = Math.min(...c.marks.map((m) => m.y1)), y2 = Math.max(...c.marks.map((m) => m.y2));
  const h = Math.max(4, y2 - y1 + 1) / Math.max(1, c.lines.length), pad = 0.5 * h;
  return marks.some((m) => !own.has(m) && Math.max(m.x2 - m.x1, m.y2 - m.y1) > 1.6 * h
    && m.x1 <= x2 + pad && m.x2 >= x1 - pad && m.y1 <= y2 + pad && m.y2 >= y1 - pad);
}

export function editableFromParts(parts: PartRead[], picture: Pixels, ptPerPx: number, choice: StyleChoice, ds: DocStyle, presets: StylePreset[], texts?: ReadLine[]): EditableParts {
  // the boxes round structures: taken out before anything else (the parts were read without them)
  const { p, frames } = withoutFrames(picture);
  const pieces = parts.map((part) => {
    const box = part.box ?? { x: 0, y: 0, w: p.width, h: p.height };
    const sub = part.box ? partPixels(p, part.box) : p;
    if ('graph' in part) return { box, graph: part.graph, m: measureGraph(part.graph, sub, part.frame, ptPerPx, presets) };
    return { box, e: editableFromMolfile(part.molblock, sub, ptPerPx, choice, ds, presets) };
  });
  const sizes = pieces.map((pc) => ('m' in pc ? pc.m!.bondPx : pc.e!.look.bondLength / ptPerPx)).sort((a, b) => a - b);
  const K = choice === 'match' || !sizes.length ? ptPerPx : ds.bondLength / sizes[Math.floor((sizes.length - 1) / 2)];
  const doc = new Doc();
  doc.style = { ...ds };
  const problems: string[] = [];
  const inks: StructureInk[] = [], whole: ReadFrame[] = [];
  let look: PictureLook | null = null, most = -1;
  let rest: Pixels | null = null;
  doc.edit('Make Editable', () => {
    for (const f of frames) {
      doc.addShape({
        kind: 'rect', x1: r2(f.x1 * K), y1: r2(f.y1 * K), x2: r2(f.x2 * K), y2: r2(f.y2 * K),
        ...(choice === 'match' ? { lineWidth: r2(f.lineWidth * K) } : {}),
        ...(f.radius ? { rounded: true, ...(choice === 'match' ? { radius: r2(f.radius * K) } : {}) } : {}),
        ...(f.shadow ? { shadow: true } : {}),
      });
    }
    for (const pc of pieces) {
      const { box } = pc;
      if ('m' in pc) {
        const m = pc.m!;
        const placed = addReadAt(doc, pc.graph!, m.px.map(([x, y]) => [(x + box.x) * K, (y + box.y) * K]));
        problems.push(...placed.problems);
        if (choice === 'match') applyLook(doc, m.look, ds, new Set(placed.ids));
        inks.push({ atoms: m.px.map(([x, y]) => [x + box.x, y + box.y]), bonds: m.bonds, labelled: m.labelled, bondPx: m.bondPx, lineWidthPx: m.lwPx });
        if (m.px.length > most) { most = m.px.length; look = m.look; }
      } else {
        // an AI model's structure has no places in the picture: its middle goes on the part's
        const e = pc.e!;
        const dx = (box.x + box.w / 2) * K - (e.at.x + e.at.w / 2), dy = (box.y + box.h / 2) * K - (e.at.y + e.at.h / 2);
        const ids = new Map<number, number>();
        for (const a of e.contents.atoms) { const { id, x, y, z, ...more } = a; ids.set(id, doc.addAtom(x + dx, y + dy, z, more).id); }
        for (const b of e.contents.bonds) { const { id: _id, a1, a2, order, display, ...more } = b; doc.addBond(ids.get(a1)!, ids.get(a2)!, order, display, more); }
        problems.push(...e.problems);
        whole.push(box);
        if (e.contents.atoms.length > most) { most = e.contents.atoms.length; look = e.look; }
      }
    }
    rest = leftover(p, inks, whole);
    // the whole scheme made editable: its arrows, then the text read
    if (rest && texts) {
      const unit = inks.length ? [...inks.map((k) => k.bondPx)].sort((a, b) => a - b)[Math.floor((inks.length - 1) / 2)] : Math.max(p.width, p.height) / 12;
      const at = (v: { x: number; y: number }) => ({ x: v.x * K, y: v.y * K });
      const match = choice === 'match';
      const lw = ds.arrowWidth ?? ds.lineWidth;
      // (a line with no head is taken only when long: a short one is a bond left of a structure not read)
      const arrows = findArrows(rest, Math.max(12, unit * 0.9)).filter((a) => a.headStyle !== 'none' || a.tailStyle !== 'none' || Math.hypot(a.head.x - a.tail.x, a.head.y - a.tail.y) > 3 * unit);
      for (const a of arrows) {
        doc.addArrow({
          tail: at(a.tail), head: at(a.head), headStyle: a.headStyle, tailStyle: a.tailStyle, headType: a.headType, line: 'solid', noGo: false, equilibrium: a.equilibrium, sweep: 0,
          headLength: match ? r2(a.headLength * K) : ds.arrowHeadLength ?? lw * 10,
          headWidth: match ? r2(Math.max(a.headWidth, a.lineWidth) * K) : ds.arrowHeadWidth ?? lw * 2.5,
          ...(match ? { lineWidth: r2(a.lineWidth * K) } : ds.arrowWidth ? { lineWidth: ds.arrowWidth } : {}),
        });
      }
      rest = rubOut(rest, arrows.flatMap((a) => a.marks));
      const restMarks = marksOf(rest);
      // text that touches lines left in the picture (the labels of a structure not read) stays with them
      const atomsPx = inks.flatMap((k) => k.atoms);
      const caps = captionsFrom(texts, rest, restMarks).filter((c) => {
        if (!c.marks.length || touchesLines(c, restMarks)) return false;
        const text = c.lines.join(' ');
        // on a bond read (what is left of a hashed bond reads as 1s and Is)
        const mx = (Math.min(...c.marks.map((m) => m.x1)) + Math.max(...c.marks.map((m) => m.x2))) / 2, my = (Math.min(...c.marks.map((m) => m.y1)) + Math.max(...c.marks.map((m) => m.y2))) / 2;
        if (text.length <= 2 && inks.some((k) => k.bonds.some((b) => segDistance(mx, my, k.atoms[b.a], k.atoms[b.b]) < 0.3 * unit))) return false;
        // one letter or sign alone (an atom's label, a stray mark): not a caption; a compound number is
        if (text.length === 1 && !/[1-9]/.test(text)) return false;
        // a short label by a structure read (H, Boc, NH2 the reader missed): it stays with the picture
        const x1 = Math.min(...c.marks.map((m) => m.x1)), x2 = Math.max(...c.marks.map((m) => m.x2)), y1 = Math.min(...c.marks.map((m) => m.y1)), y2 = Math.max(...c.marks.map((m) => m.y2));
        const near = atomsPx.some(([x, y]) => x > x1 - 0.9 * unit && x < x2 + 0.9 * unit && y > y1 - 0.9 * unit && y < y2 + 0.9 * unit);
        return !(near && /^[A-Za-z0-9*+~-]{1,4}$/.test(text) && !/^\d+[a-z]?$/.test(text));
      });
      const labelPt = look?.labelSize ?? null;
      for (const c of caps) {
        // the size it was written at: the structures' label size, or the document's text size for the look, when it is about that
        let size = c.size * K;
        const near = [labelPt, ds.captionSize * ((look?.bondLength ?? ds.bondLength) / ds.bondLength)].find((v) => v && Math.abs(size / v - 1) < 0.12);
        size = near ?? Math.round(size * 2) / 2;
        const runs = textRuns(c.lines.join('\n')).map((r) => ({ ...r, ...(match ? { size: r2(size) } : {}), ...(c.bold ? { bold: true } : {}) }));
        doc.addCaption({ x: c.x * K, y: c.y * K, runs, justify: c.center ? 'center' : 'left' });
      }
      rest = rubOut(rest, caps.flatMap((c) => c.marks));
      if (!marksOf(rest, Math.max(8, (0.12 * unit) ** 2)).length) rest = null;
    }
    if (rest) doc.addShape({ kind: 'picture', x1: 0, y1: 0, x2: p.width * K, y2: p.height * K, src: leftoverPng(rest), px: { w: p.width, h: p.height }, alt: 'The rest of the original picture (arrows and text)' });
  });
  return { contents: doc.contents(), at: { x: 0, y: 0, w: p.width * K, h: p.height * K }, look: look ?? { bondLength: ds.bondLength, lineWidth: null, labelSize: null }, problems, rest };
}
