// Slide Master view (View > Slide Master, as in PowerPoint): the slide master and each layout
// shown as pages in the slide list, edited with every tool of the slide editor. A page's
// placeholders show the prompts PowerPoint shows, in its look: on the master its own formatting
// is every layout's, on a layout only what it sets for itself is set on the text (the rest comes
// from the master, so it follows changes made there). Anything else drawn on a page is the
// master's or layout's own artwork (its items), behind every slide with it.
//
// These are the pure parts: building a page's drawing and reading a master or layout back from it.

import { Doc, applyBase, type Caption, type Contents, type Placeholder, type TextBase, type TextRun } from '../model';
import { ASCENT } from '../text/layout';
import {
  type Master, type LayoutDef, type LayoutId, type PlaceholderBox, type PlaceholderFmt, type SlideSize,
  FMT_PARA, builtinLayout, frameFields, masterFmt, paraOf, placeholderRect, textStyles,
} from './deck';

/** The master's page in the view (its layout id there). */
export const MASTER_PAGE = '#master';

/** What each kind of placeholder says on the master and layouts, as in PowerPoint. */
export const PAGE_PROMPTS: Record<Placeholder, string[]> = {
  title: ['Click to edit Master title style'],
  subtitle: ['Click to edit Master subtitle style'],
  body: ['Edit Master text styles', 'Second level', 'Third level'],
};

/** Where the master's own title and text boxes are: as set, else Title and Content's. */
export function masterBoxes(m: Master): PlaceholderBox[] {
  return m.phBoxes?.length ? m.phBoxes.map((b) => ({ ...b })) : builtinLayout('title-content').boxes;
}

/** The master with this layout in its list (as the view has it), so the layout's own colors are found. */
export function withLayout(m: Master, def: LayoutDef): Master {
  return { ...m, layouts: [...(m.layouts ?? []).filter((l) => l.id !== def.id), def] };
}

/** A placeholder on a page: its box, its prompt in the look `f`, with `own` set on its text. */
function pageCaption(box: PlaceholderBox, size: SlideSize, base: Record<Placeholder, TextBase>, f: PlaceholderFmt, own: PlaceholderFmt): Omit<Caption, 'id'> {
  const frame = { ph: box.ph, x: box.x * size.w, y: box.y * size.h, w: box.w * size.w, h: box.h * size.h, justify: box.justify };
  const lines = PAGE_PROMPTS[box.ph];
  const run: TextRun = { text: lines.join('\n') };
  for (const k of ['font', 'size', 'color', 'bold', 'italic'] as const) if (own[k] !== undefined) (run as unknown as Record<string, unknown>)[k] = own[k];
  const p = paraOf(f);
  return {
    ...frameFields(frame, base), runs: [run],
    paras: lines.map((_, k) => ({ ...p, ...(k ? { level: k } : {}) })),
    ...(f.lineSpacing && f.lineSpacing !== 1 ? { lineSpacing: f.lineSpacing } : {}),
  };
}

/** A new page drawing with these items, its ids clear of theirs. */
function pageDoc(items: Contents | undefined): Doc {
  const d = new Doc();
  if (items) {
    d.restoreContents(items);
    const ids = [...items.atoms, ...items.bonds, ...items.captions, ...items.arrows, ...items.shapes].map((x) => x.id);
    if (ids.length) d.reserveIds(Math.max(...ids));
  }
  return d;
}

/** The master's text looks as its page's base: what its placeholders' text follows. */
export const masterBase = (m: Master): Record<Placeholder, TextBase> => textStyles(m, undefined, false);

/** The master's page: its title and text boxes in its look (their text formatting the base), and its items. */
export function masterPageDoc(m: Master, size: SlideSize): Doc {
  const d = pageDoc(m.items);
  const base = masterBase(m);
  d.textStyles = base;
  d.bulk(() => {
    for (const b of masterBoxes(m)) d.addCaption(pageCaption(b, size, base, masterFmt(m, b.ph), {}));
  });
  return d;
}

/** What a layout's References placeholder shows on its page: sample lines, as slides show them. */
export const REFS_SAMPLE = ['¹ J. Am. Chem. Soc. 2021, 143, 4512.', '² Org. Lett. 2019, 21, 8210.'];
const REFS_SIZE = 10;

/** A layout's References placeholder on its page: a text box of sample lines, its box the placeholder's. */
export function refsCaption(box: { x: number; y: number; w: number; h: number }, m: Master, size: SlideSize): Omit<Caption, 'id'> {
  return {
    x: box.x * size.w, y: box.y * size.h + ASCENT * REFS_SIZE, wrap: box.w * size.w, boxH: box.h * size.h, fit: 'fixed', refsBox: true, justify: 'left',
    runs: [{ text: REFS_SAMPLE.join('\n'), size: REFS_SIZE, color: m.footerColor }],
  };
}

/** The References placeholder's box (fractions of the slide) as its text box on the page has it. */
export function refsBoxOf(c: Caption, size: SlideSize): { x: number; y: number; w: number; h: number } {
  const top = c.y - ASCENT * (c.runs[0]?.size ?? REFS_SIZE);
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return { x: r(c.x / size.w), y: r(top / size.h), w: r((c.wrap ?? 0.75 * size.w) / size.w), h: r((c.boxH ?? 0.08 * size.h) / size.h) };
}

/** A layout's page: its placeholders with its own looks set on their text, and its items. */
export function layoutPageDoc(m: Master, def: LayoutDef, size: SlideSize): { doc: Doc; wrote: Partial<Record<Placeholder, PlaceholderFmt>> } {
  const d = pageDoc(def.items);
  const mm = withLayout(m, def);
  const base = textStyles(mm, def.id, false);
  d.textStyles = base;
  const wrote: Partial<Record<Placeholder, PlaceholderFmt>> = {};
  d.bulk(() => {
    for (const b of def.boxes) {
      const f = { ...masterFmt(mm, b.ph, def.id), ...stripUndefined(def.fmt?.[b.ph] ?? {}) };
      wrote[b.ph] ??= paraLook(f);
      d.addCaption(pageCaption(b, size, base, f, def.fmt?.[b.ph] ?? {}));
    }
    if (def.refsBox) d.addCaption(refsCaption(def.refsBox, mm, size));
  });
  return { doc: d, wrote };
}

const stripUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Just the paragraph settings of a look, with their usual values filled in. */
function paraLook(f: PlaceholderFmt): PlaceholderFmt {
  return { lineSpacing: f.lineSpacing ?? 1, spaceBefore: f.spaceBefore ?? 0, spaceAfter: f.spaceAfter ?? 0, bullet: f.bullet ?? 'none' };
}

/** A placeholder's look as its page shows it: its first run's own text settings, and its first paragraph's settings. */
export function captionLook(c: Caption): { text: PlaceholderFmt; para: PlaceholderFmt } {
  const r = c.runs[0];
  const p = c.paras?.[0] ?? {};
  return {
    text: r ? stripUndefined({ font: r.font, size: r.size, color: r.color, bold: r.bold, italic: r.italic }) : {},
    para: { lineSpacing: c.lineSpacing ?? 1, spaceBefore: p.spaceBefore ?? 0, spaceAfter: p.spaceAfter ?? 0, bullet: p.list ?? 'none' },
  };
}

/** A page's placeholders in order: the title, then the others left to right and top to bottom. */
export function pagePlaceholders(d: Doc): Caption[] {
  return [...d.captions.values()].filter((c) => c.ph).sort((a, b) => (a.ph === 'title' ? 0 : 1) - (b.ph === 'title' ? 0 : 1) || a.x - b.x || a.y - b.y);
}

/** A placeholder's box as fractions of the slide. */
export function boxOf(c: Caption, base: TextBase | undefined, size: SlideSize): PlaceholderBox {
  const r = placeholderRect(c, base);
  const t = (v: number) => Math.round(v * 10000) / 10000;
  return { ph: c.ph!, x: t(r.x1 / size.w), y: t(r.y1 / size.h), w: t((r.x2 - r.x1) / size.w), h: t((r.y2 - r.y1) / size.h), justify: c.justify };
}

/** Everything on a page but its placeholders (none when there is nothing). */
export function pageItems(d: Doc): Contents | undefined {
  const c = d.contents();
  c.captions = c.captions.filter((x) => !x.ph && !x.refsBox);
  return c.atoms.length || c.bonds.length || c.captions.length || c.arrows.length || c.shapes.length ? c : undefined;
}

const sameBox = (a: PlaceholderBox, b: PlaceholderBox) => a.ph === b.ph && a.justify === b.justify && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k as 'x'] - b[k as 'x']) < 1e-3);

/**
 * The master as its page has it: its fonts, sizes, colors and the rest of its title's and text's
 * look (from each box's first line), where its boxes are, and its items. `base` is the page's base.
 */
export function readMasterPage(d: Doc, m: Master, base: Record<Placeholder, TextBase>, size: SlideSize): Master {
  const out: Master = { ...m };
  const phFmt: NonNullable<Master['phFmt']> = { ...(m.phFmt ?? {}) };
  const caps = pagePlaceholders(d);
  for (const ph of ['title', 'body'] as const) {
    const c = caps.find((x) => x.ph === ph);
    if (!c) continue;
    const eff = applyBase([c.runs[0] ?? { text: '' }], base[ph])[0];
    if (ph === 'title') {
      out.titleFont = eff.font ?? m.titleFont; out.titleSize = eff.size ?? m.titleSize; out.titleColor = eff.color ?? m.titleColor; out.titleBold = !!eff.bold;
    } else {
      out.bodyFont = eff.font ?? m.bodyFont; out.bodySize = eff.size ?? m.bodySize; out.textColor = eff.color ?? m.textColor;
    }
    const para = captionLook(c).para;
    const usual = ph === 'body' ? 'bullet' : 'none';
    const f = stripUndefined({
      // (the title's bold is the master's own, titleBold)
      bold: ph === 'body' && eff.bold ? true : undefined,
      italic: eff.italic ? true : undefined,
      lineSpacing: para.lineSpacing !== 1 ? para.lineSpacing : undefined,
      spaceBefore: para.spaceBefore || undefined, spaceAfter: para.spaceAfter || undefined,
      bullet: para.bullet !== usual ? para.bullet : undefined,
    });
    if (Object.keys(f).length) phFmt[ph] = f; else delete phFmt[ph];
  }
  if (Object.keys(phFmt).length) out.phFmt = phFmt; else delete out.phFmt;
  const boxes = caps.filter((c) => c.ph === 'title' || c.ph === 'body').map((c) => boxOf(c, base[c.ph!], size));
  const usual = builtinLayout('title-content').boxes;
  // (both boxes: one deleted from the page keeps its place)
  if (boxes.length !== 2 || boxes[0].ph !== 'title') { /* as they were */ } else if (boxes.every((b, i) => sameBox(b, usual[i]))) delete out.phBoxes; else out.phBoxes = boxes;
  const items = pageItems(d);
  if (items) out.items = items; else delete out.items;
  return out;
}

/**
 * A layout as its page has it. `meta` is the layout as it was (its id, name, title slide colors,
 * PowerPoint kind and its own looks); `wrote` the paragraph settings its page was given, so ones
 * still as given keep coming from where they came from. `m` is the master as it now is.
 */
export function readLayoutPage(d: Doc, meta: LayoutDef, m: Master, wrote: Partial<Record<Placeholder, PlaceholderFmt>>, size: SlideSize): LayoutDef {
  const mm = withLayout(m, meta);
  const base = textStyles(mm, meta.id, false);
  const caps = pagePlaceholders(d);
  const seen: Partial<Record<Placeholder, number>> = {};
  const boxes = caps.map((c) => {
    const k = seen[c.ph!] = (seen[c.ph!] ?? 0) + 1;
    const was = meta.boxes.filter((b) => b.ph === c.ph)[k - 1];
    return { ...boxOf(c, base[c.ph!], size), ...(was?.pptType ? { pptType: was.pptType } : {}), ...(was?.lst ? { lst: was.lst } : {}) };
  });
  const fmt: NonNullable<LayoutDef['fmt']> = {};
  for (const ph of ['title', 'subtitle', 'body'] as const) {
    const c = caps.find((x) => x.ph === ph);
    if (!c) continue;
    const look = captionLook(c);
    const master = masterFmt(mm, ph, meta.id);
    const f: PlaceholderFmt = {};
    for (const k of ['font', 'size', 'color'] as const) if (look.text[k] !== undefined && look.text[k] !== master[k]) (f as Record<string, unknown>)[k] = look.text[k];
    for (const k of ['bold', 'italic'] as const) if (look.text[k] !== undefined && !!look.text[k] !== !!master[k]) f[k] = !!look.text[k];
    for (const k of FMT_PARA) {
      const v = look.para[k];
      const keep = wrote[ph] && v === wrote[ph]![k];
      const got = keep ? meta.fmt?.[ph]?.[k] : v === master[k] ? undefined : v;
      if (got !== undefined) (f as Record<string, unknown>)[k] = got;
    }
    if (Object.keys(f).length) fmt[ph] = f;
  }
  const items = pageItems(d);
  const refs = [...d.captions.values()].find((c) => c.refsBox);
  const { fmt: _f, items: _i, boxes: _b, refsBox: _r, ...rest } = meta;
  void _f; void _i; void _b; void _r;
  return { ...rest, boxes, ...(Object.keys(fmt).length ? { fmt } : {}), ...(items ? { items } : {}), ...(refs ? { refsBox: refsBoxOf(refs, size) } : {}) };
}

/** Is this layout id the master's page? */
export const isMasterPage = (id: LayoutId): boolean => id === MASTER_PAGE;
