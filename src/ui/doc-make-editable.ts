// Make Editable (Document mode): a picked picture of a structure (pasted from ChemDraw as a
// picture, or from a paper) read and turned into a structure in its place, drawn to match the
// picture or in the document's style. The picture is kept with the structure (FromPicture), to
// compare with, to change style without reading again, and to go back to. A picture of a scheme
// has each structure read on its own, and its arrows and text made editable too (what can't be
// read stays as a picture behind them).

import type { DocObject, FromPictureRead } from '../document/document';
import type { DocStyle } from '../style';
import { STYLE_PRESETS } from '../drawing-styles';
import type { ReadResult } from '../recognise/reader';
import type { Pixels } from '../recognise/picture';
import { editableFromParts, readFrame, type Editable, type PartRead, type StyleChoice } from '../recognise/editable';
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
    const x = Math.round(c.l * p.width), y = Math.round(c.t * p.height);
    const w = Math.max(1, Math.round((1 - c.l - c.r) * p.width)), h = Math.max(1, Math.round((1 - c.t - c.b) * p.height));
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) data.set(p.data.subarray(((y + row) * p.width + x) * 4, ((y + row) * p.width + x + w) * 4), row * w * 4);
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
    const w0 = o.w || img.naturalWidth * 0.75, h0 = o.h || img.naturalHeight * 0.75;
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
export async function readPicture(host: MakeEditableHost, pic: Picture, ds: DocStyle): Promise<Reading | null> {
  const shown = await pictureForReading(pic);
  if (!shown) { host.flash('This picture can\'t be read (its format isn\'t one the structure reader can open).', 6000); return null; }
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
    const why = await host.check(r);
    // the reader's own doubt (a drawing in 3D, overlapping rings, or not a structure at all)
    if (r.kind === 'graph' && r.graph.confidence < UNSURE) why.unshift(`The reader was only ${Math.round(r.graph.confidence * 100)}% sure of it.`);
    problems.push(...(boxes && boxes.length > 1 ? why.map((w) => `Structure ${parts.length}: ${w}`) : why));
  }
  if (!parts.length) {
    host.flash(aiAnswer ? `The AI model's answer (${aiAnswer}) isn't a structure the chemistry engine can read.` : 'No structure was found in the picture.', 8000);
    return null;
  }
  // the rest of the picture (arrows are found from their shape when it is made): its text read
  let texts: ReadLine[] | undefined;
  if (host.readText) {
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

/** The same structure in the other style, from the picture kept (nothing is read again); null when it can't be redone. */
export async function restyle(d: Drawing, choice: StyleChoice, ds: DocStyle): Promise<Drawing | null> {
  const fp = d.fromPicture;
  if (!fp?.parts?.length) return null;
  const shown = await pictureForReading(fp.picture);
  if (!shown) return null;
  const e = editableOf(fp.parts, shown.p, shown.ptPerPx, choice, ds, fp.texts);
  return { ...drawingFor(fp.picture, e, choice, fp.parts, { w: shown.p.width, h: shown.p.height }, fp.texts), ...(d.float ? { float: structuredClone(d.float) } : {}), ...(d.look ? { look: d.look } : {}), ...(d.alt ? { alt: d.alt } : {}) };
}

/** The picture back as it was before Make Editable. */
export function pictureBack(d: Drawing): Picture | null {
  return d.fromPicture ? structuredClone(d.fromPicture.picture) : null;
}
