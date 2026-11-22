// Insert > Cover Page's gallery pictures (review round 2, finding 5): each design's first page,
// laid out and drawn by the document's own code with sample text, then scaled down, so the
// picture is what the design really gives (Word shows its cover pages the same way).

import { DocFile } from '../document/doc-file';
import { drawPageLook } from '../document/doc-paint';
import { nextObjectId } from '../document/document';
import { drawParaBorders, drawParaShading } from '../document/para-borders';
import { COVER_PAGES, insertCover } from '../document/quick-parts';
import * as rt from '../richtext';
import { drawLayout } from '../text/draw';

/** The sample text a cover page picture shows in the document's properties' places. */
export const COVER_SAMPLE = { title: 'Document Title', subject: 'Document Subtitle', author: 'Author Name', company: 'Institution' };

/** Width of a picture in CSS pixels (its height follows the page's shape). */
export const COVER_THUMB_W = 104;

const made = new Map<string, string>();

/** A design's first page as a PNG data URL, `w` CSS pixels wide (drawn once per design, accent and width). */
export function coverThumb(id: string, accent: string, w = COVER_THUMB_W): string {
  const key = `${id} ${accent} ${w}`;
  const have = made.get(key);
  if (have) return have;
  const design = COVER_PAGES.find((d) => d.id === id);
  if (!design) return '';
  const blank = new DocFile();
  const N = blank.t.styles.Normal;
  let next = nextObjectId(blank.t);
  const t = insertCover({ ...blank.t, props: { ...(blank.t.props ?? {}), ...COVER_SAMPLE } }, design, accent, rt.cleanStyle({ font: N?.font, size: N?.size }),
    (code, format) => ({ id: next++, o: format ? { kind: 'field', code, format } : { kind: 'field', code } }));
  const f = new DocFile(t);
  const lay = f.layout();
  const p = lay.pages[0];
  if (!p) return '';
  const dpr = Math.max(2, Math.ceil(globalThis.devicePixelRatio || 1));
  const k = w / p.w;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(p.h * k * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k * dpr, 0, 0, k * dpr, -p.x * k * dpr, -p.top * k * dpr);
  ctx.fontKerning = 'none';
  drawPageLook(ctx, t, p);
  drawParaShading(ctx, lay.frames, p.index);
  drawLayout(ctx, lay.text, 0, 0, p.first, p.end);
  drawParaBorders(ctx, lay.frames, p.index);
  const url = canvas.toDataURL('image/png');
  made.set(key, url);
  return url;
}

/** Forget the pictures (fonts finished loading: draw them again). */
export function clearCoverThumbs(): void {
  made.clear();
}
// (a font that finishes loading changes how the pages lay out)
globalThis.document?.fonts?.addEventListener?.('loadingdone', clearCoverThumbs);

/** The gallery's picture of a design: the page, framed as a sheet of paper. */
export function coverPic(id: string, accent: string): string {
  const url = coverThumb(id, accent);
  if (!url) return '';
  return `<img class="gal-cover" src="${url}" width="${COVER_THUMB_W}" alt="" draggable="false"/>`;
}
