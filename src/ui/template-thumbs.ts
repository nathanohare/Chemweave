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
    structureBox: () => ({ w: 0, h: 0 }),
    structureBitmap: () => null,
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


/** Room for the notes above and below the cells, and their width (CSS pixels at 100%). */
const NOTE = { w: 132, line: 13, tier: 50, gap: 6, side: 190 };

/**
 * The top rows of a template (its first `rows` rows), at full size, with a note for each of its
 * columns or cells: a label with a line to what it describes, in blue for what you type and in
 * the mode's color for what is worked out. Column notes sit above and below in up to two tiers
 * each, so they don't overlap; notes on single cells go down the right-hand side.
 */
export function sheetCallouts(wb: Workbook, rows: number, notes: Callout[]): HTMLElement {
  type Placed = { n: Callout; x: number; y: number; w: number; h: number };
  const { canvas, got } = drawSheet(wb, (view) => {
    let h = 0;
    for (let r = 0; r < rows; r++) h += view.rowHeight(r);
    return { w: usedWidth(wb, (c) => view.colWidth(c)) + 2, h: h + 2 };
  }, (view) => notes.map((n) => ({ n, rect: view.cellRect(n.row ?? 0, n.col) })));
  const cssW = canvas.width / (devicePixelRatio || 1), cssH = canvas.height / (devicePixelRatio || 1);
  const colNotes = got.filter((g) => g.n.row === undefined && g.rect).sort((a, b) => a.rect!.x - b.rect!.x);
  const cellNotes = got.filter((g) => g.n.row !== undefined && g.rect);
  // up to two tiers above and two below; each note in the first tier where it fits beside the last one there
  const tiers: { side: 'above' | 'below'; level: number; right: number }[] = [
    { side: 'above', level: 0, right: -Infinity }, { side: 'below', level: 0, right: -Infinity },
    { side: 'above', level: 1, right: -Infinity }, { side: 'below', level: 1, right: -Infinity },
  ];
  const placed: (Placed & { side: 'above' | 'below'; level: number; ax: number })[] = [];
  for (const g of colNotes) {
    const ax = g.rect!.x + g.rect!.w / 2;
    const x = Math.max(0, ax - NOTE.w / 2);
    const tier = tiers.find((t) => x >= t.right + NOTE.gap) ?? tiers.reduce((a, b) => (a.right <= b.right ? a : b));
    const at = Math.max(x, tier.right + NOTE.gap);
    tier.right = at + NOTE.w;
    placed.push({ n: g.n, x: at, y: 0, w: NOTE.w, h: NOTE.tier - 10, side: tier.side, level: tier.level, ax });
  }
  const above = placed.some((p) => p.side === 'above' && p.level === 1) ? 2 : placed.some((p) => p.side === 'above') ? 1 : 0;
  const below = placed.some((p) => p.side === 'below' && p.level === 1) ? 2 : placed.some((p) => p.side === 'below') ? 1 : 0;
  const top = above * NOTE.tier, side = cellNotes.length ? NOTE.side : 0;
  const width = Math.max(cssW, ...placed.map((p) => p.x + p.w)) + side, height = top + cssH + below * NOTE.tier;

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
  svg.innerHTML = '<defs><marker id="ft-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 8 4 0 8z" fill="context-stroke"/></marker></defs>';
  box.append(canvas, svg);
  const line = (x1: number, y1: number, x2: number, y2: number, calc?: boolean) => {
    const l = document.createElementNS(svgNs, 'line');
    for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) l.setAttribute(k, String(v));
    l.setAttribute('class', calc ? 'ft-calc' : 'ft-input');
    l.setAttribute('marker-end', 'url(#ft-arrow)');
    svg.append(l);
  };
  const label = (n: Callout, x: number, y: number, w: number) => {
    const d = document.createElement('div');
    d.className = `ft-note ${n.calc ? 'ft-calc' : 'ft-input'}`;
    d.textContent = n.text;
    Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px` });
    box.append(d);
    return d;
  };
  for (const p of placed) {
    const y = p.side === 'above' ? top - (p.level + 1) * NOTE.tier : top + cssH + p.level * NOTE.tier + 8;
    label(p.n, p.x, y, p.w).classList.add(p.side === 'below' ? 'ft-below' : 'ft-above');
    // the line runs from the label's edge to the heading (above) or the last row shown (below)
    if (p.side === 'above') line(Math.min(Math.max(p.ax, p.x + 8), p.x + p.w - 8), y + NOTE.tier - 12, p.ax, top + 2, p.n.calc);
    else line(Math.min(Math.max(p.ax, p.x + 8), p.x + p.w - 8), y - 2, p.ax, top + cssH - 2, p.n.calc);
  }
  for (const g of cellNotes) {
    const r = g.rect!;
    const y = top + r.y + r.h / 2;
    label(g.n, cssW + 18, y - 7, NOTE.side - 22).classList.add('ft-side');
    line(cssW + 16, y, r.x + r.w - 2, y, g.n.calc);
  }
  return box;
}
