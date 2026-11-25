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

/** An element's on/off value in Word's XML (no w:val: on). */
function onIn(xml: string, name: string): boolean {
  const m = new RegExp(`<w:${name}(?:\\s+w:val="([^"]*)")?\\s*/?>`).exec(xml);
  return !!m && !OFF.test(m[1] ?? '');
}

const attr = (xml: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1];

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
    if (rad > 0 && c && /^[0-9a-f]{6}$/i.test(c)) out.glow = { color: `#${c.toLowerCase()}`, r: rad / 12700, alpha: Math.max(0, 1 - alpha / 100000) };
  }
  return Object.keys(out).length ? out : undefined;
}
