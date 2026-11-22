// PowerPoint text formatting this program doesn't model, kept from the file read and written back
// while the looks it goes with are unchanged here (audit G2-03, G2-06 to G2-08, G2-21, G2-22).
//
// A run (a:rPr, ECMA-376 part 1, 21.1.2.3.9) keeps: attributes not read here (altLang, noProof,
// normalizeH, bmk...); a kern size; a baseline other than the usual sub- and superscript; the
// underline and strikethrough kinds (u="dbl", strike="dblStrike"); a fill that isn't one colour
// (a gradient); its effects (glow, a shadow of its own); the underline's own line and fill; a
// theme font (+mj-lt) and the East Asian, complex script and symbol fonts; rtl and extLst; and a
// link with no colour or underline of its own, which follows the theme's link colour.
// A paragraph (a:pPr, 21.1.2.2.7) keeps: attributes not read here (rtl, fontAlgn, defTabSz,
// eaLnBrk...), algn="dist", the bullet's colour and size, and its level and margins as read.

import { elementXml } from './kept-parts';
import { kid, kids } from './ooxml';
import type { Caption, ParaStyle, TextRun } from '../model';

/** What a run kept (see TextRun.pfx). */
export interface RunKept {
  /** Attributes not read here, as written (` altLang="fr-FR" noProof="1"`). */
  a?: string;
  kern?: string;
  bl?: number;
  u?: string;
  st?: string;
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
  const u = rPr.getAttribute('u');
  if (u && u !== 'none' && u !== 'sng') k.u = u;
  if (rPr.getAttribute('strike') === 'dblStrike') k.st = 'dblStrike';
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
    u: r.underline && k?.u ? k.u : undefined,
    strike: r.strike && k?.st ? k.st : undefined,
    fill: colourSame && k?.fill ? k.fill : undefined,
    fx: k?.fx !== undefined && !!r.shadow === !!k.sh ? k.fx : undefined,
    ul: r.underline && k?.ul ? k.ul : '',
    latin: fontSame && k?.lat ? k.lat : undefined,
    /** The link follows the theme's colour and underline (none of its own written). */
    plainLink: !!k?.pl && colourSame && !!r.underline === !!k.un,
    baseline: (sub: boolean, sup: boolean) => (k?.bl !== undefined && ((k.bl < 0 && sub) || (k.bl > 0 && sup)) && (k.p === (sub ? -1 : 1)) ? k.bl : undefined),
  };
}

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
}

/** A PowerPoint text box's frame, to write back while the box isn't resized here (null without one). */
export function keptFrame(sp: Element, c: Omit<Caption, 'id'>): string | null {
  const xf = kid(kid(sp, 'spPr'), 'xfrm'), bp = kid(kid(sp, 'txBody'), 'bodyPr');
  if (!xf || !bp || !kid(xf, 'off') || !kid(xf, 'ext')) return null;
  const k: FrameKept = { xf: xmlOf(xf), bp: xmlOf(bp), x: c.x, y: c.y, wrap: c.wrap ?? null, boxH: c.boxH ?? null, fit: c.fit ?? null, dir: c.dir ?? null, rot: c.rot ?? null };
  return JSON.stringify(k);
}

const near = (a: number | null | undefined, b: number | null | undefined) => (a ?? null) === null ? (b ?? null) === null : (b ?? null) !== null && Math.abs(a! - b!) < 0.01;

/**
 * The frame kept for a text box, moved as far as its text was moved here (in EMU, `emu` turning
 * points into them), while its width, height, fit, direction and turn are as read; else null.
 */
export function frameNow(c: Caption, emu: (pt: number) => number): { xfrm: string; bodyPr: string; dx: number; dy: number } | null {
  if (!c.pbox || c.ph) return null;
  let k: FrameKept;
  try { k = JSON.parse(c.pbox) as FrameKept; } catch { return null; }
  if (!near(c.wrap, k.wrap) || !near(c.boxH, k.boxH) || (c.fit ?? null) !== k.fit || (c.dir ?? null) !== k.dir || !near(c.rot, k.rot)) return null;
  const dx = c.x - k.x, dy = c.y - k.y;
  const xfrm = k.xf.replace(/<a:off x="(-?\d+)" y="(-?\d+)"/, (_, x: string, y: string) => `<a:off x="${Number(x) + emu(dx)}" y="${Number(y) + emu(dy)}"`);
  return { xfrm, bodyPr: k.bp, dx, dy };
}
