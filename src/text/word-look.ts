// How Word's character effects that this program keeps but doesn't edit look: the hollow
// outline, emboss and engrave (w:outline, w:emboss, w:imprint), emphasis marks (w:em), a
// character border (w:bdr) and Word 2010's glow (w14:glow). They stay in the run as the file had
// them (TextRun.wrx, TextRun.wfx) and are only read here, to draw them as Word does.

import type { TextRun } from '../model';

/** The Word effects a run shows. */
export interface WordLook {
  /** Hollow letters: an outline in the text's colour (w:outline). */
  hollow?: boolean;
  /** Raised letters (w:emboss) or pressed in (w:imprint): a grey copy beside them. */
  emboss?: boolean;
  imprint?: boolean;
  /** A mark at each character: a dot above, a comma or a circle above, or a dot below (w:em). */
  em?: 'dot' | 'comma' | 'circle' | 'underDot';
  /** A box round the text (w:bdr): its colour (undefined: the text's) and width in points. */
  border?: { color?: string; w: number };
  /** A soft halo round the letters (w14:glow): its colour, how far it reaches in points, and how opaque. */
  glow?: { color: string; r: number; alpha: number };
}

const OFF = /^(0|false|off|none|nil)$/;

/**
 * Theme colours by the names a glow's w14:schemeClr uses (ECMA-376 Part 1 20.1.10.54), in Office's
 * own default theme (the same twelve colours as a new workbook's, sheet/themes.ts): a glow in a
 * document's theme colour is drawn in that, as the layout has no document theme to ask.
 */
const OFFICE_THEME: Record<string, string> = {
  dk1: '000000', tx1: '000000', lt1: 'ffffff', bg1: 'ffffff', dk2: '44546a', tx2: '44546a', lt2: 'e7e6e6', bg2: 'e7e6e6',
  accent1: '4472c4', accent2: 'ed7d31', accent3: 'a5a5a5', accent4: 'ffc000', accent5: '5b9bd5', accent6: '70ad47', hlink: '0563c1', folHlink: '954f72',
};

/** An element's on/off value in Word's XML (no w:val: on). */
function onIn(xml: string, name: string): boolean {
  const tag = tagIn(xml, name);
  return tag !== undefined && !OFF.test(attr(tag, 'w:val') ?? '');
}

/** The first <w:name> start tag (not a longer name such as w:outlineLvl for w:outline). */
function tagIn(xml: string, name: string): string | undefined {
  const open = `<w:${name}`;
  for (let i = xml.indexOf(open); i >= 0; i = xml.indexOf(open, i + 1)) {
    if (/[\s/>]/.test(xml.charAt(i + open.length))) return xml.slice(i, xml.indexOf('>', i) + 1);
  }
  return undefined;
}

/** An attribute's value in a piece of XML (the name not preceded by a word character). */
function attr(xml: string, name: string): string | undefined {
  const key = `${name}="`;
  for (let i = xml.indexOf(key); i >= 0; i = xml.indexOf(key, i + 1)) {
    if (i === 0 || !/\w/.test(xml.charAt(i - 1))) return xml.slice(i + key.length, xml.indexOf('"', i + key.length));
  }
  return undefined;
}

/** The Word effects a run shows, read from what it keeps of the file; undefined when it has none. */
export function wordLook(r: Pick<TextRun, 'wrx' | 'wfx'>): WordLook | undefined {
  let raw: Record<string, string> = {};
  if (r.wrx) { try { raw = JSON.parse(r.wrx) as Record<string, string>; } catch { raw = {}; } }
  const all = Object.values(raw).join('');
  const out: WordLook = {};
  if (onIn(all, 'outline')) out.hollow = true;
  if (onIn(all, 'emboss')) out.emboss = true;
  if (onIn(all, 'imprint')) out.imprint = true;
  const em = /<w:em\s+w:val="([^"]*)"/.exec(all)?.[1];
  if (em === 'dot' || em === 'comma' || em === 'circle' || em === 'underDot') out.em = em;
  const bdr = /<w:bdr\b[^>]*\/?>/.exec(all)?.[0];
  if (bdr && !OFF.test(attr(bdr, 'w:val') ?? 'single')) {
    const c = attr(bdr, 'w:color');
    const sz = Number(attr(bdr, 'w:sz') ?? 4);
    out.border = { ...(c && /^[0-9a-f]{6}$/i.test(c) ? { color: `#${c.toLowerCase()}` } : {}), w: Math.max(0.25, (Number.isFinite(sz) ? sz : 4) / 8) };
  }
  const glow = r.wfx ? /<w14:glow\b([^>]*)>([\s\S]*?)<\/w14:glow>/.exec(r.wfx) : null;
  if (glow) {
    const rad = Number(attr(glow[1], 'w14:rad') ?? 0);
    const c = attr(glow[2], 'w14:val');
    const alpha = Number(/<w14:alpha\s+w14:val="(\d+)"/.exec(glow[2])?.[1] ?? 0);
    // (a theme colour, w14:schemeClr, by its name; an sRGB one, w14:srgbClr, by its six hex digits)
    const hex = c && /^[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : c ? OFFICE_THEME[c] ?? OFFICE_THEME[c.toLowerCase()] : undefined;
    if (rad > 0 && hex) out.glow = { color: `#${hex}`, r: rad / 12700, alpha: Math.max(0, 1 - alpha / 100000) };
  }
  return Object.keys(out).length ? out : undefined;
}
