// Make Editable (Document mode): a picked picture of a structure (pasted from ChemDraw as a
// picture, or from a paper) read and turned into a structure in its place, drawn to match the
// picture or in the document's style. The picture is kept with the structure (FromPicture), to
// compare with, to change style without reading again, and to go back to. A picture of a scheme
// has each structure read on its own; its arrows and text stay as a picture behind them.

import type { DocObject, FromPictureRead } from '../document/document';
import type { DocStyle } from '../style';
import { STYLE_PRESETS } from '../drawing-styles';
import type { ReadResult } from '../recognise/reader';
import type { Pixels } from '../recognise/picture';
import { editableFromParts, readFrame, type Editable, type PartRead, type StyleChoice } from '../recognise/editable';
import { partPixels, schemeParts } from '../recognise/leftover';
import type { ReadLine } from '../recognise/scheme-extras';
import { fromDataUrl } from '../render/images';
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
  // the reader works on up to 2000 pixels: more is only slower
  let p = await decodePicture(got.bytes, got.mime, 2000);
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
 * bonds (THF, LiOH as [THF].[LiOH]), and a reading the reader is far from sure of isn't taken.
 * What isn't is left in the picture behind.
 */
export function isStructure(g: { symbols: string[]; edges: number[][]; confidence: number }): boolean {
  return g.symbols.length >= 2 && g.confidence >= 0.2 && g.edges.some((row) => row.some((t) => t > 0));
}

/** What was read in a picture: the pixels read and how big they are shown, each structure read, and why to look closely. */
export interface Reading { p: Pixels; ptPerPx: number; parts: FromPictureRead[]; problems: string[]; texts?: ReadLine[] }

/** Read the picture (each structure on its own, for a scheme); null (with a message) when it can't be. */
export async function readPicture(host: MakeEditableHost, pic: Picture, ds: DocStyle): Promise<Reading | null> {
  const shown = await pictureForReading(pic);
  if (!shown) { host.flash('This picture can\'t be read (its format isn\'t one the structure reader can open).', 6000); return null; }
  const boxes = schemeParts(shown.p, partGap(shown.ptPerPx));
  const parts: FromPictureRead[] = [];
  const problems: string[] = [];
  let aiAnswer: string | null = null;
  for (const box of boxes ?? [null]) {
    const sub = box ? partPixels(shown.p, box) : shown.p;
    const got = await host.read(sub);
    if (!got) return null;
    const r = got.result;
    let read: FromPictureRead;
    if (r.kind === 'graph') {
      if (!r.graph.symbols.length || (box && !isStructure(r.graph))) continue;
      read = { ...(box ? { box } : {}), graph: { symbols: r.graph.symbols, coords: r.graph.coords, edges: r.graph.edges, confidence: r.graph.confidence }, frame: readFrame(sub) };
    } else {
      if (!got.molblock) { if (r.smiles) aiAnswer = r.smiles; continue; }
      read = { ...(box ? { box } : {}), molblock: got.molblock };
    }
    parts.push(read);
    const why = await host.check(r);
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
