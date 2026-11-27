// Word's Paragraph settings as rows of fields: alignment, the left, right and first-line indents,
// the space before and after, line spacing (a multiple, at least or exactly so many points), and
// the line and page breaks (start on a new page or column, keep with next, keep lines together).
// Document mode's side panel (doc-panel.ts) and the SI's Live Preview (Home ▸ Paragraph's corner
// box) both build them here, each with hooks for the paragraph they show and how a change is made.
// Every value can be typed in; lengths take inches, cm, mm or pt ("2.5 cm").

import type { Justify, ParaStyle } from '../model';
import { CM, INCH } from '../document/document';

/**
 * A length typed by the person, in points: "1", "1 in", '1"', "2.5 cm", "20 mm", "12 pt".
 * A bare number is in `unit`. Null when it isn't a length.
 */
export function parseLength(text: string, unit: 'in' | 'pt' | 'cm'): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(in|inch|inches|"|”|cm|mm|pt|points?)?\s*$/i.exec(text);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const u = (m[2] ?? unit).toLowerCase();
  if (u === 'cm') return v * CM;
  if (u === 'mm') return (v * CM) / 10;
  if (u.startsWith('p')) return v;
  return v * INCH;
}

/** A length in points shown in a unit, without needless decimals. */
export function showLength(pt: number, unit: 'in' | 'pt' | 'cm'): string {
  const v = unit === 'in' ? pt / INCH : unit === 'cm' ? pt / CM : pt;
  return String(Math.round(v * 100) / 100);
}

export const ALIGNS: [Justify, string][] = [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justified']];

type Field = HTMLInputElement | HTMLSelectElement;

/** A settings panel's fields, each by its key: labeled rows, check boxes, text fields that act on Enter or when left, lists and buttons. */
export class PanelFields {
  readonly fields = new Map<string, Field>();

  /** `focus`: back to the text (after a change, Enter or Escape). */
  constructor(private readonly focus: () => void) {}

  row(sec: HTMLElement, label: string, el: HTMLElement, title?: string): void {
    const l = document.createElement('label');
    l.className = 'style-row';
    const s = document.createElement('span');
    s.textContent = label;
    l.append(s, el);
    if (title) l.title = title;
    sec.append(l);
  }

  check(sec: HTMLElement, key: string, label: string, on: (v: boolean) => void, title?: string): void {
    const l = document.createElement('label');
    l.className = 'style-row check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => { on(box.checked); this.focus(); });
    l.append(box, document.createTextNode(label));
    if (title) l.title = title;
    this.fields.set(key, box);
    sec.append(l);
  }

  /** A text field that acts on Enter or when left; Escape goes back to the text. */
  input(key: string, on: (v: string) => void, opts: { list?: string; placeholder?: string } = {}): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'text';
    el.className = 'dp-input';
    el.spellcheck = false;
    if (opts.list) el.setAttribute('list', opts.list);
    if (opts.placeholder) el.placeholder = opts.placeholder;
    let before = '';
    el.addEventListener('focus', () => { before = el.value; });
    const apply = () => { if (el.value !== before) { before = el.value; on(el.value); } };
    el.addEventListener('change', apply);
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); apply(); this.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); el.value = before; this.focus(); }
    });
    this.fields.set(key, el);
    return el;
  }

  select(key: string, options: [string, string][], on: (v: string) => void): HTMLSelectElement {
    const el = document.createElement('select');
    for (const [v, label] of options) el.append(new Option(label, v));
    el.addEventListener('change', () => { on(el.value); this.focus(); });
    el.addEventListener('keydown', (e) => e.stopPropagation());
    this.fields.set(key, el);
    return el;
  }

  buttons(sec: HTMLElement, list: [string, string, () => void][]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'style-buttons';
    for (const [label, title, on] of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { on(); this.focus(); });
      box.append(b);
    }
    sec.append(box);
    return box;
  }

  /** Show a value in a field (not the one being typed in). */
  put(key: string, v: string | boolean): void {
    const el = this.fields.get(key);
    if (!el || el === document.activeElement) return;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!v;
    else if (el.value !== String(v)) el.value = String(v);
  }
}

export interface ParaRowsHooks {
  /** The paragraph's settings now (the first one selected), or null when there is none. */
  para(): ParaStyle | null;
  /** Change the selected paragraphs: a value left undefined takes that setting off (`kind`: what Undo calls it). */
  apply(patch: Partial<ParaStyle>, kind: string): void;
}

export interface ParaRowsOptions {
  /** Start a new column (documents set in columns). */
  colBreak?: boolean;
  /** The id of the line spacings' list of choices (one per panel on the page). */
  linesId: string;
}

/** Word's Paragraph settings in `sec`; returns what shows the paragraph's settings again. */
export function buildParaRows(sec: HTMLElement, kit: PanelFields, hooks: ParaRowsHooks, opts: ParaRowsOptions): () => void {
  const paras = (patch: Partial<ParaStyle>, kind = 'para') => hooks.apply(patch, kind);
  kit.row(sec, 'Alignment', kit.select('p-align', ALIGNS, (v) => paras({ align: v === 'left' ? undefined : (v as Justify) }, 'align')));
  kit.row(sec, 'Indent (in)', kit.input('p-indent', (v) => { const n = parseLength(v, 'in'); if (n !== null) paras({ indent: n || undefined }, 'indent'); }), 'From the left margin; less than 0 goes into it');
  kit.row(sec, 'First line (in)', kit.input('p-first', (v) => { const n = parseLength(v, 'in'); if (n !== null) paras({ firstLine: n || undefined }, 'indent'); }), 'The first line\'s indent from the rest; less than 0 hangs it out to the left');
  kit.row(sec, 'Space before (pt)', kit.input('p-before', (v) => { const n = parseLength(v, 'pt'); if (n !== null) paras({ spaceBefore: Math.max(0, n) }, 'spacing'); }));
  kit.row(sec, 'Space after (pt)', kit.input('p-after', (v) => { const n = parseLength(v, 'pt'); if (n !== null) paras({ spaceAfter: Math.max(0, n) }, 'spacing'); }));
  kit.row(sec, 'Right indent (in)', kit.input('p-right', (v) => { const n = parseLength(v, 'in'); if (n !== null) paras({ indentRight: n || undefined }, 'indent'); }), 'From the right margin; less than 0 goes into it');
  kit.row(sec, 'Line spacing', kit.select('p-rule', [['multiple', 'Multiple'], ['atLeast', 'At least'], ['exact', 'Exactly']], (v) => {
    const p = hooks.para();
    if (v === 'multiple') paras({ linePt: undefined, lineRule: undefined }, 'spacing');
    else paras({ linePt: p?.linePt ?? 12, lineRule: v as 'exact' | 'atLeast', line: undefined }, 'spacing');
  }), 'Multiple: times single spacing. At least or Exactly: a height in points (Exactly can cut off tall figures, as in Word)');
  kit.row(sec, 'At', kit.input('p-line', (v) => {
    const p = hooks.para();
    if (p?.linePt) { const n = parseLength(v, 'pt'); if (n !== null && n > 0 && n <= 1584) paras({ linePt: n }, 'spacing'); return; }
    const n = Number(v);
    if (n > 0 && n <= 10) paras({ line: Math.abs(n - 1) < 1e-6 ? undefined : n }, 'spacing');
  }, { list: opts.linesId }), 'Times single spacing (1, 1.15, 1.5, 2…), or points for At least and Exactly');
  const lines = document.createElement('datalist');
  lines.id = opts.linesId;
  for (const v of ['1', '1.15', '1.5', '2', '2.5', '3']) lines.append(new Option(v));
  sec.append(lines);
  kit.check(sec, 'p-break', 'Start on a new page', (v) => paras({ pageBreak: v || undefined }, 'break'), 'A page break before this paragraph (Word\'s Page break before; Ctrl+Enter makes one at the cursor)');
  if (opts.colBreak) kit.check(sec, 'p-colbreak', 'Start a new column', (v) => paras({ colBreak: v || undefined }, 'break'), 'In a page of columns: this paragraph starts the next column (Ctrl+Shift+Enter makes one at the cursor)');
  kit.check(sec, 'p-keep', 'Keep with next', (v) => paras({ keepNext: v || undefined }, 'keep'), 'On the same page as the paragraph after it (headings do this)');
  kit.check(sec, 'p-keeplines', 'Keep lines together', (v) => paras({ keepLines: v || undefined }, 'keep'), 'All of the paragraph\'s lines on one page: it is not split across pages');
  return () => {
    const p = hooks.para();
    for (const el of kit.fields.values()) if (sec.contains(el)) el.disabled = !p;
    if (!p) return;
    kit.put('p-align', p.align ?? 'left');
    kit.put('p-indent', showLength(p.indent ?? 0, 'in'));
    kit.put('p-first', showLength(p.firstLine ?? 0, 'in'));
    kit.put('p-before', showLength(p.spaceBefore ?? 0, 'pt'));
    kit.put('p-after', showLength(p.spaceAfter ?? 0, 'pt'));
    kit.put('p-right', showLength(p.indentRight ?? 0, 'in'));
    kit.put('p-rule', p.linePt ? p.lineRule ?? 'atLeast' : 'multiple');
    kit.put('p-line', p.linePt ? showLength(p.linePt, 'pt') : String(p.line ?? 1));
    kit.put('p-break', !!p.pageBreak);
    kit.put('p-colbreak', !!p.colBreak);
    kit.put('p-keep', !!p.keepNext);
    kit.put('p-keeplines', !!p.keepLines);
  };
}
