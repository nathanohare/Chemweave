// The cards in the template window over a new document, spreadsheet or presentation: our own
// document and sheet templates (each shown as a small page of its headings, or its first row of
// column headings), the slide themes (a title slide over a content slide) and starter decks.

import { DOC_CATEGORIES, DOC_TEMPLATES, type DocTemplate } from '../document/templates';
import { newDocument } from '../document/document';
import { SHEET_CATEGORIES, SHEET_TEMPLATES, type SheetTemplate } from '../sheet/templates';
import { SLIDE_TEMPLATES, applyTemplate, type SlideTemplate } from '../deck/templates';
import { STARTER_DECKS, type StarterDeck } from '../deck/starters';
import type { Master, SlideSize } from '../deck/deck';
import { keyOf } from '../sheet/refs';
import { unitPrefs } from '../sheet/template-units';
import { TEMPLATE_CALLOUTS, withSample } from '../sheet/template-samples';
import { forgetTextWidths } from '../render/renderer';
import type { TemplateCategory, TemplateCard } from './template-window';
import { SHEET_TEMPLATE_ICONS } from './sheet-template-icons';
import type { Contents } from '../model';
import type { Workbook } from '../sheet/workbook';

/** Draws a SMILES as a structure for the cards' pictures (set by the program once the chemistry engine can; null when it can't). */
export const templateChem: { toStructure: ((smiles: string, wb: Workbook) => Promise<Contents | null>) | null } = { toStructure: null };

/**
 * A template with its example rows, the SMILES in its Structure columns drawn as structures
 * (as they would be when typed in). Made once for each template and unit choice.
 */
const samples = new Map<string, Promise<Workbook>>();
function sampleBook(t: SheetTemplate): Promise<Workbook> {
  const key = `${t.id}|${unitPrefs.place}`;
  let got = samples.get(key);
  if (!got) {
    // the structures couldn't all be drawn (the chemistry engine still loading): made again next time
    let again = false;
    got = (async () => {
      const wb = withSample(t.id, t.make(unitPrefs.place));
      const draw = templateChem.toStructure;
      if (!draw) { again = true; return wb; }
      const sh = wb.sheets[0];
      const used = sh.usedRange();
      if (!used) return wb;
      const todo: { r: number; c: number; text: string }[] = [];
      for (let c = 0; c <= used.c2; c++) {
        const head = sh.cell(0, c)?.input ?? '';
        if (!/^structures?$/i.test(head.trim())) continue;
        for (let r = 1; r <= used.r2; r++) {
          const text = sh.cell(r, c)?.input;
          if (text) todo.push({ r, c, text });
        }
      }
      const drawn = await Promise.all(todo.map(async (x) => ({ ...x, contents: await draw(x.text, wb).catch(() => null) })));
      wb.build(() => { for (const d of drawn) if (d.contents) sh.setStructure(d.r, d.c, d.contents); });
      if (drawn.some((d) => !d.contents)) again = true;
      return wb;
    })();
    samples.set(key, got);
    // (after the set: forgetting it from inside the function above came before the set and did nothing)
    void got.then(() => { if (again && samples.get(key) === got) samples.delete(key); }, () => { if (samples.get(key) === got) samples.delete(key); });
  }
  return got;
}

/** A small page showing a document template's title and headings. */
export function docPreview(t: DocTemplate): HTMLElement {
  const page = document.createElement('div');
  page.className = 'ft-page';
  page.setAttribute('aria-hidden', 'true');
  const d = t.make();
  const text = d.runs.map((r) => r.text).join('').split('\n');
  d.paras.slice(0, 40).forEach((p, i) => {
    const s = p.style;
    if (s !== 'Title' && s !== 'Heading1' && s !== 'Heading2') return;
    const line = document.createElement('div');
    line.className = s === 'Title' ? 'ft-title' : s === 'Heading1' ? 'ft-h1' : 'ft-h2';
    line.textContent = text[i] ?? '';
    page.append(line);
  });
  return page;
}

/** A small grid showing a sheet template's first rows. */
export function sheetPreview(t: SheetTemplate): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'ft-sheet';
  grid.setAttribute('aria-hidden', 'true');
  const sh = t.make().sheets[0];
  // the heading row: the first row with three or more cells filled (else the first)
  let head = 0;
  for (let r = 0; r < 10; r++) {
    let n = 0;
    for (let c = 0; c < 5; c++) if (sh.cells.get(keyOf(r, c))?.input) n++;
    if (n >= 3) { head = r; break; }
  }
  for (let r = head; r < head + 6; r++) {
    for (let c = 0; c < 5; c++) {
      const cell = document.createElement('span');
      const v = sh.cells.get(keyOf(r, c))?.input ?? '';
      cell.textContent = v.startsWith('=') ? '' : v;
      if (r === head) cell.className = 'ft-head';
      grid.append(cell);
    }
  }
  return grid;
}

/** The drawing code for the cards' pictures, once loaded. */
let thumbs: typeof import('./template-thumbs') | null = null;

/** Draw a card's picture with the real drawing code (loaded when first needed), falling back to the plain outline. */
async function realPicture(host: HTMLElement, plain: () => HTMLElement, real: (m: typeof import('./template-thumbs')) => HTMLElement | Promise<HTMLElement>): Promise<void> {
  try {
    thumbs ??= await import('./template-thumbs');
    if (!host.isConnected) return;
    const pic = await real(thumbs);
    if (!host.isConnected) return;
    host.replaceChildren(pic);
  } catch {
    host.replaceChildren(plain());
  }
}

const docCard = (t: DocTemplate, use: (t: DocTemplate) => void): TemplateCard => ({
  id: t.id, name: t.name, tip: t.blurb,
  // the top of the first page as it prints
  preview: (host) => realPicture(host, () => docPreview(t), (m) => m.docPage(t.make())),
  pick: () => use(t),
});

const sheetCard = (t: SheetTemplate, use: (t: SheetTemplate) => void): TemplateCard => {
  const notes = TEMPLATE_CALLOUTS[t.id];
  return {
    // a small icon, the name and the whole description; the sheet itself shows on hover
    id: t.id, name: t.name, about: t.blurb, icon: SHEET_TEMPLATE_ICONS[t.id],
    preview: () => {},
    // its top rows at full size with a few example rows, a comment box on each worked-out column or cell
    zoom: async () => {
      thumbs ??= await import('./template-thumbs');
      return thumbs.sheetCallouts(await sampleBook(t), notes?.rows ?? 10, notes?.notes ?? [], notes?.head);
    },
    pick: () => use(t),
  };
};

/** The category and card of the blank file, first in each window and chosen when it opens. */
export const BLANK_CATEGORY = 'blank';
export const BLANK_CARD = 'blank';

/** An empty page, the blank document's picture until the drawing code loads. */
function emptyPage(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'ft-page';
  page.setAttribute('aria-hidden', 'true');
  return page;
}

/** The blank file already open behind the window: picking it keeps that file as it is. */
const blankCategory = (card: Omit<TemplateCard, 'id' | 'pick'>): TemplateCategory => ({
  id: BLANK_CATEGORY, name: 'Blank', cards: () => [{ ...card, id: BLANK_CARD, pick: () => {} }],
});

export function documentCategories(use: (t: DocTemplate) => void): TemplateCategory[] {
  return [
    blankCategory({ name: 'Blank document', tip: 'An empty document.', preview: (host) => realPicture(host, emptyPage, (m) => m.docPage(newDocument())) }),
    ...DOC_CATEGORIES.map((c) => ({ id: c.id, name: c.name, cards: () => DOC_TEMPLATES.filter((t) => t.category === c.id).map((t) => docCard(t, use)) })),
  ];
}

/** An empty grid, the Blank spreadsheet card's icon. */
const BLANK_SHEET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14.5h18M9 4v16M15 4v16"/></svg>';

export function sheetCategories(use: (t: SheetTemplate) => void): TemplateCategory[] {
  return [
    blankCategory({ name: 'Blank spreadsheet', about: 'An empty spreadsheet.', icon: BLANK_SHEET_ICON, preview: () => {} }),
    ...SHEET_CATEGORIES.map((c) => ({ id: c.id, name: c.name, cards: () => SHEET_TEMPLATES.filter((t) => t.category === c.id).map((t) => sheetCard(t, use)) })),
  ];
}

export interface SlideChoices {
  master: Master;
  size: SlideSize;
  /** Your own themes. */
  mine: SlideTemplate[];
  useTheme(t: SlideTemplate): void;
  useStarter(s: StarterDeck): void;
  /** Draw a look's title slide over a content slide (from the slide templates window). */
  paint(c: HTMLCanvasElement, m: Master, size: SlideSize, w: number, h: number, stacked: boolean): void;
}

/** Slide themes by group, your own first, then the starter decks. */
export function slideCategories(o: SlideChoices): TemplateCategory[] {
  /** A look's title slide over a content slide. */
  const paintLook = (host: HTMLElement, m: Master) => {
    const c = document.createElement('canvas');
    o.paint(c, m, o.size, 96, 54, true);
    host.replaceChildren(c);
    // the fonts that come with the app load when first used: draw again once they have, with the
    // widths measured in the stand-in font forgotten (else a centered title sits off center)
    if (typeof document.fonts?.load === 'function') {
      void Promise.allSettled([m.titleFont, m.bodyFont].flatMap((f) => [document.fonts.load(`12px "${f}"`), document.fonts.load(`bold 12px "${f}"`)]))
        .then(() => { if (!c.isConnected) return; forgetTextWidths(); o.paint(c, m, o.size, 96, 54, true); });
    }
  };
  const themeCard = (t: SlideTemplate): TemplateCard => ({
    id: `theme-${t.id}`, name: t.name, detail: t.titleFont === t.bodyFont ? t.titleFont : `${t.titleFont} and ${t.bodyFont}`,
    preview: (host) => paintLook(host, applyTemplate(o.master, t)),
    pick: () => o.useTheme(t),
  });
  const groups = ['Mine', 'Light', 'Dark title slide', 'Bright', 'Minimal', 'Bold', 'Classic', 'Chemistry'] as const;
  const out: TemplateCategory[] = [blankCategory({
    // the new presentation as it is, in the look new presentations start with
    name: 'Blank presentation', detail: o.master.titleFont === o.master.bodyFont ? o.master.titleFont : `${o.master.titleFont} and ${o.master.bodyFont}`,
    preview: (host) => paintLook(host, o.master),
  })];
  for (const g of groups) {
    const list = g === 'Mine' ? o.mine : SLIDE_TEMPLATES.filter((t) => t.group === g);
    if (list.length) out.push({ id: `themes-${g.toLowerCase().replace(/ /g, '-')}`, name: g === 'Mine' ? 'Your themes' : g, cards: () => list.map(themeCard) });
  }
  out.push({
    id: 'teaching', name: 'Teaching', cards: () => STARTER_DECKS.map((s) => ({
      id: `starter-${s.id}`, name: s.name, detail: `${s.slides.length} slides`, tip: s.blurb,
      preview: (host) => {
        const page = document.createElement('div');
        page.className = 'ft-page ft-deck';
        page.setAttribute('aria-hidden', 'true');
        for (const p of s.slides.slice(0, 9)) {
          const line = document.createElement('div');
          line.className = p.layout === 'title' ? 'ft-title' : 'ft-h2';
          line.textContent = p.text[0] ?? '';
          page.append(line);
        }
        host.replaceChildren(page);
      },
      pick: () => o.useStarter(s),
    })),
  });
  return out;
}
