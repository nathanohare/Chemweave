// Drawing a document's pages for print: the same layout the screen shows (text, header and
// footer, page numbers, figures and pictures), recorded as shapes and text so the PDF keeps
// lines and letters sharp and puts every character where it is on screen.

import type { Item } from '../render/vector';
import { VectorContext } from '../render/vector';
import type { Picture } from '../render/picture';
import type { Contents } from '../model';
import type { DocStyle } from '../style';
import { drawLayout, drawMarks } from '../text/draw';
import { BOX_PAD, SHADOWS, borderRect, lookOf, styleOf, watermarkPlace, type DocText, type HeaderFooter, type NumberPlace, type PageBorder, type Watermark } from './document';
import { withStack, type TextLayout } from '../text/layout';
import { geoDef, moveSteps, traceSteps } from '../design/geo';
import type { DocLayout, PageBox, PlacedObject, TableBox } from './doc-layout';
import { boxTextTop } from './doc-layout';
import type { BorderLine, TableData } from '../model';
import { coveringCell, rowSpanOf, spanOf } from '../table';
import { DEFAULT_MARGINS, hasLines, resolveTable, strokeOf, type TableStyleDef } from './table-styles';
import { docMeasure } from './doc-file';
import { fontKind, publishedAdvances } from '../text/font-measure';
import { drawMath } from './math';
import { fxSrc, hasFx, traceShape } from '../render/picture-fx';
import { drawParaBorders, drawParaShading } from './para-borders';
import { hfKeyFor, numbersFor, zonesFor } from './hf-bodies';
import { turnOf } from './arrange';
import type { PdfHeading, PdfLink } from '../io/pdf';
import type { TextRun } from '../model';
import { linkKind, linkSpans, type LinkSpan } from '../links';
import { bookmarkPara } from './bookmarks';
import { tocEntries } from './toc';

/** One piece of a header or footer line: its text, where it goes, and its font. */
export interface HfPart { where: 'header' | 'footer'; align: 'left' | 'center' | 'right'; text: string; font: string; size: number; w: number }

const PLACES: Record<Exclude<NumberPlace, 'none'>, ['header' | 'footer', 'left' | 'center' | 'right']> = {
  'header-left': ['header', 'left'], 'header-center': ['header', 'center'], 'header-right': ['header', 'right'],
  'footer-left': ['footer', 'left'], 'footer-center': ['footer', 'center'], 'footer-right': ['footer', 'right'],
};

/** The header and footer text of a page, with its number put in its place (after any text there). `hf` is the page's section's (the document's when left out). */
export function headerFooterText(t: DocText, label: string, hf: HeaderFooter = t.hf, page: { starts?: boolean; n?: number } = {}): HfPart[] {
  const st = styleOf(t, undefined);
  const font = st.font, size = Math.min(10, st.size);
  const out: HfPart[] = [];
  const aligns = ['left', 'center', 'right'] as const;
  for (const w of ['header', 'footer'] as const) {
    // the first page's or an even page's own, or the usual one; one with pictures or tables is drawn apart
    const key = hfKeyFor(hf, w, !!page.starts, page.n ?? 1);
    if (hf.bodies?.[key]) continue;
    const numbers = numbersFor(hf, key);
    const where = numbers !== 'none' ? PLACES[numbers] : null;
    const zones = zonesFor(hf, key);
    aligns.forEach((a, i) => {
      let text = zones[i] ?? '';
      if (where && where[0] === w && where[1] === a && label) text = text ? `${text} ${label}` : label;
      if (!text) return;
      out.push({ where: w, align: a, text, font, size, w: docMeasure(text, size, font, '') });
    });
  }
  return out;
}

/** Draw a page's header and footer (the page's top left corner is at `p.x`, `p.top`), in its section's margins. */
export function drawHeaderFooter(ctx: CanvasRenderingContext2D, t: DocText, p: PageBox): void {
  const pg = p.setup;
  for (const part of headerFooterText(t, p.label, p.hf, p)) {
    const y = part.where === 'header' ? p.top + pg.header + part.size * 0.8 : p.top + p.h - pg.footer - part.size * 0.25;
    const x = p.x + (part.align === 'left' ? pg.left : part.align === 'center' ? (pg.left + p.w - pg.right) / 2 - part.w / 2 : p.w - pg.right - part.w);
    ctx.font = `${part.size}px ${part.font}`;
    ctx.fillStyle = '#000';
    ctx.fillText(part.text, x, y);
  }
}

/**
 * Draw a page's headers and footers that have pictures, tables or formatted text: their text,
 * their tables, then their pictures (`object` draws one, as the page's own figures are drawn).
 */
export function drawHfBodies(ctx: CanvasRenderingContext2D, t: DocText, lay: DocLayout, page: number, object: (o: PlacedObject) => void): void {
  for (const h of lay.hfs) {
    if (h.page !== page) continue;
    for (const l of h.texts) drawLayout(ctx, l, 0, 0);
    for (const { id, tb } of h.tables) {
      const o = t.objects[id];
      if (o?.kind === 'table') drawDocTable(ctx, o.table, tb, page, null, t.tableStyles);
    }
    for (const o of h.objects) object(o);
  }
}

/** A colour mixed part of the way into another (`k` 0: the first, 1: the second). */
function mix(a: string, b: string, k: number): string {
  const rgb = (c: string) => { const h = c.replace('#', ''); const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0'); return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0); };
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

/**
 * Design > Page Color, Watermark and Page Borders on a page (its top left corner at `p.x`,
 * `p.top`), under the text. The watermark is as Word lays one out: in the middle of the
 * margins, as big as fits, corner to corner (turned 45°) or straight across.
 */
export function drawPageLook(ctx: CanvasRenderingContext2D, t: DocText, p: PageBox): void {
  if (t.pageColor) {
    ctx.fillStyle = t.pageColor;
    ctx.fillRect(p.x, p.top, p.w, p.h);
  }
  if (t.watermark?.text) drawWatermark(ctx, t.watermark, p, t.pageColor ?? '#ffffff');
  if (p.border) drawPageBorder(ctx, p.border, p);
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: Watermark, p: PageBox, paper: string): void {
  const at = watermarkPlace(w, p, docMeasure);
  ctx.save();
  ctx.translate(at.cx, at.cy);
  if (at.angle) ctx.rotate(at.angle);
  ctx.font = `bold ${at.size}px ${withStack(w.font)}`;
  // semitransparent: half way into the paper (printed pages can't be see-through)
  ctx.fillStyle = w.faded ? mix(w.color, paper, 0.5) : w.color;
  ctx.fillText(w.text, -at.width / 2, at.size * 0.35);
  ctx.restore();
}

function drawPageBorder(ctx: CanvasRenderingContext2D, b: PageBorder, p: PageBox): void {
  const r = borderRect(b, p);
  ctx.save();
  ctx.strokeStyle = b.color;
  ctx.lineCap = b.style === 'dotted' ? 'round' : 'butt';
  const box = (inset: number, lw: number) => { ctx.lineWidth = lw; ctx.strokeRect(r.x + inset, r.y + inset, r.w - 2 * inset, r.h - 2 * inset); };
  if (b.style === 'double') { box(-b.width, b.width * 0.6); box(b.width, b.width * 0.6); }
  else if (b.style === 'thick') { box(-b.width * 0.6, b.width * 1.4); box(b.width * 1.2, Math.max(0.25, b.width * 0.4)); }
  else {
    if (b.style === 'dotted') ctx.setLineDash([0.01, b.width * 2.5]);
    if (b.style === 'dashed') ctx.setLineDash([b.width * 4, b.width * 2.5]);
    box(0, b.width);
  }
  ctx.restore();
}

/** Draw a page's line numbers (Layout > Line Numbers), in grey on screen and black in print. */
export function drawLineNumbers(ctx: CanvasRenderingContext2D, lay: DocLayout, page: number, color = '#000'): void {
  ctx.fillStyle = color;
  for (const n of lay.lineNums) {
    if (n.page !== page) continue;
    ctx.font = `${n.size}px ${n.family}`;
    ctx.fillText(n.text, n.x, n.y);
  }
}

/** Turn a canvas about a figure's middle: `rot` degrees clockwise, flipped across or up and down. */
export function turnAbout(ctx: CanvasRenderingContext2D, o: { x: number; y: number; w: number; h: number }, turn: { rot: number; flipH: boolean; flipV: boolean }): void {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  ctx.translate(cx, cy);
  if (turn.rot) ctx.rotate((turn.rot * Math.PI) / 180);
  if (turn.flipH || turn.flipV) ctx.scale(turn.flipH ? -1 : 1, turn.flipV ? -1 : 1);
  ctx.translate(-cx, -cy);
}

/** The smallest box holding these points. */
const boxOf = (ps: { x: number; y: number }[]) => ({
  x1: Math.min(...ps.map((p) => p.x)), y1: Math.min(...ps.map((p) => p.y)), x2: Math.max(...ps.map((p) => p.x)), y2: Math.max(...ps.map((p) => p.y)),
});

/** A figure's drawn items turned and flipped about its middle, as `turnAbout` turns a canvas. */
export function turnItems(items: Item[], o: { x: number; y: number; w: number; h: number }, turn: { rot: number; flipH: boolean; flipV: boolean }): Item[] {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  const a = (turn.rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const sx = turn.flipH ? -1 : 1, sy = turn.flipV ? -1 : 1;
  const at = (x: number, y: number) => {
    const dx = (x - cx) * sx, dy = (y - cy) * sy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  const mirrored = turn.flipH !== turn.flipV;
  return items.map((one): Item => {
    // a clip rectangle turned with it: the box round its turned corners (the same rectangle when turned a quarter at a time)
    const c = one.clip;
    const it = c ? { ...one, clip: boxOf([at(c.x1, c.y1), at(c.x2, c.y1), at(c.x2, c.y2), at(c.x1, c.y2)]) } : one;
    if (it.kind === 'path') {
      return { ...it, segs: it.segs.map((s) => {
        if (s.k === 'Z') return s;
        const p = at(s.x, s.y);
        if (s.k !== 'C') return { k: s.k, ...p };
        const p1 = at(s.x1, s.y1), p2 = at(s.x2, s.y2);
        return { k: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, ...p };
      }) };
    }
    if (it.kind === 'image') {
      const m = at(it.x + it.w / 2, it.y + it.h / 2);
      const own = it.rot ?? 0;
      const rot = ((((mirrored ? -own : own) + turn.rot) % 360) + 360) % 360;
      const { rot: _r, flipH: _h, flipV: _v, ...rest } = it;
      const flipH = !!it.flipH !== turn.flipH, flipV = !!it.flipV !== turn.flipV;
      return { ...rest, x: m.x - it.w / 2, y: m.y - it.h / 2, ...(rot ? { rot } : {}), ...(flipH ? { flipH } : {}), ...(flipV ? { flipV } : {}) };
    }
    // words are turned with the figure but read the right way round (a PDF can't mirror them)
    const p = at(it.x, it.y);
    const { angle: _a, ...rest } = it;
    if (!mirrored) {
      const angle = ((((it.angle ?? 0) - turn.rot) % 360) + 360) % 360;
      return { ...rest, ...p, ...(angle ? { angle } : {}) };
    }
    // mirrored, the screen's words cover a box from their start along their (mirrored) way and
    // across to the other side of their line: upright words put to cover the same box. Flipped
    // across (Flip Horizontal) they read back from the far end; flipped over (Flip Vertical)
    // they stand on the far side of the line, about a capital's height across.
    const own = ((it.angle ?? 0) * Math.PI) / 180;
    const W = it.widths.reduce((x, w) => x + w, 0);
    const way = { x: Math.cos(own), y: -Math.sin(own) }, up = { x: -Math.sin(own), y: -Math.cos(own) };
    const map = (d: { x: number; y: number }) => { const q = at(it.x + d.x, it.y + d.y); return { x: q.x - p.x, y: q.y - p.y }; };
    const u = map(way), v = map(up);
    const cap = 0.7 * it.size;
    const across = turn.flipH;
    const start = across ? { x: p.x + W * u.x, y: p.y + W * u.y } : { x: p.x + cap * v.x, y: p.y + cap * v.y };
    const dir = across ? { x: -u.x, y: -u.y } : u;
    const angle = ((Math.round(((Math.atan2(-dir.y, dir.x) * 180) / Math.PI) * 1e6) / 1e6 % 360) + 360) % 360;
    return { ...rest, ...start, ...(angle ? { angle } : {}) };
  });
}

/** The bars in the left margin by lines with tracked changes: grey in All Markup, red in Simple Markup (as Word's). */
export function drawChangeBars(ctx: CanvasRenderingContext2D, lay: DocLayout, page: number): void {
  for (const b of lay.changeBars) {
    if (b.page !== page) continue;
    ctx.fillStyle = b.simple ? '#c00000' : '#808080';
    ctx.fillRect(b.x - 0.5, b.y1, 1, b.y2 - b.y1);
  }
}

/** The short lines above a page's footnotes and above the endnotes (half a point, as Word's). */
export function drawNoteRules(ctx: CanvasRenderingContext2D, lay: DocLayout, page: number): void {
  ctx.fillStyle = '#000';
  for (const r of lay.noteRules) if (r.page === page) ctx.fillRect(r.x, r.y - 0.25, r.w, 0.5);
}

/** A page for a PDF: its size, and what is drawn on it with the page's top left corner at `origin`; its links and the headings on it. */
export interface PrintPage { w: number; h: number; items: Item[]; origin: { x: number; y: number }; links?: PdfLink[]; outline?: PdfHeading[] }

/**
 * Where a link in the document goes in its PDF: a place in it (a bookmark, a heading a contents
 * line names) as its page and how far down it is, a web page or e-mail address as it is; null
 * for a file on this computer (a PDF reader opening files is left out) or a place that's gone.
 */
export function pdfTarget(t: DocText, lay: DocLayout, link: string): Pick<PdfLink, 'uri' | 'to'> | null {
  if (link.startsWith('#')) {
    const para = bookmarkPara(t, link.slice(1));
    const top = para >= 0 ? lay.paraTops[para] : undefined;
    const page = top ? lay.pages[top.page] : undefined;
    return top && page ? { to: { page: top.page, y: Math.max(0, top.y - page.top - 6) } } : null;
  }
  const kind = linkKind(link);
  return kind === 'web' || kind === 'doi' || kind === 'mail' ? { uri: link } : null;
}

/**
 * The links in laid-out text drawn at (ox, oy): one box for each stretch of a line with one link,
 * from the text's own links (`runs`) and from shown text that links (a contents line).
 */
export function layoutLinks(lay: TextLayout, runs: TextRun[] | LinkSpan[], ox: number, oy: number, from = 0, to = lay.lines.length): { x: number; y: number; w: number; h: number; link: string }[] {
  // (spans worked out once for a whole document's pages: pass them in place of its runs)
  const spans = runs.length && 'end' in runs[0] && 'link' in runs[0] && !('text' in runs[0]) ? (runs as LinkSpan[]) : linkSpans(runs as TextRun[]);
  const out: { x: number; y: number; w: number; h: number; link: string }[] = [];
  const shown = lay.lines.slice(from, to).some((l) => l.pieces.some((g) => g.link));
  if (!spans.length && !shown) return out;
  // (spans are in order and don't overlap: found by halving)
  const linkOf = (at: number): string | undefined => {
    let lo = 0, hi = spans.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, sp = spans[mid];
      if (sp.end <= at) lo = mid + 1; else if (sp.start > at) hi = mid - 1; else return sp.link;
    }
    return undefined;
  };
  for (let i = from; i < to; i++) {
    const l = lay.lines[i];
    if (!l) break;
    let last: (typeof out)[number] | null = null;
    for (const g of l.pieces) {
      if (g.hidden || !g.w) continue;
      const link = g.link ?? (g.decor || (g.obj !== undefined && g.shown === undefined) ? undefined : linkOf(g.start));
      if (!link) { last = null; continue; }
      const top = oy + l.y - l.ascent, h = l.ascent + l.descent;
      if (last && last.link === link && Math.abs(last.x + last.w - (ox + g.x)) < 1) last.w = ox + g.x + g.w - last.x;
      else { last = { x: ox + g.x, y: top, w: g.w, h, link }; out.push(last); }
    }
  }
  return out;
}

/** A page's links for its PDF: in the body's text, its text boxes, its footnotes and endnotes, and its tables' cells. */
function pageLinks(t: DocText, lay: DocLayout, p: PageBox, spans: LinkSpan[]): PdfLink[] {
  const found = layoutLinks(lay.text, spans, 0, 0, p.first, p.end);
  for (const o of lay.objects) {
    const obj = t.objects[o.id];
    if (o.page !== p.index || obj?.kind !== 'textbox') continue;
    const bl = lay.boxes.get(o.id);
    if (bl) found.push(...layoutLinks(bl, obj.runs, o.x + BOX_PAD.x, boxTextTop(obj, o, bl)));
  }
  // (a note's lines are laid out in place)
  for (const n of lay.notes.values()) {
    const obj = t.objects[n.id];
    if (n.page === p.index && obj?.kind === 'note') found.push(...layoutLinks(n.lay, obj.runs, 0, 0));
  }
  // each cell where drawDocTable draws it
  for (const [id, tb] of lay.tables) {
    const obj = t.objects[id];
    if (obj?.kind !== 'table') continue;
    tb.rows.forEach((at, r) => {
      if (at.page !== p.index) return;
      tb.cells[r]?.forEach((cl, c) => {
        const cell = obj.table.rows[r]?.[c];
        if (!cl || !cell) return;
        const m = tb.pads[r]?.[c] ?? DEFAULT_MARGINS;
        found.push(...layoutLinks(cl, cell.runs, at.x + tb.xs[c] + m.left, at.y + m.top + tb.drop[r][c] - cl.box.y1));
      });
    });
  }
  const out: PdfLink[] = [];
  for (const f of found) {
    const go = pdfTarget(t, lay, f.link);
    if (go) out.push({ x: f.x, y: f.y, w: f.w, h: f.h, ...go });
  }
  return out;
}

/** The headings (Heading 1 to 9) starting on each page, for the PDF's outline. */
function headingsByPage(t: DocText, lay: DocLayout): Map<number, PdfHeading[]> {
  const out = new Map<number, PdfHeading[]>();
  for (const e of tocEntries(t, 9)) {
    const top = lay.paraTops[e.para];
    const page = top ? lay.pages[top.page] : undefined;
    if (!top || !page) continue;
    const list = out.get(top.page) ?? [];
    list.push({ title: e.num ? `${e.num} ${e.text}` : e.text, level: e.level, y: Math.max(0, top.y - page.top - 6) });
    out.set(top.page, list);
  }
  return out;
}

/**
 * Every page of a document as shapes and text. `drawing` records a structure or table (its
 * picture's own coordinates and the box it shows); each is scaled into the place it has on
 * its page.
 */
export function recordPages(t: DocText, lay: DocLayout, drawing: (c: Contents, style: DocStyle) => Picture | null): PrintPage[] {
  const width = (ch: string, size: number, family: string, bold: boolean, italic: boolean) =>
    docMeasure(ch, size, family, `${italic ? 'italic ' : ''}${bold ? 'bold' : ''}`);
  // (Times New Roman, Arial and their stand-ins: letter by letter, kerned as laid out)
  const advances = (text: string, size: number, family: string, bold: boolean, italic: boolean) => {
    const kind = fontKind(family);
    return kind ? publishedAdvances(text, size, kind, bold, italic) : null;
  };
  const heads = headingsByPage(t, lay);
  const spans = linkSpans(t.runs);
  return lay.pages.map((p) => {
    const ctx = new VectorContext(width, advances);
    const c = ctx as unknown as CanvasRenderingContext2D;
    drawPageLook(c, t, p);
    drawHeaderFooter(c, t, p);
    drawLineNumbers(c, lay, p.index);
    drawChangeBars(c, lay, p.index);
    drawParaShading(c, lay.frames, p.index);
    // figures behind the text first
    // tables go under the figures in their cells
    // (a table in a cell after the table holding it)
    const depth = (id: number) => (t.objects[id]?.kind === 'table' ? lay.tables.get(id)?.depth ?? 0 : 1e9);
    const mine = lay.objects.filter((o) => o.page === p.index).sort((a, b) => depth(a.id) - depth(b.id));
    const order = [...mine.filter((o) => o.wrap === 'behind'), null, ...mine.filter((o) => o.wrap !== 'behind')];
    const drawObject = (o: PlacedObject) => {
      const obj = t.objects[o.id];
      if (obj?.kind === 'note') {
        const n = lay.notes.get(o.id);
        if (n) drawLayout(c, n.lay, 0, 0);
        return;
      }
      const look = lookOf(obj);
      // a picture cut to a shape has the shape's outline for its shadow and frame
      const cut = obj?.kind === 'picture' ? obj.fx?.shape : undefined;
      const outline = (dx: number) => {
        c.beginPath();
        if (obj?.kind === 'textbox' && obj.geo) traceGeo(c, obj.geo, { x: o.x + dx, y: o.y + dx, w: o.w, h: o.h }, dx === 0);
        else if (!cut || !traceShape(c, cut, o.x + dx, o.y + dx, o.w, o.h)) c.rect(o.x + dx, o.y + dx, o.w, o.h);
      };
      if (look?.shadow) {
        // a PDF has no blur: the shadow is a grey box, lighter when soft
        const s = SHADOWS[look.shadow];
        c.fillStyle = look.shadow === 'soft' ? '#c9c9c9' : '#8c8c8c';
        outline(s.off);
        c.fill();
        if (!(obj?.kind === 'picture' && hasFx(obj.fx))) {
          c.fillStyle = '#fff';
          c.fillRect(o.x, o.y, o.w, o.h);
        }
      }
      if (obj?.kind === 'table') {
        const tb = lay.tables.get(o.id);
        if (tb) drawDocTable(c, obj.table, tb, p.index, null, t.tableStyles);
      } else if (obj?.kind === 'textbox') {
        if (obj.fill) { c.fillStyle = obj.fill; if (obj.geo) { c.beginPath(); traceGeo(c, obj.geo, o); c.fill(); } else c.fillRect(o.x, o.y, o.w, o.h); }
        const bl = lay.boxes.get(o.id);
        if (bl) drawLayout(c, bl, o.x + BOX_PAD.x, boxTextTop(obj, o, bl));
      } else if (obj?.kind === 'math') {
        const m = lay.maths.get(o.id);
        if (m) drawMath(c, m, o.x, o.y + m.ascent, m.family, m.color);
      } else if (obj?.kind === 'picture') ctx.items.push({ kind: 'image', src: fxSrc(obj) ?? obj.src, x: o.x, y: o.y, w: o.w, h: o.h, px: obj.px, ...(obj.crop ? { crop: obj.crop } : {}), ...(obj.rot ? { rot: obj.rot } : {}), ...(obj.flipH ? { flipH: true } : {}), ...(obj.flipV ? { flipV: true } : {}) });
      else if (obj?.kind === 'drawing') {
        const drawn = drawing(obj.contents, t.drawingStyle);
        // a figure's area is what fills its place (its structures where they are in it; nothing of the area itself is printed)
        const fr = obj.frame;
        const pic = drawn && fr ? { ...drawn, box: { x1: fr.x, y1: fr.y, x2: fr.x + fr.w, y2: fr.y + fr.h } } : drawn;
        const turn = turnOf(obj);
        if (pic) ctx.items.push(...(turn ? turnItems(placeItems(pic, o), o, turn) : placeItems(pic, o)));
      }
      if (look?.frame) {
        c.strokeStyle = look.frameColor ?? '#000';
        c.lineWidth = look.frame;
        outline(0);
        c.stroke();
      }
    };
    drawHfBodies(c, t, lay, p.index, drawObject);
    for (const o of order) {
      if (!o) { drawLayout(c, lay.text, 0, 0, p.first, p.end); drawNoteRules(c, lay, p.index); drawParaBorders(c, lay.frames, p.index); continue; }
      drawObject(o);
    }
    const links = pageLinks(t, lay, p, spans);
    const outline = heads.get(p.index);
    return { w: p.w, h: p.h, items: ctx.items, origin: { x: p.x, y: p.top }, ...(links.length ? { links } : {}), ...(outline ? { outline } : {}) };
  });
}

/**
 * A shape's outline (Insert > Shapes in a document) filling its place; with `lines`, its
 * details drawn as lines only too (a cylinder's rim), for stroking.
 */
export function traceGeo(ctx: Parameters<typeof traceSteps>[0], geo: string, at: { x: number; y: number; w: number; h: number }, lines = false): void {
  const out = geoDef(geo).draw(at.w, at.h);
  traceSteps(ctx, moveSteps(out.body, at.x, at.y));
  if (lines && out.lines) traceSteps(ctx, moveSteps(out.lines, at.x, at.y));
}

// (boxTextTop lives with the layout, so typing into a box (doc-file.ts) and drawing it agree)
export { boxTextTop };

/** A recorded picture's shapes and text scaled and moved to fill a box. */
export function placeItems(pic: Picture, at: { x: number; y: number; w: number; h: number }): Item[] {
  const b = pic.box;
  const kx = at.w / Math.max(1e-9, b.x2 - b.x1), ky = at.h / Math.max(1e-9, b.y2 - b.y1);
  const k = Math.min(kx, ky);
  const X = (x: number) => at.x + (x - b.x1) * kx;
  const Y = (y: number) => at.y + (y - b.y1) * ky;
  return pic.items.map((one): Item => {
    const c = one.clip;
    const it = c ? { ...one, clip: { x1: X(c.x1), y1: Y(c.y1), x2: X(c.x2), y2: Y(c.y2) } } : one;
    if (it.kind === 'text') return { ...it, x: X(it.x), y: Y(it.y), size: it.size * k, widths: it.widths.map((w) => w * k), ...(it.stroke ? { stroke: it.stroke * k } : {}) };
    if (it.kind === 'image') return { ...it, x: X(it.x), y: Y(it.y), w: it.w * kx, h: it.h * ky };
    return {
      ...it,
      ...(it.stroke ? { stroke: { ...it.stroke, width: it.stroke.width * k } } : {}),
      segs: it.segs.map((s) => (s.k === 'Z' ? s : s.k === 'C'
        ? { k: 'C', x1: X(s.x1), y1: Y(s.y1), x2: X(s.x2), y2: Y(s.y2), x: X(s.x), y: Y(s.y) }
        : { k: s.k, x: X(s.x), y: Y(s.y) })),
    };
  });
}


/**
 * Draw the rows of a table that are on one page: cell shading, cell text, then the lines.
 * `faint` (the screen only) is the colour for gridlines where no line is drawn, so the cells
 * can be seen while typing (always, or only in a table with no lines at all); leave it null to
 * draw none (print). `kept` is the document's own table styles.
 */
export function drawDocTable(ctx: CanvasRenderingContext2D, t: TableData, tb: TableBox, page: number, faint: { color: string; px: number; always?: boolean } | null, kept?: Record<string, TableStyleDef>, marks = false): void {
  const n = t.cols.length;
  const rows = tb.rows.map((at, r) => ({ ...at, r })).filter((at) => at.page === page);
  if (!rows.length) return;
  const res = resolveTable(t, kept);
  // shading under everything (a merged cell's in each row it covers)
  for (const { r, x, y } of rows) {
    for (let c = 0; c < n; c++) {
      const o = coveringCell(t, r, c);
      const fill = res.fill[o.r]?.[o.c];
      if (!fill || o.c !== c) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x + tb.xs[c], y, tb.xs[c + spanOf(t, o.r, o.c)] - tb.xs[c], tb.hs[r]);
    }
  }
  for (const { r, x, y } of rows) {
    tb.cells[r]?.forEach((cl, c) => {
      const m = tb.pads[r]?.[c] ?? DEFAULT_MARGINS;
      if (!cl) return;
      // a row of an exact height cuts off the text that doesn't fit in it (as Word does)
      const down = rowSpanOf(t, r, c);
      const cut = !!t.rowH?.[r + down - 1]?.exact;
      if (cut) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + tb.xs[c], y, tb.xs[c + spanOf(t, r, c)] - tb.xs[c], tb.hs.slice(r, r + down).reduce((a, b) => a + b, 0));
        ctx.clip();
      }
      drawLayout(ctx, cl, x + tb.xs[c] + m.left, y + m.top + tb.drop[r][c] - cl.box.y1);
      if (marks) drawMarks(ctx, cl, x + tb.xs[c] + m.left, y + m.top + tb.drop[r][c] - cl.box.y1, 0, cl.lines.length, true);
      if (cut) ctx.restore();
    });
  }
  const lines: { x1: number; y1: number; x2: number; y2: number; e: BorderLine | null }[] = [];
  const showFaint = !!faint && (faint.always || !hasLines(res));
  const add = (x1: number, y1: number, x2: number, y2: number, e: BorderLine | null) => {
    if (!e && !showFaint) return;
    // joined to the line before when it carries straight on in the same look
    const last = lines[lines.length - 1];
    if (last && last.x2 === x1 && last.y2 === y1 && (last.y1 === last.y2) === (y1 === y2) && sameLine(last.e, e)) {
      last.x2 = x2; last.y2 = y2;
      return;
    }
    lines.push({ x1, y1, x2, y2, e });
  };
  const same = (a: { r: number; c: number }, b: { r: number; c: number }) => a.r === b.r && a.c === b.c;
  // inside a merged cell: no line, not even a faint one
  const insideH = (r: number, c: number) => r > 0 && r < t.rows.length && same(coveringCell(t, r - 1, c), coveringCell(t, r, c));
  rows.forEach(({ r, x, y }, i) => {
    const h = tb.hs[r];
    // the top of each row; on a page the table carries on to, the table's own top line where the row has none
    for (let c = 0; c < n; c++) {
      let e = res.h[r][c];
      if (i === 0 && r > 0 && !e) e = res.h[0][c];
      if (!e && insideH(r, c)) continue;
      add(x + tb.xs[c], y, x + tb.xs[c + 1], y, e);
    }
    // the bottom: the next row draws its top, unless it is on another page (or this is the last)
    const next = rows[i + 1];
    if (!next || next.r !== r + 1) {
      const last = r === t.rows.length - 1;
      for (let c = 0; c < n; c++) {
        let e = res.h[r + 1][c];
        if (!last && !e) e = res.h[t.rows.length][c];
        if (!e && insideH(r + 1, c)) continue;
        add(x + tb.xs[c], y + h, x + tb.xs[c + 1], y + h, e);
      }
    }
    for (let c = 0; c <= n; c++) {
      const e = res.v[r][c];
      if (c > 0 && c < n && same(coveringCell(t, r, c - 1), coveringCell(t, r, c))) continue;
      add(x + tb.xs[c], y, x + tb.xs[c], y + h, e);
    }
  });
  ctx.save();
  ctx.lineCap = 'butt';
  for (const { x1, y1, x2, y2, e } of lines) {
    if (!e) {
      if (!faint) continue;
      ctx.strokeStyle = faint.color;
      ctx.lineWidth = faint.px;
      ctx.setLineDash([2 * faint.px, 2 * faint.px]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      continue;
    }
    const s = strokeOf(e);
    ctx.strokeStyle = e.color || '#000';
    ctx.setLineDash(s.dash);
    if (s.double) {
      // two lines, as far apart as each is wide, centred on the edge
      ctx.lineWidth = s.w;
      const d = s.w;
      const across = y1 === y2;
      for (const k of [-d, d]) {
        ctx.beginPath();
        ctx.moveTo(x1 + (across ? 0 : k), y1 + (across ? k : 0));
        ctx.lineTo(x2 + (across ? 0 : k), y2 + (across ? k : 0));
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = s.w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }
  ctx.restore();
}

const sameLine = (a: BorderLine | null, b: BorderLine | null) => (!a && !b) || (!!a && !!b && a.style === b.style && a.w === b.w && a.color === b.color);
