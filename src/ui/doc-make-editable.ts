// Make Editable (Document mode): a picked picture of a structure (pasted from ChemDraw as a
// picture, or from a paper) read and turned into a structure in its place, drawn to match the
// picture or in the document's style. The picture is kept with the structure (FromPicture), to
// compare with, to change style without reading again, and to go back to. A picture of a scheme
// has each structure read on its own, and its arrows and text made editable too (what can't be
// read stays as a picture behind them).

import type { DocObject, FromPicture, FromPictureRead } from '../document/document';
import type { Contents } from '../model';
import type { DocStyle } from '../style';
import { STYLE_PRESETS } from '../drawing-styles';
import type { ReadResult } from '../recognise/reader';
import type { Pixels } from '../recognise/picture';
import { editableFromParts, readFrame, type Editable, type PartRead, type PictureLook, type StyleChoice } from '../recognise/editable';
import { strokeWidthPx } from '../recognise/measure';
import { partPixels, schemeParts } from '../recognise/leftover';
import { withoutFrames } from '../recognise/frames';
import { findArrows, rubOut, type ReadLine } from '../recognise/scheme-extras';
import { fromDataUrl, showableSrc } from '../render/images';
import { decodePicture } from './import-structures';

type Picture = Extract<DocObject, { kind: 'picture' }>;
type Drawing = Extract<DocObject, { kind: 'drawing' }>;

export interface MakeEditableHost {
  /** Read a picture (the reader here or the AI model); null when it couldn't be. */
  read(p: Pixels): Promise<{ result: ReadResult; molblock: string | null } | null>;
  /** Read a picture only to measure it: the reader on this computer when it is set up, with no questions or messages (null otherwise). */
  readQuietly?(p: Pixels): Promise<{ result: ReadResult; molblock: string | null } | null>;
  /** Read the text in a picture (the rest of a scheme); missing where it can't be. */
  readText?(p: Pixels): Promise<ReadLine[]>;
  /** Why to look closely at what was read (the chemistry engine's checks); empty when nothing looks wrong. */
  check(r: ReadResult): Promise<string[]>;
  flash(msg: string, ms?: number): void;
}

/** Whether a picture can be made editable: a plain picture (not a chart or another program's object). */
export function canMakeEditable(o: DocObject | undefined): o is Picture {
  return o?.kind === 'picture' && !o.chart && !o.embed;
}

/** The picture's pixels as shown (its cropping taken off), and how many points each pixel is on the page. */
export async function pictureForReading(o: Picture): Promise<{ p: Pixels; ptPerPx: number } | null> {
  let got: { mime: string; bytes: Uint8Array };
  try { got = fromDataUrl(o.src); } catch { return null; }
  // the reader works on up to 2000 pixels: more is only slower. A drawing (a metafile, as ChemDraw
  // pastes into Word, or SVG) is drawn at 300 dpi for it
  let p = /^image\/(svg|x-emf)/.test(got.mime) ? await vectorPixels(o, 2000) : await decodePicture(got.bytes, got.mime, 2000);
  if (!p) return null;
  const c = o.crop;
  if (c && (c.l || c.t || c.r || c.b)) {
    // the frame the picture is shown in, edge by edge, as pixels of it: what lies outside the picture (a
    // cropping that reaches outward, as Word allows) is white, as it is on the page
    const W = p.width, H = p.height;
    const x0 = Math.round(c.l * W), x1 = Math.round((1 - c.r) * W), y0 = Math.round(c.t * H), y1 = Math.round((1 - c.b) * H);
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    if (w * h > 25e6) return null;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const from = Math.max(x0, 0), to = Math.min(x0 + w, W);
    if (to > from) {
      for (let row = 0; row < h; row++) {
        const sy = y0 + row;
        if (sy >= 0 && sy < H) data.set(p.data.subarray((sy * W + from) * 4, (sy * W + to) * 4), (row * w + (from - x0)) * 4);
      }
    }
    p = { width: w, height: h, data };
  }
  return { p, ptPerPx: (o.w * (o.scale ?? 1)) / p.width };
}

/** A drawn picture (SVG, or EMF shown as SVG) as pixels, at 300 dpi of its size on the page, the longer side at most `most`. */
async function vectorPixels(o: Picture, most: number): Promise<Pixels | null> {
  const src = showableSrc(o.src);
  if (!src) return null;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    // o.w × o.h is the part left after cropping; the whole image (that is drawn here, then cropped) is larger by what was cut off
    const cr = o.crop;
    // (with no size, the image's own is already the whole image)
    const w0 = o.w ? o.w / Math.max(0.01, 1 - (cr?.l ?? 0) - (cr?.r ?? 0)) : img.naturalWidth * 0.75;
    const h0 = o.h ? o.h / Math.max(0.01, 1 - (cr?.t ?? 0) - (cr?.b ?? 0)) : img.naturalHeight * 0.75;
    const k = Math.min(300 / 72, most / Math.max(1, w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k));
    c.height = Math.max(1, Math.round(h0 * k));
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height);
    return { width: d.width, height: d.height, data: d.data };
  } catch {
    return null;
  }
}

/** The readings kept, as the structure maker takes them. */
function partReads(parts: FromPictureRead[]): PartRead[] {
  return parts.map((r) => ('molblock' in r ? r : { ...r, graph: { smiles: '', ...r.graph, atomScores: r.graph.symbols.map(() => 1) } }));
}

/** The structures for the readings, in the style chosen (with what wasn't read behind them). */
export function editableOf(parts: FromPictureRead[], p: Pixels, ptPerPx: number, choice: StyleChoice, ds: DocStyle, texts?: ReadLine[]): Editable {
  return editableFromParts(partReads(parts), p, ptPerPx, choice, ds, STYLE_PRESETS, texts);
}

/** The structure in the picture's place: where it floats, its frame and shadow, its alt text, and the picture kept. */
export function drawingFor(pic: Picture, e: Editable, choice: StyleChoice, parts: FromPictureRead[], px: { w: number; h: number }, texts?: ReadLine[]): Drawing {
  return {
    kind: 'drawing', contents: e.contents,
    ...(pic.float ? { float: structuredClone(pic.float) } : {}),
    ...(pic.look ? { look: structuredClone(pic.look) } : {}),
    ...(pic.alt ? { alt: pic.alt } : {}),
    ...(pic.wordPr ? { wordPr: { ...pic.wordPr } } : {}),
    fromPicture: { picture: pic, at: e.at, style: choice, look: e.look, parts, px, ...(texts ? { texts } : {}) },
  };
}

export interface Made { drawing: Drawing; problems: string[] }

/**
 * How far apart two strokes may be and still be one drawing, in the picture's pixels: about 5
 * points as it is shown (as for a PDF page), the space a scheme leaves between a structure and its arrow.
 */
export const partGap = (ptPerPx: number): number => Math.max(2, Math.min(60, Math.round(5 / ptPerPx)));

/**
 * Whether a drawing of a scheme read as a structure: conditions read come out as atoms with no
 * bonds (THF, LiOH as [THF].[LiOH]), a word as two or three atoms, and a reading the reader is
 * far from sure of isn't taken.
 * What isn't is left in the picture behind.
 */
export function isStructure(g: { symbols: string[]; edges: number[][]; confidence: number }, whole = false): boolean {
  // a word read as a structure comes out as two or three atoms (TBAF as BH3, a name as a fragment)
  if (g.symbols.length <= 3 && g.confidence < 0.8) return false;
  // a whole picture is taken however unsure (the original is shown beside it); a part of a scheme isn't
  if (g.symbols.length < 2 || !g.edges.some((row) => row.some((t) => t > 0))) return false;
  // a part of a scheme the reader is unsure of is taken when it reads as one connected structure
  // (a crowded 3D drawing reads unsure but close); one in pieces is something else read as atoms
  return whole || g.confidence >= 0.2 || (g.confidence >= 0.05 && g.symbols.length >= 8 && biggestPiece(g.edges) >= 0.8 * g.symbols.length);
}

/** How many atoms the biggest connected piece of a reading has. */
function biggestPiece(edges: number[][]): number {
  const seen = new Uint8Array(edges.length);
  let most = 0;
  for (let s = 0; s < edges.length; s++) {
    if (seen[s]) continue;
    let n = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      edges[i].forEach((t, j) => { if (t > 0 && !seen[j]) { seen[j] = 1; stack.push(j); } });
    }
    most = Math.max(most, n);
  }
  return most;
}

/** Below this the reader is unsure of a structure: the original is shown beside it to check. */
const UNSURE = 0.5;

/** What was read in a picture: the pixels read and how big they are shown, each structure read, and why to look closely. */
export interface Reading { p: Pixels; ptPerPx: number; parts: FromPictureRead[]; problems: string[]; texts?: ReadLine[] }

/** Read the picture (each structure on its own, for a scheme); null (with a message) when it can't be. */
export async function readPicture(host: MakeEditableHost, pic: Picture, ds: DocStyle, /** Only to measure its look: no messages, checks or text. */ quiet = false): Promise<Reading | null> {
  const shown = await pictureForReading(pic);
  if (!shown) { if (!quiet) host.flash('This picture can\'t be read (its format isn\'t one the structure reader can open).', 6000); return null; }
  // the boxes round structures taken out first (editableFromParts takes them out the same way)
  // (and the arrows: an arrow reaching from one box to the next joins them into one part)
  const framed = withoutFrames(shown.p).p;
  const bare = rubOut(framed, findArrows(framed, Math.max(12, 25 / shown.ptPerPx)).filter((a) => a.headStyle !== 'none' || a.tailStyle !== 'none').flatMap((a) => a.marks));
  const boxes = schemeParts(bare, partGap(shown.ptPerPx));
  const parts: FromPictureRead[] = [];
  const problems: string[] = [];
  let aiAnswer: string | null = null;
  for (const box of boxes ?? [null]) {
    const sub = box ? partPixels(bare, box) : bare;
    const got = await host.read(sub);
    if (!got) return null;
    const r = got.result;
    let read: FromPictureRead;
    if (r.kind === 'graph') {
      if (!isStructure(r.graph, !box)) continue;
      read = { ...(box ? { box } : {}), graph: { symbols: r.graph.symbols, coords: r.graph.coords, edges: r.graph.edges, confidence: r.graph.confidence }, frame: readFrame(sub) };
    } else {
      if (!got.molblock) { if (r.smiles) aiAnswer = r.smiles; continue; }
      read = { ...(box ? { box } : {}), molblock: got.molblock };
    }
    parts.push(read);
    const why = quiet ? [] : await host.check(r);
    // the reader's own doubt (a drawing in 3D, overlapping rings, or not a structure at all)
    if (r.kind === 'graph' && r.graph.confidence < UNSURE) why.unshift(`The reader was only ${Math.round(r.graph.confidence * 100)}% sure of it.`);
    problems.push(...(boxes && boxes.length > 1 ? why.map((w) => `Structure ${parts.length}: ${w}`) : why));
  }
  if (!parts.length) {
    if (!quiet) host.flash(aiAnswer ? `The AI model's answer (${aiAnswer}) isn't a structure the chemistry engine can read.` : 'No structure was found in the picture.', 8000);
    return null;
  }
  // the rest of the picture (arrows are found from their shape when it is made): its text read
  let texts: ReadLine[] | undefined;
  if (host.readText && !quiet) {
    const rest = editableFromParts(partReads(parts), shown.p, shown.ptPerPx, 'match', ds, STYLE_PRESETS, []).rest;
    try {
      texts = rest ? await host.readText(rest) : [];
    } catch (e) {
      host.flash(`The text in the picture could not be read (${e instanceof Error ? e.message : String(e)}): it is kept as picture.`, 8000);
    }
  }
  return { p: shown.p, ptPerPx: shown.ptPerPx, parts, problems, ...(texts ? { texts } : {}) };
}

/** The structure for what was read, in the style chosen (nothing is read again). */
export function madeFrom(pic: Picture, r: Reading, choice: StyleChoice, ds: DocStyle): Made {
  const e = editableOf(r.parts, r.p, r.ptPerPx, choice, ds, r.texts);
  return { drawing: drawingFor(pic, e, choice, r.parts, { w: r.p.width, h: r.p.height }, r.texts), problems: [...e.problems, ...r.problems] };
}

/** Read the picture and make it a structure (each structure, for a scheme); null (with a message) when it can't be. */
export async function makeEditable(host: MakeEditableHost, pic: Picture, choice: StyleChoice, ds: DocStyle): Promise<Made | null> {
  const r = await readPicture(host, pic, ds);
  return r ? madeFrom(pic, r, choice, ds) : null;
}

/**
 * Whether a structure is still exactly what the reader found, in the style it has now: every atom,
 * bond, caption, arrow and shape with all it has (colors, fonts, line and arrow kinds, sizes, where
 * it lies), atoms and ends of arrows to a tenth of a point (as saving and opening again rounds
 * them). Anything else different is a change made by hand. (Ids may differ: bonds are matched by
 * the atoms they join.)
 */
function sameReading(was: Contents, now: Contents): boolean {
  if (was.atoms.length !== now.atoms.length || was.bonds.length !== now.bonds.length || was.captions.length !== now.captions.length
    || was.arrows.length !== now.arrows.length || was.shapes.length !== now.shapes.length) return false;
  const ids = new Map(now.atoms.map((a, i) => [a.id, was.atoms[i].id]));
  const same = (a: unknown, b: unknown, key = ''): boolean => {
    if (typeof a === 'number' && typeof b === 'number') {
      if (key === 'a1' || key === 'a2') return ids.get(b) === a;
      return Math.abs(a - b) <= 0.1;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((v, i) => same(v, b[i], key === 'multi' ? 'a1' : ''));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = (o: object) => Object.entries(o).filter(([k, v]) => k !== 'id' && v !== undefined).map(([k]) => k);
      const ka = keys(a), kb = keys(b);
      if (ka.length !== kb.length) return false;
      return ka.every((k) => k in b && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], k));
    }
    return a === b;
  };
  return was.atoms.every((a, i) => same(a, now.atoms[i]))
    && was.bonds.every((a, i) => same(a, now.bonds[i]))
    && was.captions.every((a, i) => same(a, now.captions[i]))
    && was.arrows.every((a, i) => same(a, now.arrows[i]))
    && was.shapes.every((a, i) => same(a, now.shapes[i]));
}

/** What a structure kept by hand has for the other style's size: everything scaled by k about (cx, cy), as bond lengths change. */
function scaledAbout(c: Contents, k: number, cx: number, cy: number): Contents {
  if (!(k > 0) || Math.abs(k - 1) < 1e-6) return c;
  const x = (v: number) => cx + (v - cx) * k, y = (v: number) => cy + (v - cy) * k;
  return {
    atoms: c.atoms.map((a) => ({ ...a, x: x(a.x), y: y(a.y) })),
    bonds: c.bonds,
    captions: c.captions.map((a) => ({ ...a, x: x(a.x), y: y(a.y) })),
    arrows: c.arrows.map((r) => ({ ...r, tail: { x: x(r.tail.x), y: y(r.tail.y) }, head: { x: x(r.head.x), y: y(r.head.y) }, headLength: r.headLength * k, headWidth: r.headWidth * k })),
    shapes: c.shapes.map((s) => ({ ...s, x1: x(s.x1), y1: y(s.y1), x2: x(s.x2), y2: y(s.y2) })),
  };
}

/**
 * The same structure in the other style (nothing is read again); null when it can't be redone.
 * What the person changed in the structure after Make Editable (an atom put right, a bond fixed,
 * a label added) is kept: only its look and size change then (to the other style's bond length). A structure
 * still as it was read is drawn afresh from what was read, in the style chosen.
 */
export async function restyle(d: Drawing, choice: StyleChoice, ds: DocStyle): Promise<Drawing | null> {
  const fp = d.fromPicture;
  // a figure drawn by hand: what is drawn in it takes the look (or the document's style)
  if (fp && !fp.parts?.length) {
    if (choice === 'match' && !fp.look) return null;
    return { ...d, contents: withLook(d.contents, choice === 'match' ? fp.look! : null, ds, true), fromPicture: { ...fp, style: choice } };
  }
  if (!fp?.parts?.length) return null;
  const shown = await pictureForReading(fp.picture);
  if (!shown) return null;
  // as it was read, in the style it has now: when that is what is there, nothing was changed by hand
  const was = editableOf(fp.parts, shown.p, shown.ptPerPx, fp.style, ds, fp.texts);
  if (!sameReading(was.contents, d.contents)) {
    if (choice === 'match' && !fp.look) return null;
    // what was put right by hand stays, drawn at the other style's bond length (about the middle of the picture) and in its look
    const to = editableOf(fp.parts, shown.p, shown.ptPerPx, choice, ds, fp.texts);
    const k = was.at.w > 0 ? to.at.w / was.at.w : 1;
    const sized = scaledAbout(d.contents, k, was.at.x + was.at.w / 2, was.at.y + was.at.h / 2);
    return { ...d, contents: withLook(sized, choice === 'match' ? fp.look! : null, ds, true), fromPicture: { ...fp, style: choice } };
  }
  const e = editableOf(fp.parts, shown.p, shown.ptPerPx, choice, ds, fp.texts);
  const made = drawingFor(fp.picture, e, choice, fp.parts, { w: shown.p.width, h: shown.p.height }, fp.texts);
  // what the structure has as an object (where it floats, its look, size, turn, names) stays as it is now; so does tracing and the alt text, cleared or not
  const { alt: _alt, wordPr: _wordPr, float: _float, look: _look, ...rest } = made;
  return {
    ...rest,
    ...(d.float ? { float: structuredClone(d.float) } : {}),
    ...(d.look ? { look: d.look } : {}),
    ...(d.alt ? { alt: d.alt } : {}),
    ...(d.wordPr ? { wordPr: { ...d.wordPr } } : {}),
    ...(d.scale !== undefined ? { scale: d.scale } : {}),
    ...(d.rot !== undefined ? { rot: d.rot } : {}),
    ...(d.flipH ? { flipH: d.flipH } : {}),
    ...(d.flipV ? { flipV: d.flipV } : {}),
    fromPicture: { ...made.fromPicture!, ...(fp.trace ? { trace: fp.trace } : {}) },
  };
}

/** The picture back as it was before Make Editable. */
export function pictureBack(d: Drawing): Picture | null {
  return d.fromPicture ? structuredClone(d.fromPicture.picture) : null;
}

// ------------------------------------------------------------------ Convert to Figure

/**
 * Convert to Figure: an empty figure `size` points (the picture's size on the page) in the
 * picture's place, wrapped and framed as it was, the picture kept beside it to copy or trace.
 * Its structures are drawn in the picture's look (`look`, measured) or the document's style.
 */
export function figureFor(pic: Picture, size: { w: number; h: number }, choice: StyleChoice, look: PictureLook | null): Drawing {
  const w = Math.round(size.w * 100) / 100, h = Math.round(size.h * 100) / 100;
  return {
    kind: 'drawing', contents: { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] },
    frame: { x: 0, y: 0, w, h },
    ...(pic.float ? { float: structuredClone(pic.float) } : {}),
    ...(pic.look ? { look: structuredClone(pic.look) } : {}),
    ...(pic.alt ? { alt: pic.alt } : {}),
    fromPicture: { picture: pic, at: { x: 0, y: 0, w, h }, style: choice, ...(look ? { look } : {}) },
  };
}

/** The picture a structure was made from, or a figure was converted from: the picture as it was. */
export function keptPicture(o: DocObject | undefined): Picture | null {
  if (canMakeEditable(o)) return o;
  return o?.kind === 'drawing' && o.fromPicture ? o.fromPicture.picture : null;
}

/** A figure converted from a picture (drawn by hand), rather than a structure read from it. */
export const isConvertedFigure = (o: DocObject | undefined): boolean => o?.kind === 'drawing' && !!o.fromPicture && !!o.frame && !o.fromPicture.parts?.length;

/** The drawing style that draws in the picture's look (the document's, sized to the bond length measured). */
export function styleForLook(ds: DocStyle, look: PictureLook): DocStyle {
  const k = look.bondLength / ds.bondLength;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    ...ds,
    bondLength: r2(look.bondLength),
    lineWidth: r2(look.lineWidth ?? ds.lineWidth * k),
    boldWidth: r2(ds.boldWidth * k),
    hashSpacing: r2(ds.hashSpacing * k),
    marginWidth: r2(ds.marginWidth * k),
    labelSize: r2(look.labelSize ?? ds.labelSize * k),
  };
}

/** The style a structure made from a picture is drawn in while it is edited: the picture's look when it matches it. */
export function drawingStyleOf(fp: FromPicture | undefined, ds: DocStyle): DocStyle {
  return fp?.style === 'match' && fp.look ? styleForLook(ds, fp.look) : ds;
}

const BOND_LOOK = ['s', 'boldWidth', 'hashSpacing', 'marginWidth', 'bondLength'] as const;

/**
 * The picture's look kept on each bond and atom drawn without one (as applyLook does for a
 * structure read), so what was drawn in a matching figure keeps that look in the document and in
 * CDXML. `all` puts it on every one (the style changed); null `look` takes it off (the document's style).
 */
export function withLook(c: Contents, look: PictureLook | null, ds: DocStyle, all = false): Contents {
  if (!look) {
    if (!all) return c;
    return {
      ...c,
      bonds: c.bonds.map((b) => { const n = { ...b }; for (const k of BOND_LOOK) delete n[k]; return n; }),
      atoms: c.atoms.map((a) => { const n = { ...a }; delete n.s; return n; }),
    };
  }
  const st = styleForLook(ds, look);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const bond = { s: r2(st.lineWidth / ds.lineWidth), boldWidth: st.boldWidth, hashSpacing: st.hashSpacing, marginWidth: st.marginWidth, bondLength: st.bondLength };
  const atomS = r2(st.labelSize / ds.labelSize);
  return {
    ...c,
    bonds: c.bonds.map((b) => (all || b.s === undefined ? { ...b, ...bond } : b)),
    atoms: c.atoms.map((a) => (all || a.s === undefined ? { ...a, s: atomS } : a)),
  };
}

/**
 * How the picture is drawn, for a figure to match it: from what the reader reads in it (its bond
 * length, line width and label size), else only its line width (the bond length is then the document's, to change by hand; no labels). Null when nothing could be measured.
 */
export async function measurePicture(host: MakeEditableHost | null, pic: Picture, ds: DocStyle): Promise<{ look: PictureLook; from: 'read' | 'lines' } | null> {
  if (host?.readQuietly) {
    const r = await readPicture({ ...host, read: host.readQuietly }, pic, ds, true).catch(() => null);
    if (r?.parts.length) {
      const e = editableOf(r.parts, r.p, r.ptPerPx, 'match', ds);
      if (e.look.bondLength > 0) return { look: e.look, from: 'read' };
    }
  }
  const shown = await pictureForReading(pic);
  const px = shown && strokeWidthPx(shown.p);
  if (!shown || !px) return null;
  const lw = px * shown.ptPerPx;
  return { look: { bondLength: ds.bondLength, lineWidth: Math.round(lw * 100) / 100, labelSize: null }, from: 'lines' };
}
