// Drawing laid-out text on a canvas (or on the recording canvas that makes pictures for Word
// and PowerPoint).

import type { Glyphs, LaidLine, TextLayout } from './layout';
import { placeX, pieceX } from './layout';
import { withFx } from './fx';

export const fontOf = (g: Glyphs): string => `${g.style}${g.size}px ${g.family}`;

/** Draw a text laid out by layoutText with its origin at (ox, oy) (or only its lines from `from` up to `to`). */
export function drawLayout(ctx: CanvasRenderingContext2D, lay: TextLayout, ox: number, oy: number, from = 0, to = lay.lines.length): void {
  for (let i = from; i < to; i++) {
    const l = lay.lines[i];
    // highlighter colours go under all the line's text
    for (const g of l.pieces) {
      if (!g.highlight || g.hidden) continue;
      ctx.fillStyle = g.highlight;
      const h = l.above !== undefined ? Math.min(l.above, l.ascent * 1.12) : l.ascent;
      ctx.fillRect(ox + g.x, oy + l.y - h, g.w, h + l.descent);
    }
    if (l.marker) drawGlyphs(ctx, lay, l, l.marker, ox, oy);
    for (const g of l.pieces) drawGlyphs(ctx, lay, l, g, ox, oy);
  }
  ctx.fillStyle = '#000';
}

function drawGlyphs(ctx: CanvasRenderingContext2D, lay: TextLayout, l: LaidLine, g: Glyphs, ox: number, oy: number): void {
  // figures are drawn by the document itself; a field shows its text
  if ((g.obj !== undefined && g.shown === undefined) || g.hidden) return;
  ctx.font = fontOf(g);
  ctx.fillStyle = g.color ?? '#000';
  // (a right-to-left piece drawn so, placed by its left end as every piece is)
  const c = ctx as { direction?: string };
  const dir = c.direction, align = ctx.textAlign;
  if (g.rtl) { c.direction = 'rtl'; ctx.textAlign = 'left'; }
  const y = oy + l.y + g.dy;
  // text effects: drawn in a state of their own
  const fx = g.fx && !g.tab ? g.fx : undefined;
  if (fx) ctx.save();
  const draw = fx ? withFx(ctx, fx, g.size) : (t: string, x: number, yy: number) => ctx.fillText(t, x, yy);
  // a soft hyphen draws nothing (a line broken at one gets a hyphen glyph of its own)
  const put = (t: string, x: number, yy: number) => { const u = t.includes('\u00ad') ? t.split('\u00ad').join('') : t; if (u) draw(u, x, yy); };
  if (g.tab) {
    // a tab shows nothing but its leader: dots, a dashed or a solid line along the baseline
    if (g.leader === 'underscore') ctx.fillRect(ox + g.x, oy + l.y + Math.max(1, g.size * 0.1), g.w, Math.max(0.5, g.size * 0.05));
    else if (g.leader) {
      const mark = g.leader === 'dot' ? '.' : '-';
      const step = Math.max(1, lay.measure(mark, g.size, g.family, g.style) * (g.leader === 'dot' ? 1.6 : 1.3));
      // dots line up from one line to the next (on a grid from the margin), as Word's do
      for (let x = Math.ceil((g.x + 0.5) / step) * step; x + step <= g.x + g.w + 0.01; x += step) ctx.fillText(mark, ox + x, y);
    }
  } else if (g.shown !== undefined) put(g.shown, ox + g.x, y);
  else if (g.spacing) {
    // spaced out (or condensed): each character where the spacing puts it
    for (let k = 0; k < g.text.length; k++) if (g.text[k] !== ' ') put(g.text[k], ox + g.x + (g.rtl ? g.w - pieceX(lay, g, k + 1) : pieceX(lay, g, k)), y);
  } else if (g.spread) {
    // justified: each word goes where the stretched spaces put it
    let k = 0;
    for (const word of g.text.split(' ')) {
      // (a right-to-left piece's words from its right end)
      if (word) put(word, ox + g.x + (g.rtl ? g.w - pieceX(lay, g, k + word.length) : pieceX(lay, g, k)), y);
      k += word.length + 1;
    }
  } else put(g.text, ox + g.x, y);
  if (fx) {
    ctx.restore();
    ctx.font = fontOf(g);
    ctx.fillStyle = g.color ?? '#000';
  }
  if (g.rtl) { c.direction = dir; ctx.textAlign = align; }
  if (g.underline) {
    // from the text's own size (the line's height also takes in pictures set in the line)
    const base = g.size;
    ctx.fillRect(ox + g.x, oy + l.y + Math.max(1, base * 0.1), g.w, Math.max(0.5, base * 0.05));
  }
  if (g.strike) {
    // through the middle of the small letters
    ctx.fillRect(ox + g.x, oy + l.y + g.dy - g.size * 0.27, g.w, Math.max(0.5, g.size * 0.05));
  }
}

/** The color formatting marks are drawn in (Home > Show/Hide ¶): a muted blue, as Word's are on screen. */
export const MARK_COLOR = '#5b78a8';

/**
 * Formatting marks over a laid-out text (Home > Show/Hide ¶, as Word's): a raised dot for each
 * space, an arrow across each tab, and ¶ where each paragraph ends (or ¤ at the end of a table
 * cell's text, `cell`). Only for the screen: never in a picture, a print or a file.
 */
export function drawMarks(ctx: CanvasRenderingContext2D, lay: TextLayout, ox: number, oy: number, from = 0, to = lay.lines.length, cell = false): void {
  ctx.save();
  ctx.fillStyle = MARK_COLOR;
  ctx.textAlign = 'center';
  for (let i = from; i < to; i++) {
    const l = lay.lines[i];
    let end = l.x, last: Glyphs | undefined;
    for (const g of l.pieces) {
      if (g.hidden || g.decor) continue;
      last = g;
      end = Math.max(end, g.x + g.w);
      if (g.obj !== undefined && !g.tab) continue;
      const y = oy + l.y + g.dy;
      if (g.tab) {
        ctx.font = `${g.size}px ${g.family}`;
        ctx.fillText('→', ox + g.x + g.w / 2, y);
        continue;
      }
      // a space's dot sits at its middle, as high as the middle of the small letters
      for (let k = g.text.indexOf(' '); k >= 0; k = g.text.indexOf(' ', k + 1)) {
        const a = placeX(lay, g, k), b = placeX(lay, g, k + 1);
        const r = Math.max(0.45, g.size * 0.055);
        ctx.beginPath();
        ctx.arc(ox + g.x + (a + b) / 2, y - g.size * 0.27, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (!l.last) continue;
    const size = last?.size ?? l.size ?? 12;
    ctx.font = `${size}px ${last?.family ?? 'serif'}`;
    // (at the paragraph's end: its left, where it runs right to left)
    const leftEnd = !!last?.rtl;
    ctx.textAlign = leftEnd ? 'right' : 'left';
    const start = Math.min(l.x, ...l.pieces.filter((g) => !g.hidden && !g.decor).map((g) => g.x));
    ctx.fillText(cell && i === lay.lines.length - 1 ? '¤' : '¶', leftEnd ? ox + start - size * 0.08 : ox + end + size * 0.08, oy + l.y);
    ctx.textAlign = 'center';
  }
  ctx.restore();
}
