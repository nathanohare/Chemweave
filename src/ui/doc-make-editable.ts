// Make Editable (Document mode): a picked picture of a structure (pasted from ChemDraw as a
// picture, or from a paper) read and turned into a structure in its place, drawn to match the
// picture or in the document's style. The picture is kept with the structure (FromPicture), to
// compare with, to change style without reading again, and to go back to.

import type { DocObject, FromPicture } from '../document/document';
import type { DocStyle } from '../style';
import { STYLE_PRESETS } from '../drawing-styles';
import type { ReadResult } from '../recognise/reader';
import type { Pixels } from '../recognise/picture';
import type { ReadGraph } from '../recognise/molscribe';
import { editableFromGraph, editableFromMolfile, readFrame, type Editable, type StyleChoice } from '../recognise/editable';
import { fromDataUrl } from '../render/images';
import { decodePicture } from './import-structures';

type Picture = Extract<DocObject, { kind: 'picture' }>;
type Drawing = Extract<DocObject, { kind: 'drawing' }>;

export interface MakeEditableHost {
  /** Read a picture (the reader here or the AI model); null when it couldn't be. */
  read(p: Pixels): Promise<{ result: ReadResult; molblock: string | null } | null>;
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

/** The structure for a reading, in the style chosen. */
export function editableOf(read: NonNullable<FromPicture['read']>, p: Pixels, ptPerPx: number, choice: StyleChoice, ds: DocStyle): Editable {
  if ('molblock' in read) return editableFromMolfile(read.molblock, p, ptPerPx, choice, ds, STYLE_PRESETS);
  const g: ReadGraph = { smiles: '', ...read.graph, atomScores: read.graph.symbols.map(() => 1) };
  return editableFromGraph(g, p, read.frame, ptPerPx, choice, ds, STYLE_PRESETS);
}

/** The structure in the picture's place: where it floats, its frame and shadow, its alt text, and the picture kept. */
export function drawingFor(pic: Picture, e: Editable, choice: StyleChoice, read: FromPicture['read']): Drawing {
  return {
    kind: 'drawing', contents: e.contents,
    ...(pic.float ? { float: structuredClone(pic.float) } : {}),
    ...(pic.look ? { look: structuredClone(pic.look) } : {}),
    ...(pic.alt ? { alt: pic.alt } : {}),
    fromPicture: { picture: pic, at: e.at, style: choice, look: e.look, ...(read ? { read } : {}) },
  };
}

export interface Made { drawing: Drawing; problems: string[] }

/** Read the picture and make it a structure; null (with a message) when it can't be. */
export async function makeEditable(host: MakeEditableHost, pic: Picture, choice: StyleChoice, ds: DocStyle): Promise<Made | null> {
  const shown = await pictureForReading(pic);
  if (!shown) { host.flash('This picture can\'t be read (its format isn\'t one the structure reader can open).', 6000); return null; }
  const got = await host.read(shown.p);
  if (!got) return null;
  const r = got.result;
  let read: FromPicture['read'];
  if (r.kind === 'graph') {
    if (!r.graph.symbols.length) { host.flash('No structure was found in the picture.', 6000); return null; }
    read = { graph: { symbols: r.graph.symbols, coords: r.graph.coords, edges: r.graph.edges, confidence: r.graph.confidence }, frame: readFrame(shown.p), px: { w: shown.p.width, h: shown.p.height } };
  } else {
    if (!got.molblock) { host.flash(r.smiles ? `The AI model's answer (${r.smiles}) isn't a structure the chemistry engine can read.` : 'No structure was found in the picture.', 8000); return null; }
    read = { molblock: got.molblock };
  }
  const e = editableOf(read, shown.p, shown.ptPerPx, choice, ds);
  const problems = [...e.problems, ...await host.check(r)];
  return { drawing: drawingFor(pic, e, choice, read), problems };
}

/** The same structure in the other style, from the picture kept (nothing is read again); null when it can't be redone. */
export async function restyle(d: Drawing, choice: StyleChoice, ds: DocStyle): Promise<Drawing | null> {
  const fp = d.fromPicture;
  if (!fp?.read) return null;
  const shown = await pictureForReading(fp.picture);
  if (!shown) return null;
  const e = editableOf(fp.read, shown.p, shown.ptPerPx, choice, ds);
  return { ...drawingFor(fp.picture, e, choice, fp.read), ...(d.float ? { float: structuredClone(d.float) } : {}), ...(d.look ? { look: d.look } : {}), ...(d.alt ? { alt: d.alt } : {}) };
}

/** The picture back as it was before Make Editable. */
export function pictureBack(d: Drawing): Picture | null {
  return d.fromPicture ? structuredClone(d.fromPicture.picture) : null;
}
