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
import { SheetView } from './sheet-view';

/** A document's first page, as an SVG the size of the card's picture (its text in the page's own proportion). */
export function docPage(t: DocText): HTMLElement {
  const box = document.createElement('div');
  box.className = 'ft-real-page';
  const f = new DocFile(t);
  const pages = recordPages(f.t, f.printLayout(), (c, style) => figures.record(c, style).pic);
  const p = pages[0];
  if (!p) return box;
  const x = p.origin?.x ?? 0, y = p.origin?.y ?? 0;
  box.innerHTML = itemsToSvg(p.items, { x1: x, y1: y, x2: x + p.w, y2: y + p.h });
  const svg = box.firstElementChild as SVGSVGElement | null;
  // sized by the card (the viewBox keeps the page's shape); the text is drawn at the page's scale
  svg?.removeAttribute('width');
  svg?.removeAttribute('height');
  box.style.aspectRatio = `${p.w} / ${p.h}`;
  return box;
}

/** The shape of a card's picture (width over height), and the narrowest and widest part of a sheet drawn for one, in CSS pixels at 100%. */
export const SHEET_SHOT = { aspect: 1.4, minW: 420, maxW: 960 };

let shared: { host: HTMLDivElement; view: SheetView } | null = null;

/** One grid, off screen, that draws each template in turn. */
function offscreenView(): { host: HTMLDivElement; view: SheetView } {
  if (shared) return shared;
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
 * A spreadsheet template's first sheet, drawn by the grid without its row and column headings,
 * as a picture for a card: as wide as its columns in use and its charts (within limits), and
 * as tall as the card's shape allows.
 */
export function sheetPicture(wb: Workbook): HTMLCanvasElement {
  const { host, view } = offscreenView();
  const sh = wb.sheets[0];
  // a picture of the cells only (the card has its own copy: the template isn't changed)
  sh.viewOpts = { ...(sh.viewOpts ?? {}), headings: false };
  wb.active = 0;
  view.show(wb);
  const w = Math.round(Math.min(SHEET_SHOT.maxW, Math.max(SHEET_SHOT.minW, usedWidth(wb, (c) => view.colWidth(c)) + 6)));
  host.style.width = `${w}px`;
  host.style.height = `${Math.round(w / SHEET_SHOT.aspect)}px`;
  view.draw();
  const src = view.picture;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  out.getContext('2d')?.drawImage(src, 0, 0);
  out.className = 'ft-real-sheet';
  view.show(null);
  return out;
}
