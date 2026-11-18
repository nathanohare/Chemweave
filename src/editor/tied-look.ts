// How text tied to a structure looks and where it sits, from the drawing style: ID labels have
// their own look (bold by default), and captions, names and descriptors share another. New ID
// labels and captions take it, and so does text when it is linked to a structure, as if it had
// been made as a label in the first place. Every field can still be changed by hand afterwards.

import type { Attachment, AttachSide, Caption, Doc, Justify, TextRun } from '../model';
import type { DocStyle, TiedLook } from '../style';
import { defaultGap } from './attached';
import { plainText } from '../richtext';

export type LookRole = 'label' | 'caption';

/** Which look a tie's role takes: descriptors look like captions. */
export const lookRole = (role: Attachment['role']): LookRole => (role === 'label' ? 'label' : 'caption');

/** A look with every field worked out (font and size undefined: the captions'; gap undefined: a third of a bond length). */
export interface FullLook {
  font?: string;
  size?: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color?: string;
  align: 'left' | 'center' | 'right';
  side: AttachSide;
  gap?: number;
}

const SIDES: AttachSide[] = ['below', 'above', 'left', 'right'];
const ALIGNS = ['left', 'center', 'right'] as const;

/** The usual look of each role (the program's look before these settings): ID labels bold, all centered below. */
export const USUAL: Record<LookRole, FullLook> = {
  label: { bold: true, italic: false, underline: false, align: 'center', side: 'below' },
  caption: { bold: false, italic: false, underline: false, align: 'center', side: 'below' },
};

/** The look a style gives a role. */
export function fullLook(style: DocStyle, role: LookRole): FullLook {
  const own = (role === 'label' ? style.idLook : style.tiedLook) ?? {};
  const u = USUAL[role];
  return {
    font: own.font, size: own.size,
    bold: own.bold ?? u.bold, italic: own.italic ?? u.italic, underline: own.underline ?? u.underline,
    color: own.color, align: own.align ?? u.align, side: own.side ?? u.side, gap: own.gap,
  };
}

/** The gap a role's text is given from its structure, in points. */
export function lookGap(doc: Doc, role: LookRole): number {
  return fullLook(doc.style, role).gap ?? defaultGap(doc);
}

/** How the lines of tied text line up: beside a structure, towards it; above or below, as the look says. */
export function lookJustify(look: Pick<FullLook, 'side' | 'align'>): Justify {
  return look.side === 'right' ? 'left' : look.side === 'left' ? 'right' : look.align;
}

/** A tie to `atoms` placed as the style says (centered or lined up, at its gap). */
export function lookAttachment(doc: Doc, role: Attachment['role'], atoms: Iterable<number>, extra: Partial<Attachment> = {}): Attachment {
  const r = lookRole(role);
  const look = fullLook(doc.style, r);
  const a: Attachment = { atoms: [...atoms], side: look.side, gap: lookGap(doc, r), shift: 0, role, ...extra };
  if ((a.side === 'below' || a.side === 'above') && look.align !== 'center' && extra.align === undefined) a.align = look.align;
  return a;
}

/**
 * The text's runs in a role's look. Text being linked (or reset) has its font, size, bold and
 * color set to the look's for the whole text, and keeps what is set inside it (a subscript, an
 * italic n-Bu); italic or underline are added when the look has them. With `add` (text made
 * from other parts, like descriptors and names), the look is only added, so bold or italic
 * already in the text stays.
 */
export function lookRuns(runs: TextRun[], style: DocStyle, role: LookRole, add = false): TextRun[] {
  const look = fullLook(style, role);
  const font = look.font && look.font !== style.captionFont ? look.font : undefined;
  const size = look.size !== undefined && Math.abs(look.size - style.captionSize) > 1e-6 ? look.size : undefined;
  return runs.map((r) => {
    const out: TextRun = { ...r };
    if (!add || font) out.font = font;
    if (!add || size !== undefined) out.size = size;
    if (!add || look.color) out.color = look.color;
    if (!add || look.bold) out.bold = look.bold || undefined;
    if (look.italic) out.italic = true;
    if (look.underline) out.underline = true;
    for (const k of ['font', 'size', 'bold', 'color'] as const) if (out[k] === undefined) delete out[k];
    return out;
  });
}

/** A new caption of a role tied to `atoms`, as the style says (place it with placeAttached). */
export function lookCaption(doc: Doc, role: Attachment['role'], atoms: Iterable<number>, runs: TextRun[], extra: Partial<Attachment> = {}, add = false): Omit<Caption, 'id'> {
  const attach = lookAttachment(doc, role, atoms, extra);
  const look = fullLook(doc.style, lookRole(role));
  return { x: 0, y: 0, runs: lookRuns(runs, doc.style, lookRole(role), add), justify: lookJustify({ side: attach.side, align: look.align }), attach };
}

/**
 * Text given its role's look and place beside `atoms`, as if it had been made there (linking
 * text to a structure, and Reset to Default Look). Text not tied yet becomes an ID label when it
 * reads as one, else a caption; tied text keeps its role and what else its tie holds.
 */
export function lookPatch(doc: Doc, c: Caption, atoms: Iterable<number>): Partial<Caption> {
  const role: Attachment['role'] = c.attach?.role ?? (looksLikeId(plainText(c.runs)) ? 'label' : 'caption');
  const { atoms: _a, side: _s, gap: _g, shift: _h, align: _l, role: _r, ...rest } = c.attach ?? ({} as Partial<Attachment>);
  const fresh = lookCaption(doc, role, atoms, c.runs, rest);
  return { runs: fresh.runs, justify: fresh.justify, attach: fresh.attach };
}

/**
 * Does this text read as a compound ID (12, 3a, S4, 12′, iv, B, (±)-7)? Linked text that does is
 * made an ID label; other text a caption.
 */
export function looksLikeId(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 12) return false;
  return /^(\((?:±|\+|−|-|[RS]|rac)\)-?)?[A-Z]{0,2}\d{1,4}[a-z]{0,2}[′″'"*]?$/.test(t)
    || /^[ivxlc]{1,6}[′'"]?$/.test(t) || /^[IVXLC]{1,6}[′'"]?$/.test(t) || /^[A-Za-z][′'"]?$/.test(t);
}

/** A look as read from a file or the settings (only sensible fields; undefined when none). */
export function cleanTiedLook(raw: unknown): TiedLook | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: TiedLook = {};
  if (typeof r.font === 'string' && r.font.trim()) out.font = r.font.trim().slice(0, 80);
  if (typeof r.size === 'number' && Number.isFinite(r.size) && r.size >= 4 && r.size <= 72) out.size = r.size;
  for (const k of ['bold', 'italic', 'underline'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  if (typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color)) out.color = r.color.toLowerCase();
  if (ALIGNS.includes(r.align as never)) out.align = r.align as TiedLook['align'];
  if (SIDES.includes(r.side as AttachSide)) out.side = r.side as AttachSide;
  if (typeof r.gap === 'number' && Number.isFinite(r.gap) && r.gap >= 0 && r.gap <= 100) out.gap = r.gap;
  return Object.keys(out).length ? out : undefined;
}

/** Does this caption still look as `look` made it (so a new look may replace it)? */
export function hasLook(c: Caption, style: DocStyle, role: LookRole): boolean {
  const want = lookRuns(c.runs.map((r) => ({ text: r.text })), style, role)[0] ?? {};
  return c.runs.every((r) => !r.text.trim() || ((r.font ?? undefined) === want.font && (r.size ?? undefined) === want.size && !!r.bold === !!want.bold && (r.color ?? undefined) === want.color));
}

/**
 * A new drawing style's looks on the tied text that still has the old style's: its formatting,
 * and its side, gap and alignment where they are still the old look's. Call inside an edit.
 */
export function restyleTied(doc: Doc, old: DocStyle, next: DocStyle): Set<number> {
  const done = new Set<number>();
  for (const c of [...doc.captions.values()]) {
    const a = c.attach;
    if (!a || c.ph) continue;
    const role = lookRole(a.role);
    const was = fullLook(old, role), now = fullLook(next, role);
    const patch: Partial<Caption> = {};
    if (hasLook(c, old, role)) {
      const runs = c.runs.map((r) => {
        const out: TextRun = { ...r };
        for (const k of ['font', 'size', 'bold', 'color'] as const) delete out[k];
        if (was.italic && !now.italic) delete out.italic;
        if (was.underline && !now.underline) delete out.underline;
        return out;
      });
      patch.runs = lookRuns(runs, next, role);
    }
    const oldGap = was.gap ?? Math.round(old.bondLength * 0.3 * 10) / 10, newGap = now.gap ?? Math.round(next.bondLength * 0.3 * 10) / 10;
    const placeWas = a.side === was.side && Math.abs(a.gap - oldGap) < 1e-6 && a.shift === 0 && (a.align ?? 'center') === (was.side === 'left' || was.side === 'right' ? 'center' : was.align);
    if (placeWas && (was.side !== now.side || Math.abs(oldGap - newGap) > 1e-6 || was.align !== now.align)) {
      const at: Attachment = { ...a, side: now.side, gap: newGap, shift: 0 };
      delete at.align;
      if ((now.side === 'below' || now.side === 'above') && now.align !== 'center') at.align = now.align;
      patch.attach = at;
      patch.justify = lookJustify(now);
    }
    if (patch.runs) done.add(c.id);
    if (Object.keys(patch).length) doc.updateCaption(c.id, patch);
  }
  return done;
}
