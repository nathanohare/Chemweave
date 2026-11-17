// A scheme page's reaction scheme (SI Assistant's scheme editor, SPEC §13n.4) drawn as one
// Chemweave drawing for the compiled SI, so it stays editable in the document: the starting
// materials, then for each step an arrow with its conditions above and below and the step's
// products, "+" between structures of one side. Laid out by the scheme's Layout (its own
// settings over the project's, Project Settings ▸ Schemes, over the built-in ones):
//
//  - structures are centred on the arrow's line, each ID (bold, the conditions' size + 1 pt)
//    centred under its structure and its yield under the ID; with "line up IDs" every ID of a
//    row starts under the row's lowest structure;
//  - an arrow is as long as its wider conditions text, plus room before and after it, and never
//    shorter than the shortest arrow; the conditions sit 0.3 em above and under it;
//  - too wide for the page: a new row starts at an arrow (a step is kept together), or the
//    whole scheme shrinks to one line; the scheme's size (%) applies to everything.
//
// The drawing is built at full size; how much it is shrunk or grown is returned as its scale.

import { Doc, type Contents, type Justify, type TextRun } from '../model';
import type { Rect } from '../geom';
import { atomsBox } from '../editor/arrange';
import { plainMeasure } from '../chem/reaction';
import { ACS_1996 } from '../style';
import type { Json } from './project';

const MM = 72 / 25.4;

/** A scheme's layout settings, with SI Assistant's names (scheme.json "layout", project.json "schemes"). */
export interface SchemeLayout {
  cond_size_pt: number;
  cond_structure_pct: number;
  top_align: 'left' | 'center' | 'right';
  bottom_align: 'left' | 'center' | 'right';
  arrow_before_mm: number;
  arrow_after_mm: number;
  arrow_min_mm: number;
  fit: 'wrap' | 'shrink';
  scale_pct: number;
  yields: 'product' | 'conditions' | 'none';
  gap_mm: number;
  align_ids: boolean;
  show_label: boolean;
}

export const SCHEME_DEFAULTS: SchemeLayout = {
  cond_size_pt: 9, cond_structure_pct: 70, top_align: 'center', bottom_align: 'center',
  arrow_before_mm: 2, arrow_after_mm: 3, arrow_min_mm: 12, fit: 'wrap', scale_pct: 100,
  yields: 'product', gap_mm: 2, align_ids: true, show_label: false,
};

const LIMITS: Partial<Record<keyof SchemeLayout, [number, number]>> = {
  cond_size_pt: [5, 20], cond_structure_pct: [10, 300], arrow_before_mm: [0, 50], arrow_after_mm: [0, 50],
  arrow_min_mm: [2, 150], scale_pct: [20, 300], gap_mm: [0, 20],
};
const CHOICES: Partial<Record<keyof SchemeLayout, readonly string[]>> = {
  top_align: ['left', 'center', 'right'], bottom_align: ['left', 'center', 'right'], fit: ['wrap', 'shrink'], yields: ['product', 'conditions', 'none'],
};

/** `value` for setting `key` when it is a sensible one, else undefined. */
function cleanValue(key: keyof SchemeLayout, value: unknown): unknown {
  if (key === 'align_ids' || key === 'show_label') return typeof value === 'boolean' ? value : undefined;
  if (CHOICES[key]) return typeof value === 'string' && CHOICES[key]!.includes(value) ? value : undefined;
  const lim = LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || !lim) return undefined;
  return Math.min(lim[1], Math.max(lim[0], value));
}

/** A scheme's layout: its own settings over the project's over the built-in ones. */
export function schemeLayout(project: Json | null | undefined, own: Json | null | undefined): SchemeLayout {
  const out = { ...SCHEME_DEFAULTS } as Record<string, unknown>;
  for (const src of [project, own]) {
    if (!src || typeof src !== 'object') continue;
    for (const key of Object.keys(SCHEME_DEFAULTS) as (keyof SchemeLayout)[]) {
      const v = cleanValue(key, (src as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
  }
  return out as unknown as SchemeLayout;
}

/** A structure in the scheme: its drawing, its ID label (runs) and its yield ('' for none). */
export interface DrawBox { contents: Contents; label: TextRun[]; yieldText: string; dx?: number; dy?: number }
export interface DrawStep {
  top: TextRun[]; bottom: TextRun[]; topAlign?: 'left' | 'center' | 'right'; bottomAlign?: 'left' | 'center' | 'right'; products: DrawBox[];
  /** Structures in the conditions above the arrow (drawn over its text) and under it (under its text), at the Layout's size for them. */
  topStructures?: Contents[]; bottomStructures?: Contents[];
}

export interface DrawnScheme {
  contents: Contents;
  /** How much to shrink or grow the drawing in the document (the scheme's size × any shrinking to fit). */
  scale: number;
  /** Rows it was set out in. */
  rows: number;
  /** The size its conditions print at, in points (warned about below 6 pt). */
  textPt: number;
}

type Part =
  | { kind: 'box'; atoms: number[]; captions: number[]; box: Rect; label: number | null; yieldCap: number | null; dx: number; dy: number }
  | { kind: 'plus'; cap: number; box: Rect }
  | { kind: 'arrow'; w: number; top: number | null; bottom: number | null; topAlign: Justify; bottomAlign: Justify; arrow: number; above: Placed[]; below: Placed[] };

/** A structure added to the drawing: its atoms and captions, and its box (left edge at 0, centred on y = 0). */
interface Placed { atoms: number[]; captions: number[]; box: Rect }

/** The drawing of a scheme `maxW` points wide at most (the text width), or null when it has no structures. */
export function drawScheme(starting: DrawBox[], steps: DrawStep[], lay: SchemeLayout, maxW: number): DrawnScheme | null {
  if (!starting.length && !steps.some((s) => s.products.length)) return null;
  const doc = new Doc();
  doc.style = { ...ACS_1996 };
  const m = plainMeasure(doc);
  const textPt = lay.cond_size_pt, idPt = textPt + 1;
  const gap = lay.gap_mm * MM;
  const lw = doc.style.lineWidth;
  const capBox = (id: number): Rect => m.captionBox(doc.captions.get(id)!);
  const sized = (runs: TextRun[], size: number, bold = false): TextRun[] => runs.map((r) => ({ ...r, size, ...(bold ? { bold: true } : {}) }));
  const text = (runs: TextRun[], justify: Justify = 'center'): number | null =>
    runs.some((r) => r.text.trim()) ? doc.addCaption({ x: 0, y: 0, runs, justify, chem: false }).id : null;
  const moveCap = (id: number | null, dx: number, dy: number): void => {
    if (id === null) return;
    const c = doc.captions.get(id)!;
    doc.updateCaption(id, { x: c.x + dx, y: c.y + dy });
  };

  const between = 0.4 * textPt;
  const rowWidth = (ps: Placed[]): number => ps.reduce((w, x, i) => w + x.box.x2 + (i ? between : 0), 0);
  const segments: Part[][] = [];
  doc.edit('Scheme', () => {
    // a structure, `f` times its size (its labels and lines too), with its left edge at 0, centred on y = 0
    const structure = (contents: Contents, f = 1): Placed => {
      const ids = new Map<number, number>();
      const atoms: number[] = [];
      for (const a of [...contents.atoms.filter((x) => !x.multi), ...contents.atoms.filter((x) => x.multi)]) {
        const { id, ...rest } = structuredClone(a);
        if (rest.multi) {
          rest.multi = rest.multi.map((k) => ids.get(k)).filter((k): k is number => k !== undefined);
          if (rest.multi.length < 2) continue;
        }
        if (f !== 1) { rest.s = (rest.s ?? 1) * f; rest.x = a.x * f; rest.y = a.y * f; }
        const n = doc.addAtom(rest.x, rest.y, a.z, rest);
        ids.set(id, n.id);
        atoms.push(n.id);
      }
      for (const bd of contents.bonds) {
        const a1 = ids.get(bd.a1), a2 = ids.get(bd.a2);
        if (a1 === undefined || a2 === undefined) continue;
        const { id: _id, ...rest } = structuredClone(bd);
        if (f !== 1) rest.s = (rest.s ?? 1) * f;
        doc.addBond(a1, a2, bd.order, bd.display, { ...rest, a1, a2 });
      }
      const captions = contents.captions.map((t) => { const { id: _id, attach: _at, ...rest } = structuredClone(t); return doc.addCaption(f !== 1 ? { ...rest, x: rest.x * f, y: rest.y * f } : rest).id; });
      let box = atoms.length ? atomsBox(doc, atoms, m) : null;
      for (const c of captions) {
        const r = capBox(c);
        box = box ? { x1: Math.min(box.x1, r.x1), y1: Math.min(box.y1, r.y1), x2: Math.max(box.x2, r.x2), y2: Math.max(box.y2, r.y2) } : r;
      }
      box ??= { x1: 0, y1: 0, x2: 0, y2: 0 };
      const dx = -box.x1, dy = -(box.y1 + box.y2) / 2;
      doc.moveAtoms(atoms, dx, dy);
      for (const c of captions) moveCap(c, dx, dy);
      return { atoms, captions, box: { x1: 0, y1: box.y1 + dy, x2: box.x2 - box.x1, y2: box.y2 + dy } };
    };
    const boxPart = (b: DrawBox): Part => {
      const { atoms, captions, box } = structure(b.contents);
      const label = text(sized(b.label, idPt, true));
      const yieldCap = lay.yields === 'product' && b.yieldText ? text([{ text: b.yieldText, size: textPt }]) : null;
      return { kind: 'box', atoms, captions, box, label, yieldCap, dx: b.dx ?? 0, dy: b.dy ?? 0 };
    };
    const plus = (): Part => {
      const cap = doc.addCaption({ x: 0, y: 0, runs: [{ text: '+', size: idPt + 2 }], justify: 'left', chem: false }).id;
      const r = capBox(cap);
      moveCap(cap, -r.x1, -(r.y1 + r.y2) / 2);
      return { kind: 'plus', cap, box: capBox(cap) };
    };
    const side = (boxes: DrawBox[]): Part[] => boxes.flatMap((b, i) => (i ? [plus(), boxPart(b)] : [boxPart(b)]));
    segments.push(side(starting));
    for (const st of steps) {
      const yields = lay.yields === 'conditions' ? st.products.map((p) => p.yieldText).filter(Boolean) : [];
      const bottomRuns = [...st.bottom, ...(yields.length ? [{ text: (st.bottom.some((r) => r.text.trim()) ? '\n' : '') + yields.join(', ') }] : [])];
      const topAlign = st.topAlign ?? lay.top_align, bottomAlign = st.bottomAlign ?? lay.bottom_align;
      const top = text(sized(st.top, textPt), topAlign);
      const bottom = text(sized(bottomRuns, textPt), bottomAlign);
      const f = lay.cond_structure_pct / 100;
      const above = (st.topStructures ?? []).filter((c) => c.atoms.length).map((c) => structure(c, f));
      const below = (st.bottomStructures ?? []).filter((c) => c.atoms.length).map((c) => structure(c, f));
      const textW = Math.max(top !== null ? capBox(top).x2 - capBox(top).x1 : 0, bottom !== null ? capBox(bottom).x2 - capBox(bottom).x1 : 0, rowWidth(above), rowWidth(below));
      const w = Math.max(lay.arrow_min_mm * MM, textW + (lay.arrow_before_mm + lay.arrow_after_mm) * MM);
      const arrow = doc.addArrow({
        tail: { x: 0, y: 0 }, head: { x: w, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid',
        noGo: false, equilibrium: false, sweep: 0, headLength: lw * 10, headWidth: lw * 2.5,
      }).id;
      segments.push([{ kind: 'arrow', w, top, bottom, topAlign, bottomAlign, arrow, above, below }, ...side(st.products)]);
    }
  });

  const width = (p: Part): number => (p.kind === 'arrow' ? p.w : p.box.x2 - p.box.x1);
  const segW = (seg: Part[]): number => seg.reduce((s, p, i) => s + width(p) + (i ? gap : 0), 0);
  // rows: a step (arrow and products) is kept together; a new row starts at an arrow
  const room = maxW / (lay.scale_pct / 100);
  const rows: Part[][] = [];
  for (const seg of segments.filter((s) => s.length)) {
    const row = rows[rows.length - 1];
    if (row && (lay.fit === 'shrink' || segW(row) + gap + segW(seg) <= room)) row.push(...seg);
    else rows.push([...seg]);
  }
  const widest = Math.max(...rows.map(segW));
  const shrink = widest > room ? room / widest : 1;

  doc.edit('Lay Out Scheme', () => {
    let y = 0;
    for (const row of rows) {
      // across: each part's left edge, then the IDs' line
      let x = 0;
      const lowest = Math.max(0, ...row.map((p) => (p.kind === 'box' ? p.box.y2 : 0)));
      let top = 0, bottom = 0;
      const placed: { p: Part; x: number }[] = [];
      for (const p of row) {
        if (placed.length) x += gap;
        placed.push({ p, x });
        x += width(p);
      }
      // where each thing goes, relative to the row's arrow line (y = 0)
      const moves: ((dy: number) => void)[] = [];
      for (const { p, x: px } of placed) {
        if (p.kind === 'box') {
          top = Math.min(top, p.box.y1);
          bottom = Math.max(bottom, p.box.y2);
          const cx = px + (p.box.x2 - p.box.x1) / 2;
          let under = (lay.align_ids ? lowest : p.box.y2) + 0.25 * idPt;
          const lab = p.label !== null ? capBox(p.label) : null;
          if (lab) {
            const ldx = cx - (lab.x1 + lab.x2) / 2 + p.dx, ldy = under - lab.y1 + p.dy;
            under += lab.y2 - lab.y1 + 0.1 * textPt;
            bottom = Math.max(bottom, lab.y2 + ldy);
            moves.push((dy) => moveCap(p.label, ldx, ldy + dy));
          }
          const yc = p.yieldCap !== null ? capBox(p.yieldCap) : null;
          if (yc) {
            const ydx = cx - (yc.x1 + yc.x2) / 2 + (lab ? p.dx : 0), ydy = under - yc.y1 + (lab ? p.dy : 0);
            bottom = Math.max(bottom, yc.y2 + ydy);
            moves.push((dy) => moveCap(p.yieldCap, ydx, ydy + dy));
          }
          moves.push((dy) => { doc.moveAtoms(p.atoms, px, dy); for (const c of p.captions) moveCap(c, px, dy); });
        } else if (p.kind === 'plus') {
          top = Math.min(top, p.box.y1);
          bottom = Math.max(bottom, p.box.y2);
          moves.push((dy) => moveCap(p.cap, px, dy));
        } else {
          const from = px + lay.arrow_before_mm * MM, to = px + p.w - lay.arrow_after_mm * MM;
          const across = (b: Rect, align: Justify): number => (align === 'left' ? from - b.x1 : align === 'right' ? to - b.x2 : (from + to) / 2 - (b.x1 + b.x2) / 2);
          const em = 0.3 * textPt;
          let over = -em, under = em;
          if (p.top !== null) {
            const b = capBox(p.top), dx = across(b, p.topAlign), ty = -em - b.y2;
            top = Math.min(top, b.y1 + ty);
            over = b.y1 + ty;
            moves.push((dy) => moveCap(p.top, dx, ty + dy));
          }
          if (p.bottom !== null) {
            const b = capBox(p.bottom), dx = across(b, p.bottomAlign), by = em - b.y1;
            bottom = Math.max(bottom, b.y2 + by);
            under = b.y2 + by;
            moves.push((dy) => moveCap(p.bottom, dx, by + dy));
          }
          // structures in the conditions: in a row over the text above the arrow, or under the text below it
          const row = (ps: Placed[], align: Justify, edge: number, up: boolean): void => {
            if (!ps.length) return;
            const tall = Math.max(...ps.map((x) => x.box.y2 - x.box.y1));
            const mid = up ? edge - 0.2 * textPt - tall / 2 : edge + 0.2 * textPt + tall / 2;
            let x0 = across({ x1: 0, y1: 0, x2: rowWidth(ps), y2: 0 }, align);
            for (const s of ps) {
              const sx = x0, sy = mid;
              moves.push((dy) => { doc.moveAtoms(s.atoms, sx, sy + dy); for (const c of s.captions) moveCap(c, sx, sy + dy); });
              x0 += s.box.x2 + between;
            }
            if (up) top = Math.min(top, mid - tall / 2); else bottom = Math.max(bottom, mid + tall / 2);
          };
          row(p.above, p.topAlign, over, true);
          row(p.below, p.bottomAlign, under, false);
          const id = p.arrow;
          moves.push((dy) => doc.updateArrow(id, { tail: { x: px, y: dy }, head: { x: px + p.w, y: dy } }));
        }
      }
      const line = y - top;
      for (const mv of moves) mv(line);
      y = line + bottom + 3 * gap + 0.5 * idPt;
    }
  });
  return { contents: doc.contents(), scale: (lay.scale_pct / 100) * shrink, rows: rows.length, textPt: textPt * (lay.scale_pct / 100) * shrink };
}
