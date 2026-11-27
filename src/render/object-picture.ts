// The picture an embedded object shows (Insert > Document > Object): the cells of a workbook, the first
// page of a PDF, a picture file itself, or an icon with the file's name for anything else
// (and whenever the person asks for the icon).

import { dataUrl, imageSize, pictureMime } from './images';
import type { Workbook } from '../sheet/workbook';

/** A picture for a document: its data URL and its size in points (`px` its pixels, for bitmaps). */
export interface ObjectPicture { src: string; w: number; h: number; px?: { w: number; h: number } }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const svgUrl = (svg: string) => dataUrl(new TextEncoder().encode(svg), 'image/svg+xml');

/** The extension of a file name, in lower case. */
function extOf(name: string): string {
  return /\.([^.\\/]+)$/.exec(name)?.[1].toLowerCase() ?? '';
}

/** Whether a file shows its contents (otherwise it shows as an icon). */
export function showsContents(name: string): boolean {
  const ext = extOf(name);
  return ext === 'xlsx' || ext === 'xlsm' || ext === 'pdf' || !!pictureMime(name, new Uint8Array(0));
}

/**
 * The picture for a file: its contents where we can show them, else (or when `icon` is set)
 * its icon. `readBook` reads a workbook (the app's Excel reader); `pdfPage` draws a PDF's first page.
 */
export async function objectPicture(
  name: string, bytes: Uint8Array, icon: boolean,
  deps: { readBook?(bytes: Uint8Array): Promise<Workbook>; pdfPage?(bytes: Uint8Array): Promise<ObjectPicture | null> } = {},
): Promise<ObjectPicture> {
  if (!icon) {
    const ext = extOf(name);
    try {
      if ((ext === 'xlsx' || ext === 'xlsm') && deps.readBook) {
        const pic = cellsPicture(await deps.readBook(bytes));
        if (pic) return pic;
      }
      if (ext === 'pdf' && deps.pdfPage) {
        const pic = await deps.pdfPage(bytes);
        if (pic) return pic;
      }
      const mime = pictureMime(name, bytes);
      const px = mime ? imageSize(bytes, mime) : null;
      if (mime && px) return { src: dataUrl(bytes, mime), w: px.w * 0.75, h: px.h * 0.75, px };
    } catch { /* not readable: its icon */ }
  }
  return iconPicture(name);
}

/** An icon for a file: a page with its kind on a band, and its name underneath (as Word's Display as Icon shows it). */
export function iconPicture(name: string): ObjectPicture {
  const ext = extOf(name).toUpperCase().slice(0, 4) || 'FILE';
  const colour = /^XLS/.test(ext) ? '#1d6f42' : /^DOC/.test(ext) ? '#2b579a' : /^PPT/.test(ext) ? '#c4472b' : ext === 'PDF' ? '#b30b00' : '#5f6b7a';
  const shown = name.length > 28 ? name.slice(0, 25) + '…' : name;
  const w = Math.max(72, Math.min(160, shown.length * 5.6 + 8)), h = 70;
  const x = w / 2 - 15;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<path d="M${x} 2h22l8 8v36h-30z" fill="#fff" stroke="#8a94a3" stroke-width="1"/><path d="M${x + 22} 2v8h8" fill="none" stroke="#8a94a3" stroke-width="1"/>` +
    `<rect x="${x - 4}" y="24" width="30" height="12" rx="1.5" fill="${colour}"/>` +
    `<text x="${x + 11}" y="33" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="#fff" text-anchor="middle">${esc(ext)}</text>` +
    `<text x="${w / 2}" y="62" font-family="Arial, sans-serif" font-size="9" fill="#222" text-anchor="middle">${esc(shown)}</text></svg>`;
  return { src: svgUrl(svg), w, h };
}

const MAX_ROWS = 40, MAX_COLS = 15;
const COL_PX = 64, ROW_PX = 20;

/** The cells in use on a workbook's active sheet (up to 40 rows and 15 columns), drawn as Excel shows them, gridlines and all. */
export function cellsPicture(book: Workbook): ObjectPicture | null {
  const s = book.sheets[book.active] ?? book.sheets[0];
  const used = s?.usedRange();
  if (!s || !used) return null;
  const rows = Math.min(used.r2, MAX_ROWS - 1) + 1, cols = Math.min(used.c2, MAX_COLS - 1) + 1;
  const xs = [0], ys = [0];
  for (let c = 0; c < cols; c++) xs.push(xs[c] + (s.hiddenCols.has(c) ? 0 : s.colWidths.get(c) ?? COL_PX));
  for (let r = 0; r < rows; r++) ys.push(ys[r] + (s.hiddenRows.has(r) ? 0 : s.rowHeights.get(r) ?? s.fittedRows.get(r) ?? ROW_PX));
  const W = xs[cols], H = ys[rows];
  if (W <= 0 || H <= 0) return null;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`];
  // a merged block is drawn as one cell, its anchor's (the top-left), spanning the cells of the block shown
  const blockAt = (r: number, c: number) => {
    const m = s.mergeAt(r, c);
    return m ? { r1: m.r1, c1: m.c1, r2: Math.min(m.r2, rows - 1), c2: Math.min(m.c2, cols - 1) } : null;
  };
  const sameBlock = (r: number, c: number, r2: number, c2: number) => {
    const m = s.mergeAt(r, c);
    return !!m && m === s.mergeAt(r2, c2);
  };
  // gridlines, left out inside merged blocks
  const lines: string[] = [];
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) if (c === 0 || c === cols || !sameBlock(r, c - 1, r, c)) lines.push(`M${xs[c] + 0.5} ${ys[r]}V${ys[r + 1]}`);
  }
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) if (r === 0 || r === rows || !sameBlock(r - 1, c, r, c)) lines.push(`M${xs[c]} ${ys[r] + 0.5}H${xs[c + 1]}`);
  }
  const fills: string[] = [], texts: string[] = [], borders: string[] = [], clips: string[] = [];
  /** Does a cell stop text running into it: it shows something, or is in a merged block? */
  const filled = (r: number, cc: number) => s.shownText(r, cc) !== '' || !!s.mergeAt(r, cc);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const block = blockAt(r, c);
      if (block && (block.r1 !== r || block.c1 !== c)) continue;
      const c2 = block ? block.c2 : c, r2 = block ? block.r2 : r;
      const left = xs[c], right = xs[c2 + 1], top = ys[r], bottom = ys[r2 + 1];
      const cw = right - left, ch = bottom - top;
      if (cw <= 0 || ch <= 0) continue;
      const st = s.styleAt(r, c);
      if (st?.fill) fills.push(`<rect x="${left}" y="${top}" width="${cw}" height="${ch}" fill="${esc(st.fill)}"/>`);
      for (const [side, d] of [['top', `M${left} ${top + 0.5}h${cw}`], ['bottom', `M${left} ${bottom + 0.5}h${cw}`], ['left', `M${left + 0.5} ${top}v${ch}`], ['right', `M${right + 0.5} ${top}v${ch}`]] as const) {
        const b = st?.borders?.[side];
        if (b) borders.push(`<path d="${d}" stroke="${esc(b.color ?? '#000')}" stroke-width="${b.style === 'thick' ? 3 : b.style === 'medium' ? 2 : 1}"/>`);
      }
      const text = s.shownText(r, c);
      if (!text) continue;
      const v = s.value(r, c);
      const align = st?.align ?? (typeof v === 'number' ? 'right' : 'left');
      const x = align === 'right' ? right - 3 : align === 'center' ? (left + right) / 2 : left + 3;
      const size = (st?.size ?? 11) * (96 / 72);
      const y = st?.valign === 'top' ? top + size : st?.valign === 'middle' ? (top + bottom) / 2 + size * 0.35 : bottom - 4;
      const look = `${st?.bold ? ' font-weight="bold"' : ''}${st?.italic ? ' font-style="italic"' : ''}${st?.underline ? ' text-decoration="underline"' : ''}`;
      // text runs on over empty cells beside it, as in Excel, up to the first filled one (numbers,
      // and the text of a merged block, always stay in their cell)
      let from = c, to = c2;
      if (typeof v !== 'number' && !block) {
        if (align !== 'right') while (to + 1 < cols && !filled(r, to + 1)) to++;
        if (align !== 'left') while (from > 0 && !filled(r, from - 1)) from--;
      }
      const cut = { x1: xs[from], x2: xs[to + 1] };
      clips.push(`<clipPath id="k${r}_${c}"><rect x="${cut.x1}" y="${top}" width="${cut.x2 - cut.x1}" height="${ch}"/></clipPath>`);
      texts.push(`<text x="${x}" y="${y}" font-family="${esc(st?.font || 'Calibri')}, Carlito, Arial, sans-serif" font-size="${size.toFixed(2)}" fill="${esc(st?.color ?? '#000')}" text-anchor="${align === 'right' ? 'end' : align === 'center' ? 'middle' : 'start'}"${look} clip-path="url(#k${r}_${c})">${esc(text)}</text>`);
    }
  }
  out.push(clips.length ? `<defs>${clips.join('')}</defs>` : '', ...fills, `<path d="${lines.join('')}" stroke="#d4d4d4" stroke-width="1" fill="none"/>`, ...borders, ...texts, '</svg>');
  return { src: svgUrl(out.join('')), w: W * 0.75, h: H * 0.75 };
}
