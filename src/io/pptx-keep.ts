// PowerPoint text formatting this program doesn't model, kept from the file read and written back
// while the looks it goes with are unchanged here (audit G2-03, G2-06 to G2-08, G2-21, G2-22).
//
// A run (a:rPr, ECMA-376 part 1, 21.1.2.3.9) keeps: attributes not read here (altLang, noProof,
// normalizeH, bmk...); a kern size; a baseline other than the usual sub- and superscript; a fill that isn't one colour
// (a gradient); its effects (glow, a shadow of its own); the underline's own line and fill; a
// theme font (+mj-lt) and the East Asian, complex script and symbol fonts; rtl and extLst; and a
// link with no colour or underline of its own, which follows the theme's link colour.
// A paragraph (a:pPr, 21.1.2.2.7) keeps: attributes not read here (rtl, fontAlgn, defTabSz,
// eaLnBrk...), algn="dist", the bullet's colour and size, and its level and margins as read.

import { elementXml } from './kept-parts';
import { kid, kids } from './ooxml';
import { turnAbout } from '../geom';
import type { Caption, ParaStyle, TextRun } from '../model';

/** What a run kept (see TextRun.pfx). */
export interface RunKept {
  /** Attributes not read here, as written (` altLang="fr-FR" noProof="1"`). */
  a?: string;
  kern?: string;
  bl?: number;
  fill?: string;
  fx?: string;
  ul?: string;
  lat?: string;
  /** The complex script font ('' when the run had none: none is written). */
  cs?: string;
  ea?: string;
  sym?: string;
  end?: string;
  /** A link with no colour or underline of its own. */
  pl?: 1;
  // the run's looks as read here, to tell whether they were changed
  c?: string | null;
  f?: string | null;
  sh?: boolean;
  un?: boolean;
  sk?: boolean;
  p?: number;
  nf?: boolean;
  tr?: number | null;
}

const RUN_ATTRS = new Set(['lang', 'sz', 'b', 'i', 'u', 'strike', 'cap', 'spc', 'kern', 'baseline', 'dirty', 'err', 'smtClean']);
const FILLS = new Set(['gradFill', 'pattFill', 'blipFill', 'grpFill']);
const xmlOf = (el: Element) => elementXml(el).replace(/ xmlns:a="[^"]*"/g, '');
const attrText = (el: Element, skip: Set<string>) => Array.from(el.attributes).filter((x) => !x.prefix && !skip.has(x.name)).map((x) => ` ${x.name}="${x.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`).join('');

/** What a run's own a:rPr has that isn't read here (null when nothing). */
export function readRunKept(rPr: Element | null): RunKept | null {
  if (!rPr) return null;
  const k: RunKept = {};
  const a = attrText(rPr, RUN_ATTRS);
  if (a) k.a = a;
  const kern = rPr.getAttribute('kern');
  if (kern && kern !== '0') k.kern = kern;
  const bl = Number(rPr.getAttribute('baseline') ?? 0);
  if (bl && bl !== -25000 && bl !== 30000) k.bl = bl;
  let hasFill = false;
  for (const ch of kids(rPr)) {
    const n = ch.localName;
    if (FILLS.has(n)) { k.fill = xmlOf(ch); hasFill = true; } else if (n === 'solidFill' || n === 'noFill') hasFill = true;
    else if (n === 'effectLst' || n === 'effectDag') k.fx = xmlOf(ch);
    else if (n === 'uLnTx' || n === 'uLn' || n === 'uFillTx' || n === 'uFill') k.ul = (k.ul ?? '') + xmlOf(ch);
    else if (n === 'latin' && (/^\+/.test(ch.getAttribute('typeface') ?? '') || ch.hasAttribute('pitchFamily') || ch.hasAttribute('charset') || ch.hasAttribute('panose'))) k.lat = xmlOf(ch);
    else if (n === 'ea') k.ea = xmlOf(ch);
    else if (n === 'sym') k.sym = xmlOf(ch);
    else if (n === 'cs') k.cs = xmlOf(ch);
    else if (n === 'rtl' || n === 'extLst') k.end = (k.end ?? '') + xmlOf(ch);
  }
  if (k.cs === undefined) k.cs = '';
  if (kid(rPr, 'hlinkClick') && !hasFill && !rPr.hasAttribute('u')) k.pl = 1;
  // (a run whose only note is that it has no complex script font: nothing to keep)
  return Object.keys(k).some((x) => x !== 'cs') || k.cs ? k : null;
}

/** The run's looks as read, set on what it kept once the run's own values are final. */
export function finishRunKept(r: TextRun): TextRun {
  if (!r.pfx) return r;
  const k = JSON.parse(r.pfx) as RunKept;
  Object.assign(k, { c: r.color ?? null, f: r.font ?? null, sh: !!r.shadow, un: !!r.underline, sk: !!r.strike, p: r.sub ? -1 : r.sup ? 1 : 0, nf: !!r.noFill, tr: r.transparency ?? null });
  return { ...r, pfx: JSON.stringify(k) };
}

export function runKept(r: TextRun): RunKept | null {
  if (!r.pfx) return null;
  try { return JSON.parse(r.pfx) as RunKept; } catch { return null; }
}

const sameColour = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

/** Which kept parts still go with the run as it is now. */
export function keptNow(r: TextRun, k: RunKept | null) {
  const fontSame = !!k && (r.font ?? null) === (k.f ?? null);
  const colourSame = !!k && sameColour(r.color, k.c) && !!r.noFill === !!k.nf && (r.transparency ?? null) === (k.tr ?? null);
  return {
    kern: !!k?.kern && !r.noKern ? k.kern : undefined,
    fill: colourSame && k?.fill ? k.fill : undefined,
    fx: k?.fx !== undefined && !!r.shadow === !!k.sh ? k.fx : undefined,
    ul: r.underline && k?.ul ? k.ul : '',
    latin: fontSame && k?.lat ? k.lat : undefined,
    /** The link follows the theme's colour and underline (none of its own written). */
    plainLink: !!k?.pl && colourSame && !!r.underline === !!k.un,
    baseline: (sub: boolean, sup: boolean) => (k?.bl !== undefined && ((k.bl < 0 && sub) || (k.bl > 0 && sup)) && (k.p === (sub ? -1 : 1)) ? k.bl : undefined),
  };
}

// ---------------------------------------------------------------- underline kinds

/**
 * PowerPoint's underline kinds (ST_TextUnderlineType, 20.1.10.82) by Word's names for them
 * (ST_Underline, 17.18.99), which runs keep (TextRun.ukind), so a double underline stays one
 * when text goes between documents and slides.
 */
const PPT_U: Record<string, string> = {
  words: 'words', double: 'dbl', thick: 'heavy', dotted: 'dotted', dottedHeavy: 'dottedHeavy', dash: 'dash', dashedHeavy: 'dashHeavy',
  dashLong: 'dashLong', dashLongHeavy: 'dashLongHeavy', dotDash: 'dotDash', dashDotHeavy: 'dotDashHeavy', dotDotDash: 'dotDotDash',
  dashDotDotHeavy: 'dotDotDashHeavy', wave: 'wavy', wavyHeavy: 'wavyHeavy', wavyDouble: 'wavyDbl',
  // (Excel's, from text pasted from a sheet)
  doubleAccounting: 'dbl',
};
const WORD_U = Object.fromEntries(Object.entries(PPT_U).filter(([w]) => w !== 'doubleAccounting').map(([w, p]) => [p, w]));

/** A run's underline kind by Word's name, from PowerPoint's (undefined: a single line). */
export const wordUnderline = (u: string): string | undefined => WORD_U[u];
/** PowerPoint's u for a run's underline kind. */
export const pptUnderline = (kind: string | undefined): string => (kind && PPT_U[kind]) || 'sng';

// ---------------------------------------------------------------- paragraphs

/** What a paragraph kept (see ParaStyle.ppx). */
export interface ParaKept {
  a?: string;
  dist?: 1;
  lvl?: number;
  bu?: string;
  marL?: string;
  indent?: string;
  /** The paragraph's settings as read, to tell whether they were changed. */
  sig?: string;
}

const PARA_ATTRS = new Set(['algn', 'lvl', 'marL', 'indent']);

/**
 * What a paragraph's own a:pPr has that isn't read here, with the margins it sets itself (those it
 * takes from its list style or the master are written from the settings here, as before); `list`:
 * it is a list item, whose level is read.
 */
export function readParaKept(pPr: Element | null, list: boolean): ParaKept | null {
  if (!pPr) return null;
  const k: ParaKept = {};
  const a = attrText(pPr, PARA_ATTRS);
  if (a) k.a = a;
  if (pPr.getAttribute('algn') === 'dist') k.dist = 1;
  const lvl = Number(pPr.getAttribute('lvl') ?? 0);
  if (!list && lvl > 0 && lvl <= 8) k.lvl = lvl;
  const bu = kids(pPr).filter((c) => /^bu(Clr|ClrTx|SzPct|SzPts|SzTx)$/.test(c.localName)).map(xmlOf).join('');
  if (bu) k.bu = bu;
  const marL = pPr.getAttribute('marL'), indent = pPr.getAttribute('indent');
  if (marL !== null) { k.marL = marL; if (indent !== null) k.indent = indent; }
  return Object.keys(k).length ? k : null;
}

/** The settings of a paragraph its kept margins and level go with. */
export function paraSig(ps: ParaStyle, justify: string): string {
  return JSON.stringify([ps.list ?? '', ps.level ?? 0, ps.indent ?? 0, !!ps.cont, ps.bullet ?? '', ps.numType ?? '', ps.align ?? justify]);
}

export function finishParaKept(ps: ParaStyle, justify: string): ParaStyle {
  if (!ps.ppx) return ps;
  const k = JSON.parse(ps.ppx) as ParaKept;
  k.sig = paraSig(ps, justify);
  return { ...ps, ppx: JSON.stringify(k) };
}

export function paraKept(ps: ParaStyle, justify: string): { k: ParaKept | null; same: boolean } {
  if (!ps.ppx) return { k: null, same: false };
  try {
    const k = JSON.parse(ps.ppx) as ParaKept;
    return { k, same: k.sig === paraSig(ps, justify) };
  } catch { return { k: null, same: false }; }
}

// ---------------------------------------------------------------- text boxes

/** A text box's frame as the file had it (see Caption.pbox). */
interface FrameKept {
  /** The shape's a:xfrm and its text's a:bodyPr (21.1.2.1.1), as written. */
  xf: string;
  bp: string;
  /** The caption's place, width, height, fit, direction and turn as read. */
  x: number;
  y: number;
  wrap: number | null;
  boxH: number | null;
  fit: string | null;
  dir: string | null;
  rot: number | null;
  /** The text as read (`textSig`), to tell when a box that grows with its text must be fitted to it again. */
  t?: string;
}

/**
 * What a text box's size depends on in its text: each stretch of characters with one size, font,
 * weight, slant and raising (however the runs are split), and each paragraph's spacing.
 */
export function textSig(c: Pick<Caption, 'runs' | 'paras'>): string {
  const parts: [string, ...unknown[]][] = [];
  for (const r of c.runs) {
    const look = [r.size ?? null, r.font ?? null, !!r.bold, !!r.italic, r.sub ? 1 : r.sup ? 2 : 0];
    const last = parts[parts.length - 1];
    if (last && JSON.stringify(last.slice(1)) === JSON.stringify(look)) last[0] += r.text;
    else parts.push([r.text, ...look]);
  }
  const paras = (c.paras ?? []).map((p) => [p.line ?? null, p.linePt ?? null, p.spaceBefore ?? 0, p.spaceAfter ?? 0, p.indent ?? 0]);
  return JSON.stringify([parts.filter((x) => x[0] !== ''), paras]);
}

/** A PowerPoint text box's frame, to write back while the box isn't resized here (null without one). */
export function keptFrame(sp: Element, c: Omit<Caption, 'id'>): string | null {
  const xf = kid(kid(sp, 'spPr'), 'xfrm'), bp = kid(kid(sp, 'txBody'), 'bodyPr');
  if (!xf || !bp || !kid(xf, 'off') || !kid(xf, 'ext')) return null;
  const k: FrameKept = { xf: xmlOf(xf), bp: xmlOf(bp), x: c.x, y: c.y, wrap: c.wrap ?? null, boxH: c.boxH ?? null, fit: c.fit ?? null, dir: c.dir ?? null, rot: c.rot ?? null, t: textSig(c) };
  return JSON.stringify(k);
}

const near = (a: number | null | undefined, b: number | null | undefined) => (a ?? null) === null ? (b ?? null) === null : (b ?? null) !== null && Math.abs(a! - b!) < 0.01;

/** A text box's size from its text, in points: the height of its lines, its widest line and where its first line's top is. */
export type TextFit = { h: number; w: number; top: number; free?: () => { h: number; w: number } };

/**
 * The frame kept for a text box, moved as far as its text was moved here (in EMU, `emu` turning
 * points into them), while its fit, direction and turn are as read; else null. A box made wider
 * or taller here keeps its anchor, margins and AutoFit, as resizing it in PowerPoint does, its
 * extent changed by as much. A box that grows with its text (spAutoFit, "Resize shape to fit
 * text") whose text or its look was changed here is fitted to the text as laid out here, its top
 * where the text starts here and, when it doesn't wrap, its width the text's (`fit`: the text's
 * height, widest line and top, in points; `free` the same laid out on one line per paragraph, for
 * a box the file says doesn't wrap), as PowerPoint fits it when the text is typed there; a box
 * that doesn't wrap grows from its text's alignment side (centred: both sides, right: leftward).
 * Turned boxes and text running up or down (review F2b-R02) are sized in the text's own frame (the
 * file's the other way round for vertical text, as pptx-read reads it) and placed so that
 * PowerPoint, turning the frame about its middle, puts the text's start where it is here: the
 * writer's own step for turned text (turnAbout). A box whose size and text are as read is written
 * exactly as read.
 */
export function frameNow(c: Caption, emu: (pt: number) => number, fit?: TextFit): { xfrm: string; bodyPr: string; dx: number; dy: number } | null {
  if (!c.pbox || c.ph) return null;
  let k: FrameKept;
  try { k = JSON.parse(c.pbox) as FrameKept; } catch { return null; }
  if ((c.fit ?? null) !== k.fit || (c.dir ?? null) !== k.dir || !near(c.rot, k.rot)) return null;
  const dx = c.x - k.x, dy = c.y - k.y;
  let xfrm = k.xf.replace(/<a:off x="(-?\d+)" y="(-?\d+)"/, (_, x: string, y: string) => `<a:off x="${Number(x) + emu(dx)}" y="${Number(y) + emu(dy)}"`);
  const resized = !near(c.wrap, k.wrap) || !near(c.boxH, k.boxH);
  // (a box that didn't wrap, or now doesn't: made afresh)
  if (resized && (k.wrap === null || c.wrap === undefined)) return null;
  const autoFit = /<a:spAutoFit\/>/.test(k.bp);
  const refit = !!fit && autoFit && k.t !== undefined && k.t !== textSig(c);
  if (!resized && !refit) return { xfrm, bodyPr: k.bp, dx, dy };
  const m = /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"/.exec(xfrm);
  if (!m) return { xfrm, bodyPr: k.bp, dx, dy };
  const [x, y, cx, cy] = m.slice(1).map(Number);
  const ins = (n: string, d: number) => Number(new RegExp(` ${n}="(\\d+)"`).exec(k.bp)?.[1] ?? d);
  const tIns = ins('tIns', 45720), bIns = ins('bIns', 45720), lr = ins('lIns', 91440) + ins('rIns', 91440);
  // the text's frame: the file's, the other way round for vertical text, about the same middle
  const vertical = !!c.dir, rot = c.rot ?? 0;
  const w0 = vertical ? cy : cx, h0 = vertical ? cx : cy;
  const mid = { x: x + cx / 2, y: y + cy / 2 };
  const at = { x: emu(c.x), y: emu(c.y) };
  // its corner in the text's own coordinates, where the text is laid out unturned at its start
  // (PowerPoint turns the frame about its middle, this program the text about its start)
  const back = turnAbout(mid, at, -rot);
  let fx = mid.x - w0 / 2 + back.x - mid.x, fy = mid.y - h0 / 2 + back.y - mid.y;
  let w1 = w0, h1 = h0;
  if (resized) {
    w1 = Math.max(1, w0 + emu(c.wrap! - k.wrap!));
    h1 = k.boxH !== null && c.boxH !== undefined ? h0 + emu(c.boxH - k.boxH) : fit && autoFit ? emu(fit.h) + tIns + bIns : h0;
  }
  if (refit) {
    const none = /\bwrap="none"/.test(k.bp);
    const size = none && fit!.free ? fit!.free() : fit!;
    if (none || k.wrap === null) {
      const w = Math.max(1, emu(size.w) + lr);
      if (none) fx += c.justify === 'center' ? (w1 - w) / 2 : c.justify === 'right' ? w1 - w : 0;
      w1 = w;
    }
    h1 = emu(size.h) + tIns + bIns;
    fy = emu(fit!.top) - tIns;
  }
  h1 = Math.max(1, h1);
  // back to the file's frame: its middle where turning puts the text's frame's middle
  const to = turnAbout({ x: fx + w1 / 2, y: fy + h1 / 2 }, at, rot);
  const cx1 = Math.round(vertical ? h1 : w1), cy1 = Math.round(vertical ? w1 : h1);
  xfrm = xfrm.replace(m[0], `<a:off x="${Math.round(to.x - cx1 / 2)}" y="${Math.round(to.y - cy1 / 2)}"/><a:ext cx="${cx1}" cy="${cy1}"`);
  return { xfrm, bodyPr: k.bp, dx, dy };
}
