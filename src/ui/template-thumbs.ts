// The pictures on the cards of the New Document and New Spreadsheet windows, drawn from the
// templates themselves: a document's first page as it prints (shrunk whole, so its text is as
// small as the page), and a spreadsheet's first sheet as the grid draws it (its column widths,
// fills, borders, number formats, conditional formats and charts). Loaded when the window first
// shows a card, so the drawing code stays out of the program's start-up.

import { DocFile, figures } from '../document/doc-file';
import type { DocText } from '../document/document';
import { recordPages } from '../document/doc-paint';
import { itemsToSvg } from '../render/svg';
import type { Workbook } from '../sheet/workbook';
import type { Callout } from '../sheet/template-samples';
import { SheetView } from './sheet-view';
import { StructurePictures } from './structure-pictures';
import type { DocStyle } from '../style';

/** How much of a document's first page a card shows, from the top (the rest is cut off so the text is larger). */
export const DOC_SHOWN = 0.5;

/** The top of a document's first page, as an SVG the width of the card's picture (its text in the page's own proportion). */
export function docPage(t: DocText): HTMLElement {
  const box = document.createElement('div');
  box.className = 'ft-real-page';
  const f = new DocFile(t);
  const pages = recordPages(f.t, f.printLayout(), (c, style) => figures.record(c, style).pic);
  const p = pages[0];
  if (!p) return box;
  const x = p.origin?.x ?? 0, y = p.origin?.y ?? 0;
  const h = p.h * DOC_SHOWN;
  box.innerHTML = itemsToSvg(p.items, { x1: x, y1: y, x2: x + p.w, y2: y + h });
  const svg = box.firstElementChild as SVGSVGElement | null;
  // sized by the card (the viewBox keeps the page's shape); the text is drawn at the page's scale
  svg?.removeAttribute('width');
  svg?.removeAttribute('height');
  box.style.aspectRatio = `${p.w} / ${h}`;
  return box;
}

/** The shape of a card's picture (width over height), and the narrowest and widest part of a sheet drawn for one, in CSS pixels at 100%. */
export const SHEET_SHOT = { aspect: 1.4, minW: 420, maxW: 960 };

let shared: { host: HTMLDivElement; view: SheetView } | null = null;
/** The workbook being drawn (its drawing style draws the structures in its cells). */
let drawing: Workbook | null = null;
const pictures = new StructurePictures(() => drawing?.drawingStyle ?? ({} as DocStyle));

/** One grid, off screen, that draws each template in turn. */
function offscreenView(): { host: HTMLDivElement; view: SheetView } {
  if (shared) {
    if (!shared.host.isConnected) document.body.append(shared.host);
    return shared;
  }
  const host = document.createElement('div');
  host.className = 'ft-sheet-offscreen';
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  // laid out (so the grid has a size) but out of sight
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: `${SHEET_SHOT.minW}px`, height: `${Math.round(SHEET_SHOT.minW / SHEET_SHOT.aspect)}px`, display: 'flex', flexDirection: 'column', visibility: 'hidden', pointerEvents: 'none' });
  document.body.append(host);
  const view = new SheetView(host, {
    structureBox: (st) => pictures.box(st),
    // made straight away: the picture is taken once, not redrawn when bitmaps are ready
    structureBitmap: (st, scale) => pictures.bitmap(st, Math.abs(scale), true),
    editStructure: () => {},
    key: () => false,
    changed: () => {},
    contextMenu: () => {},
    filterMenu: () => {},
    flash: () => {},
    typing: () => {},
  });
  view.bare = true;
  shared = { host, view };
  return shared;
}

/** How wide a sheet's contents are: its columns up to the last one used, and its charts. */
export function usedWidth(wb: Workbook, colWidth: (c: number) => number): number {
  const sh = wb.sheets[0];
  const left = (c: number) => { let x = 0; for (let i = 0; i < c; i++) x += colWidth(i); return x; };
  const used = sh.usedRange();
  let w = used ? left(used.c2 + 1) : 0;
  for (const ch of sh.charts) w = Math.max(w, left(ch.at.col) + (ch.at.dx ?? 0) + ch.w);
  return w;
}

/**
 * Draw a workbook's first sheet off screen, `w` by `h` pixels, without its headings; `read`
 * gets what it needs from the grid (cell places) before it is let go. The picture is a copy.
 */
function drawSheet<T>(wb: Workbook, size: (view: SheetView) => { w: number; h: number }, read: (view: SheetView) => T): { canvas: HTMLCanvasElement; got: T } {
  const { host, view } = offscreenView();
  const sh = wb.sheets[0];
  // a picture of the cells only (the card has its own copy: the template isn't changed)
  sh.viewOpts = { ...(sh.viewOpts ?? {}), headings: false };
  wb.active = 0;
  drawing = wb;
  view.show(wb);
  const { w, h } = size(view);
  host.style.width = `${Math.round(w)}px`;
  host.style.height = `${Math.round(h)}px`;
  view.draw();
  const got = read(view);
  const src = view.picture;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  out.getContext('2d')?.drawImage(src, 0, 0);
  view.show(null);
  drawing = null;
  // out of the page between pictures, its big canvas let go (drawn at full size again next time)
  src.width = src.height = 0;
  host.remove();
  return { canvas: out, got };
}

/**
 * A spreadsheet template's first sheet, drawn by the grid without its row and column headings,
 * as a picture for a card: as wide as its columns in use and its charts (within limits), and
 * as tall as the card's shape allows.
 */
export function sheetPicture(wb: Workbook): HTMLCanvasElement {
  const { canvas } = drawSheet(wb, (view) => {
    const w = Math.min(SHEET_SHOT.maxW, Math.max(SHEET_SHOT.minW, usedWidth(wb, (c) => view.colWidth(c)) + 6));
    return { w, h: w / SHEET_SHOT.aspect };
  }, () => null);
  canvas.className = 'ft-real-sheet';
  return canvas;
}


/** The comment boxes' width, the room between them and the cells, and their text's line height (CSS pixels at 100%). */
const NOTE = { w: 168, gap: 10, line: 15, pad: 12, side: 200 };

/** A comment box's height for its text (a few characters short of a line wraps). */
function noteHeight(text: string, w: number): number {
  const perLine = Math.max(8, Math.floor((w - NOTE.pad) / 6.4));
  const words = text.split(/\s+/);
  let lines = 1, used = 0;
  for (const word of words) {
    const need = (used ? 1 : 0) + word.length;
    if (used && used + need > perLine) { lines++; used = word.length; } else used += need;
  }
  return lines * NOTE.line + NOTE.pad;
}

/**
 * The top rows of a template (its first `rows` rows), at full size, with a comment box for each
 * worked-out column or cell, much as Excel shows its notes: a thin line from the middle of the
 * cell's nearest edge (its heading, for a column) to a box in the mode's green saying how it is
 * worked out. Column
 * notes sit in a row of boxes above the cells (below them when the headings are lower down),
 * moved along so they don't overlap; notes on single cells go down the right-hand side.
 */
export function sheetCallouts(wb: Workbook, rows: number, notes: Callout[], head = 0): HTMLElement {
  const { canvas, got } = drawSheet(wb, (view) => {
    let h = 0;
    for (let r = 0; r < rows; r++) h += view.rowHeight(r);
    return { w: usedWidth(wb, (c) => view.colWidth(c)) + 2, h: h + 2 };
  }, (view) => notes.map((n) => ({ n, rect: view.cellRect(n.row ?? head, n.col) })));
  const cssW = canvas.width / (devicePixelRatio || 1), cssH = canvas.height / (devicePixelRatio || 1);
  const colNotes = got.filter((g) => g.n.row === undefined && g.rect).sort((a, b) => a.rect!.x - b.rect!.x);
  const cellNotes = got.filter((g) => g.n.row !== undefined && g.rect).sort((a, b) => a.rect!.y - b.rect!.y);
  // column notes in one band, each as near its column as the one before allows
  const band = head === 0 ? 'above' : 'below';
  let right = -Infinity;
  const placed = colNotes.map((g) => {
    const ax = g.rect!.x + g.rect!.w / 2;
    const x = Math.max(0, ax - NOTE.w / 2, right + NOTE.gap);
    right = x + NOTE.w;
    return { g, x, h: noteHeight(g.n.text, NOTE.w) };
  });
  const bandH = placed.length ? Math.max(...placed.map((p) => p.h)) + 2 * NOTE.gap + 8 : 0;
  const top = band === 'above' ? bandH : 0;
  const side = cellNotes.length ? NOTE.side + 24 : 0;
  // side notes go down beside their cells, pushed down when one would overlap the one above
  let below = -Infinity;
  const sided = cellNotes.map((g) => {
    const h = noteHeight(g.n.text, NOTE.side);
    const y = Math.max(top + g.rect!.y - 4, below + 6);
    below = y + h;
    return { g, y, h };
  });
  const width = Math.max(cssW + side, right);
  const height = Math.max(top + cssH + (band === 'below' ? bandH : 0), below + 4);

  const box = document.createElement('div');
  box.className = 'ft-callouts';
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  canvas.className = 'ft-callout-grid';
  Object.assign(canvas.style, { left: '0', top: `${top}px`, width: `${cssW}px`, height: `${cssH}px` });
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  box.append(canvas, svg);
  /** The line from a box to its cell (the middle of the cell's nearest edge), ending in a dot there. */
  const lead = (cx: number, cy: number, bx: number, by: number) => {
    const l = document.createElementNS(svgNs, 'line');
    for (const [k, v] of Object.entries({ x1: cx, y1: cy, x2: bx, y2: by })) l.setAttribute(k, String(v));
    svg.append(l);
    const dot = document.createElementNS(svgNs, 'circle');
    for (const [k, v] of Object.entries({ cx, cy, r: 2.5 })) dot.setAttribute(k, String(v));
    dot.setAttribute('class', 'ft-mark');
    svg.append(dot);
  };
  const note = (text: string, x: number, y: number, w: number) => {
    const d = document.createElement('div');
    d.className = 'ft-note';
    d.textContent = text;
    Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px` });
    box.append(d);
  };
  for (const p of placed) {
    const r = p.g.rect!;
    // to the middle of the heading's top edge (above), or of the column's foot (below), so the
    // line never crosses the cells' text
    const cx = r.x + r.w / 2, cy = band === 'above' ? top + r.y + 1 : top + cssH - 1;
    const y = band === 'above' ? top - NOTE.gap - 8 - p.h : top + cssH + NOTE.gap + 8;
    note(p.g.n.text, p.x, y, NOTE.w);
    // straight up or down to the box where it is over the column
    const bx = Math.min(Math.max(cx, p.x + 10), p.x + NOTE.w - 10);
    lead(cx, cy, bx, band === 'above' ? y + p.h : y);
  }
  for (const sd of sided) {
    const r = sd.g.rect!;
    const x = cssW + 24;
    note(sd.g.n.text, x, sd.y, NOTE.side);
    // to the middle of the cell's right-hand edge
    lead(r.x + r.w - 1, top + r.y + r.h / 2, x, sd.y + Math.min(sd.h / 2, 12));
  }
  return box;
}
