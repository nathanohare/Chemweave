// Getting a picture into an SI project's section (a table cell's, or a figure's): from a file,
// from the clipboard (a ChemDraw or Chemweave drawing is kept as an SVG with its CDXML beside it,
// a metafile as an SVG with the metafile beside it, as SI Assistant keeps pasted originals), from
// the drawing tools (a picture made here is drawn again from its CDXML) or from a compound of
// the project. Each gives the picture's path in the section's folder (images/…).

import type { Contents, Doc } from '../model';
import type { Pasted } from '../io/clipboard';
import type { SiProject, SiSection } from '../si/project';

export interface SiPictureHost {
  project: SiProject;
  section: SiSection;
  flash(msg: string): void;
  pickFiles(label: string, exts: string[]): Promise<{ name: string; bytes: Uint8Array }[]>;
  editStructure(contents: Contents | null, title: string, done: (c: Contents | null) => void): void;
  /** A drawing as an SVG picture and as CDXML (to draw it again), or null when it is empty. */
  drawingFiles(d: Contents | Doc): { svg: string; cdxml: string } | null;
  /** A CDXML drawing (a picture's original) as a drawing. */
  contentsOfCdxml(text: string): Contents | null;
  /** What is on the clipboard: from a paste event, or read (a Paste button). */
  readClipboard(e?: ClipboardEvent): Promise<Pasted>;
  /** One of the project's compounds with a structure, picked; null when cancelled. */
  pickCompound(): Promise<{ id: string; mol: string } | null>;
  contentsOf(mol: string): Contents | null;
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
export const PICTURE_MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };
const extOf = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

export class SiPictures {
  constructor(private host: SiPictureHost) {}

  private add(name: string, bytes: Uint8Array, others: Record<string, Uint8Array> = {}): Promise<string> {
    return this.host.project.addSectionPicture(this.host.section, name, bytes, others);
  }

  /** A picture file chosen (PNG, JPG, SVG or PDF); null when none was. */
  async fromFile(label: string): Promise<string | null> {
    const [f] = await this.host.pickFiles(label, ['png', 'jpg', 'jpeg', 'svg', 'pdf']);
    return f ? this.add(f.name, f.bytes) : null;
  }

  /** A drawing kept as SVG, with its CDXML beside it; null when it is empty. */
  async fromDrawing(d: Contents | Doc, name = 'structure.svg'): Promise<string | null> {
    const files = this.host.drawingFiles(d);
    if (!files) { this.host.flash('Nothing was drawn, so nothing was changed.'); return null; }
    return this.add(name, enc(files.svg), { cdxml: enc(files.cdxml) });
  }

  /** A pasted drawing or picture; null for anything else on the clipboard. */
  async fromPasted(p: Pasted): Promise<string | null> {
    if (p.kind === 'drawing') return this.fromDrawing(p.doc, 'pasted picture.svg');
    if (p.kind !== 'picture') return null;
    if (p.mime === 'image/png' || p.mime === 'image/jpeg') return this.add(`pasted picture.${p.mime === 'image/png' ? 'png' : 'jpg'}`, p.bytes);
    if (p.mime === 'image/svg+xml') return this.add('pasted picture.svg', p.bytes);
    if (p.mime === 'image/x-emf') {
      const { emfToSvg } = await import('../render/emf-read');
      const svg = emfToSvg(p.bytes)?.svg;
      if (svg) return this.add('pasted picture.svg', enc(svg), { emf: p.bytes });
    }
    const png = await toPng(p.bytes, p.mime);
    if (png) return this.add('pasted picture.png', png);
    this.host.flash('This picture could not be read.');
    return null;
  }

  /** The clipboard read (a Paste button): its picture, or null with a message. */
  async fromClipboard(): Promise<string | null> {
    let p: Pasted;
    try { p = await this.host.readClipboard(); } catch (e) { this.host.flash(`The clipboard could not be read: ${e instanceof Error ? e.message : String(e)}`); return null; }
    const got = await this.fromPasted(p);
    if (!got && p.kind !== 'picture') this.host.flash('The clipboard has no picture or drawing. Copy a structure in ChemDraw or Chemweave, or a picture, first.');
    return got;
  }

  /** Draw with the drawing tools: the picture `current` again when it was drawn here, else a new drawing. */
  draw(current: string, title: string): Promise<string | null> {
    const again = current ? current.replace(/\.[^./]+$/, '.cdxml') : '';
    return (again && again !== current ? this.host.project.readSectionFile(this.host.section, again) : Promise.resolve(null)).then((bytes) => new Promise((done) => {
      const contents = bytes ? this.host.contentsOfCdxml(new TextDecoder().decode(bytes)) : null;
      if (current && !contents) this.host.flash('This picture wasn’t drawn here, so you start a new drawing; it replaces the picture when you finish.');
      this.host.editStructure(contents, title, (got) => {
        if (!got || (!got.atoms.length && !got.arrows.length && !got.captions.length && !got.shapes.length)) { done(null); return; }
        void this.fromDrawing(got).then(done);
      });
    }));
  }

  /** A compound's structure picked; with its id, to mention it under the picture. */
  async fromCompound(): Promise<{ rel: string; id: string } | null> {
    const got = await this.host.pickCompound();
    if (!got) return null;
    const contents = this.host.contentsOf(got.mol);
    if (!contents) { this.host.flash('That compound’s structure could not be read.'); return null; }
    const rel = await this.fromDrawing(contents);
    return rel ? { rel, id: got.id } : null;
  }

  /** A preview of a section's picture (an <img>, or its name for a PDF or one that is missing). */
  preview(rel: string, urls: string[], maxPx?: { w: number; h: number }, widthCm = 0): HTMLElement {
    const box = document.createElement('div');
    box.className = 'si-tpic';
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    const mime = PICTURE_MIME[extOf(rel)];
    if (!mime) { box.textContent = `[${name}]`; return box; }
    void this.host.project.readSectionFile(this.host.section, rel).then((bytes) => {
      if (!bytes) { box.textContent = `[missing: ${name}]`; box.classList.add('si-missing'); return; }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      urls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = name;
      if (maxPx) { img.style.maxWidth = `${maxPx.w}px`; img.style.maxHeight = `${maxPx.h}px`; }
      // (about the printed size, at half of it in a table's grid)
      if (widthCm > 0) img.style.width = `${Math.round((widthCm / 2.54) * 96 * (maxPx ? 1 : 0.5))}px`;
      box.append(img);
    });
    return box;
  }
}

/** A picture the browser can show (a bitmap) as PNG bytes. */
async function toPng(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
