// The Knowledge Base window (Chemistry > Knowledge Base…, in every mode): reference tables to look
// things up in while working, without a drawing. One search box finds rows by name, CAS number,
// formula or SMILES, and a number typed alone (2.17) finds the chemical shifts near it. A SMILES
// (typed, or the structure selected in the drawing) finds that compound and then every compound
// containing it. Each table
// can be filtered by a column (Solvent, Kind), sorted by any column, and copied to paste into a
// sheet or document. Every abbreviation shows what it means when the mouse rests on it.
//
// Tables you import (a CSV or tab-separated file, or text pasted from a spreadsheet) are kept on
import { addCloseX } from './window-x';
// this computer only, for data you have a copy of but the program can't carry.

import { BUILT_IN_TABLES, LATER_ROWS, LATER_TABLES } from '../kb/data';
import type { SafetyRecord } from '../kb/safety';
import { safetyRow, sortSafety } from '../kb/safety-tables';
import { explainPieces, glossaryEntry } from '../kb/glossary';
import { CANONICAL_ROWS, COL_MAX, COL_MIN, LINKS_COL, PRESENT, filterValues, findRows, groupRows, inlineGroups, isCas, layoutId, looksLikeSmiles, moveColumn, orderColumns, parseUserTable, sortRows, tableTsv, type KbColumn, type KbLayout, type KbTable, type RowMatch } from '../kb/tables';
import { showContextMenu } from './context-menu';
import { ask } from './ask';
import { infoIcon, setInfo } from './info-tip';
import { templateIcon } from './template-icons';
import { svgNode } from './svg-node';
import { prettyChem } from '../kb/pretty';
import type { Template } from '../chem/templates';
import type { Contents } from '../model';
import { ICONS } from '../icons';

/** A structure picture in a table cell, in pixels. */
const PIC = 48;
/** A series' parent compound on its group heading, in pixels. */
const GROUP_PIC = 40;
/** The structure shown beside a solvent's name, in pixels. */
const STRUCTURE_PIC = 120;

/** The Look up column (each row's links), placed and sized like the table's own columns. */
const LOOK_UP: KbColumn = { key: LINKS_COL, label: 'Look up' };

/** Rows built when a table is shown, and how many more each time it is scrolled near its end. */
const FIRST_ROWS = 60;
const MORE_ROWS = 300;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const button = (label: string, title: string, on: () => void, primary = false): HTMLButtonElement => {
  const b = el('button', { type: 'button', textContent: label, title });
  if (primary) b.className = 'primary';
  b.addEventListener('click', on);
  return b;
};

/** Text with its abbreviations explained on hover (each one an <abbr> with its meaning as the tooltip). */
export function explained(text: string, nuclei = false): DocumentFragment {
  const f = document.createDocumentFragment();
  // formulas with real subscripts (CDCl₃), nuclei with superscripts (¹H): shown so, searched as typed
  for (const p of explainPieces(text)) { const t = prettyChem(p.text, nuclei); f.append(p.tip ? el('abbr', { textContent: t, title: p.tip }) : withSigma(t)); }
  return f;
}

/** Text with the m and p of Hammett's σm and σp as italic subscripts. */
function withSigma(text: string): DocumentFragment | string {
  if (!/σ[mpoIR]/.test(text)) return text;
  const f = document.createDocumentFragment();
  for (const part of text.split(/(σ[mpoIR](?![A-Za-z]))/)) {
    if (/^σ[mpoIR]$/.test(part)) f.append('σ', el('sub', {}, el('i', { textContent: part[1] })));
    else if (part) f.append(part);
  }
  return f;
}

/**
 * A cell's text with its abbreviations explained. A short list cell (multiplicities "sept, s")
 * is explained piece by piece, so a lone "s" or "t" gets its tooltip there and nowhere else.
 */
function cellExplained(text: string, list: boolean, nuclei = false): DocumentFragment {
  if (!list) return explained(text, nuclei);
  const f = document.createDocumentFragment();
  for (const part of text.split(/(,\s*)/)) f.append(/^,/.test(part) ? part : explained(part, nuclei));
  return f;
}

/** A table's NMR solvent filter column (an impurity table's), if it has one: a table of shifts with a Solvent column. */
function solventColumn(t: KbTable): KbColumn | undefined {
  if (!t.columns.some((c) => c.shift)) return undefined;
  return t.columns.find((c) => c.filter === true && /^(nmr )?solvent$/i.test(c.label));
}

/** The same NMR solvent under another name: "CDCl3", "Chloroform-d", "cdcl3". */
const SOLVENT_NAMES = [
  ['cdcl3', 'chloroform-d', 'chloroform'], ['acetone-d6', '(cd3)2co', 'acetone'], ['dmso-d6', '(cd3)2so', 'dmso', 'dimethyl sulfoxide-d6'],
  ['cd3cn', 'acetonitrile-d3', 'acetonitrile'], ['cd3od', 'methanol-d4', 'methanol'], ['d2o', 'deuterium oxide'], ['c6d6', 'benzene-d6', 'benzene'],
  ['thf-d8', 'tetrahydrofuran-d8', 'c4d8o'], ['toluene-d8', 'c6d5cd3', 'c7d8'], ['cd2cl2', 'dichloromethane-d2'], ['c5d5n', 'pyridine-d5'],
];
export function matchSolvent(values: string[], wanted: string): string | null {
  const key = (v: string) => { const l = v.trim().toLowerCase(); return SOLVENT_NAMES.find((n) => n.includes(l))?.[0] ?? l; };
  const w = key(wanted);
  return values.find((v) => key(v) === w) ?? null;
}

const NMR_SOLVENT_KEY = 'chem-illustrator.kb.nmrSolvent';
/** Compact rows (one line each, structures behind the name): kept on this computer. */
const COMPACT_KEY = 'chem-illustrator.kb.compact';
function readCompact(): boolean {
  try { return localStorage.getItem(COMPACT_KEY) === '1'; } catch { return false; }
}
function writeCompact(on: boolean): void {
  try { if (on) localStorage.setItem(COMPACT_KEY, '1'); else localStorage.removeItem(COMPACT_KEY); } catch { /* not kept */ }
}
function readNmrSolvent(): string {
  try { return localStorage.getItem(NMR_SOLVENT_KEY) ?? ''; } catch { return ''; }
}
function writeNmrSolvent(v: string): void {
  try { if (v) localStorage.setItem(NMR_SOLVENT_KEY, v); else localStorage.removeItem(NMR_SOLVENT_KEY); } catch { /* not kept */ }
}

export interface KnowledgeBaseHost {
  flash(msg: string, ms?: number): void;
  /** The canonical SMILES of a structure, or null when it can't be read. */
  canonical(smiles: string): Promise<string | null>;
  /** The tables imported before (JSON), or null. */
  readImported(): Promise<string | null>;
  writeImported(json: string): Promise<void>;
  /** A text file the user picks (CSV or tab-separated), or null. */
  pickTable(): Promise<{ name: string; text: string } | null>;
  copyText(text: string): Promise<void>;
  openUrl(url: string): void;
  /** PubChem's compound number for a CAS number (the big tables carry no CAS numbers). */
  cidForCas?(cas: string): Promise<number | null>;
  /** A compound's hazard record read live from PubChem (a name, CAS number or SMILES), or null. */
  lookUpSafety?(query: string): Promise<SafetyRecord | null>;
  /** Which of these SMILES contain the structure (a substructure search): their indexes, or null when the engine isn't ready. */
  contains?(query: string, smiles: string[]): Promise<number[] | null>;
  /** The SMILES of the structure selected in the drawing, or a sentence saying why there is none. */
  selected?(): Promise<{ smiles: string } | string>;
  /** Drawing the structure to search for with the program's drawing tools (the Draw window). */
  drawing?: KbDrawing;
  /** Where each table's column layout (widths, order) is kept: the settings file. Without it, only while the program runs. */
  layout?: { get(id: string): KbLayout | undefined; set(id: string, layout: KbLayout | null): void };
}

/** The program's drawing tools, working in the Draw window's box. */
export interface KbDrawing {
  /** Draw `contents` (null: start empty) in the box `area` gives the place of on screen; `done` hears the drawing when it ends (null: cancelled). */
  start(contents: Contents | null, area: () => DOMRect | null, done: (c: Contents | null) => void): void;
  /** End the drawing: true keeps it (Search), false cancels. */
  finish(keep: boolean): void;
  /** Pick a drawing tool by name (bond-single, ring-benzene, eraser…), or an element by its atomic number. */
  tool(t: string | number): void;
  /** The tool in use (the element tool as its element's atomic number), to light its button. */
  current(): string | number;
  /** The structure selected in the drawing (read before the Draw window opens), or a sentence saying why there is none. */
  selection(): Contents | string;
  /**
   * A drawing's SMILES (several structures joined by "."), or a sentence saying why it can't be
   * read. With `on`, the drawing's attachment point (if it has one) is joined to that structure.
   */
  smiles(c: Contents, on?: string): Promise<{ smiles: string } | string>;
  /** A drawing of an attachment point (a wavy line) on the end of a bond, to draw a group out from. */
  group(): Contents;
}

/** The Draw window's tools: bonds, rings, a chain and the eraser, then common elements. */
const DRAW_TOOLS: [string, string][] = [
  ['bond-single', 'Single bond'], ['bond-double', 'Double bond'], ['bond-triple', 'Triple bond'], ['bond-wedge', 'Wedged bond'], ['bond-hashWedge', 'Hashed wedged bond'],
  ['ring-benzene', 'Benzene ring'], ['ring-6', 'Cyclohexane ring'], ['ring-5', 'Cyclopentane ring'], ['chain', 'Chain'], ['eraser', 'Eraser'],
];
const DRAW_ATOMS: [string, number][] = [['C', 6], ['H', 1], ['N', 7], ['O', 8], ['S', 16], ['P', 15], ['F', 9], ['Cl', 17], ['Br', 35], ['I', 53]];
const DRAW_INFO = 'Draw the structure or substructure to find, using these buttons, the toolbox and the usual keys (point at an atom and type N, O, Cl…). Search finds that compound, then every compound containing it, in every table. Draw… reopens the drawing; Use Selected starts from the structure selected in the drawing.';
const GROUP_INFO = 'Draw the group outward from the attachment point (the wavy line): point at the carbon and type O, N, Cl…, or draw bonds from it. Search finds that group, then every group containing it. Without an attachment point, the drawing is searched as a whole substituted benzene. Draw… reopens the drawing.';

export { looksLikeSmiles };

export class KnowledgeBaseWindow {
  private d: HTMLDialogElement | null = null;
  private tables: KbTable[] = [...BUILT_IN_TABLES];
  private current: KbTable = BUILT_IN_TABLES[0];
  private search!: HTMLInputElement;
  /** Draw… (or Use Selected): hidden with the search box on a table that isn't searched. */
  private findBtn: HTMLButtonElement | null = null;
  private list!: HTMLDivElement;
  private filters!: HTMLDivElement;
  private about!: HTMLElement;
  private title!: HTMLHeadingElement;
  private titleText!: HTMLSpanElement;
  private wrap!: HTMLDivElement;
  /** The table's sources (links), in a card opened from the Sources button. */
  private sources!: HTMLElement;
  private sourcesBtn!: HTMLButtonElement;
  /** One line per row, structures behind the name (the Compact Rows box). */
  private compact = readCompact();
  private count!: HTMLSpanElement;
  private removeBtn!: HTMLButtonElement;
  private picked: Record<string, string> = {};
  /** The NMR solvent last picked in a Solvent filter: impurity tables open showing that solvent. */
  private nmrSolvent = readNmrSolvent();
  private sort: { key: string; down: boolean } | null = null;
  /** The groups folded away, by table (a table with `group`): kept while the program runs. A table whose groups start folded keeps the ones opened instead. */
  private folded = new Map<string, Set<string>>();
  /** The table showing last (a different one starts scrolled to its top). */
  private shownId = '';
  /** Canonical SMILES of each row's structure (worked out once, when a SMILES is first searched). */
  private canon = new Map<string, string | null>();
  /** The canonical form of the SMILES typed, when the search is one. */
  private queryCanon: string | null = null;
  /** The rows' SMILES that contain the structure searched for (null: not looked for yet). */
  private containing: Set<string> | null = null;
  /** Still looking for the structures containing the one searched for. */
  private lookingInside = false;
  private searchToken = 0;
  /** Builds more rows of the table showing (as it is scrolled down). */
  private moreRows: ((n?: number) => void) | null = null;
  private loaded = false;
  /** The PubChem compound a CAS number typed belongs to, for rows that carry no CAS number. */
  private casCid: number | null = null;
  /** The Draw window, while it is open, and its box (where the drawing tools work). */
  private drawWin: HTMLDivElement | null = null;
  private drawBox: HTMLDivElement | null = null;
  /** The drawing searched for last: Draw… opens it again. */
  private drawn: Contents | null = null;
  /** The group last searched for, on a table of groups (Hammett), and whether the Draw window is drawing one, on which structure. */
  private drawnGroup: Contents | null = null;
  private drawOn: string | null = null;
  /** The structure selected in the drawing when Draw… was pressed (or why there was none). */
  private drawSelected: Contents | string = '';
  /** Each drawing started (a newer one makes the older one's end not count). */
  private drawToken = 0;
  private drawLight = 0;
  /** The structure card showing beside a name (one at a time; see structureOnHover). */
  private structurePop: HTMLElement | null = null;
  /** Column layouts, when the host doesn't keep them. */
  private layouts = new Map<string, KbLayout>();
  /** A header was just dragged to move its column: the click that ends the drag doesn't sort. */
  private moved = false;

  constructor(private host: KnowledgeBaseHost) {}

  get isOpen(): boolean { return !!this.d; }

  async open(query = ''): Promise<void> {
    if (!this.loaded) await this.loadImported();
    if (this.d) { if (query) { this.search.value = query; this.searchChanged(); } this.search.focus(); return; }
    const d = (this.d = el('dialog', { className: 'refs-dialog kb-window' }));
    d.setAttribute('aria-label', 'Knowledge Base');
    d.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && this.structurePop) { e.preventDefault(); this.hideStructurePop(); }
      else if (e.key === 'Escape' && !this.sources.hidden) { e.preventDefault(); this.sources.hidden = true; this.sourcesBtn.setAttribute('aria-expanded', 'false'); }
    });
    // a structure card never outlives the pointer resting on its name: a click, a dropdown or a key
    // moving the focus, scrolling, or leaving the window puts it away
    const hidePop = () => this.hideStructurePop();
    d.addEventListener('pointerdown', hidePop, true);
    d.addEventListener('focusin', hidePop);
    d.addEventListener('scroll', hidePop, { capture: true, passive: true });
    d.addEventListener('wheel', hidePop, { passive: true });
    window.addEventListener('blur', hidePop);
    this.search = el('input', { type: 'search', placeholder: 'Name, CAS, SMILES or a shift (2.17)', title: 'Search every table by name, CAS number, any word, or a chemical shift (2.17 finds peaks within 0.05 ppm in 1H, 0.5 in 13C). A SMILES finds that compound, then every compound containing it', value: query });
    this.search.setAttribute('aria-label', 'Search the Knowledge Base');
    // a single letter matches most of every table (~110 ms): wait a moment for the next key first
    let wait = 0;
    this.search.addEventListener('input', () => {
      clearTimeout(wait);
      if (this.search.value.trim().length === 1) wait = window.setTimeout(() => this.searchChanged(), 200);
      else this.searchChanged();
    });
    this.list = el('div', { className: 'kb-list', role: 'tablist' });
    this.list.setAttribute('aria-label', 'Tables');
    this.filters = el('div', { className: 'refs-filter kb-filters' });
    // the table's name with its description behind an "i" (UI rule 2), and its filters, in the
    // title row above the table: no line of their own
    this.title = el('h3', { className: 'kb-title has-info' });
    this.titleText = el('span');
    this.about = infoIcon('');
    this.title.append(this.titleText, this.about);
    this.wrap = el('div', { className: 'refs-table-wrap kb-table-wrap' });
    this.wrap.addEventListener('scroll', () => { const w = this.wrap; if (w.scrollTop + w.clientHeight > w.scrollHeight - 600) this.moreRows?.(); }, { passive: true });
    // the sources sit behind a button by the row count (UI rule 2): a card, since they are links
    this.sources = el('div', { className: 'info-pop kb-sources', hidden: true });
    this.sourcesBtn = button('Sources', 'Where this table\'s values come from', () => { this.sources.hidden = !this.sources.hidden; this.sourcesBtn.setAttribute('aria-expanded', String(!this.sources.hidden)); });
    this.sourcesBtn.classList.add('kb-sources-btn');
    this.sourcesBtn.setAttribute('aria-expanded', 'false');
    d.addEventListener('pointerdown', (e) => { if (!this.sources.hidden && !(e.target as Element).closest('.kb-sources, .kb-sources-btn')) { this.sources.hidden = true; this.sourcesBtn.setAttribute('aria-expanded', 'false'); } });
    const compact = el('input', { type: 'checkbox', checked: this.compact });
    compact.addEventListener('change', () => { this.compact = compact.checked; writeCompact(this.compact); this.showTable(); });
    const compactBox = el('label', { className: 'kb-compact-box', title: 'One line per row: longer text shows when the pointer rests on it, and a structure when it rests on the name' }, compact, 'Compact Rows');
    this.count = el('span', { className: 'muted' });
    this.removeBtn = button('Remove Table…', 'Remove the imported table shown (from this computer only)', () => void this.removeImported());
    this.findBtn = this.host.drawing ? button('Draw…', 'Draw the structure to search for: that compound, then every compound containing it', () => this.openDraw())
      : this.host.selected ? button('Use Selected', 'Search for the structure selected in the drawing: that compound, then every compound containing it', () => void this.useSelected()) : null;
    d.append(
      el('div', { className: 'refs-head kb-head' }, el('h2', { textContent: 'Knowledge Base' }), el('div', { className: 'kb-top' }, this.title, this.filters), this.search,
        ...(this.findBtn ? [this.findBtn] : [])),
      el('div', { className: 'kb-body' },
        this.list,
        el('div', { className: 'kb-main' }, this.wrap)),
      el('div', { className: 'refs-buttons' },
        el('span', { className: 'refs-add' },
          button('Import Table…', 'Add a custom table from a CSV or tab-separated file (or paste one from a spreadsheet). It is kept on this computer only', () => void this.importTable()),
          this.removeBtn),
        el('span', { className: 'refs-edit kb-foot' },
          compactBox,
          el('span', { className: 'kb-sources-at' }, this.sourcesBtn, this.sources),
          this.count,
          button('Copy Table', 'Copy the rows showing, to paste into a sheet, a document table, Word or Excel', () => void this.copy()))),
    );
    addCloseX(d, d.querySelector<HTMLElement>('.refs-head')!);
    d.addEventListener('close', () => { this.hideStructurePop(); window.removeEventListener('blur', hidePop); this.closeDraw(true); d.remove(); this.d = null; });
    document.body.append(d);
    this.showList();
    this.showTable();
    d.show();
    this.search.focus();
    if (query) this.searchChanged();
  }

  close(): void { this.d?.close(); }

  /** The tables the window offers now (built in, then imported). */
  get allTables(): KbTable[] { return this.tables; }

  private async loadImported(): Promise<void> {
    this.loaded = true;
    // the big built-in tables go before the glossary, which stays last of the built-in ones
    for (const later of LATER_TABLES) {
      try {
        const t = await later();
        const at = this.tables.findIndex((x) => x.id === 'glossary');
        this.tables.splice(at < 0 ? this.tables.length : at, 0, t);
      } catch { /* not there (offline web build): the window works without it */ }
    }
    // more rows for built-in tables (the big Reagent Safety table), merged in where they belong
    for (const later of LATER_ROWS) {
      try {
        const extra = await later.rows();
        const i = this.tables.findIndex((x) => x.id === later.table);
        if (i < 0) continue;
        const t = this.tables[i];
        const have = new Set(t.rows.map((r) => r.cid));
        const rows = [...t.rows, ...extra.filter((r) => !have.has(r.cid))];
        const merged = { ...t, rows: t.id === 'reagent-safety' ? sortSafety(rows) : rows.sort((a, b) => String(a.name).localeCompare(String(b.name))) };
        this.tables[i] = merged;
        if (this.current === t) this.current = merged;
      } catch { /* not there (offline web build): the window works without it */ }
    }
    try {
      const text = await this.host.readImported();
      if (!text) return;
      const got = JSON.parse(text) as KbTable[];
      if (!Array.isArray(got)) return;
      for (const t of got) if (t && typeof t.id === 'string' && Array.isArray(t.rows) && Array.isArray(t.columns)) this.tables.push({ ...t, personal: true });
    } catch { /* a damaged file: start without imported tables */ }
  }

  private async saveImported(): Promise<void> {
    await this.host.writeImported(JSON.stringify(this.tables.filter((t) => t.personal), null, 1));
  }

  /** The table list on the left, each with how many rows match the search. */
  private showList(): void {
    const q = this.search.value.trim();
    this.list.replaceChildren(...this.tables.map((t) => {
      const n = q && !t.noSearch ? this.matches(t, false).length : t.rows.length;
      const b = el('button', { type: 'button', className: `kb-tab${t === this.current ? ' on' : ''}`, title: t.about },
        el('span', { textContent: t.title }), el('span', { className: 'muted', textContent: String(n) }));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t === this.current));
      if (t.personal) b.classList.add('personal');
      if (q && !n) b.classList.add('none');
      b.addEventListener('click', () => { this.current = t; this.picked = {}; this.sort = null; this.showList(); this.showTable(); });
      return b;
    }));
  }

  /** The rows matched for each table and search, so one key typed matches each table once (the counts on the left and the table showing ask for the same). */
  private matchMemo = new Map<string, readonly RowMatch[]>();

  private matches(t: KbTable, withFilters = true): RowMatch[] {
    const filters = withFilters ? this.filtersFor(t) : {};
    const key = JSON.stringify([t.id, t.personal === true, t.rows.length, this.search.value, this.queryCanon, this.casCid, this.canon.size, this.containing?.size ?? -1, filters]);
    const got = this.matchMemo.get(key);
    if (got) return [...got];
    if (this.matchMemo.size > 200) this.matchMemo.clear();
    const found = this.findMatches(t, filters);
    this.matchMemo.set(key, found);
    return [...found];
  }

  private findMatches(t: KbTable, filters: Record<string, string>): RowMatch[] {
    // a table read whole: every row, whatever is typed
    if (t.noSearch) return findRows(t, '', filters);
    // a structure: the same compound first, then the ones containing it
    if (this.queryCanon) {
      const same: RowMatch[] = [], inside: RowMatch[] = [];
      for (const m of findRows(t, '', filters)) {
        const s = m.row.smiles;
        if (typeof s !== 'string') continue;
        if (this.canon.get(s) === this.queryCanon) same.push({ ...m, same: true });
        else if (this.containing?.has(s)) inside.push({ ...m, same: false });
      }
      return [...same, ...inside];
    }
    let found = findRows(t, this.search.value, filters);
    // a CAS number typed also finds rows without CAS numbers, by the compound PubChem gives it
    if (this.casCid !== null) {
      const seen = new Set(found.map((m) => m.row));
      found = [...found, ...findRows(t, '', filters).filter((m) => m.row.cid === this.casCid && !seen.has(m.row))];
    }
    // an abbreviation typed (THF, DCM, DMAP) also finds the rows that spell it out
    const full = !this.queryCanon && t.id !== 'glossary' ? glossaryEntry(this.search.value)?.full.replace(/\s*\(.*?\)/g, '').trim() : '';
    if (!full) return found;
    const seen = new Set(found.map((m) => m.row));
    return [...found, ...findRows(t, full, filters).filter((m) => !seen.has(m.row))];
  }

  private searchChanged(): void {
    const q = this.search.value.trim();
    const token = ++this.searchToken;
    this.queryCanon = null;
    this.containing = null;
    this.lookingInside = false;
    this.casCid = null;
    if (looksLikeSmiles(q)) void this.smilesSearch(q, token);
    if (isCas(q)) void this.casSearch(q, token);
    // (a structure moves to a table once its matches are in: its SMILES as words would match another table's)
    if (!looksLikeSmiles(q)) this.jumpToMatches();
    this.showList();
    this.showTable();
    // what was found starts at the top
    this.wrap.scrollTop = 0;
  }

  /** Move to the first table a search finds something in, when the one showing has nothing (or is read whole, unsearched). */
  private jumpToMatches(): void {
    if (!this.search.value.trim() || (!this.current.noSearch && this.matches(this.current).length)) return;
    const other = this.tables.find((t) => !t.noSearch && this.matches(t, false).length);
    if (other) { this.current = other; this.picked = {}; }
  }

  /** A CAS number typed: ask PubChem which compound it is, to find rows that carry no CAS number. */
  private async casSearch(q: string, token: number): Promise<void> {
    const cid = await this.host.cidForCas?.(q).catch(() => null) ?? null;
    if (token !== this.searchToken || cid === null) return;
    this.casCid = cid;
    this.jumpToMatches();
    this.showList();
    this.showTable();
  }

  /** Rate a compound that isn't in Reagent Safety, live from PubChem, and add it for this session. */
  private async rateLive(q: string): Promise<void> {
    const h = this.host;
    if (!h.lookUpSafety) return;
    h.flash(`Looking up ${q} on PubChem…`, 30000);
    let r: SafetyRecord | null;
    try {
      r = await h.lookUpSafety(q);
    } catch (e) {
      h.flash(`Couldn't rate ${q}: ${e instanceof Error ? e.message : e}`, 6000);
      return;
    }
    if (!r) { h.flash(`PubChem has no compound called “${q}”. Try another name, the CAS number or a SMILES.`, 6000); return; }
    const i = this.tables.findIndex((t) => t.id === 'reagent-safety');
    if (i < 0) return;
    const t = this.tables[i];
    if (!t.rows.some((x) => x.cid === r.cid)) {
      const row = safetyRow(r);
      row.sources = `Read live from PubChem, ${new Date().toISOString().slice(0, 10)}${row.sources ? '; ' + row.sources : ''}`;
      this.tables[i] = { ...t, rows: sortSafety([...t.rows, row]) };
    }
    this.current = this.tables[i];
    this.picked = {};
    this.search.value = r.name;
    this.searchChanged();
    h.flash(`${r.name}: rated from PubChem's open records. It stays in the table until Chemweave closes.`, 6000);
  }

  /**
   * A SMILES typed: match rows whose structure is the same compound (canonical SMILES equal), then
   * the rows whose structure contains it (a substructure search, shown when it comes back).
   */
  private async smilesSearch(q: string, token: number): Promise<void> {
    const c = await this.host.canonical(q);
    if (token !== this.searchToken) return;
    // not a structure after all: words, found as words
    if (!c) { this.showFound(); return; }
    for (const t of this.tables) for (const r of t.rows) if ((t.canonicalSmiles || CANONICAL_ROWS.has(r)) && typeof r.smiles === 'string') this.canon.set(r.smiles, r.smiles);
    const todo = this.tables.flatMap((t) => t.rows.map((r) => r.smiles)).filter((s): s is string => typeof s === 'string' && !this.canon.has(s));
    for (const s of todo) this.canon.set(s, await this.host.canonical(s));
    if (token !== this.searchToken) return;
    this.queryCanon = c;
    this.lookingInside = !!this.host.contains;
    this.showFound();
    if (!this.host.contains) return;
    const all = [...new Set(this.tables.flatMap((t) => t.rows.map((r) => r.smiles)).filter((s): s is string => typeof s === 'string'))];
    const hits = await this.host.contains(c, all).catch(() => null);
    if (token !== this.searchToken) return;
    this.lookingInside = false;
    this.containing = new Set((hits ?? []).map((i) => all[i]));
    this.showFound();
  }

  /** Show what a search found, moving to a table with matches when the one showing has none. */
  private showFound(): void {
    this.jumpToMatches();
    this.showList();
    this.showTable();
  }

  /** Draw…: a window with the drawing tools, over the table, to draw the structure to search for. */
  private openDraw(): void {
    const dr = this.host.drawing;
    if (!dr || !this.d || this.drawWin) return;
    this.drawOn = this.current.drawOn ?? null;
    this.drawSelected = dr.selection();
    const tools = el('div', { className: 'kb-draw-tools', role: 'toolbar' });
    tools.setAttribute('aria-label', 'Drawing tools');
    const lit: { b: HTMLButtonElement; t: string | number }[] = [];
    const tool = (t: string | number, title: string, face: string | null, text = ''): HTMLButtonElement => {
      const b = el('button', { type: 'button', title, className: typeof t === 'number' ? 'kb-draw-atom' : '' });
      if (face) b.innerHTML = face; else b.textContent = text;
      b.addEventListener('click', () => { dr.tool(t); light(); });
      lit.push({ b, t });
      return b;
    };
    for (const [name, title] of DRAW_TOOLS) tools.append(tool(name, title, ICONS[name] ?? null, title));
    tools.append(el('span', { className: 'kb-draw-sep' }));
    for (const [sym, z] of DRAW_ATOMS) tools.append(tool(z, `${sym}: click an atom to make it ${sym}, or empty space to add one`, null, sym));
    const light = () => { const now = dr.current(); for (const { b, t } of lit) b.classList.toggle('on', t === now); };
    this.drawBox = el('div', { className: 'kb-draw-box' });
    const name = this.drawOn ? 'Draw a Group to Search' : 'Draw a Structure to Search';
    const title = el('h3', { className: 'kb-draw-title has-info', textContent: name });
    title.append(infoIcon(this.drawOn ? GROUP_INFO : DRAW_INFO));
    const w = (this.drawWin = el('div', { className: 'kb-draw', role: 'dialog' },
      el('div', { className: 'kb-draw-head' }, title, button('✕', 'Close without searching (Esc)', () => dr.finish(false))),
      tools,
      this.drawBox,
      el('div', { className: 'kb-draw-foot' },
        button('Clear', this.drawOn ? 'Start again from the attachment point' : 'Start again with an empty drawing', () => this.restartDrawing(this.drawStart())),
        button('Use Selected', 'Start from the structure selected in the drawing', () => {
          if (typeof this.drawSelected === 'string') this.host.flash(this.drawSelected || 'Select a structure in the drawing before opening Draw.', 6000);
          else this.restartDrawing(this.drawSelected);
        }),
        el('span', { className: 'kb-draw-gap' }),
        button('Cancel', 'Close without searching (Esc)', () => dr.finish(false)),
        button('Search', 'Find this compound, then every compound containing it (Ctrl+Enter)', () => dr.finish(true), true))));
    w.setAttribute('aria-label', name);
    this.d.append(w);
    this.startDrawing(this.drawOn ? this.drawnGroup ?? this.drawStart() : this.drawn);
    light();
    this.drawLight = window.setInterval(light, 250);
  }

  /** What the Draw window starts from afresh: nothing, or an attachment point to draw a group out from. */
  private drawStart(): Contents | null {
    return this.drawOn ? this.host.drawing?.group() ?? null : null;
  }

  /** The drawing tools start on `c` in the Draw window's box. */
  private startDrawing(c: Contents | null): void {
    const token = ++this.drawToken;
    const box = this.drawBox;
    this.host.drawing?.start(c, () => (box?.isConnected ? box.getBoundingClientRect() : null), (got) => { if (token === this.drawToken) void this.drawEnded(got); });
  }

  /** Clear and Use Selected: the drawing starts again on `c`. */
  private restartDrawing(c: Contents | null): void {
    this.drawToken++;
    this.host.drawing?.finish(false);
    this.startDrawing(c);
  }

  /** The drawing ended: Search (with the drawing) or Cancel (null). */
  private async drawEnded(got: Contents | null): Promise<void> {
    if (got && !got.atoms.length) {
      this.host.flash('Draw a structure to search for first.');
      this.startDrawing(this.drawStart());
      return;
    }
    const on = this.drawOn;
    this.closeDraw(false);
    if (!got) return;
    const r = await this.host.drawing!.smiles(got, on ?? undefined);
    if (typeof r === 'string') { this.host.flash(r, 6000); return; }
    if (on) this.drawnGroup = got; else this.drawn = got;
    if (!this.d) return;
    this.search.value = r.smiles;
    this.searchChanged();
    this.search.focus();
  }

  /** The Draw window goes (`stop`: the drawing tools are still at work in it, and stop without searching). */
  private closeDraw(stop: boolean): void {
    if (!this.drawWin) return;
    clearInterval(this.drawLight);
    if (stop) { this.drawToken++; this.host.drawing?.finish(false); }
    this.drawWin.remove();
    this.drawWin = this.drawBox = null;
  }

  /** Use Selected: search for the structure selected in the drawing. */
  private async useSelected(): Promise<void> {
    const got = await this.host.selected?.();
    if (!got) return;
    if (typeof got === 'string') { this.host.flash(got, 6000); return; }
    this.search.value = got.smiles;
    this.searchChanged();
    this.search.focus();
  }

  /** The filters picked, with the remembered NMR solvent in a Solvent column nobody has set yet. */
  private filtersFor(t: KbTable): Record<string, string> {
    const col = solventColumn(t);
    if (!col || this.picked[col.key] !== undefined || !this.nmrSolvent) return this.picked;
    const v = matchSolvent(filterValues(t, col.key), this.nmrSolvent);
    return v ? { ...this.picked, [col.key]: v } : this.picked;
  }

  /** A table's layout of its columns (widths, order) as the user left it. */
  private layout(id: string): KbLayout {
    return (this.host.layout ? this.host.layout.get(id) : this.layouts.get(id)) ?? {};
  }

  private saveLayout(id: string, l: KbLayout | null): void {
    const keep = l && (l.order?.length || Object.keys(l.widths ?? {}).length) ? l : null;
    if (this.host.layout) this.host.layout.set(id, keep);
    else if (keep) this.layouts.set(id, keep);
    else this.layouts.delete(id);
  }

  /** A column's width (null: as wide as its contents need), kept for the table. */
  private setWidth(id: string, key: string, w: number | null): void {
    const l = this.layout(id);
    const widths = { ...l.widths };
    if (w === null) delete widths[key]; else widths[key] = w;
    this.saveLayout(id, { ...l, widths: Object.keys(widths).length ? widths : undefined });
  }

  /** The columns shown, in the order the user put them (Look up, a table's links, is one of them). */
  private shownColumns(t: KbTable, columns: KbColumn[], id: string): KbColumn[] {
    const cols = columns.filter((c) => !c.hidden);
    if (t.links) cols.push(LOOK_UP);
    const by = new Map(cols.map((c) => [c.key, c]));
    return orderColumns(cols.map((c) => c.key), this.layout(id).order).map((k) => by.get(k)!);
  }

  /** A header cell or a cell set to a width the user dragged (none: its contents decide). */
  private sizeCell(cell: HTMLElement, w: number | undefined): void {
    cell.classList.toggle('kb-sized', !!w);
    cell.style.width = cell.style.minWidth = cell.style.maxWidth = w ? `${w}px` : '';
  }

  /**
   * A column's heading: a click sorts by it; dragging its right edge makes it wider or narrower
   * (a double-click there fits it to its contents); dragging the heading moves the column; a
   * right-click offers the same and Reset.
   */
  private header(c: KbColumn, id: string, keys: string[]): HTMLTableCellElement {
    const th = el('th', {}, c === LOOK_UP ? c.label : explained(c.label, true));
    th.dataset.col = c.key;
    if (c.numeric || c.shift) th.classList.add('num');
    if (c.narrow) th.classList.add('narrow');
    // what the scale means: hover for the tip, a click pins it (and doesn't sort)
    if (c.info) th.append(' ', infoIcon(c.info));
    const sortable = !c.picture && c !== LOOK_UP;
    const sort = (down?: boolean) => {
      this.sort = down !== undefined ? { key: c.key, down } : this.sort?.key === c.key ? { key: c.key, down: !this.sort.down } : { key: c.key, down: false };
      this.showTable();
    };
    if (c.picture) th.classList.add('kb-pic');
    else if (!sortable) th.classList.add('kb-nosort');
    if (sortable) {
      th.title = `Sort by ${c.label}. Drag to move the column; right-click for more`;
      if (this.sort?.key === c.key) th.append(this.sort.down ? ' ▾' : ' ▴');
      th.addEventListener('click', () => { if (!this.moved) sort(); });
    }
    th.tabIndex = 0;
    th.addEventListener('keydown', (e) => {
      if (sortable && (e.key === 'Enter' || e.key === ' ') && e.target === th) { e.preventDefault(); sort(); }
    });
    this.sizeCell(th, this.layout(id).widths?.[c.key]);
    if (!c.picture) th.append(this.grip(th, c.key, id));
    this.dragToMove(th, c, id, keys);
    th.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const at = keys.indexOf(c.key);
      const l = this.layout(id);
      const r = th.getBoundingClientRect();
      // from the keyboard (the menu key), under the heading
      const [x, y] = e.clientX || e.clientY ? [e.clientX, e.clientY] : [r.left + 8, r.bottom];
      const order = (to: number) => () => { this.saveLayout(id, { ...l, order: moveColumn(keys, c.key, to) }); this.showTable(); };
      showContextMenu(x, y, [
        ...(sortable ? [{ label: 'Sort Ascending', run: () => sort(false) }, { label: 'Sort Descending', run: () => sort(true) }, null] : []),
        { label: 'Move Column Left', disabled: at <= 0, run: order(at - 1) },
        { label: 'Move Column Right', disabled: at >= keys.length - 1, run: order(at + 2) },
        null,
        { label: 'Fit Column to Contents', disabled: !!c.picture, run: () => { this.setWidth(id, c.key, null); this.showTable(); } },
        { label: 'Fit All Columns', run: () => { this.saveLayout(id, { ...l, widths: undefined }); this.showTable(); } },
        null,
        { label: 'Reset Column Widths and Order', disabled: !l.order && !l.widths, run: () => { this.saveLayout(id, null); this.showTable(); } },
      ], { run: () => {}, escaped: () => th.focus() });
    });
    return th;
  }

  /** The handle on a heading's right edge: drag to resize the column, double-click to fit it to its contents. */
  private grip(th: HTMLTableCellElement, key: string, id: string): HTMLElement {
    const g = el('span', { className: 'kb-col-grip', title: 'Drag to resize the column; double-click to fit its contents' });
    g.setAttribute('aria-hidden', 'true');
    g.addEventListener('click', (e) => e.stopPropagation());
    g.addEventListener('dblclick', (e) => { e.stopPropagation(); this.setWidth(id, key, null); this.showTable(); });
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const table = th.closest('table');
      if (!table) return;
      g.setPointerCapture?.(e.pointerId);
      const x0 = e.clientX, w0 = Math.round(th.getBoundingClientRect().width);
      let w = w0;
      table.classList.add('kb-resizing');
      const cells = () => [...table.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(key)}"]`)];
      const move = (ev: PointerEvent) => {
        w = Math.round(Math.max(COL_MIN, Math.min(COL_MAX, w0 + ev.clientX - x0)));
        for (const cell of cells()) this.sizeCell(cell, w);
      };
      const up = () => {
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.removeEventListener('pointercancel', up);
        table.classList.remove('kb-resizing');
        if (w !== w0) this.setWidth(id, key, w);
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
      g.addEventListener('pointercancel', up);
    });
    return g;
  }

  /** Dragging a heading sideways moves its column: a teal bar shows where it will land. */
  private dragToMove(th: HTMLTableCellElement, c: KbColumn, id: string, keys: string[]): void {
    const key = c.key;
    th.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as Element).closest('.kb-col-grip, .info-icon')) return;
      const row = th.parentElement as HTMLTableRowElement;
      const host = th.closest('dialog') ?? document.body;
      const x0 = e.clientX, y0 = e.clientY;
      let ghost: HTMLElement | null = null, bar: HTMLElement | null = null, to = -1;
      const move = (ev: PointerEvent) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
          ghost = el('div', { className: 'kb-col-ghost', textContent: prettyChem(c.label) });
          bar = el('div', { className: 'kb-col-drop' });
          host.append(ghost, bar);
          th.classList.add('kb-col-moving');
        }
        ghost.style.left = `${ev.clientX + 10}px`;
        ghost.style.top = `${ev.clientY + 6}px`;
        // the edge between two headings nearest the pointer
        const rects = [...row.cells].map((cell) => cell.getBoundingClientRect());
        const edges = [...rects.map((r) => r.left), rects[rects.length - 1].right];
        to = edges.reduce((b, x, i) => (Math.abs(x - ev.clientX) < Math.abs(edges[b] - ev.clientX) ? i : b), 0);
        const head = row.getBoundingClientRect(), box = this.wrap.getBoundingClientRect(), table = row.closest('table')!.getBoundingClientRect();
        const left = Math.max(box.left, Math.min(box.right - 2, edges[to] - 1));
        bar!.style.left = `${left}px`;
        bar!.style.top = `${Math.max(head.top, box.top)}px`;
        bar!.style.height = `${Math.max(0, Math.min(table.bottom, box.bottom) - Math.max(head.top, box.top))}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!ghost) return;
        ghost.remove();
        bar?.remove();
        th.classList.remove('kb-col-moving');
        // the click this release makes doesn't sort
        this.moved = true;
        setTimeout(() => { this.moved = false; });
        const from = keys.indexOf(key);
        if (to < 0 || to === from || to === from + 1) return;
        this.saveLayout(id, { ...this.layout(id), order: moveColumn(keys, key, to) });
        this.showTable();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  private showTable(): void {
    if (!this.d) return;
    // the rows are about to be redrawn: a card left over one would never get its pointerleave
    this.hideStructurePop();
    const t = this.current;
    // another table starts at its top
    if (this.shownId !== t.id) { this.shownId = t.id; this.wrap.scrollTop = 0; this.wrap.scrollLeft = 0; }
    // a chart gets the room to show whole
    this.wrap.classList.toggle('kb-mx-host', !!t.matrix);
    this.titleText.textContent = prettyChem(t.title);
    setInfo(this.about, prettyChem(t.about));
    this.removeBtn.hidden = !t.personal;
    // a table read whole has no search box (nor Draw…)
    this.search.hidden = !!t.noSearch;
    if (this.findBtn) this.findBtn.hidden = !!t.noSearch;
    if (t.noSearch) this.closeDraw(true);
    // filter lists
    this.filters.replaceChildren(...t.columns.filter((c) => c.filter).map((c) => {
      const s = el('select', { title: `Show only one ${c.label.toLowerCase()}` });
      s.append(el('option', { value: '', textContent: 'All' }));
      if (c.filter === 'present') s.append(el('option', { value: PRESENT, textContent: `With ${c.label.toLowerCase()}` }));
      else s.append(...filterValues(t, c.key).map((v) => el('option', { value: v, textContent: prettyChem(v, c.key === 'nucleus') })));
      const solvent = c === solventColumn(t);
      s.value = (solvent ? this.filtersFor(t)[c.key] : this.picked[c.key]) ?? '';
      s.addEventListener('change', () => {
        this.picked = { ...this.picked, [c.key]: s.value };
        if (solvent) { this.nmrSolvent = s.value; writeNmrSolvent(s.value); }
        this.showTable();
      });
      if (solvent) s.title = 'The solvent your NMR was taken in: impurity shifts change with it. Remembered for the other impurity tables';
      return el('label', {}, el('span', { textContent: solvent ? 'NMR taken in' : c.label }), ...(c.hidden && c.info ? [infoIcon(c.info)] : []), s);
    }));
    // a table in groups: fold or open every group at once
    if (t.group) {
      // (a table whose groups start folded keeps the groups opened: none when all are folded)
      const all = (fold: boolean) => { this.folded.set(t.id, new Set(fold === !t.groupInline ? t.rows.map((r) => String(r[t.group!] ?? '')) : [])); this.showTable(); };
      this.filters.append(el('span', { className: 'kb-fold-all' },
        button('Collapse All', 'Collapse All Groups', () => all(true)),
        button('Expand All', 'Open every group', () => all(false))));
    }
    this.filters.hidden = !this.filters.childElementCount;
    let rows = this.matches(t);
    const sortCol = this.sort && t.columns.find((c) => c.key === this.sort!.key);
    // a structure search (not on a table read whole) keeps the same compound above the ones containing it, each sorted
    const structure = !!this.queryCanon && !t.noSearch;
    if (sortCol) rows = structure ? [...sortRows(rows.filter((m) => m.same), sortCol, this.sort!.down), ...sortRows(rows.filter((m) => !m.same), sortCol, this.sort!.down)] : sortRows(rows, sortCol, this.sort!.down);
    const id = layoutId(t);
    // compact rows: no picture column (the structure shows beside the name instead)
    const cols = this.shownColumns(t, t.columns, id).filter((c) => !(this.compact && c.picture));
    const span = cols.length;
    const sameCount = rows.filter((m) => m.same).length;
    // a table in groups (not while a structure search splits it its own way): a heading over each
    // group, sorted within it; a search shows its matches even in folded groups
    const marked = this.folded.get(t.id) ?? new Set<string>();
    const isFolded = (g: string) => (t.groupInline ? !marked.has(g) : marked.has(g));
    const searching = !!this.search.value.trim();
    const items: (RowMatch | { group: string; rows: RowMatch[] })[] = !t.group || structure ? rows
      : t.groupInline ? inlineGroups(t, rows, (g) => isFolded(g) && !searching)
      : groupRows(t, rows).flatMap((g) => [{ group: g.name, rows: g.rows }, ...(isFolded(g.name) && !searching ? [] : g.rows)]);
    // the first rows straight away and the rest as the table is scrolled down: building every
    // row of a big table (Reagent Safety, Solubility) on each key typed took most of a second
    const body = el('tbody');
    let next = 0;
    this.moreRows = (n = MORE_ROWS) => {
      const end = Math.min(items.length, next + n);
      for (; next < end; next++) {
        const it = items[next];
        if ('group' in it && !('row' in it)) { body.append(this.foldRow(t, span, it.group, it.rows, isFolded(it.group) && !searching)); continue; }
        const m = it as RowMatch;
        // a structure search: a heading over the same compound and over the ones containing it
        if (structure && (next === 0 || m.same !== rows[next - 1].same)) body.append(this.groupRow(span, m.same ? `This compound (${sameCount})` : `Containing it (${rows.length - sameCount})`));
        body.append(this.rowEl(t, m, cols, id));
      }
      if (structure && next === rows.length && this.lookingInside) body.append(this.groupRow(span, 'Looking for compounds containing it…'));
    };
    this.moreRows(FIRST_ROWS);
    const table = el('table', { className: 'refs-table kb-table' + (t.picture && !this.compact ? ' kb-pictures' : '') + (t.fit ? ' kb-fit' : '') + (this.compact ? ' kb-compact' : '') }, el('thead', {}, el('tr', {}, ...cols.map((c) => this.header(c, id, cols.map((x) => x.key))))), body);
    if (!rows.length) {
      const q = this.search.value.trim();
      const empty = el('p', { className: 'muted kb-empty', textContent: this.lookingInside ? `Looking for compounds containing ${q}…` : this.queryCanon ? `Nothing in ${t.title} matches or contains ${q}.` : q ? `Nothing in ${t.title} matches “${q}”.` : 'This table is empty.' });
      // a compound the table doesn't have can be rated live from PubChem
      const live = q && t.id === 'reagent-safety' && this.host.lookUpSafety && !Object.values(this.picked).some(Boolean)
        ? [button(`Rate “${q.length > 40 ? q.slice(0, 39) + '…' : q}” from PubChem`, 'Look the compound up on PubChem and rate it with the same rules, from the same open sources (needs the internet)', () => void this.rateLive(q))]
        : [];
      this.wrap.replaceChildren(empty, ...live);
    } else if (t.matrix) this.wrap.replaceChildren(this.matrixEl(t, rows));
    else if (t.parts) this.wrap.replaceChildren(...this.partsEl(t, rows));
    else this.wrap.replaceChildren(table);
    this.count.textContent = rows.length === t.rows.length ? `${t.rows.length} rows` : `${rows.length} of ${t.rows.length} rows`;
    // sources, each a link when it has one
    this.sourcesBtn.textContent = t.sources.length > 1 ? 'Sources' : 'Source';
    this.sourcesBtn.hidden = !t.sources.length;
    this.sources.hidden = true;
    this.sourcesBtn.setAttribute('aria-expanded', 'false');
    this.sources.replaceChildren();
    t.sources.forEach((s, i) => {
      if (i) this.sources.append(el('br'));
      if (s.url) {
        const a = el('a', { href: s.url, textContent: s.label });
        a.addEventListener('click', (e) => { e.preventDefault(); this.host.openUrl(s.url!); });
        this.sources.append(a);
      } else this.sources.append(s.label);
    });
  }

  /** A heading row across the table (a structure search's two groups). */
  private groupRow(span: number, text: string): HTMLTableRowElement {
    const th = el('th', { colSpan: span, textContent: text });
    th.scope = 'rowgroup';
    return el('tr', { className: 'kb-group' }, th);
  }

  /**
   * The heading of one group of a table in groups: its name and how many rows it holds, and a
   * click folds its rows away or opens them again. `extra` adds to the heading (after the count).
   */
  private foldRow(t: KbTable, span: number, name: string, rows: RowMatch[], closed: boolean, extra: Node[] = []): HTMLTableRowElement {
    // a series: its parent compound's drawing before the name, its range after the count
    const head = t.groupHeading?.(name, rows);
    const pic = head?.picture ? svgNode(templateIcon(head.picture, GROUP_PIC, 9)) : null;
    if (pic) pic.classList.add('kb-fold-pic');
    const note = head?.note ? [el('span', { className: 'kb-fold-note', textContent: head.note })] : [];
    const th = el('th', { colSpan: span }, el('span', { className: 'kb-chev', textContent: closed ? '▸' : '▾' }), ...(pic ? [pic] : []), name || 'Other', el('span', { className: 'kb-fold-count', textContent: String(rows.length) }), ...note, ...extra);
    th.scope = 'rowgroup';
    th.tabIndex = 0;
    th.setAttribute('role', 'button');
    th.setAttribute('aria-expanded', String(!closed));
    th.title = closed ? `Expand the ${name} rows` : `Collapse the ${name} rows`;
    const toggle = () => {
      const set = new Set(this.folded.get(t.id) ?? []);
      if (set.has(name)) set.delete(name); else set.add(name);
      this.folded.set(t.id, set);
      this.showTable();
    };
    th.addEventListener('click', toggle);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    return el('tr', { className: 'kb-group kb-fold' }, th);
  }

  /** One row of the table: its cells in the columns' order (`cols`), at the widths kept under `id`. */
  private rowEl(t: KbTable, m: RowMatch, cols: KbColumn[], id: string): HTMLTableRowElement {
    const tr = el('tr');
    // a row of a series (under its heading): marked down its left edge
    if (t.groupInline && t.group && m.row[t.group]) tr.className = 'kb-in-group';
    const widths = this.layout(id).widths ?? {};
    // the table's first column (the name) wraps a long name rather than running into the next one
    const lead = t.columns.find((c) => !c.hidden && !c.picture)?.key;
    for (const c of cols) {
      const td = this.cellEl(t, m, c);
      td.dataset.col = c.key;
      if (c.key === lead) td.classList.add('kb-lead');
      if (!c.picture) this.sizeCell(td, widths[c.key]);
      if (this.compact) {
        // the whole text when the pointer rests on a cut-off cell; the structure beside the name
        const text = td.textContent ?? '';
        if (text.length > 20 && !td.title) td.title = text;
        if (c.key === lead && t.picture && !t.structure) this.structureOnHover(td, () => t.picture!(m.row) ?? null);
      }
      tr.append(td);
    }
    return tr;
  }

  /** One cell of a row. */
  private cellEl(t: KbTable, m: RowMatch, c: KbColumn): HTMLTableCellElement {
    if (c === LOOK_UP) {
      const td = el('td', { className: 'kb-links' });
      t.links?.(m.row).forEach((l, i) => {
        if (i) td.append(' · ');
        const a = el('a', { href: l.url ?? '#', textContent: l.label });
        a.addEventListener('click', (e) => { e.preventDefault(); if (l.url) this.host.openUrl(l.url); });
        td.append(a);
      });
      return td;
    }
    const v = m.row[c.key];
    const td = el('td');
    if (c.numeric || c.shift) td.className = 'num';
    if (c.narrow) td.classList.add('narrow');
    if (c.prose) td.classList.add('prose');
    if (c.key === 'cas') td.classList.add('cas');
    if (c.picture) {
      const tpl = t.picture?.(m.row);
      td.className = 'kb-pic';
      const icon = tpl ? svgNode(templateIcon(tpl, t.pictureSize ?? PIC, 14)) : null;
      if (icon) td.append(icon);
      if (t.pictureSize) td.style.width = td.style.minWidth = `${t.pictureSize}px`;
      return td;
    }
    if (v !== null && v !== undefined && v !== '') td.append(typeof v === 'number' ? String(v) : c.key === 'atom' ? v : cellExplained(v, !!c.narrow, c.key === 'nucleus')); // atom labels (H2, C3) are not formulas
    if (c.key === 'name' && t.structure) this.structureOnHover(td, () => t.structure!(m.row));
    return td;
  }

  /** The structure in a little card beside a name while the pointer rests on it (Solvents, pKa). */
  private structureOnHover(td: HTMLElement, tpl: () => Template | null): void {
    td.classList.add('kb-structure-name');
    td.addEventListener('pointerenter', (e) => {
      this.hideStructurePop();
      // a finger on the screen or a held mouse button is a tap or a drag, not a rest
      if (e.buttons) return;
      const t = tpl();
      const icon = t ? svgNode(templateIcon(t, STRUCTURE_PIC, 30)) : null;
      if (!icon) return;
      const pop = (this.structurePop = el('div', { className: 'info-pop kb-structure-pop' }));
      pop.setAttribute('role', 'tooltip');
      pop.append(icon);
      (td.closest('dialog') ?? document.body).append(pop);
      // just after the name, level with the row, kept on the screen
      const range = document.createRange();
      range.selectNodeContents(td);
      const r = td.getBoundingClientRect(), words = range.getBoundingClientRect(), size = STRUCTURE_PIC + 10;
      pop.style.left = `${Math.max(8, Math.min((words.width ? words.right : r.right) + 10, window.innerWidth - size - 8))}px`;
      pop.style.top = `${Math.max(8, Math.min(r.top + r.height / 2 - size / 2, window.innerHeight - size - 8))}px`;
    });
    td.addEventListener('pointerleave', () => this.hideStructurePop());
  }

  /** Put the structure card away (also when its row is redrawn, which would leave it orphaned). */
  private hideStructurePop(): void {
    this.structurePop?.remove();
    this.structurePop = null;
  }

  /**
   * A miscibility chart: the solvents down the side and across the top, a shaded square where a
   * pair forms two layers (picked out by a search, on a table that is searched); resting the pointer
   * on a square names the pair and lights up its row and column.
   */
  private matrixEl(t: KbTable, rows: RowMatch[]): HTMLElement {
    const m = t.matrix!;
    const q = t.noSearch ? '' : this.search.value.trim();
    const hit = new Set(q ? rows.map((r) => String(r.row.name)) : []);
    const marked = new Set(m.pairs.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
    const head = el('tr', {}, el('th', { className: 'kb-mx-corner' }));
    m.names.forEach((name, j) => {
      const th = el('th', { className: 'kb-mx-col' }, el('span', {}, prettyChem(name)));
      th.dataset.c = String(j);
      if (hit.has(name)) th.classList.add('hit');
      head.append(th);
    });
    const body = el('tbody');
    m.names.forEach((a, i) => {
      const th = el('th', { className: 'kb-mx-row', textContent: prettyChem(a) });
      th.dataset.r = String(i);
      if (hit.has(a)) th.classList.add('hit');
      const tr = el('tr', {}, th);
      m.names.forEach((b, j) => {
        const td = el('td');
        // the full square (Nate's pick): every pair twice, a solvent with itself shaded on the diagonal
        if (j === i) { td.className = 'kb-mx-self'; tr.append(td); return; }
        const two = marked.has(`${a}|${b}`);
        td.className = two ? 'kb-mx-two' : 'kb-mx-one';
        td.dataset.r = String(i);
        td.dataset.c = String(j);
        if (hit.has(a) || hit.has(b)) td.classList.add('hit');
        td.title = `${a} + ${b}: ${two ? `${m.mark.toLowerCase()} (two layers form in some proportions)` : `${m.other.toLowerCase()} in all proportions`}`;
        tr.append(td);
      });
      body.append(tr);
    });
    const table = el('table', { className: 'kb-matrix' }, el('thead', {}, head), body);
    // the row and column of the square under the pointer
    let lit: Element[] = [];
    table.addEventListener('pointerover', (e) => {
      const cell = (e.target as Element).closest('td[data-r]') as HTMLElement | null;
      lit.forEach((x) => x.classList.remove('lit'));
      lit = cell ? [...table.querySelectorAll(`[data-r="${cell.dataset.r}"], [data-c="${cell.dataset.c}"]`)] : [];
      lit.forEach((x) => x.classList.add('lit'));
    });
    table.addEventListener('pointerleave', () => { lit.forEach((x) => x.classList.remove('lit')); lit = []; });
    const key = el('div', { className: 'kb-mx-key' },
      el('span', { className: 'kb-mx-swatch two' }), el('span', { textContent: m.mark }), infoIcon(m.markInfo),
      el('span', { className: 'kb-mx-swatch one' }), el('span', { textContent: m.other }));
    return el('div', { className: 'kb-mx-wrap' }, table, key);
  }

  /** A table in parts (Acids and Bases): each part under its own heading, with its own columns. */
  private partsEl(t: KbTable, rows: RowMatch[]): HTMLElement[] {
    return t.parts!.flatMap((p) => {
      const mine = rows.filter((m) => m.row.part === p.key);
      if (!mine.length) return [];
      const shown: KbTable = { ...t, columns: p.columns, parts: undefined };
      const id = layoutId(t, p.key);
      const cols = this.shownColumns(shown, p.columns, id);
      const table = el('table', { className: 'refs-table kb-table kb-part' },
        el('thead', {}, el('tr', {}, ...cols.map((c) => this.header(c, id, cols.map((x) => x.key))))),
        el('tbody', {}, ...mine.map((m) => this.rowEl(shown, m, cols, id))));
      return [el('h4', { className: 'kb-part-title', textContent: p.title }), table];
    });
  }

  private async copy(): Promise<void> {
    const rows = this.matches(this.current);
    await this.host.copyText(tableTsv(this.current, rows));
    this.host.flash(`Copied ${rows.length} row${rows.length === 1 ? '' : 's'} of ${this.current.title}: paste into a sheet or a table.`);
  }

  private async importTable(): Promise<void> {
    const how = await ask('Import Table', [
      { name: 'title', label: 'Name', value: '', placeholder: 'NMR impurities (my copy)' },
      { name: 'paste', label: 'Or paste the table', value: '', type: 'textarea', placeholder: 'Tab- or comma-separated; first line is the header', help: 'Leave this empty to pick a CSV or tab-separated file. Columns named 1H or 13C (ppm) are searched as chemical shifts.' },
    ], { ok: 'Import', note: 'A custom table, kept on this computer only and never shared with Chemweave. The first line names the columns.' });
    if (!how) return;
    let text = how.paste.trim(), name = how.title.trim();
    if (!text) {
      const f = await this.host.pickTable();
      if (!f) return;
      text = f.text;
      if (!name) name = f.name.replace(/\.[^.]+$/, '');
    }
    const id = `user-${Date.now().toString(36)}`;
    const t = parseUserTable(text, name || 'My table', id);
    if (!t) { this.host.flash('That table couldn\'t be read: the first line should name the columns, separated by tabs or commas.'); return; }
    this.tables.push(t);
    await this.saveImported();
    this.current = t;
    this.picked = {};
    this.sort = null;
    this.showList();
    this.showTable();
    this.host.flash(`Imported ${t.rows.length} rows into ${t.title}.`);
  }

  private async removeImported(): Promise<void> {
    const t = this.current;
    if (!t.personal) return;
    const ok = await ask('Remove Table', [], { ok: 'Remove', note: `Remove ${t.title} (${t.rows.length} rows) from this computer? The file it came from is not changed.` });
    if (!ok) return;
    this.tables = this.tables.filter((x) => x !== t);
    await this.saveImported();
    this.current = this.tables[0];
    this.showList();
    this.showTable();
  }
}
