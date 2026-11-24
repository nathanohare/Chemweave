// The pages of a document on screen: grey around white pages, one under another, scrolled
// with the scroll bars or the mouse wheel and zoomed with Ctrl+wheel. Only the pages in view
// are drawn. Text is drawn by the same layout the PDF and Word files are made from, with the
// fonts' published widths, so what is on screen is what prints.

import type { Rect } from '../geom';
import { PAGE_GAP, type DocLayout, type PageBox, type PlacedObject } from '../document/doc-layout';
import { SHEET_MARGIN, breaksIn, continuous, outlineMarks, type DocViewKind } from '../document/doc-views';
import type { LaidLine } from '../text/layout';
import type { DocFile } from '../document/doc-file';
import { figures } from '../document/doc-file';
import { turnOf } from '../document/arrange';
import { boxTextTop, drawChangeBars, turnAbout, drawDocTable, drawHeaderFooter, drawHfBodies, drawLineNumbers, drawNoteRules, drawPageLook, traceGeo } from '../document/doc-paint';
import { BOX_PAD, SHADOWS, emptyContents, lookOf, styleOf, type DocText } from '../document/document';
import { BREAK_NAMES, sectionsOf } from '../document/sections';
import { drawLayout, drawMarks } from '../text/draw';
import { drawMath } from '../document/math';
import { selectionRects } from '../text/layout';
import { imageFor, onImageReady } from '../render/images';
import { fxCanvas, hasFx, traceShape } from '../render/picture-fx';
import { paintChartBox } from '../render/chart-box-paint';
import { drawParaBorders, drawParaShading } from '../document/para-borders';

/** Grey space round the pages, in pixels. */
const PAD_X = 24;
const PAD_Y = 16;
const SURROUND = '#d5d8de';
/** The space round the pages: the dark theme's colour when the window is dark (main.ts sends it with 'surround-changed'). */
let surround = getComputedStyle(document.documentElement).getPropertyValue('--surround').trim() || SURROUND;
addEventListener('surround-changed', (e) => { surround = (e as CustomEvent<string | null>).detail ?? SURROUND; });
const SELECTION = 'rgba(40, 120, 255, 0.25)';
const OBJECT_FRAME = '#2f6fdf';
/** Header and footer editing's dashed lines and tags (Word's blue). */
const HF_LINE = '#2b6cb0';
/** A figure's area under the pointer: light grey, so its edges show. */
const FIGURE_HOVER = 'rgba(60, 64, 72, 0.08)';
/** 100%: a point of the page is a point on the screen (96 pixels to the inch). */
export const ACTUAL = 96 / 72;

/** What the view draws over the text: selection, caret, underlines, the chosen figure. */
export interface Overlay {
  selection: [number, number] | null;
  caret: { x: number; y1: number; y2: number } | null;
  squiggles: { start: number; end: number; color: string }[];
  /** The figure or picture picked on its own (framed, with a handle to resize it). */
  picked: number | null;
  /** A bibliography picked on its own (framed on every page it is on). */
  framed: number | null;
  /** Found text to show (find and replace). */
  found: [number, number][];
  /** The text box being typed into, and its selection (in the document's coordinates). */
  editing?: { id: number; cell?: boolean; selection: Rect[] } | null;
  /** Text with comments on it, shaded (more strongly for the comment being looked at). */
  comments?: { start: number; end: number; active: boolean }[];
  /** A block of table cells chosen together (dragged across), shaded. */
  cells?: { id: number; r0: number; c0: number; r1: number; c1: number } | null;
  /** More stretches of text selected with the selection (Select Text with Similar Formatting). */
  also?: [number, number][];
  /** A header or footer being typed into (Word's header and footer editing): the rest of the page faded, each page's header and footer marked, and the selection in it. */
  hf?: HfOverlay | null;
  /** The SI Live Preview's marks: the part being worked on, a field's text, the person's own text. */
  marks?: TextMarks | null;
}

/** Marks over the text (character offsets; the end not included). */
export interface TextMarks {
  /** Everything but [start, end) washed out lightly, with a bar in the margin beside it. */
  focus?: { start: number; end: number; bar: string; /** false: the bar alone, nothing washed out */ wash?: boolean } | null;
  /** Stretches shaded. */
  tints?: { start: number; end: number; color: string }[];
  /** Stretches bracketed (or boxed, maybe dashed), the first with a tag above it. */
  brackets?: { start: number; end: number; color: string; label?: string; boxed?: boolean; dashed?: boolean; /** Only the tag, no bracket or box (a tint marks the text). */ tagOnly?: boolean }[];
  /** Stretches flagged: a flag in the margin, and a dotted underline or a fill with a bar in the margin. */
  flagged?: { start: number; end: number; color: string; look: 'underline' | 'fill' }[];
}

/** Header and footer editing as the view shows it. */
export interface HfOverlay {
  page: number;
  kind: 'header' | 'footer';
  selection: Rect[];
  /** Header & Footer > Show Document Text: the document's text faded (or hidden when off). */
  showText: boolean;
}

/** The tags on the lines of each page's header and footer while they are edited: which one it is, and its section. */
export function hfTag(p: PageBox, kind: 'header' | 'footer', sections: number): string {
  const name = kind === 'header' ? 'Header' : 'Footer';
  const which = p.hf.firstPage && p.starts ? 'First Page ' : p.hf.oddEven ? ((p.n ?? p.index + 1) % 2 === 0 ? 'Even Page ' : 'Odd Page ') : '';
  return `${which}${name}${sections > 1 ? ` -Section ${p.section + 1}-` : ''}`;
}

/** Word's pointer for hiding the white space between pages (arrows pointing together) and showing it again (pointing apart). */
const arrowsCursor = (together: boolean) => {
  const a = together ? 'M12 10.5 6.5 4h11z M12 13.5 6.5 20h11z' : 'M12 2.5 6.5 9h11z M12 21.5 6.5 15h11z';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${a}" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 12h18" stroke="#fff" stroke-width="3.5"/><path d="M3 12h18" stroke="#111" stroke-width="1.5"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, row-resize`;
};
export const HIDE_SPACE_CURSOR = arrowsCursor(true);
export const SHOW_SPACE_CURSOR = arrowsCursor(false);

export class DocView {
  readonly canvas: HTMLCanvasElement;
  readonly scroller: HTMLDivElement;
  private space: HTMLDivElement;
  zoom = ACTUAL;
  /** Room kept to the right of the pages, in pixels (for the comments beside them). */
  gutter = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private queued = false;
  file: DocFile | null = null;
  overlay: () => Overlay = () => ({ selection: null, caret: null, squiggles: [], picked: null, found: [], framed: null });
  /** Called after the view scrolls or zooms (the hidden text field follows the caret). */
  onMove: () => void = () => {};
  /** Called when the view changes size or zoom, before it is laid out for it (Web Layout wraps to the window). */
  onResize: () => void = () => {};
  /** Pages in rows of this many (View > Multiple Pages), or 1. */
  perRow = 1;
  /** A figure's area being drawn (Insert > Figure), in the document's points. */
  sketch: Rect | null = null;
  /** Figures proposed for a document's structures (Make Figures' preview): their areas, labelled; those left out greyed. */
  proposals: { rect: Rect; on: boolean; label: string }[] | null = null;
  /** Where each proposal's label was drawn (the document's points), to click. */
  private labels: Rect[] = [];

  /** Where a proposed figure's label is (the document's points), as last drawn. */
  proposalLabel(i: number): Rect | null {
    return this.labels[i] ?? null;
  }
  /** The figure the pointer is over: its area is shaded light grey, to show its edges (on screen only). */
  hover: number | null = null;
  /**
   * A structure being drawn in place on its page: `paint` draws it as it is being drawn (in the
   * page's points, `o` its place) instead of as the document has it, over the rest of the
   * page, which is faded when `fade` (it can't be changed until the drawing is done).
   */
  live: { id: number; fade: boolean; paint(ctx: CanvasRenderingContext2D, o: PlacedObject): void } | null = null;
  /** Table > View Gridlines: faint lines on every table edge with no border (else only in tables with none). */
  gridlines = false;
  /** Home > Show/Hide ¶: spaces, tabs and paragraph ends drawn as marks (on screen only). */
  showMarks = false;
  /** Pages side by side in one row, scrolled across (View > Side to Side, and Read Mode). */
  sideways = false;
  /** Read Mode: only these pages are drawn (the two being read), or all. */
  shownPages: ((index: number) => boolean) | null = null;
  /** Read Mode: the wheel turns the pages two at a time instead of scrolling. */
  turnPages: ((dir: 1 | -1) => void) | null = null;
  private wheelSum = 0;
  /** Outline: where each paragraph's level mark was drawn (to fold a heading by clicking it). */
  private marks: { para: number; x: number; y: number }[] = [];
  /** Hide white space (Word's double-click between pages): each page's top and bottom margins, with its header and footer, left out, the pages' text one under another with a line between. */
  hideSpace = false;
  /** Crop marks at the corners of each page's text (Word's Show crop marks). */
  cropMarks = false;
  /** Hidden white space: where each page's text starts in the scrolled area, in points (the last: where the last page's ends), with the layout it is for. */
  private bands: { lay: DocLayout; y: number[] } | null = null;

  constructor(readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'doc-canvas';
    this.scroller = document.createElement('div');
    this.scroller.className = 'doc-scroll';
    this.space = document.createElement('div');
    this.space.className = 'doc-space';
    this.scroller.append(this.space);
    host.append(this.canvas, this.scroller);
    this.scroller.addEventListener('scroll', () => { this.redraw(); this.onMove(); });
    this.scroller.addEventListener('wheel', (e) => {
      if (this.turnPages && !(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.wheelSum += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (Math.abs(this.wheelSum) >= 60) { this.turnPages(this.wheelSum > 0 ? 1 : -1); this.wheelSum = 0; }
        return;
      }
      // pages side by side: the wheel turns them
      if (this.sideways && !(e.ctrlKey || e.metaKey) && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        this.scroller.scrollLeft += e.deltaY;
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = this.scroller.getBoundingClientRect();
      this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(host);
    onImageReady(() => { if (this.file) this.redraw(); });
  }

  private get layout(): DocLayout | null {
    return this.file ? this.file.layout() : null;
  }

  // ---------------------------------------------------------------- size, scroll and zoom

  /** The view the document is shown in (Print Layout unless another is chosen). */
  get kind(): DocViewKind {
    return this.file?.view.kind ?? 'print';
  }

  /** One long sheet with no pages (Web Layout, Outline, Draft). */
  private get endless(): boolean {
    return continuous(this.kind);
  }

  /** White space is hidden: pages one under another (Print Layout's Vertical). */
  get hiding(): boolean {
    return this.hideSpace && !this.endless && !this.sideways && this.perRow === 1;
  }

  /** Hidden white space: where each page's text starts in the scrolled area (and, last, where the last page's ends). */
  private bandTops(lay: DocLayout): number[] {
    if (this.bands?.lay !== lay) {
      const y = [0];
      for (const p of lay.pages) y.push(y[y.length - 1] + Math.max(0, p.h - p.setup.top - p.setup.bottom));
      this.bands = { lay, y };
    }
    return this.bands.y;
  }

  /** Where a page sits in the scrolled area, in points from the top left of the first (before zooming). */
  place(p: PageBox, lay: DocLayout): { x: number; y: number } {
    if (this.endless) return { x: 0, y: p.top };
    if (this.hiding) return { x: 0, y: this.bandTops(lay)[p.index] - p.setup.top };
    const W = lay.pageW + this.gapX, H = lay.pageH + PAGE_GAP;
    if (this.sideways) return { x: p.index * W, y: 0 };
    if (this.perRow > 1) return { x: (p.index % this.perRow) * W, y: Math.floor(p.index / this.perRow) * H };
    return { x: 0, y: p.top };
  }

  /** The size of everything shown, in points: the pages as arranged, or the long sheet down to its last line. */
  private extent(lay: DocLayout): { w: number; h: number } {
    const n = lay.pages.length;
    const W = lay.pageW + this.gapX, H = lay.pageH + PAGE_GAP;
    if (this.endless) {
      let bottom = 0;
      for (const l of lay.text.lines) bottom = Math.max(bottom, l.y + (l.below ?? l.descent));
      for (const o of lay.objects) bottom = Math.max(bottom, o.y + o.h);
      return { w: lay.pageW, h: bottom + SHEET_MARGIN + 0.5 * Math.max(0, this.scroller.clientHeight / this.zoom) };
    }
    // (the last page's comments have the room sizeSpace keeps beside the pages)
    if (this.sideways) return { w: n * W - this.gapX, h: lay.pageH };
    if (this.perRow > 1) return { w: Math.min(this.perRow, n) * W - this.gapX, h: Math.ceil(n / this.perRow) * H - PAGE_GAP };
    if (this.hiding) return { w: lay.pageW, h: this.bandTops(lay)[n] };
    return { w: lay.pageW, h: lay.pages[n - 1].top + lay.pageH };
  }

  /** More than one page across (Side to Side, Read Mode, Multiple Pages): each has its comments beside it. */
  private get across(): boolean {
    return !this.endless && (this.sideways || this.perRow > 1);
  }

  /** The room between pages side by side, in points: with the comments' column when they show. */
  private get gapX(): number {
    return PAGE_GAP + (this.across ? this.gutter / this.zoom : 0);
  }

  /**
   * How many columns of comments to make room for when fitting n pages across: one for each in
   * Read Mode and Multiple Pages, which show just those pages; Side to Side scrolls across anyway,
   * so the pages aren't made tiny for it.
   */
  private gutters(n: number): number {
    return this.across && (this.turnPages || !this.sideways) ? n : 1;
  }

  /** Whether a page is drawn (Read Mode draws only the two being read). */
  pageShown(index: number): boolean {
    return !this.shownPages || this.shownPages(index);
  }

  /** The page a point of the document (points) is on, by its number. */
  pageIndexAt(y: number): number {
    const lay = this.layout;
    return lay ? this.pageAt(lay, y).index : 0;
  }

  resize(): void {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.onResize();
    this.sizeSpace();
    this.paint();
  }

  /** The scrolled area: every page at this zoom, with grey round them. */
  sizeSpace(): void {
    const lay = this.layout;
    if (!lay) return;
    const e = this.extent(lay);
    const w = e.w * this.zoom + 2 * PAD_X + this.gutter;
    const h = e.h * this.zoom + 2 * PAD_Y;
    const sw = `${Math.ceil(w)}px`, sh = `${Math.ceil(h)}px`;
    if (this.space.style.width !== sw) this.space.style.width = sw;
    if (this.space.style.height !== sh) this.space.style.height = sh;
  }

  /** Left edge of the pages in the scrolled area (they sit in the middle when the window is wider). */
  private get ox(): number {
    const lay = this.layout;
    const pw = (lay ? this.extent(lay).w : 612) * this.zoom;
    return Math.max(PAD_X, (this.scroller.clientWidth - this.gutter - pw) / 2);
  }

  /** Top edge of the pages in the scrolled area (pages side by side sit in the middle when the window is taller). */
  private get oy(): number {
    const lay = this.layout;
    if (!lay || !this.sideways || this.endless) return PAD_Y;
    return Math.max(PAD_Y, (this.scroller.clientHeight - lay.pageH * this.zoom) / 2);
  }

  /** The page a point of the document (points) is on. */
  private pageAt(lay: DocLayout, y: number): PageBox {
    let best = lay.pages[0];
    for (const p of lay.pages) if (p.top <= y) best = p;
    return best;
  }

  /** A point of the document (points) on screen (pixels from the view's top left). */
  toScreen(x: number, y: number): { x: number; y: number } {
    const lay = this.layout;
    const p = lay ? this.pageAt(lay, y) : null;
    const pos = lay && p ? this.place(p, lay) : { x: 0, y: 0 };
    const top = p ? p.top : 0;
    return { x: this.ox + (pos.x + x) * this.zoom - this.scroller.scrollLeft, y: this.oy + (pos.y + y - top) * this.zoom - this.scroller.scrollTop };
  }

  /** A point on screen (client coordinates) in the document: on the page nearest it. */
  toDoc(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.scroller.getBoundingClientRect();
    const vx = (clientX - r.left + this.scroller.scrollLeft - this.ox) / this.zoom;
    const vy = (clientY - r.top + this.scroller.scrollTop - this.oy) / this.zoom;
    const lay = this.layout;
    if (lay && this.hiding) {
      const y = this.bandTops(lay);
      let i = 0;
      while (i < lay.pages.length - 1 && y[i + 1] <= vy) i++;
      const p = lay.pages[i];
      return { x: vx, y: vy - (y[i] - p.setup.top) + p.top };
    }
    if (!lay || this.endless || (!this.sideways && this.perRow === 1)) return { x: vx, y: vy };
    let best = lay.pages[0], dist = Infinity;
    for (const p of lay.pages) {
      const pos = this.place(p, lay);
      const dx = Math.max(pos.x - vx, 0, vx - pos.x - lay.pageW), dy = Math.max(pos.y - vy, 0, vy - pos.y - lay.pageH);
      const d = dx * dx + dy * dy;
      if (d < dist) { dist = d; best = p; }
    }
    const pos = this.place(best, lay);
    return { x: vx - pos.x, y: vy - pos.y + best.top };
  }

  /** The pages and the room beside them are wider than the view. */
  overflows(): boolean {
    const lay = this.layout;
    if (!lay) return false;
    // pages side by side scroll across anyway: what matters is the two in view and their comments
    if (this.sideways) { const n = Math.min(2, lay.pages.length); return n * lay.pageW * this.zoom + this.gutters(n) * this.gutter + 2 * PAD_X > this.scroller.clientWidth; }
    return this.extent(lay).w * this.zoom + 2 * PAD_X + this.gutter > this.scroller.clientWidth;
  }

  /** Web Layout and Outline: the width of the window, in points, for the text to wrap to. */
  sheetWidth(): number {
    return Math.max(1, this.scroller.clientWidth - this.gutter - 2 * PAD_X - 4) / this.zoom;
  }

  /** The pages' width in points. */
  pageWidth(): number {
    return this.layout?.pageW ?? 612;
  }

  /** Where a stretch of the text is, in the document's coordinates (one box per line; `joined`: the boxes of a paragraph's lines meeting). */
  rangeRects(a: number, b: number, joined = false): Rect[] {
    const lay = this.layout;
    return lay && lay.text.lines.length ? selectionRects(lay.text, a, b, joined) : [];
  }

  /** Zoom, keeping the point under `at` (pixels in the view) where it is. */
  setZoom(z: number, at?: { x: number; y: number }): void {
    z = Math.max(0.1, Math.min(6, z));
    const a = at ?? { x: this.scroller.clientWidth / 2, y: this.scroller.clientHeight / 2 };
    const before = { x: (a.x + this.scroller.scrollLeft - this.ox) / this.zoom, y: (a.y + this.scroller.scrollTop - this.oy) / this.zoom };
    this.zoom = z;
    this.onResize();
    this.sizeSpace();
    this.scroller.scrollLeft = before.x * z + this.ox - a.x;
    this.scroller.scrollTop = before.y * z + this.oy - a.y;
    this.paint();
    this.onMove();
  }

  /** Zoom so a page's width (or the row of pages') fills the window. */
  fitWidth(): void {
    const lay = this.layout;
    if (!lay) return;
    const n = !this.across ? 1 : Math.min(this.sideways ? 2 : this.perRow, lay.pages.length);
    const w = this.across ? n * lay.pageW + (n - 1) * PAGE_GAP : this.extent(lay).w;
    // a column of comments beside each page across
    this.setZoom((this.scroller.clientWidth - 2 * PAD_X - 16 - this.gutters(n) * this.gutter) / w);
  }

  /** Zoom so whole pages show: one (One Page), or a row of them (Multiple Pages, Side to Side: two). */
  fitPages(): void {
    const lay = this.layout;
    if (!lay) return;
    const n = this.sideways ? Math.min(2, lay.pages.length) : Math.min(this.perRow, lay.pages.length);
    const w = n * lay.pageW + (n - 1) * PAGE_GAP;
    const kx = (this.scroller.clientWidth - 2 * PAD_X - this.gutters(n) * this.gutter - (this.sideways ? 0 : 16)) / w;
    const ky = (this.scroller.clientHeight - 2 * PAD_Y - (this.sideways ? 16 : 0)) / lay.pageH;
    this.setZoom(Math.min(kx, ky));
  }

  /** Scroll so a part of the document (points) is in view. */
  reveal(r: Rect, margin = 24): void {
    const s = this.scroller;
    const lay = this.layout;
    const p = lay ? this.pageAt(lay, r.y1) : null;
    const pos = lay && p ? this.place(p, lay) : { x: 0, y: 0 };
    const dy = pos.y - (p?.top ?? 0);
    const top = this.oy + (r.y1 + dy) * this.zoom, bottom = this.oy + (r.y2 + dy) * this.zoom;
    if (top - margin < s.scrollTop) s.scrollTop = Math.max(0, top - margin);
    else if (bottom + margin > s.scrollTop + s.clientHeight) s.scrollTop = bottom + margin - s.clientHeight;
    const left = this.ox + (pos.x + r.x1) * this.zoom, right = this.ox + (pos.x + r.x2) * this.zoom;
    if (left - margin < s.scrollLeft) s.scrollLeft = Math.max(0, left - margin);
    else if (right + margin > s.scrollLeft + s.clientWidth) s.scrollLeft = right + margin - s.clientWidth;
  }

  /** Scroll so a part of the document is at the top of the window (going to a heading). */
  revealTop(r: Rect, margin = 24): void {
    const lay = this.layout;
    const p = lay ? this.pageAt(lay, r.y1) : null;
    const pos = lay && p ? this.place(p, lay) : { x: 0, y: 0 };
    const dy = pos.y - (p?.top ?? 0);
    this.scroller.scrollTop = Math.max(0, this.oy + (r.y1 + dy) * this.zoom - margin);
    this.reveal(r, margin);
  }

  /** Scroll to the top of a page (pages side by side: its left edge). */
  scrollToPage(i: number): void {
    const lay = this.layout;
    if (!lay) return;
    const p = lay.pages[Math.max(0, Math.min(lay.pages.length - 1, i))];
    const pos = this.place(p, lay);
    this.scroller.scrollTop = pos.y * this.zoom;
    if (this.sideways || this.perRow > 1) this.scroller.scrollLeft = pos.x * this.zoom + (this.sideways ? this.ox - PAD_X : 0);
  }

  /** The page in the middle of the view (for "Page 3 of 12"); pages side by side: the first one wholly in view. */
  currentPage(): number {
    const lay = this.layout;
    if (!lay) return 0;
    const k = this.zoom;
    if (this.sideways) {
      const left = (this.scroller.scrollLeft - this.ox) / k;
      for (const p of lay.pages) if (this.place(p, lay).x >= left - 1) return p.index;
      return lay.pages.length - 1;
    }
    const mx = (this.scroller.scrollLeft + this.scroller.clientWidth / 2 - this.ox) / k;
    const my = (this.scroller.scrollTop + this.scroller.clientHeight / 2 - this.oy) / k;
    if (this.endless) return this.pageAt(lay, my).index;
    let best = 0, dist = Infinity;
    for (const p of lay.pages) {
      const pos = this.place(p, lay);
      const dx = Math.max(pos.x - mx, 0, mx - pos.x - lay.pageW), dy = Math.max(pos.y - my, 0, my - pos.y - lay.pageH);
      if (dx * dx + dy * dy < dist) { dist = dx * dx + dy * dy; best = p.index; }
    }
    return best;
  }

  /** The pages in view (pages side by side: those wholly or mostly in view). */
  pagesInView(): number[] {
    const lay = this.layout;
    if (!lay) return [];
    const k = this.zoom, sl = this.scroller.scrollLeft, w = this.scroller.clientWidth;
    return lay.pages.filter((p) => {
      const x = this.ox + this.place(p, lay).x * k - sl;
      return x + lay.pageW * k * 0.5 > 0 && x + lay.pageW * k * 0.5 < w;
    }).map((p) => p.index);
  }

  /** Outline view: the paragraph whose level mark is under a point (client coordinates), if any. */
  markAt(clientX: number, clientY: number): number | null {
    if (this.kind !== 'outline') return null;
    const p = this.toDoc(clientX, clientY);
    const r = 7 / Math.max(this.zoom, 0.5);
    for (const m of this.marks) if (Math.abs(p.x - m.x) <= r && Math.abs(p.y - m.y) <= r) return m.para;
    return null;
  }

  // ---------------------------------------------------------------- drawing

  redraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.paint();
    });
  }

  paint(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    // the scrolled area follows the pages, however they changed (fonts or pictures arriving after the file opened)
    this.sizeSpace();
    const d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const endless = this.endless;
    // the views without pages are white right across
    ctx.fillStyle = endless ? '#fff' : surround;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const file = this.file;
    const lay = this.layout;
    if (!file || !lay) return;
    const t = file.t;
    const k = this.zoom;
    const ox = this.ox - this.scroller.scrollLeft, oy = this.oy - this.scroller.scrollTop;
    const ov = this.overlay();
    // each page drawn where it is placed (one under another, in rows, or side by side)
    const at = (p: PageBox) => {
      const pos = this.place(p, lay);
      ctx.setTransform(d * k, 0, 0, d * k, d * (ox + pos.x * k), d * (oy + (pos.y - p.top) * k));
    };
    const visible = lay.pages.filter((p) => {
      const pos = this.place(p, lay);
      const x = ox + pos.x * k, y = oy + pos.y * k;
      return x < this.w && x + lay.pageW * k > 0 && y < this.h && y + lay.pageH * k > 0 && this.pageShown(p.index);
    });
    ctx.fontKerning = 'none';
    const hiding = this.hiding;
    // hidden white space: only the page's text area shows
    const band = (p: PageBox) => {
      if (!hiding) return false;
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x - 1, p.top + p.setup.top, p.w + 2, Math.max(0, p.h - p.setup.top - p.setup.bottom));
      ctx.clip();
      return true;
    };
    if (!endless) for (const p of visible) { at(p); const c = band(p); this.paper(ctx, p, lay); if (c) ctx.restore(); }
    for (const p of visible) {
      at(p);
      const clipped = band(p);
      if (!endless) { drawHeaderFooter(ctx, t, p); drawHfBodies(ctx, t, lay, p.index, (o) => this.object(ctx, t, o, lay)); drawLineNumbers(ctx, lay, p.index, '#555'); drawChangeBars(ctx, lay, p.index); }
      drawParaShading(ctx, lay.frames, p.index);
      // the found text and the selection, under the text
      const from = lay.text.lines[p.first]?.start ?? 0;
      const to = p.end > p.first ? lay.text.lines[p.end - 1].end : from;
      const inPage = (a: number, b: number) => b >= from && a <= to;
      for (const c of ov.comments ?? []) {
        if (!inPage(c.start, c.end)) continue;
        ctx.fillStyle = c.active ? 'rgba(232, 160, 40, 0.42)' : 'rgba(240, 190, 90, 0.22)';
        for (const r of rectsOn(lay, p, c.start, c.end)) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
      ctx.fillStyle = 'rgba(255, 200, 0, 0.45)';
      for (const [a, b] of ov.found) if (inPage(a, b)) for (const r of rectsOn(lay, p, a, b)) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      if (ov.also) {
        ctx.fillStyle = SELECTION;
        for (const [a, b] of ov.also) if (inPage(a, b)) for (const r of rectsOn(lay, p, a, b)) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
      if (ov.selection && inPage(...ov.selection)) {
        ctx.fillStyle = SELECTION;
        for (const r of rectsOn(lay, p, ...ov.selection)) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
      // figures behind the text first, then the text, then the rest
      for (const o of lay.objects) if (o.page === p.index && o.wrap === 'behind') this.object(ctx, t, o, lay);
      drawLayout(ctx, lay.text, 0, 0, p.first, p.end);
      if (this.showMarks) drawMarks(ctx, lay.text, 0, 0, p.first, p.end);
      drawNoteRules(ctx, lay, p.index);
      drawParaBorders(ctx, lay.frames, p.index);
      // tables, then the figures (some of them in table cells)
      // (a table in a cell after the table holding it)
      const tabs = lay.objects.filter((o) => o.page === p.index && t.objects[o.id]?.kind === 'table').sort((a, b) => (lay.tables.get(a.id)?.depth ?? 0) - (lay.tables.get(b.id)?.depth ?? 0));
      for (const o of tabs) {
        const obj = t.objects[o.id];
        const tb = lay.tables.get(o.id);
        if (obj?.kind === 'table' && tb) drawDocTable(ctx, obj.table, tb, p.index, { color: '#9fb4d8', px: 1 / k, always: this.gridlines }, t.tableStyles, this.showMarks);
      }
      for (const o of lay.objects) if (o.page === p.index && o.wrap !== 'behind' && t.objects[o.id]?.kind !== 'table') this.object(ctx, t, o, lay);
      const px = 1 / k;
      // a structure drawn in place: over the page (faded, as it can't be changed meanwhile)
      const live = this.live;
      if (live) {
        if (live.fade && !endless) { ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; ctx.fillRect(p.x, p.top, p.w, p.h); }
        const lo = lay.objects.find((o) => o.id === live.id);
        if (lo && lo.page === p.index) live.paint(ctx, lo);
      }
      for (const s of ov.squiggles) {
        if (!inPage(s.start, s.end)) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.1 * px;
        for (const r of rectsOn(lay, p, s.start, s.end)) squiggle(ctx, r, px);
      }
      if (ov.marks) drawMarksOn(ctx, lay, p, ov.marks, px);
      if (clipped) ctx.restore();
    }
    if (hiding) this.joins(ctx, visible, at);
    if (ov.hf && !endless) this.hfMarks(ctx, t, lay, visible, at, ov.hf);
    if (endless) {
      at(lay.pages[0]);
      if (this.kind === 'draft') this.breaks(ctx, t, lay);
      if (this.kind === 'outline') this.outline(ctx, t, lay);
    }
    const onPageOf = (o: PlacedObject) => at(lay.pages[o.page] ?? lay.pages[0]);
    // the picked figure's frame and handle
    if (ov.picked !== null && ov.picked !== this.live?.id) {
      const o = lay.objects.find((x) => x.id === ov.picked);
      if (o) {
        onPageOf(o);
        const px = 1 / k;
        ctx.strokeStyle = OBJECT_FRAME;
        ctx.lineWidth = 1.2 * px;
        // a structure picked shows only its handles (no box round it); other things their frame too
        const obj = t.objects[o.id];
        const structure = obj?.kind === 'drawing' && !obj.frame;
        if (obj?.kind !== 'drawing') ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#fff';
        const hs = 7 * px;
        const corners = structure ? [[o.x, o.y], [o.x + o.w, o.y], [o.x, o.y + o.h], [o.x + o.w, o.y + o.h]] : [[o.x + o.w, o.y + o.h]];
        for (const [x, y] of corners) { ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs); ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs); }
      }
    }
    if (this.sketch) {
      const r = this.sketch;
      at(this.pageAt(lay, r.y1));
      ctx.strokeStyle = OBJECT_FRAME;
      ctx.lineWidth = 1.2 / k;
      ctx.setLineDash([5 / k, 4 / k]);
      ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      ctx.setLineDash([]);
    }
    this.labels = [];
    if (this.proposals) {
      ctx.save();
      ctx.font = `600 ${11 / k}px system-ui, sans-serif`;
      this.proposals.forEach((pr, i) => {
        const r = pr.rect;
        at(this.pageAt(lay, r.y1));
        const colour = pr.on ? OBJECT_FRAME : '#9aa0aa';
        if (pr.on) { ctx.fillStyle = 'rgba(47, 111, 223, 0.06)'; ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1); }
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.4 / k;
        ctx.setLineDash(pr.on ? [6 / k, 4 / k] : [2 / k, 3 / k]);
        ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
        ctx.setLineDash([]);
        // its corner handles (its edges drag too)
        if (pr.on) {
          const hs = 6 / k;
          ctx.fillStyle = '#fff';
          for (const [x, y] of [[r.x1, r.y1], [r.x2, r.y1], [r.x1, r.y2], [r.x2, r.y2]]) { ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs); ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs); }
        }
        // the label above it: click it to leave the figure out (or put it back)
        const text = pr.on ? pr.label : `${pr.label} (left out)`;
        const w = ctx.measureText(text).width + 12 / k, h = 17 / k;
        const lb = { x1: r.x1, y1: r.y1 - h - 3 / k, x2: r.x1 + w, y2: r.y1 - 3 / k };
        ctx.fillStyle = colour;
        ctx.fillRect(lb.x1, lb.y1, w, h);
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, lb.x1 + 6 / k, lb.y1 + h / 2);
        this.labels[i] = lb;
      });
      ctx.restore();
    }
    if (ov.framed !== null) {
      ctx.strokeStyle = OBJECT_FRAME;
      ctx.lineWidth = 1.2 / k;
      for (const o of lay.objects) if (o.id === ov.framed) { onPageOf(o); ctx.strokeRect(o.x - 2, o.y - 1, o.w + 4, o.h + 2); }
    }
    if (ov.cells) {
      const tb = lay.tables.get(ov.cells.id);
      const b = ov.cells;
      ctx.fillStyle = SELECTION;
      if (tb) for (let r = b.r0; r <= b.r1; r++) {
        const row = tb.rows[r];
        if (!row) continue;
        at(lay.pages[row.page] ?? lay.pages[0]);
        ctx.fillRect(row.x + tb.xs[b.c0], row.y, tb.xs[b.c1 + 1] - tb.xs[b.c0], tb.hs[r]);
      }
    }
    if (ov.editing) {
      const o = lay.objects.find((x) => x.id === ov.editing!.id);
      if (o) {
        onPageOf(o);
        ctx.fillStyle = SELECTION;
        for (const r of ov.editing.selection) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
      if (o && !ov.editing.cell) {
        ctx.strokeStyle = OBJECT_FRAME;
        ctx.lineWidth = 1 / k;
        ctx.setLineDash([4 / k, 3 / k]);
        ctx.strokeRect(o.x - 1.5 / k, o.y - 1.5 / k, o.w + 3 / k, o.h + 3 / k);
        ctx.setLineDash([]);
      }
    }
    if (ov.caret) {
      at(this.pageAt(lay, ov.caret.y1));
      ctx.fillStyle = '#000';
      ctx.fillRect(ov.caret.x - 0.6 / k, ov.caret.y1, 1.2 / k, ov.caret.y2 - ov.caret.y1);
    }
  }

  /** Draft: a dotted line, labelled, where a page or column break is. */
  private breaks(ctx: CanvasRenderingContext2D, t: DocText, lay: DocLayout): void {
    const k = this.zoom;
    for (const b of breaksIn(t)) {
      const top = lay.paraTops[b.para];
      if (!top) continue;
      const y = top.y - 5;
      ctx.strokeStyle = '#8a8f98';
      ctx.lineWidth = 1 / k;
      ctx.setLineDash([2 / k, 2 / k]);
      ctx.beginPath();
      ctx.moveTo(SHEET_MARGIN, y);
      ctx.lineTo(lay.pageW - SHEET_MARGIN, y);
      // a section break is a double dotted line, as in Word
      const section = b.kind !== 'page' && b.kind !== 'column';
      if (section) { ctx.moveTo(SHEET_MARGIN, y + 2.5 / k); ctx.lineTo(lay.pageW - SHEET_MARGIN, y + 2.5 / k); }
      ctx.stroke();
      ctx.setLineDash([]);
      const label = b.kind === 'page' ? 'Page Break' : b.kind === 'column' ? 'Column Break' : `Section Break (${BREAK_NAMES[b.kind]})`;
      ctx.font = `${9 / Math.max(k / ACTUAL, 0.6)}px Arial, sans-serif`;
      const w = ctx.measureText(label).width + 8 / k;
      ctx.fillStyle = '#fff';
      ctx.fillRect(lay.pageW / 2 - w / 2, y - 6 / k, w, 12 / k);
      ctx.fillStyle = '#6b7079';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lay.pageW / 2, y);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /** Outline: each paragraph's mark at its left (⊕ a heading with text under it, ⊖ one without, a dot for body text), a grey line under a folded heading. */
  private outline(ctx: CanvasRenderingContext2D, t: DocText, lay: DocLayout): void {
    const o = this.file?.view.outline;
    this.marks = [];
    if (!o) return;
    const k = this.zoom;
    const firstLine = new Map<number, LaidLine>();
    for (const l of lay.text.lines) if (!firstLine.has(l.para)) firstLine.set(l.para, l);
    ctx.lineWidth = 1 / k;
    for (const m of outlineMarks(t, o)) {
      const l = firstLine.get(m.para);
      if (!l) continue;
      const r = Math.min(4.5, Math.max(3, l.size * 0.3));
      const x = l.left - 9 - r, y = l.y - l.ascent * 0.38;
      this.marks.push({ para: m.para, x, y });
      ctx.strokeStyle = '#5b6170';
      ctx.fillStyle = '#5b6170';
      if (m.kind === 'body') {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.55, y);
      ctx.lineTo(x + r * 0.55, y);
      if (m.kind !== 'empty') { ctx.moveTo(x, y - r * 0.55); ctx.lineTo(x, y + r * 0.55); }
      ctx.stroke();
      if (m.kind === 'folded') {
        ctx.strokeStyle = '#9aa0aa';
        ctx.lineWidth = 1.5 / k;
        ctx.beginPath();
        ctx.moveTo(l.x, l.y + l.descent + 2);
        ctx.lineTo(l.x + Math.max(l.width, 24), l.y + l.descent + 2);
        ctx.stroke();
        ctx.lineWidth = 1 / k;
      }
    }
  }

  /** A white page with its shadow, and faint corner marks where the text area starts and ends (crop marks, when shown). */
  private paper(ctx: CanvasRenderingContext2D, p: PageBox, _lay: DocLayout): void {
    const k = this.zoom;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowBlur = 4 * this.dpr;
    ctx.shadowOffsetY = 1 * this.dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.x, p.top, p.w, p.h);
    ctx.restore();
    // Design > Page Color, Watermark and Page Borders
    if (this.file) drawPageLook(ctx, this.file.t, p);
    const pg = p.setup;
    const x1 = p.x + pg.left, x2 = p.x + p.w - pg.right, y1 = p.top + pg.top, y2 = p.top + p.h - pg.bottom;
    if (!this.cropMarks || this.hiding) return;
    const m = 12;
    ctx.strokeStyle = '#c4c8cf';
    ctx.lineWidth = 0.8 / k;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[x1, y1, -1, -1], [x2, y1, 1, -1], [x1, y2, -1, 1], [x2, y2, 1, 1]] as const) {
      ctx.moveTo(x + sx * m, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * m);
    }
    ctx.stroke();
  }

  /**
   * Hidden white space: a grey line where one page's text ends and the next one's starts and,
   * with crop marks shown, a mark at each side of the text across it, the same above and below.
   */
  private joins(ctx: CanvasRenderingContext2D, visible: PageBox[], at: (p: PageBox) => void): void {
    const k = this.zoom;
    for (const p of visible) {
      if (p.index === 0) continue;
      at(p);
      const y = p.top + p.setup.top;
      ctx.strokeStyle = '#8a8f98';
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
      ctx.stroke();
      if (!this.cropMarks) continue;
      const m = 12;
      ctx.strokeStyle = '#c4c8cf';
      ctx.lineWidth = 0.8 / k;
      ctx.beginPath();
      for (const x of [p.x + p.setup.left, p.x + p.w - p.setup.right]) { ctx.moveTo(x, y - m); ctx.lineTo(x, y + m); }
      ctx.stroke();
    }
  }

  /**
   * Header and footer editing, as in Word: each page's text faded (or hidden, with Show Document
   * Text off), a dashed line under each header and over each footer with its name on a tag, and
   * "Same as Previous" on those a section takes from the one before.
   */
  private hfMarks(ctx: CanvasRenderingContext2D, t: DocText, lay: DocLayout, visible: PageBox[], at: (p: PageBox) => void, hf: HfOverlay): void {
    const k = this.zoom;
    const secs = sectionsOf(t);
    const size = Math.min(10, styleOf(t, undefined).size);
    const accent = HF_LINE;
    for (const p of visible) {
      at(p);
      const placed = (kind: 'header' | 'footer') => lay.hfs.find((h) => h.page === p.index && h.kind === kind)?.whole.box;
      const hb = placed('header'), fb = placed('footer');
      const yh = Math.max(hb ? hb.y2 : p.top + p.setup.header + size * 1.25, p.top + p.setup.header + size) + 3;
      const yf = Math.min(fb ? fb.y1 : p.top + p.h - p.setup.footer - size * 1.2, p.top + p.h - p.setup.footer - size) - 3;
      // the page's own text faded, or hidden
      ctx.fillStyle = hf.showText ? 'rgba(255, 255, 255, 0.55)' : '#fff';
      ctx.fillRect(p.x, yh, p.w, Math.max(0, yf - yh));
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1 / k;
      ctx.setLineDash([3 / k, 2 / k]);
      ctx.beginPath();
      ctx.moveTo(p.x, yh); ctx.lineTo(p.x + p.w, yh);
      ctx.moveTo(p.x, yf); ctx.lineTo(p.x + p.w, yf);
      ctx.stroke();
      ctx.setLineDash([]);
      const linked = secs[p.section]?.linked;
      ctx.font = `600 ${10.5 / k}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      const tag = (text: string, x: number, y: number, below: boolean, right = false) => {
        const w = ctx.measureText(text).width + 12 / k, h = 17 / k;
        const x1 = right ? x - w : x, y1 = below ? y : y - h;
        ctx.fillStyle = accent;
        ctx.fillRect(x1, y1, w, h);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, x1 + 6 / k, y1 + h / 2);
      };
      const left = p.x + p.setup.left - 2 / k, right = p.x + p.w - p.setup.right + 2 / k;
      tag(hfTag(p, 'header', secs.length), left, yh, true);
      tag(hfTag(p, 'footer', secs.length), left, yf, false);
      if (linked) { tag('Same as Previous', right, yh, true, true); tag('Same as Previous', right, yf, false, true); }
      if (p.index === hf.page && hf.selection.length) {
        ctx.fillStyle = SELECTION;
        for (const r of hf.selection) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
    }
  }

  /**
   * Header and footer editing: the header or footer of the page at a point (client
   * coordinates), when it is in the page's top or bottom margin (above or below its text).
   */
  hfAt(clientX: number, clientY: number): { page: number; kind: 'header' | 'footer' } | null {
    const lay = this.layout;
    if (!lay || this.endless || this.hiding) return null;
    const d = this.toDoc(clientX, clientY);
    const p = this.pageAt(lay, d.y);
    if (!p || d.x < p.x || d.x > p.x + p.w || d.y < p.top || d.y > p.top + p.h) return null;
    if (d.y < p.top + p.setup.top) return { page: p.index, kind: 'header' };
    if (d.y > p.top + p.h - p.setup.bottom) return { page: p.index, kind: 'footer' };
    return null;
  }

  /**
   * Hide white space: whether a point (client coordinates) is where a double-click hides the
   * white space (in the grey between two pages, a little into either) or shows it again (on the
   * line between pages' text), in Print Layout with pages one under another.
   */
  spaceAt(clientX: number, clientY: number): 'hide' | 'show' | null {
    const lay = this.layout;
    if (!lay || this.endless || this.sideways || this.perRow !== 1 || lay.pages.length < 2) return null;
    const r = this.scroller.getBoundingClientRect();
    const k = this.zoom;
    const vx = (clientX - r.left + this.scroller.scrollLeft - this.ox) / k;
    const vy = (clientY - r.top + this.scroller.scrollTop - this.oy) / k;
    if (vx < 0 || vx > lay.pageW) return null;
    const near = 4 / k;
    if (this.hiding) {
      const y = this.bandTops(lay);
      for (let i = 1; i < lay.pages.length; i++) if (Math.abs(vy - y[i]) <= near) return 'show';
      return null;
    }
    for (let i = 1; i < lay.pages.length; i++) {
      const a = lay.pages[i - 1], b = lay.pages[i];
      if (vy >= a.top + a.h - near && vy <= b.top + near) return 'hide';
    }
    return null;
  }

  private object(ctx: CanvasRenderingContext2D, t: DocText, o: PlacedObject, lay: DocLayout): void {
    // the structure being drawn in place is painted over the page as it is drawn
    if (this.live?.id === o.id) return;
    // a picture turned or flipped (Arrange > Rotate) is drawn so about its middle
    const turn = turnOf(t.objects[o.id]);
    if (!turn) { this.objectBody(ctx, t, o, lay); return; }
    ctx.save();
    turnAbout(ctx, o, turn);
    this.objectBody(ctx, t, o, lay);
    ctx.restore();
  }

  private objectBody(ctx: CanvasRenderingContext2D, t: DocText, o: PlacedObject, lay: DocLayout): void {
    const obj = t.objects[o.id];
    if (!obj) return;
    const look = lookOf(obj);
    // a picture changed in Picture Format (cut to a shape, background out) casts its own shadow
    const own = obj.kind === 'picture' && !obj.chart && hasFx(obj.fx);
    if (look?.shadow && !own) {
      // a shadow is a box's: the figure sits on white, and the white casts it
      const s = SHADOWS[look.shadow];
      const k = this.zoom * this.dpr;
      ctx.save();
      ctx.shadowColor = `rgba(0, 0, 0, ${s.alpha})`;
      ctx.shadowBlur = s.blur * k;
      ctx.shadowOffsetX = ctx.shadowOffsetY = s.off * k;
      ctx.fillStyle = '#fff';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.restore();
    }
    if (obj.kind === 'note') {
      const n = lay.notes.get(o.id);
      if (n) drawLayout(ctx, n.lay, 0, 0);
      return;
    }
    if (obj.kind === 'textbox') {
      if (obj.fill) {
        ctx.fillStyle = obj.fill;
        if (obj.geo) { ctx.beginPath(); traceGeo(ctx, obj.geo, o); ctx.fill(); } else ctx.fillRect(o.x, o.y, o.w, o.h);
      }
      const bl = lay.boxes.get(o.id);
      if (bl) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(o.x, o.y, o.w, o.h);
        ctx.clip();
        drawLayout(ctx, bl, o.x + BOX_PAD.x, boxTextTop(obj, o, bl));
        if (this.showMarks) drawMarks(ctx, bl, o.x + BOX_PAD.x, boxTextTop(obj, o, bl));
        ctx.restore();
      }
    } else if (obj.kind === 'math') {
      const m = lay.maths.get(o.id);
      if (m) drawMath(ctx, m, o.x, o.y + m.ascent, m.family, m.color);
    } else this.figure(ctx, t, o);
    if (look?.frame) {
      ctx.strokeStyle = look.frameColor ?? '#000';
      ctx.lineWidth = look.frame;
      ctx.beginPath();
      if (obj.kind === 'textbox' && obj.geo) traceGeo(ctx, obj.geo, o, true);
      else if (!(obj.kind === 'picture' && obj.fx?.shape && traceShape(ctx, obj.fx.shape, o.x, o.y, o.w, o.h))) ctx.rect(o.x, o.y, o.w, o.h);
      ctx.stroke();
    }
  }

  private figure(ctx: CanvasRenderingContext2D, t: DocText, o: PlacedObject): void {
    const obj = t.objects[o.id];
    if (!obj) return;
    if (obj.kind === 'drawing' && obj.frame) {
      // a figure: its area shaded when the pointer is over it, and an empty one outlined faintly (neither is printed)
      const fr = obj.frame, k = o.w / Math.max(1e-6, fr.w), px = 1 / this.zoom;
      if (this.hover === o.id) { ctx.fillStyle = FIGURE_HOVER; ctx.fillRect(o.x, o.y, o.w, o.h); }
      if (emptyContents(obj.contents)) {
        ctx.save();
        ctx.strokeStyle = '#b4b9c2';
        ctx.lineWidth = px;
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.restore();
        return;
      }
      const pic = figures.record(obj.contents, t.drawingStyle).pic;
      const bmp = pic && figures.bitmap(obj.contents, t.drawingStyle, k * this.zoom * this.dpr, true);
      if (pic && bmp) {
        const b = pic.box;
        ctx.drawImage(bmp, o.x + (b.x1 - fr.x) * k, o.y + (b.y1 - fr.y) * k, (b.x2 - b.x1) * k, (b.y2 - b.y1) * k);
      }
    } else if (obj.kind === 'drawing') {
      const bmp = figures.bitmap(obj.contents, t.drawingStyle, (o.w / Math.max(1, figures.size(obj.contents, t.drawingStyle).w)) * this.zoom * this.dpr, true);
      if (bmp) ctx.drawImage(bmp, o.x, o.y, o.w, o.h);
    } else if (obj.kind === 'picture' && obj.chart) {
      // a chart is drawn from its data, sharp at any zoom
      paintChartBox(ctx, obj.chart, o.x, o.y, o.w, o.h);
    } else if (obj.kind === 'picture') {
      // pictures (EMF spectra from MestReNova too) are decoded once, shared with the drawings
      const img = fxCanvas(obj) ?? imageFor(obj.src);
      const look = obj.look;
      if (img) {
        ctx.save();
        if (look?.shadow && hasFx(obj.fx)) {
          const s = SHADOWS[look.shadow], k = this.zoom * this.dpr;
          ctx.shadowColor = `rgba(0, 0, 0, ${s.alpha})`;
          ctx.shadowBlur = s.blur * k;
          ctx.shadowOffsetX = ctx.shadowOffsetY = s.off * k;
        }
        const c = obj.crop ?? { l: 0, t: 0, r: 0, b: 0 };
        const iw = (img as HTMLImageElement).naturalWidth || img.width, ih = (img as HTMLImageElement).naturalHeight || img.height;
        ctx.drawImage(img, c.l * iw, c.t * ih, Math.max(1e-3, (1 - c.l - c.r) * iw), Math.max(1e-3, (1 - c.t - c.b) * ih), o.x, o.y, o.w, o.h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#eceef2';
        ctx.fillRect(o.x, o.y, o.w, o.h);
      }
    }
  }
}

/** Rectangles covering text on one page (only that page's lines are looked at). */
/** The SI Live Preview's marks on one page (in the page's points). */
function drawMarksOn(ctx: CanvasRenderingContext2D, lay: DocLayout, p: PageBox, m: TextMarks, px: number): void {
  const left = p.x + p.setup.left;
  if (m.focus) {
    const rs = rectsOn(lay, p, m.focus.start, m.focus.end);
    const wash = m.focus.wash !== false;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    if (!rs.length) { if (wash) ctx.fillRect(p.x, p.top, p.w, p.h); }
    else {
      const y1 = Math.min(...rs.map((r) => r.y1)) - 4, y2 = Math.max(...rs.map((r) => r.y2)) + 4;
      if (wash) {
        ctx.fillRect(p.x, p.top, p.w, Math.max(0, y1 - p.top));
        ctx.fillRect(p.x, y2, p.w, Math.max(0, p.top + p.h - y2));
      }
      ctx.fillStyle = m.focus.bar;
      ctx.fillRect(left - 10, y1, 2.2, y2 - y1);
    }
  }
  for (const t of m.tints ?? []) {
    ctx.fillStyle = t.color;
    // (a paragraph's lines meet: one stretch, no stripes between them)
    for (const r of rectsOn(lay, p, t.start, t.end, true)) ctx.fillRect(r.x1 - 0.5, r.y1, r.x2 - r.x1 + 1, r.y2 - r.y1);
  }
  for (const b of m.brackets ?? []) {
    const rs = rectsOn(lay, p, b.start, b.end);
    if (!rs.length) continue;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash(b.dashed ? [3 * px, 2 * px] : []);
    if (b.tagOnly) { /* (the text is tinted: only its tag) */ } else if (b.boxed) for (const r of rs) ctx.strokeRect(r.x1 - 1, r.y1, r.x2 - r.x1 + 2, r.y2 - r.y1);
    else {
      // (Word's content-control look: a bracket at each end)
      const f = rs[0], l = rs[rs.length - 1], w = 3;
      ctx.beginPath();
      ctx.moveTo(f.x1 - 1 + w, f.y1); ctx.lineTo(f.x1 - 1, f.y1); ctx.lineTo(f.x1 - 1, f.y2); ctx.lineTo(f.x1 - 1 + w, f.y2);
      ctx.moveTo(l.x2 + 1 - w, l.y1); ctx.lineTo(l.x2 + 1, l.y1); ctx.lineTo(l.x2 + 1, l.y2); ctx.lineTo(l.x2 + 1 - w, l.y2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // the tag above the first line, only on the page where it starts
    if (b.label && rectsOn(lay, p, b.start, b.start + 1).length) {
      const f = rs[0];
      const size = 7 * Math.max(1, px * 1.3);
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      const w = ctx.measureText(b.label).width + 4, h = size + 2.5;
      ctx.fillStyle = b.color;
      ctx.fillRect(f.x1 - 1, f.y1 - h, w, h);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, f.x1 + 1, f.y1 - h / 2 + 0.3);
    }
  }
  for (const f of m.flagged ?? []) {
    const rs = rectsOn(lay, p, f.start, f.end);
    if (!rs.length) continue;
    ctx.fillStyle = f.color;
    ctx.strokeStyle = f.color;
    if (f.look === 'fill') {
      ctx.save();
      ctx.globalAlpha = 0.28;
      for (const r of rs) ctx.fillRect(r.x1 - 0.5, r.y1, r.x2 - r.x1 + 1, r.y2 - r.y1);
      ctx.restore();
      ctx.fillRect(left - 4, Math.min(...rs.map((r) => r.y1)), 1.6, Math.max(...rs.map((r) => r.y2)) - Math.min(...rs.map((r) => r.y1)));
    } else {
      ctx.lineWidth = 0.9;
      ctx.setLineDash([1, 1.4]);
      for (const r of rs) { ctx.beginPath(); ctx.moveTo(r.x1, r.y2 - 0.3); ctx.lineTo(r.x2, r.y2 - 0.3); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // a flag in the margin where it starts
    if (rectsOn(lay, p, f.start, f.start + 1).length) {
      const y = rs[0].y1, x = left - 16;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + 9, y); ctx.lineTo(x + 6.5, y + 2.6); ctx.lineTo(x + 9, y + 5.2); ctx.lineTo(x + 1, y + 5.2); ctx.lineTo(x + 1, y + 9); ctx.lineTo(x, y + 9);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function rectsOn(lay: DocLayout, p: PageBox, a: number, b: number, joined = false): Rect[] {
  const sub = { ...lay.text, lines: lay.text.lines.slice(p.first, p.end) };
  if (!sub.lines.length) return [];
  return selectionRects(sub, a, b, joined);
}

function squiggle(ctx: CanvasRenderingContext2D, r: Rect, px: number): void {
  const y = r.y2 - (r.y2 - r.y1) * 0.12;
  const step = 2 * px;
  ctx.beginPath();
  for (let x = r.x1, k = 0; x <= r.x2 + 1e-9; x += step, k++) {
    const yy = y + (k % 2 ? step * 0.6 : 0);
    if (k) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
  }
  ctx.stroke();
}

