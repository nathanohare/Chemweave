// Labels of drawings kept as data on an invisible frame (energy diagrams, TLC plates and gels, MO
// diagrams, Newman projections, torsion charts, SmartArt-style diagrams). Each of them is drawn
// again from its data when its frame is resized or its window applied, and every label is made
// afresh. Looks set on a label by hand on the drawing (bold, italic, a colour, a subscript) are
// carried over to the label drawn again with the same words.
//
// To tell a look set by hand from one the drawing gives (its labels' colour or size, a bold
// heading), the frame keeps the labels as last drawn (`Shape.madeLabels`): a look that differs
// from that is one set by hand. A label typed into on the drawing (new words, so not in that list)
// is compared with the label drawn again instead, leaving out text size (which follows the
// frame's size). A frame drawn before the list was kept carries only bold, italic, underline and
// strikethrough set on its labels. The labels of atoms in a frame (a sawhorse's groups) are taken
// as text too: their per-character marks (bold, italic, underline, raised, lowered), colour and font.

import type { Atom, Doc, Frame, MadeLabel, Shape, TextRun } from '../model';
import { anyMarks, readMark, writeMark } from '../chem/label-marks';
import { normalizeRuns, plainText, styleOf, type RunStyle } from '../richtext';

/** The looks a hand can set on a label's characters (not what the text is, or where it links). */
const LOOKS = ['bold', 'italic', 'underline', 'strike', 'sub', 'sup', 'formula', 'size', 'font', 'color', 'highlight', 'smallCaps', 'allCaps', 'spacing', 'noFill', 'transparency', 'outline', 'outlineW', 'shadow'] as const;
type Look = (typeof LOOKS)[number];
const SWITCHES: Look[] = ['bold', 'italic', 'underline', 'strike'];
/** Where a character sits: one of these at most. */
const POSITION: Look[] = ['sub', 'sup', 'formula'];

/** A label on the frame before it is drawn again. */
interface OldLabel { text: string; runs: TextRun[]; atom?: boolean }

/** What a frame's labels were before it is drawn again. */
export interface OldLabels { labels: OldLabel[]; made: MadeLabel[] | undefined }

const labelOfShape = (s: Shape | undefined): TextRun[] | null => (s?.text?.runs.length ? s.text.runs : null);

/** An atom's label as runs: each character's marks, and the atom's colour, font and bold. */
function atomRuns(a: Atom | undefined): TextRun[] | null {
  if (!a?.label) return null;
  const out: TextRun[] = [...a.label].map((c, i) => {
    const m = readMark(a.labelMarks?.[i]);
    return {
      text: c, ...(m.bold || (a.face ?? 0) & 1 ? { bold: true } : {}), ...(m.italic ? { italic: true } : {}), ...(m.underline ? { underline: true } : {}),
      ...(m.pos === 'down' ? { sub: true } : m.pos === 'up' ? { sup: true } : {}), ...(a.color ? { color: a.color } : {}), ...(a.font ? { font: a.font } : {}),
    };
  });
  return normalizeRuns(out);
}

/** An atom's look from runs of its label (as atomRuns gives them): its marks, and a colour or font all its characters have. */
function atomPatch(a: Atom, runs: TextRun[]): Partial<Atom> {
  const ch = perChar(runs);
  const bold = !!((a.face ?? 0) & 1);
  const marks = ch.map((st) => writeMark({ pos: st.sub ? 'down' : st.sup ? 'up' : 'auto', italic: !!st.italic, bold: !!st.bold && !bold, underline: !!st.underline })).join('');
  const one = <K extends 'color' | 'font'>(k: K) => { const v = ch[0]?.[k]; return ch.every((st) => st[k] === v) ? v : a[k]; };
  return { labelMarks: anyMarks(marks) ? marks : undefined, color: one('color') as string | undefined, font: one('font') as string | undefined };
}

type Label = { kind: 'c' | 's' | 'a'; id: number; runs: TextRun[] };

/** The frame's labels, in order: its captions, then the words of its shapes, then its atoms' labels. */
function labelsOf(doc: Doc, f: Pick<Frame, 'captions' | 'shapes'> & { atoms?: number[] }): Label[] {
  const out: Label[] = [];
  for (const id of f.captions) { const c = doc.captions.get(id); if (c?.runs.length) out.push({ kind: 'c', id, runs: c.runs }); }
  for (const id of f.shapes) { const runs = labelOfShape(doc.shapes.get(id)); if (runs) out.push({ kind: 's', id, runs }); }
  for (const id of f.atoms ?? []) { const runs = atomRuns(doc.atoms.get(id)); if (runs) out.push({ kind: 'a', id, runs }); }
  return out;
}

/** Read a frame's labels before what it holds is taken away to be drawn again. */
export function readLabels(doc: Doc, frame: Shape | undefined): OldLabels {
  if (!frame?.frame) return { labels: [], made: frame?.madeLabels };
  return { labels: labelsOf(doc, frame.frame).map((l) => ({ text: plainText(l.runs), runs: l.runs, ...(l.kind === 'a' ? { atom: true } : {}) })), made: frame.madeLabels };
}

/** Each character's style. */
function perChar(runs: TextRun[]): RunStyle[] {
  const out: RunStyle[] = [];
  for (const r of runs) { const st = styleOf(r); for (let i = 0; i < r.text.length; i++) out.push(st); }
  return out;
}

const same = (a: unknown, b: unknown) => (a ?? false) === (b ?? false);

/**
 * The looks set by hand on each character of `old`: what differs from `base` (the same words as
 * drawn). `keys` are the looks compared; `onlyOn` keeps only switches turned on.
 */
export function handLooks(old: TextRun[], base: TextRun[], keys: readonly Look[] = LOOKS, onlyOn = false): (Partial<RunStyle> | null)[] {
  const a = perChar(old), b = perChar(base);
  return a.map((st, i) => {
    const was = b[i] ?? {};
    let hand: Partial<RunStyle> | null = null;
    for (const k of keys) {
      const v = st[k], w = was[k];
      if (same(v, w)) continue;
      if (onlyOn && !v) continue;
      (hand ??= {} as Record<string, unknown>)[k] = v ?? undefined;
    }
    return hand;
  });
}

const merge = (a: (Partial<RunStyle> | null)[], b: (Partial<RunStyle> | null)[]) => a.map((x, i) => (x || b[i] ? { ...x, ...b[i] } : null));

/** Runs with these looks put on their characters (the rest as they are). */
export function withLooks(runs: TextRun[], hand: (Partial<RunStyle> | null)[]): TextRun[] {
  const text = plainText(runs);
  if (!hand.some(Boolean)) return runs;
  const st = perChar(runs);
  const out: TextRun[] = [];
  for (let i = 0; i < text.length; i++) {
    const h = hand[i];
    let s: Record<string, unknown> = { ...st[i] };
    if (h) {
      // a position set by hand replaces the one drawn (a character is never both)
      if (POSITION.some((k) => h[k] !== undefined && h[k])) for (const k of POSITION) delete s[k];
      s = { ...s, ...h };
      for (const k of Object.keys(s)) if (s[k] === undefined || s[k] === false) delete s[k];
    }
    out.push({ ...(s as RunStyle), text: text[i] });
  }
  return normalizeRuns(out);
}

/**
 * After a frame was drawn again: looks set by hand on its old labels go onto the new labels with
 * the same words. Returns its labels as drawn (before the looks went on), to keep on the frame.
 */
export function keepLabels(doc: Doc, was: OldLabels, frame: Pick<Frame, 'captions' | 'shapes'> & { atoms?: number[] }): MadeLabel[] {
  const now = labelsOf(doc, frame);
  const made: MadeLabel[] = now.map((l) => ({ text: plainText(l.runs), runs: l.runs.map((r) => ({ ...r })), ...(l.kind === 'a' ? { atom: true as const } : {}) }));
  if (!was.labels.length) return made;
  const usedOld = new Set<number>(), usedMade = new Set<number>();
  for (let i = 0; i < now.length; i++) {
    const text = made[i].text;
    const atom = now[i].kind === 'a';
    // (an atom's label goes to an atom's, a caption's words to a caption's)
    const k = was.labels.findIndex((l, j) => !usedOld.has(j) && l.text === text && !!l.atom === atom);
    if (k < 0) continue;
    usedOld.add(k);
    const old = was.labels[k];
    let hand: (Partial<RunStyle> | null)[];
    if (was.made) {
      const m = was.made.findIndex((x, j) => !usedMade.has(j) && x.text === text && !!x.atom === atom);
      if (m >= 0) { usedMade.add(m); hand = handLooks(old.runs, was.made[m].runs); }
      // typed on the drawing (not words the frame drew): compared with the words drawn now, apart
      // from text size, which follows the frame's size
      // (a subscript the drawing puts in that the words typed haven't got stays)
      else hand = merge(handLooks(old.runs, now[i].runs, LOOKS.filter((x) => x !== 'size' && !POSITION.includes(x))), handLooks(old.runs, now[i].runs, POSITION, true));
    } else hand = handLooks(old.runs, now[i].runs, SWITCHES, true);
    const runs = withLooks(now[i].runs, hand);
    if (runs === now[i].runs) continue;
    const l = now[i];
    if (l.kind === 'a') doc.updateAtom(l.id, atomPatch(doc.atoms.get(l.id)!, runs));
    else if (l.kind === 'c') doc.updateCaption(l.id, { runs });
    else { const s = doc.shapes.get(l.id)!; doc.updateShape(l.id, { text: { ...s.text!, runs } }); }
  }
  return made;
}
