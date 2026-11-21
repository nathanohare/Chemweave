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
export function applyLook(doc: Doc, look: PictureLook, ds: DocStyle): void {
  const k = look.bondLength / ds.bondLength;
  const lw = look.lineWidth ?? ds.lineWidth * k;
  const s = r2(lw / ds.lineWidth);
  const atomS = r2((look.labelSize ?? ds.labelSize * k) / ds.labelSize);
  for (const b of doc.bonds.values()) {
    doc.updateBond(b.id, { s, boldWidth: r2(ds.boldWidth * k), hashSpacing: r2(ds.hashSpacing * k), marginWidth: r2(ds.marginWidth * k), bondLength: r2(look.bondLength) });
  }
  for (const a of doc.atoms.values()) doc.updateAtom(a.id, { s: atomS });
}

/** Points per pixel of `p` as the picture is shown (`shownW` points wide). */
export const pointsPerPixel = (p: Pixels, shownW: number): number => shownW / p.width;

/**
 * What the reader read (atoms and their places), made a structure in the style chosen. `p` is the
 * picture as read, shown `ptPerPx` points to the pixel; `ds` the document's drawing style.
 */
export function editableFromGraph(g: ReadGraph, p: Pixels, frame: ReadFrame, ptPerPx: number, choice: StyleChoice, ds: DocStyle, presets: StylePreset[]): Editable {
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
  const look = snapLook(measured, presets);
  // the drawing's points: the picture's, or made the document's bond length
  const k = choice === 'match' ? ptPerPx : ds.bondLength / bondPx;
  const doc = new Doc();
  doc.style = { ...ds };
  let problems: string[] = [];
  doc.edit('Make Editable', () => {
    problems = addReadAt(doc, g, px.map(([x, y]) => [x * k, y * k])).problems;
    if (choice === 'match') applyLook(doc, look, ds);
  });
  return { contents: doc.contents(), at: { x: 0, y: 0, w: p.width * k, h: p.height * k }, look, problems };
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
