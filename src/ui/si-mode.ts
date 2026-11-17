// The SI Project tab: a Supporting Information kept as Chem SI Assistant keeps it (a folder of
// readable files, src/si/project.ts), worked on here. On the left, the project's sections with
// their compounds; in the middle, the page picked: a compound's data, a Data section's ID
// table and fields, or a section's text. Every change is saved to the folder as it is made, so
// there is nothing to Save, and the project opens in SI Assistant as it is.
//
// Structures are drawn with the drawing tools (Edit Structure); compounds go to and come from
// the Compound Library; references come from My Library.

import type { Tab } from '../workspace';
import type { Contents } from '../model';
import type { DocText } from '../document/document';
import { compileSi } from '../si/compile-doc';
import type { LibCompound, LibraryData, LibReference } from '../library/library';
import { SiProject, SiProjectError, compoundName, compoundsOf, defaultFieldsOf, fieldKeys, fieldsOf, flagsOf, idOverride, idTableOf, valuesOf, TYPE_LABELS, type Json, type SiCompound, type SiSection } from '../si/project';
import { displayId, patternIds, cellKey, type IdReport } from '../si/compound-ids';
import { ALL_FIELDS, NUCLEI, fieldDef, learnedChoices, nucleusLabel, partText, CORE_FIELDS, LIBRARY_FIELDS, type FieldDef, type Part, type FieldEntry } from '../si/fields';
import { CITE, MENTION } from '../si/markup';
import { newId } from '../si/ids';
import { SiRichBox } from './si-rich';
import { ask, askChoice } from './ask';
import { allWarnings, compoundHrms, hrmsSpecies, isDismissed, monoisotopic, outOfTolerance, ID_KEY, type SiWarning } from '../si/checks';
import { adductDisplay, sameFormula, speciesLabel, ChemError, type MolFacts } from '../si/chem';
import { addInfo } from './info-tip';

export interface SiModeHost {
  flash(msg: string, ms?: number): void;
  /** The status bar's text. */
  hint(text: string): void;
  /** The tab's name or marks changed. */
  changed(): void;
  /** A molfile as a drawing (null when it can't be read). */
  contentsOf(molfile: string): Contents | null;
  /** A drawing as one molfile, or why it can't be. */
  molfileOf(c: Contents): { molblock: string | null; problem?: string };
  /** A picture (SVG markup) of a molfile's structure, drawn in the house style. */
  pictureOf(molfile: string): string | null;
  /** Formula and masses. */
  analyze(molfile: string): Promise<{ formula: string; mw: number; exact: number } | null>;
  smiles(molfile: string): Promise<string | null>;
  /** Draw a structure with the drawing tools; `done` gets it (null: cancelled). */
  editStructure(contents: Contents | null, title: string, done: (c: Contents | null) => void): void;
  /** The library (loaded): what it holds now, and a change to it. */
  library(): Promise<{ now: LibraryData; change(f: (lib: LibraryData) => LibraryData): void }>;
  /** Files chosen to add (spectra, other files). */
  pickFiles(label: string, exts: string[]): Promise<{ name: string; bytes: Uint8Array }[]>;
  /** What the checks need from structures (molfiles): formula, pieces, distinct carbons, H counts. */
  siFacts(mols: string[]): Promise<(MolFacts | null)[]>;
  /** A drawing's own size in points, in the SI drawing style. */
  sizeOf(c: Contents): { w: number; h: number } | null;
  /** The compiled SI, opened as a document named `name` (and, with `pdf`, saved as a PDF too). */
  openCompiled(doc: DocText, name: string, pdf: boolean): Promise<void>;
}

/** An SI compound as the Canvas shows it (its card in the Analysis panel). */
export interface SiCard {
  tab: Tab;
  compoundId: string;
  project: string;
  section: string;
  id: string;
  name: string;
  filled: number;
  total: number;
  missing: string[];
  warnings: string[];
  yieldText: string;
  hrms: string;
}

type Pick = { kind: 'project' } | { kind: 'section'; id: string } | { kind: 'compound'; id: string } | { kind: 'references' } | { kind: 'warnings' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** A small icon (the same line drawings as the mockups). */
const ICON: Record<string, string> = {
  section: '<path d="M3 6.5h7l2 2h9v11H3z"/>',
  flask: '<path d="M9 2.5h6M10 2.5v6l-5.5 10a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 8.5v-6"/><path d="M7 15h10"/>',
  page: '<path d="M6 2.5h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z"/><path d="M14 2.5v4h4"/>',
  scheme: '<polygon points="5,8 8,9.7 8,13.3 5,15 2,13.3 2,9.7"/><path d="M10 11.5h5M13.5 10l1.5 1.5-1.5 1.5"/><polygon points="19,8 22,9.7 22,13.3 19,15 16,13.3 16,9.7"/>',
  spectrum: '<path d="M2.5 20.5h19"/><path d="M4 20V18M7 20v-9M8.5 20v-6M12 20v-14M13.5 20v-4M17 20v-8M19 20v-3"/>',
  xray: '<ellipse cx="7" cy="8" rx="3" ry="2"/><ellipse cx="17" cy="9" rx="2.6" ry="3.2"/><ellipse cx="11" cy="17" rx="3.2" ry="2.2"/><path d="M9.6 9.2 10.6 14.8M14.5 9.2 7.8 7.8M15.6 11.6 13.2 15.6"/>',
  refs: '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h11"/>',
  check: '<path d="M4 12.5l5 5 11-11"/>',
  warn: '<path d="M12 3 22 20H2z"/><path d="M12 9.5v5M12 17.2v.3"/>',
  flag: '<path d="M5 21V3.5M5 4h11l-2 4 2 4H5"/>',
  open: '<circle cx="12" cy="12" r="5"/>',
  chev: '<path d="M8 10l4 4 4-4"/>',
  si: '<path d="M6.5 2.75h8l4.5 4.5v12.5a1.5 1.5 0 0 1-1.5 1.5h-11a1.5 1.5 0 0 1-1.5-1.5v-15.5a1.5 1.5 0 0 1 1.5-1.5z"/><text x="12" y="17.2" font-size="7.2" font-weight="700" text-anchor="middle" stroke="none" fill="currentColor">SI</text>',
};
const svg = (k: string, s = 14): string => `<svg class="si-ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

/** The ribbon: what each button does is its data-si command. */
const RIBBON = `
  <div class="rb-tabs" role="tablist">
    <button role="tab" data-si-tab="home" aria-selected="true">Home</button>
  </div>
  <div class="rb-panel" data-si-panel="home">
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="new-compound" data-ic="compound" title="A new compound page in the Data section picked, after the compound picked (Ctrl+Shift+N)"><span class="rb-icon">⬡</span>New Compound</button>
      <button class="rb-big" data-si="new-section" data-ic="section" title="A new section: a Data section holds compounds; a Custom section holds text (and sub-sections)"><span class="rb-icon">▤</span>New Section</button>
      <div class="rb-col">
        <button data-si="delete" data-ic="delete" title="Move the compound picked to the project's Trash (SI Assistant can restore it)">Delete</button>
        <button data-si="move-up" title="Move the compound or section picked up (Alt+↑): compound IDs follow the order">▲ Move Up</button>
        <button data-si="move-down" title="Move the compound or section picked down (Alt+↓)">▼ Move Down</button>
      </div>
    </div><div class="rb-label">Project</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="id-table" data-ic="compound-number" title="The ID table of the Data section picked: compound IDs follow the compounds' order"><span class="rb-icon">#</span>ID Table</button>
      <div class="rb-col">
        <button data-si="fill-pattern" title="Fill the ID table from a pattern: 3a, 3b, 3c… or S1, S2, S3…">Fill from Pattern…</button>
        <button data-si="pages-for-ids" title="A blank compound page for each ID in the table that has none yet">Add Pages for IDs</button>
        <button data-si="manual-id" title="Give the compound picked an ID of its own (it still uses up its row of the table)">Manual ID…</button>
      </div>
    </div><div class="rb-label">Compound IDs</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="edit-structure" data-ic="structure" title="Draw or change the compound's structure with the drawing tools"><span class="rb-icon">⌬</span>Edit Structure</button>
      <div class="rb-col">
        <button data-si="from-library" title="A new compound page with a compound from your Compound Library (its structure and name)">From Compound Library…</button>
        <button data-si="to-library" title="Keep the structures of this section's compounds in your Compound Library, with their SI IDs and this project as where they appear">Add to Compound Library</button>
        <button data-si="cite-library" data-ic="insert-citation" title="Cite references from My Library in the compound's References field (they join the project's references)">Cite from My Library…</button>
      </div>
    </div><div class="rb-label">Library</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="warnings" data-ic="check-structure" title="Every automatic warning in the project (HRMS, NMR, yields, spectra, IDs), by compound: dismiss or restore them"><span class="rb-icon">⚠</span>Warnings</button>
    </div><div class="rb-label">Checks</div></div>
    <div class="rb-group"><div class="rb-row">
      <button class="rb-big" data-si="compile-doc" data-ic="cover-page" title="Make the Supporting Information as a document you can edit: cover, contents, sections, procedures and compound data, laid out as Chem SI Assistant lays it out. The project itself is not changed."><span class="rb-icon">▤</span>Compile to Document</button>
      <button class="rb-big" data-si="compile-pdf" data-ic="export-pdf" title="Compile the Supporting Information and save it as a PDF (it also opens as a document)"><span class="rb-icon">⎙</span>Compile to PDF</button>
    </div><div class="rb-label">Compile</div></div>
    <div class="rb-group"><div class="rb-row">
      <div class="rb-col">
        <button data-si="add-field" title="Add a field to the compound page (melting point, Rf, IR, optical rotation…), or one of your own">Add Field…</button>
        <button data-si="apply-fields" title="Give every compound of the section the section's fields, in the section's order">Apply Section Fields</button>
        <button data-si="reload" data-ic="refresh-all" title="Read the project folder again (after changes made in Chem SI Assistant or by a sync)">Reload Project</button>
      </div>
      <div class="rb-col">
        <button data-si="project-settings" title="The project's title and journal style, and the HRMS tolerance">Project Settings…</button>
      </div>
    </div><div class="rb-label">Project</div></div>
  </div>`;

export class SiMode {
  private pane: HTMLDivElement;
  private ribbon: HTMLDivElement;
  private tree: HTMLDivElement;
  private page: HTMLDivElement;
  private tab: Tab | null = null;
  private report: IdReport | null = null;
  private boxes: SiRichBox[] = [];
  private shownKey = '';
  private analyzed = new Map<string, { formula: string; mw: number; exact: number } | null>();
  /** Compounds' structures as last read (compound id → molfile), and what the checks read from each molfile. */
  private mols = new Map<string, string>();
  private facts = new Map<string, MolFacts | null>();
  private loadingFacts = false;
  /** Every warning of each compound (dismissed too), as last worked out. */
  private warnings = new Map<string, SiWarning[]>();
  /** Dismissed warnings are listed too (with Restore). */
  private showDismissed = false;

  constructor(private host: SiModeHost) {
    const work = document.querySelector('#work')!;
    this.pane = el('div');
    this.pane.id = 'si-pane';
    this.pane.className = 'si-only';
    this.pane.hidden = true;
    this.tree = el('div', 'si-tree');
    this.tree.setAttribute('role', 'tree');
    this.tree.setAttribute('aria-label', 'Sections and compounds');
    this.page = el('div', 'si-page');
    this.pane.append(this.tree, this.page);
    work.append(this.pane);
    this.ribbon = el('div', 'ribbon tabbed si-ribbon si-only');
    this.ribbon.id = 'si-ribbon';
    this.ribbon.setAttribute('role', 'toolbar');
    this.ribbon.setAttribute('aria-label', 'SI Project');
    this.ribbon.hidden = true;
    this.ribbon.innerHTML = RIBBON;
    const docRibbon = document.querySelector('#doc-ribbon');
    if (docRibbon) docRibbon.after(this.ribbon); else document.body.prepend(this.ribbon);
    this.ribbon.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-si]');
      if (b) void this.run(b.dataset.si!);
    });
    this.pane.addEventListener('keydown', (e) => this.key(e));
  }

  get project(): SiProject | null { return this.tab?.si ?? null; }

  private get pick(): Pick {
    const st = this.tab?.sheetState as { pick?: Pick } | null;
    return st?.pick ?? { kind: 'project' };
  }
  private set pick(p: Pick) {
    if (this.tab) this.tab.sheetState = { pick: p };
  }

  /** Show this tab's project (null: another kind of tab shows). */
  show(tab: Tab | null): void {
    if (this.tab && this.tab !== tab) this.commitAll();
    this.tab = tab && tab.si ? tab : null;
    this.pane.hidden = this.ribbon.hidden = !this.tab;
    if (!this.tab) return;
    this.shownKey = '';
    this.refresh();
  }

  /** Save what is being typed. */
  commitAll(): void { for (const b of this.boxes) b.commit(); }

  /** Everything again: the tree, the page, the status bar. */
  refresh(): void {
    const p = this.project;
    if (!p) return;
    this.report = p.idReport();
    this.check();
    this.renderTree();
    const key = JSON.stringify(this.pick);
    if (key !== this.shownKey) { this.shownKey = key; this.renderPage(); } else this.relabel();
    this.paintWarnings();
    this.status();
  }

  // ---------------------------------------------------------------- checks

  /** Work out every compound's warnings again (those whose structure is still being read keep the ones they had). */
  private check(): void {
    const p = this.project!;
    let waiting = false;
    const seen = new Set<string>();
    for (const c of p.compounds) {
      seen.add(c.id);
      let facts: MolFacts | null = null;
      if (p.hasStructure(c)) {
        const mol = this.mols.get(c.id);
        if (mol === undefined || !this.facts.has(mol)) { waiting = true; continue; }
        facts = this.facts.get(mol) ?? null;
      }
      try { this.warnings.set(c.id, allWarnings(p, c, this.report!, facts)); } catch (e) { console.warn('SI checks failed for', c.id, e); this.warnings.set(c.id, []); }
    }
    for (const id of [...this.warnings.keys()]) if (!seen.has(id)) this.warnings.delete(id);
    if (waiting) void this.loadFacts();
  }

  /** Read the structures not read yet, and what the checks need from them (off the main thread), then check again. */
  private async loadFacts(): Promise<void> {
    if (this.loadingFacts) return;
    const p = this.project;
    if (!p) return;
    this.loadingFacts = true;
    try {
      await this.readFacts(p);
    } finally {
      this.loadingFacts = false;
    }
    if (this.project === p) this.refresh();
  }

  /** Read a project's structures not read yet, and what the checks need from them. */
  private async readFacts(p: SiProject): Promise<void> {
    for (const c of p.compounds) if (p.hasStructure(c) && !this.mols.has(c.id)) this.mols.set(c.id, await p.readStructure(c));
    const todo = [...new Set([...this.mols.values()].filter((m) => !this.facts.has(m)))];
    if (!todo.length) return;
    const got = await this.host.siFacts(todo).catch(() => todo.map(() => null));
    todo.forEach((m, i) => this.facts.set(m, got[i] ?? null));
  }

  // ---------------------------------------------------------------- for the Canvas (layout C)

  /** The compounds of these SI projects whose structure is each SMILES (RDKit's), as the Canvas's SI card and right-click menu want them. */
  async compoundsFor(tabs: Tab[], smiles: string[]): Promise<Map<string, SiCard[]>> {
    const out = new Map<string, SiCard[]>();
    const want = new Set(smiles.filter(Boolean));
    for (const t of tabs) {
      const p = t.si;
      if (!p) continue;
      await this.readFacts(p);
      let report: IdReport | null = null;
      for (const c of p.compounds) {
        const f = this.factsOf(c);
        const smi = f?.info?.smiles;
        if (!smi || !want.has(smi)) continue;
        report ??= p.idReport();
        out.set(smi, [...(out.get(smi) ?? []), this.card(t, c, report, f)]);
      }
    }
    return out;
  }

  /** What the Canvas's SI card says about a compound. */
  private card(tab: Tab, c: SiCompound, report: IdReport, facts: MolFacts | null): SiCard {
    const p = tab.si!;
    const k = p.completion(c);
    let warnings: SiWarning[] = [];
    try { warnings = allWarnings(p, c, report, facts).filter((w) => !isDismissed(c, w)); } catch { /* (shown as none) */ }
    const v = valuesOf(c);
    const part = (key: string, sub: string): string => { const x = v[key]; return x && typeof x === 'object' && !Array.isArray(x) ? partText((x as Json)[sub]).trim() : ''; };
    const pct = part('yield', 'percent'), mass = part('yield', 'mass'), unit = part('yield', 'mass_unit');
    const yieldText = [pct ? `${pct}%` : '', mass ? `(${mass} ${unit || 'mg'})` : ''].filter(Boolean).join(' ');
    const state = part('physical_state', 'text');
    let hrms = '';
    const [r] = (() => { try { return compoundHrms(p, c, facts); } catch { return [null, '']; } })();
    if (r) {
      const mono = monoisotopic(r);
      hrms = `${adductDisplay(partText((v.hrms as Json | undefined)?.adduct) || '[M+H]+')} ${mono.mz.toFixed(4)}${r.ppm !== null ? ` (${r.ppm >= 0 ? '+' : '−'}${Math.abs(r.ppm).toFixed(1)} ppm)` : ''}`;
    }
    return {
      tab, compoundId: c.id, project: p.title, section: (() => { try { return p.section(c.sectionId).name; } catch { return ''; } })(),
      id: displayId(report, c.id), name: compoundName(c), filled: k.filled, total: k.total, missing: k.missing,
      warnings: warnings.map((w) => w.message), yieldText: [yieldText, state].filter(Boolean).join(' · '), hrms,
    };
  }

  /** The Data sections of an SI tab's project, with the compound each ID would land on (for "as 2b"). */
  dataSectionsOf(tab: Tab): { id: string; name: string; ids: Map<string, string> }[] {
    const p = tab.si;
    if (!p) return [];
    const report = p.idReport();
    return p.dataSections.map((s) => ({ id: s.id, name: s.name, ids: new Map(compoundsOf(s).map((c) => [displayId(report, c.id), c.id])) }));
  }

  /** A structure drawn on a Canvas, as a new compound page at the end of a Data section (null: it couldn't be saved). */
  async addFromCanvas(tab: Tab, sectionId: string, molfile: string): Promise<{ id: string; label: string } | null> {
    const p = tab.si;
    if (!p) return null;
    try {
      const c = await p.addCompound(sectionId);
      await p.setStructure(c, molfile);
      this.forgetStructure(c);
      if (this.tab === tab) { this.shownKey = ''; this.refresh(); }
      return { id: c.id, label: displayId(p.idReport(), c.id) };
    } catch (e) {
      this.host.flash(e instanceof SiProjectError ? e.message : `Could not add the compound: ${e instanceof Error ? e.message : String(e)}`, 8000);
      return null;
    }
  }

  /** Put a Canvas structure on an existing compound page (its structure before is replaced). */
  async replaceFromCanvas(tab: Tab, compoundId: string, molfile: string): Promise<boolean> {
    const p = tab.si;
    const c = p?.compounds.find((x) => x.id === compoundId);
    if (!p || !c) return false;
    try {
      await p.setStructure(c, molfile);
      this.forgetStructure(c);
      if (this.tab === tab) { this.shownKey = ''; this.refresh(); }
      return true;
    } catch (e) {
      this.host.flash(e instanceof SiProjectError ? e.message : `Could not change the structure: ${e instanceof Error ? e.message : String(e)}`, 8000);
      return false;
    }
  }

  /** Open a compound's page when its tab next shows. */
  pickCompound(tab: Tab, compoundId: string): void {
    tab.sheetState = { pick: { kind: 'compound', id: compoundId } };
    if (this.tab === tab) this.refresh();
  }

  /** A compound's structure changed (or the folder was read again): read it again. */
  private forgetStructure(c?: SiCompound): void {
    if (c) this.mols.delete(c.id); else this.mols.clear();
  }

  private activeWarnings(c: SiCompound): SiWarning[] { return (this.warnings.get(c.id) ?? []).filter((w) => !isDismissed(c, w)); }
  private dismissedWarnings(c: SiCompound): SiWarning[] { return (this.warnings.get(c.id) ?? []).filter((w) => isDismissed(c, w)); }
  private factsOf(c: SiCompound): MolFacts | null {
    const mol = this.mols.get(c.id);
    return mol === undefined ? null : this.facts.get(mol) ?? null;
  }

  /** One warning: its text, and Dismiss… (or, dismissed, why and Restore). */
  private warningLine(c: SiCompound, w: SiWarning, field = ''): HTMLElement {
    const p = this.project!;
    const dismissed = isDismissed(c, w);
    const line = el('div', `si-warn${dismissed ? ' dismissed' : ''}`);
    line.innerHTML = svg('warn', 13);
    const said = field && w.field !== ID_KEY && !w.message.toLowerCase().startsWith(field.toLowerCase());
    const text = el('span', 'si-warn-text', (said ? field + ': ' : '') + w.message);
    line.append(text);
    if (dismissed) {
      const d = ((c.data.dismissed ?? {}) as Record<string, Json>)[w.key] ?? {};
      const why = partText(d.reason).trim();
      text.title = `Dismissed${partText(d.by) ? ' by ' + partText(d.by) : ''}${partText(d.at) ? ' on ' + partText(d.at).slice(0, 10) : ''}${why ? ': ' + why : ''}`;
      if (why) line.append(el('span', 'si-warn-why', `(${why})`));
    }
    if (!p.readOnly) {
      const b = el('button', 'si-link', dismissed ? 'Restore' : 'Dismiss…');
      b.type = 'button';
      b.title = dismissed ? 'Show this warning again' : 'Hide this warning for this compound (it comes back if the data it is about changes)';
      b.addEventListener('click', async () => {
        if (dismissed) { await this.act(() => p.restoreWarning(c, w.key)); return; }
        const got = await ask('Dismiss Warning', [{ name: 'reason', label: 'Why is this OK? (optional, saved with the project)', value: '', placeholder: 'e.g. rotamers: two signals for one carbon' }], { ok: 'Dismiss', lines: [[w.message, '']] });
        if (got) await this.act(() => p.dismissWarning(c, w, got.reason));
      });
      line.append(b);
    }
    return line;
  }

  /** The warnings on the compound page shown, in place (typing in a field changes them without drawing the page again). */
  private paintWarnings(): void {
    const c = this.currentCompound();
    if (!c || this.pick.kind !== 'compound') return;
    const list = this.showDismissed ? this.warnings.get(c.id) ?? [] : this.activeWarnings(c);
    const boxes = new Map([...this.page.querySelectorAll<HTMLElement>('.si-fwarn[data-key]')].map((b) => [b.dataset.key!, b]));
    const byField = new Map<string, SiWarning[]>();
    for (const w of list) {
      const at = boxes.has(w.field) ? w.field : '';
      byField.set(at, [...(byField.get(at) ?? []), w]);
    }
    for (const [key, box] of boxes) {
      const here = byField.get(key) ?? [];
      box.replaceChildren(...here.map((w) => this.warningLine(c, w, key === '' ? this.fieldName(c, w.field) : '')));
      box.hidden = !here.length;
    }
    const n = this.dismissedWarnings(c).length;
    const chip = this.page.querySelector<HTMLButtonElement>('.si-dismissed-chip');
    if (chip) {
      chip.hidden = !n;
      chip.textContent = `${n} dismissed`;
      chip.setAttribute('aria-pressed', String(this.showDismissed));
      chip.classList.toggle('on', this.showDismissed);
    }
    const calc = this.page.querySelector<HTMLElement>('.si-calc');
    if (calc) this.paintHrms(c, calc);
  }

  /** How a field is named in a warning list ("ID" for the compound's ID). */
  private fieldName(c: SiCompound, key: string): string {
    if (key === ID_KEY) return 'ID';
    if (key === 'structure') return 'Structure';
    const e = fieldsOf(c).find((x) => x.key === key);
    const def = e ? fieldDef(e) : null;
    return (def?.label ?? key).replace(/ \(private, never printed\)$/, '');
  }

  private relabel(): void {
    for (const b of this.boxes) b.relabel();
    // the header's ID and the completion counts
    const pick = this.pick;
    if (pick.kind === 'compound') this.renderPage();
  }

  private idOf(c: SiCompound): string { return this.report ? displayId(this.report, c.id) : 'ID?'; }

  /** How a link shows in text: a compound by its ID; citations by their numbers in the project's list. */
  private label = (ref: string): string => {
    const p = this.project;
    if (!p) return '?';
    if (ref.startsWith(MENTION)) {
      const id = ref.slice(MENTION.length);
      const c = p.compounds.find((x) => x.id === id);
      return c ? this.idOf(c) : id.startsWith('c-') ? '(deleted compound)' : id;
    }
    if (ref.startsWith(CITE)) {
      const ids = ref.slice(CITE.length).split(',');
      return '[' + ids.map((id) => { const i = p.references.findIndex((r) => r.id === id); return i >= 0 ? String(i + 1) : '?'; }).join(',') + ']';
    }
    return '▣';
  };

  private mentionable = (): { id: string; label: string; text: string }[] => {
    const p = this.project;
    return p ? p.compounds.map((c) => ({ id: c.id, label: this.idOf(c), text: compoundName(c) })) : [];
  };

  private status(): void {
    const p = this.project;
    if (!p) return;
    const flags = p.compounds.reduce((n, c) => n + Object.keys(flagsOf(c)).length, 0);
    const warns = p.compounds.reduce((n, c) => n + this.activeWarnings(c).length, 0);
    const s = this.currentSection();
    let lead = p.title;
    if (s?.type === 'data') {
      const cs = compoundsOf(s);
      const done = cs.filter((c) => { const k = p.completion(c); return k.filled === k.total; }).length;
      lead = `${s.name}: ${done} of ${cs.length} compound${cs.length === 1 ? '' : 's'} complete`;
    }
    const bits = [lead, `${flags} flag${flags === 1 ? '' : 's'}`, `${warns} warning${warns === 1 ? '' : 's'}`, p.readOnly ? 'Open read-only' : 'Every change is saved to the project folder'];
    this.host.hint(bits.join(' · '));
  }

  private currentSection(): SiSection | null {
    const p = this.project;
    if (!p) return null;
    const pick = this.pick;
    try {
      if (pick.kind === 'section') return p.section(pick.id);
      if (pick.kind === 'compound') return p.section(p.compound(pick.id).sectionId);
    } catch { /* gone */ }
    return null;
  }

  private currentCompound(): SiCompound | null {
    const p = this.project, pick = this.pick;
    if (!p || pick.kind !== 'compound') return null;
    return p.compounds.find((c) => c.id === pick.id) ?? null;
  }

  private go(pick: Pick): void {
    this.commitAll();
    this.pick = pick;
    this.refresh();
  }

  // ---------------------------------------------------------------- the tree

  private renderTree(): void {
    const p = this.project!;
    const rows: HTMLElement[] = [];
    const pick = this.pick;
    const row = (depth: number, icon: string, text: string, sel: Pick, extra: (r: HTMLElement) => void = () => {}): HTMLElement => {
      const r = el('div', 'si-row');
      r.setAttribute('role', 'treeitem');
      r.style.paddingLeft = `${6 + depth * 14}px`;
      r.innerHTML = icon;
      const t = el('span', 'si-row-text');
      t.textContent = text;
      r.append(t);
      const on = JSON.stringify(sel) === JSON.stringify(pick);
      r.classList.toggle('on', on);
      r.setAttribute('aria-selected', String(on));
      r.tabIndex = on ? 0 : -1;
      extra(r);
      r.addEventListener('click', () => this.go(sel));
      rows.push(r);
      return r;
    };
    const head = row(0, svg('si', 16), p.title, { kind: 'project' });
    head.classList.add('si-root');
    const compoundRow = (c: SiCompound, depth: number): void => {
      const k = p.completion(c);
      const flagged = Object.keys(flagsOf(c)).length > 0;
      const active = this.activeWarnings(c);
      const tip = active.map((w) => w.message).join('\n').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const icon = flagged ? `<span class="si-st flag" title="Flagged for checking">${svg('flag')}</span>` : active.length ? `<span class="si-st warn" title="${tip}">${svg('warn')}</span>`
        : k.filled === k.total ? `<span class="si-st ok" title="Every required field is filled in">${svg('check')}</span>` : `<span class="si-st" title="Missing: ${k.missing.join(', ')}">${svg('open')}</span>`;
      row(depth, icon, '', { kind: 'compound', id: c.id }, (r) => {
        const t = r.querySelector('.si-row-text')!;
        t.innerHTML = '';
        t.append(el('b', 'si-cid', this.idOf(c)), document.createTextNode(' ' + (compoundName(c) || 'unnamed compound')));
      });
    };
    const walk = (list: SiSection[], depth: number): void => {
      for (const s of list) {
        const icon = svg(s.type === 'data' ? 'flask' : s.type === 'spectra' ? 'spectrum' : s.type === 'xray' ? 'xray' : 'page', 15);
        row(depth, icon, s.name, { kind: 'section', id: s.id }, (r) => { r.title = `${TYPE_LABELS[s.type] ?? s.type} section`; });
        if (s.type === 'data') {
          for (const it of s.items) {
            if (it.kind === 'scheme') {
              row(depth + 1, svg('scheme'), String(it.data.name || 'Scheme'), { kind: 'section', id: s.id }, (r) => { r.title = 'A scheme page (made in Chem SI Assistant’s scheme editor)'; r.classList.add('si-scheme'); r.classList.remove('on'); r.setAttribute('aria-selected', 'false'); r.tabIndex = -1; });
              for (const c of it.children) compoundRow(c, depth + 2);
            } else compoundRow(it, depth + 1);
          }
        }
        walk(s.children, depth + 1);
      }
    };
    walk(p.top, 1);
    row(1, svg('refs', 15), `References (${p.references.length})`, { kind: 'references' });
    const total = p.compounds.reduce((n, c) => n + this.activeWarnings(c).length, 0);
    row(1, svg('warn', 15), `Warnings (${total})`, { kind: 'warnings' }, (r) => { r.classList.toggle('si-has-warn', total > 0); r.title = 'Every automatic warning in the project, by compound'; });
    this.tree.replaceChildren(...rows);
  }

  // ---------------------------------------------------------------- pages

  private renderPage(): void {
    this.commitAll();
    this.boxes = [];
    const p = this.project!;
    const pick = this.pick;
    const out = el('div', 'si-sheet');
    if (p.warnings.length && pick.kind === 'project') {
      const w = el('div', 'si-warnings');
      for (const m of p.warnings) w.append(el('p', '', m));
      out.append(w);
    }
    if (pick.kind === 'compound') {
      const c = this.currentCompound();
      if (c) this.compoundPage(out, c);
      else this.pick = { kind: 'project' };
    } else if (pick.kind === 'section') {
      try { this.sectionPage(out, p.section(pick.id)); } catch { this.pick = { kind: 'project' }; }
    } else if (pick.kind === 'references') this.referencesPage(out);
    else if (pick.kind === 'warnings') this.warningsPage(out);
    if (this.pick.kind === 'project') this.projectPage(out);
    this.page.replaceChildren(out);
  }

  private projectPage(out: HTMLElement): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('h2', 'si-title', p.title);
    addInfo(h, 'An SI project is a folder Chem SI Assistant reads and writes too: changes made here are saved to its files at once, and open there as they are. Pick a section or a compound on the left.');
    card.append(h);
    const rows: [string, string][] = [
      ['Folder', p.folder.where],
      ['Journal style', String(p.settings.journal_style ?? 'ACS')],
      ['Sections', String(p.sections.length)],
      ['Compounds', String(p.compounds.length)],
      ['References', String(p.references.length)],
    ];
    if (p.savedBy) rows.push(['Last saved by', `version ${p.savedBy}`]);
    const t = el('table', 'si-facts');
    for (const [a, b] of rows) { const tr = el('tr'); tr.append(el('th', '', a), el('td', '', b)); t.append(tr); }
    card.append(t);
    if (!p.sections.length) card.append(el('p', 'muted', 'No sections yet: New Section makes one (a Data section holds compounds).'));
    out.append(card);
  }

  private referencesPage(out: HTMLElement): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('h2', 'si-title', 'References');
    addInfo(h, 'The project’s references (references.json), numbered in the order they are listed. Cite from My Library adds references from your library.');
    card.append(h);
    const add = el('button', 'si-btn', 'Add from My Library…');
    add.type = 'button';
    add.addEventListener('click', () => void this.citeFromLibrary(null));
    card.append(add);
    const ol = el('ol', 'si-refs');
    for (const r of p.references) {
      const li = el('li');
      const authors = Array.isArray(r.authors) ? (r.authors as string[]).join('; ') : '';
      li.textContent = [authors, r.title, [r.journal, r.year, r.volume, r.pages].filter(Boolean).join(', '), r.doi ? `DOI: ${r.doi}` : ''].filter(Boolean).join('. ');
      ol.append(li);
    }
    if (!p.references.length) card.append(el('p', 'muted', 'No references yet.'));
    card.append(ol);
    out.append(card);
  }

  private sectionPage(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('div', 'si-head-row');
    const name = el('input', 'si-name-input');
    name.value = s.name;
    name.setAttribute('aria-label', 'Section name');
    name.addEventListener('change', () => void this.act(() => p.renameSection(s.id, name.value)));
    h.append(name, el('span', 'si-chip', `${TYPE_LABELS[s.type] ?? s.type} section`));
    card.append(h);
    out.append(card);
    if (s.type === 'data') {
      this.idTableCard(out, s);
      this.fieldsCard(out, s);
      const gps = p.generalProcedures(s);
      if (gps.length) {
        const g = el('div', 'si-card');
        const gh = el('h3', 'si-sub', 'General procedures');
        addInfo(gh, 'Made and edited in Chem SI Assistant for now. A compound uses one in its Experimental procedure field.');
        g.append(gh);
        for (const gp of gps) g.append(el('p', '', `${partText(gp.name)}${gp.title ? ': ' + partText(gp.title) : ''}`));
        out.append(g);
      }
    } else if (s.type === 'text') {
      const t = el('div', 'si-card');
      const th = el('h3', 'si-sub', 'Text');
      addInfo(th, 'The section’s text. Lines starting with # are headings. Mention a compound with @ (it prints as its ID).');
      t.append(th);
      out.append(t);
      void p.readSectionText(s).then((text) => {
        const box = new SiRichBox(text, { label: this.label, mentionable: this.mentionable, changed: (v) => void this.act(() => p.writeSectionText(s, v)) }, true, 'Type the section’s text');
        this.boxes.push(box);
        t.append(box.el);
      });
    } else {
      out.append(el('p', 'muted si-note', `${TYPE_LABELS[s.type] ?? s.type} sections are edited in Chem SI Assistant for now; they are kept as they are here.`));
    }
  }

  private idTableCard(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('h3', 'si-sub', 'ID table');
    addInfo(h, 'Row 1 is the first compound’s ID, row 2 the second’s, and so on: moving compounds renumbers them. A Manual ID on a compound replaces its ID but still uses up its row.');
    card.append(h);
    const tools = el('div', 'si-tools');
    const fill = el('button', 'si-btn', 'Fill from Pattern…');
    fill.type = 'button';
    fill.addEventListener('click', () => void this.run('fill-pattern'));
    const pages = el('button', 'si-btn', 'Add Pages for IDs');
    pages.type = 'button';
    pages.addEventListener('click', () => void this.run('pages-for-ids'));
    tools.append(fill, pages);
    card.append(tools);
    const table = idTableOf(s);
    const cs = compoundsOf(s);
    const grid = el('div', 'si-idgrid');
    const n = Math.max(table.length + 1, cs.length, 3);
    for (let i = 0; i < n; i++) {
      const r = el('div', 'si-idrow');
      const input = el('input');
      input.value = table[i] ?? '';
      input.setAttribute('aria-label', `ID for row ${i + 1}`);
      input.addEventListener('change', () => {
        const next = idTableOf(s).slice();
        while (next.length <= i) next.push('');
        next[i] = input.value.trim();
        while (next.length && !next[next.length - 1]) next.pop();
        void this.act(() => p.setIdTable(s.id, next));
      });
      const c = cs[i];
      const warn = this.report?.tableWarnings.get(cellKey(s.id, i));
      r.append(el('span', 'si-rown', String(i + 1)), input, el('span', 'si-idwho', c ? `${compoundName(c) || 'unnamed compound'}${idOverride(c) ? ` (Manual ID ${idOverride(c)})` : ''}` : ''));
      r.append(warn ? el('span', 'si-chip warn', warn) : el('span'));
      grid.append(r);
    }
    card.append(grid);
    out.append(card);
  }

  private fieldsCard(out: HTMLElement, s: SiSection): void {
    const p = this.project!;
    const card = el('div', 'si-card');
    const h = el('h3', 'si-sub', 'Fields of new compounds');
    addInfo(h, 'The fields a new compound page of this section gets, in this order. Required fields count towards a page being complete. Apply Section Fields gives them to the compounds already there.');
    card.append(h);
    const entries = defaultFieldsOf(s);
    const list = el('div', 'si-fieldlist');
    entries.forEach((e, i) => {
      const def = fieldDef(e);
      const r = el('div', 'si-fieldrow');
      const req = el('input');
      req.type = 'checkbox';
      req.checked = !!e.required;
      req.title = 'Required';
      req.addEventListener('change', () => {
        const next = entries.map((x, j) => (j === i ? { ...x, required: req.checked } : x));
        void this.act(() => p.setDefaultFields(s.id, next));
      });
      const up = el('button', 'si-mini', '▲');
      up.type = 'button';
      up.title = 'Move up';
      up.disabled = i === 0;
      up.addEventListener('click', () => { const next = entries.slice(); [next[i - 1], next[i]] = [next[i], next[i - 1]]; void this.act(() => p.setDefaultFields(s.id, next)); });
      const rm = el('button', 'si-mini', '✕');
      rm.type = 'button';
      rm.title = 'Take off the list';
      rm.addEventListener('click', () => void this.act(() => p.setDefaultFields(s.id, entries.filter((_, j) => j !== i))));
      const lab = el('label', 'si-fieldname');
      lab.append(req, document.createTextNode(def?.label ?? e.key));
      r.append(lab, up, rm);
      list.append(r);
    });
    card.append(list);
    const add = el('button', 'si-btn', 'Add Field…');
    add.type = 'button';
    add.addEventListener('click', async () => {
      const got = await this.chooseField(entries.map((e) => e.key));
      if (got) await this.act(() => p.setDefaultFields(s.id, [...entries, { ...got, required: false }]));
    });
    const apply = el('button', 'si-btn', 'Apply Section Fields');
    apply.type = 'button';
    apply.addEventListener('click', () => void this.run('apply-fields'));
    const tools = el('div', 'si-tools');
    tools.append(add, apply);
    card.append(tools);
    out.append(card);
  }

  // ---------------------------------------------------------------- a compound's page

  private compoundPage(out: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const s = p.section(c.sectionId);
    const required = new Set(defaultFieldsOf(s).filter((e) => e.required).map((e) => e.key));
    // the header: structure, ID and name, formula and masses
    const head = el('div', 'si-card si-cpd-head');
    const pic = el('button', 'si-struct');
    pic.type = 'button';
    pic.title = 'Edit Structure: draw it with the drawing tools';
    pic.addEventListener('click', () => this.editStructure(c));
    const info = el('div', 'si-cpd-info');
    const line = el('div', 'si-cpd-title');
    line.append(el('b', 'si-cid', this.idOf(c)), el('span', 'si-cpd-name', compoundName(c) || 'unnamed compound'));
    const facts = el('div', 'si-cpd-facts muted', p.hasStructure(c) ? '' : 'No structure yet.');
    const k = p.completion(c);
    const chips = el('div', 'si-chips');
    const done = el('span', `si-chip ${k.filled === k.total ? 'ok' : ''}`, `${k.filled} / ${k.total} required`);
    if (k.missing.length) done.title = 'Missing: ' + k.missing.join(', ');
    const idChip = el('button', 'si-chip si-chip-btn', idOverride(c) ? `Manual ID ${idOverride(c)}` : 'ID from table');
    idChip.type = 'button';
    idChip.title = 'Change the compound’s ID (a Manual ID, or the one in its section’s ID table)';
    idChip.addEventListener('click', () => void this.run('manual-id'));
    const shown = el('button', 'si-chip si-chip-btn si-dismissed-chip');
    shown.type = 'button';
    shown.hidden = true;
    shown.title = 'Show the warnings dismissed for this compound (with Restore), or hide them again';
    shown.addEventListener('click', () => { this.showDismissed = !this.showDismissed; this.paintWarnings(); });
    chips.append(done, idChip, shown);
    const buttons = el('div', 'si-tools');
    const edit = el('button', 'si-btn', p.hasStructure(c) ? 'Edit Structure' : 'Draw Structure');
    edit.type = 'button';
    edit.addEventListener('click', () => this.editStructure(c));
    const lib = el('button', 'si-btn', 'Add to Compound Library');
    lib.type = 'button';
    lib.addEventListener('click', () => void this.toLibrary([c]));
    buttons.append(edit, lib);
    const headWarn = el('div', 'si-fwarn si-head-warn');
    headWarn.dataset.key = '';
    headWarn.hidden = true;
    info.append(line, facts, buttons);
    head.append(pic, info, chips, headWarn);
    out.append(head);
    if (p.hasStructure(c)) void this.fillStructure(c, pic, facts);
    else pic.innerHTML = '<span class="muted">Draw<br>structure</span>';

    const card = el('div', 'si-card si-fields');
    for (const e of fieldsOf(c)) {
      const def = fieldDef(e);
      if (!def || def.kind === 'structure') continue;
      card.append(this.fieldRow(c, def, required.has(def.key)));
    }
    const unknown = fieldsOf(c).filter((e) => !fieldDef(e)).map((e) => e.key);
    if (unknown.length) card.append(el('p', 'muted si-note', `Kept as they are (made by a newer Chem SI Assistant): ${unknown.join(', ')}.`));
    out.append(card);
  }

  private async fillStructure(c: SiCompound, pic: HTMLElement, facts: HTMLElement): Promise<void> {
    const p = this.project!;
    const mol = await p.readStructure(c);
    const shown = this.host.pictureOf(mol);
    if (shown) pic.innerHTML = shown; else pic.textContent = 'Structure';
    const key = mol;
    if (!this.analyzed.has(key)) this.analyzed.set(key, await this.host.analyze(mol).catch(() => null));
    const a = this.analyzed.get(key);
    if (a) {
      facts.replaceChildren();
      facts.append(formulaNode(a.formula), document.createTextNode(` · MW ${a.mw.toFixed(2)} · Exact mass ${a.exact.toFixed(4)}`));
    }
  }

  private fieldRow(c: SiCompound, def: FieldDef, required: boolean): HTMLElement {
    const p = this.project!;
    const row = el('div', 'si-field');
    row.dataset.key = def.key;
    const lab = el('div', 'si-flabel');
    lab.textContent = def.label.replace(/ \(private, never printed\)$/, '');
    if (required) lab.append(el('span', 'si-req', '*'));
    if (def.description) addInfo(lab, def.description);
    const body = el('div', 'si-fbody');
    const flag = el('button', 'si-flag');
    flag.type = 'button';
    const f = flagsOf(c)[def.key];
    flag.innerHTML = svg('flag');
    flag.classList.toggle('on', !!f);
    flag.title = f ? `Flagged${f.by ? ' by ' + f.by : ''}: ${partText(f.comment) || '(no comment)'}. Click to take the flag off.` : 'Flag this field for checking';
    flag.setAttribute('aria-pressed', String(!!f));
    flag.addEventListener('click', async () => {
      if (f) { await this.act(() => p.setFlag(c, def.key, false)); return; }
      const got = await ask('Flag for Checking', [{ name: 'comment', label: 'What to check', value: '', placeholder: 'e.g. Rf measured in the wrong eluent' }], { ok: 'Flag' });
      if (got) await this.act(() => p.setFlag(c, def.key, true, got.comment.trim()));
    });
    row.append(lab, body, flag);
    const values = valuesOf(c);
    if (def.kind === 'parts') this.partsEditor(body, c, def);
    if (def.key === 'hrms') this.hrmsExtra(body, c);
    else if (def.kind === 'richtext' || def.kind === 'notes') {
      if (def.key === 'procedure') this.procedureEditor(body, c);
      else this.textBox(body, c, def.key, def.kind === 'notes' ? 'Private notes (never printed)' : '');
    } else if (def.kind === 'nmr') this.nmrEditor(body, c);
    else if (def.kind === 'citations') this.citationsEditor(body, c);
    else if (def.kind === 'attachments' || def.kind === 'private') {
      const list = Array.isArray(values[def.key]) ? (values[def.key] as Json[]) : [];
      const chips = el('div', 'si-chips');
      for (const it of list) {
        const name = partText(it.file) || partText(it.name) || 'file';
        const type = partText(it.type);
        chips.append(el('span', 'si-chip', type ? `${name} · ${type}` : name));
      }
      if (!list.length) chips.append(el('span', 'muted', 'None yet.'));
      if (def.kind === 'attachments') {
        const add = el('button', 'si-btn', def.key === 'spectra' ? 'Add Spectra…' : 'Add Files…');
        add.type = 'button';
        add.addEventListener('click', () => void this.addFiles(c, def));
        chips.append(add);
      }
      body.append(chips);
    }
    const warn = el('div', 'si-fwarn');
    warn.dataset.key = def.key;
    warn.hidden = true;
    body.append(warn);
    return row;
  }

  // ---------------------------------------------------------------- HRMS

  /** Under the HRMS boxes: M (a salt's piece, or a typed formula) and the calculated m/z with the error. */
  private hrmsExtra(body: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const value = (): Json => { const v = valuesOf(c).hrms; return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}; };
    const line = el('div', 'si-parts si-hrms-m');
    const mIs = el('label', 'si-part si-species');
    mIs.append(el('span', 'si-plabel', 'M is'));
    const sel = el('select');
    sel.setAttribute('aria-label', 'M is');
    sel.addEventListener('change', () => void this.act(() => p.setPart(c, 'hrms', 'species', sel.value), false));
    mIs.append(sel);
    const fcell = el('label', 'si-part');
    fcell.append(el('span', 'si-plabel', 'M formula'));
    const formula = el('input');
    formula.value = partText(value().formula);
    formula.setAttribute('aria-label', 'M formula');
    formula.title = 'Type M’s formula to use instead of the structure’s (the adduct is still applied). Leave empty to use the structure.';
    formula.addEventListener('change', () => void this.act(() => p.setPart(c, 'hrms', 'formula', formula.value.trim()), false));
    fcell.append(formula);
    line.append(mIs, fcell);
    const calc = el('div', 'si-calc muted');
    body.append(line, calc);
  }

  /** The species choice and the calculated line, from the compound as it is now. */
  private paintHrms(c: SiCompound, calc: HTMLElement): void {
    const p = this.project!;
    const value = ((): Json => { const v = valuesOf(c).hrms; return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}; })();
    const facts = this.factsOf(c);
    const waiting = p.hasStructure(c) && !this.mols.has(c.id);
    // M is: only for a structure in pieces (a salt)
    const sel = calc.parentElement?.querySelector<HTMLSelectElement>('.si-species select');
    const auto = (() => { try { return hrmsSpecies(facts, { species: value.species ?? '' }); } catch { return null; } })();
    if (sel) {
      const cell = sel.closest<HTMLElement>('.si-species')!;
      cell.hidden = !auto?.choices;
      if (auto?.choices && auto.automatic) {
        const opts = [new Option(`Automatic (${auto.automatic[1]})`, ''), ...auto.choices.map(([k, label]) => new Option(label, k))];
        opts[0].title = 'The largest piece that is not a common counter-ion (halide, BF4⁻, PF6⁻, OTf⁻, NTf2⁻, TFA⁻, BArF⁻, Na⁺, K⁺, NBu4⁺…); the largest piece if all are.';
        sel.replaceChildren(...opts);
        sel.value = auto.key;
      }
      const input = calc.parentElement?.querySelector<HTMLInputElement>('.si-hrms-m input');
      if (input) {
        input.placeholder = auto ? `auto: ${speciesLabel(auto.info)}` : 'e.g. C12H13NO';
        input.classList.toggle('si-manual', !!partText(value.formula).trim());
      }
    }
    calc.classList.remove('bad');
    calc.title = '';
    if (waiting) { calc.textContent = 'Working out the expected m/z…'; return; }
    let sp;
    try { sp = hrmsSpecies(facts, value); } catch (e) { calc.textContent = e instanceof ChemError ? e.message : String(e); calc.classList.add('bad'); return; }
    if (!sp) {
      calc.textContent = facts?.generic.length ? `The structure has a generic atom (${facts.generic.join(', ')}): type M’s formula to calculate the expected m/z.` : 'Add a structure (or type M’s formula) to calculate the expected m/z.';
      return;
    }
    const [r, problem] = compoundHrms(p, c, facts);
    if (!r) { calc.textContent = problem || ''; calc.classList.toggle('bad', !!problem); return; }
    const mono = monoisotopic(r);
    const adduct = partText(value.adduct) || '[M+H]+';
    calc.replaceChildren();
    calc.append('Calcd for ', formulaNode(mono.formula));
    if (sp.manual) {
      const differs = auto && !sameFormula(auto.info.counts, sp.info.counts) ? ` (structure gives ${auto.info.formula})` : '';
      calc.append(el('span', 'si-manual-mark', ' ✎'));
      calc.title = `M formula typed by hand${differs}.`;
    }
    calc.append(` ${adductDisplay(adduct)}: `, el('b', '', mono.mz.toFixed(4)));
    if (r.found !== null && r.ppm !== null) {
      const peak = r.matched && r.matched !== mono ? ` (compared with the ${r.matched.mz.toFixed(4)} peak, ${r.matched.formula})` : '';
      const ppm = `${r.ppm >= 0 ? '+' : ''}${r.ppm.toFixed(1)} ppm`;
      const bad = outOfTolerance(r);
      calc.append(`; found ${r.found.toFixed(4)}${peak} · Δ `, el('span', bad ? 'si-bad' : 'si-good', bad ? `${ppm} (outside ±${r.tolerance} ppm)` : `${ppm} ✓`));
    }
    const shownPeaks = r.peaks.filter((x) => x.abundance >= 5).slice(0, 6);
    addInfo(calc, `Isotope pattern (m/z): ${shownPeaks.map((x) => `${x.mz.toFixed(4)} (${x.abundance.toFixed(1)}%)`).join(', ')}`);
  }

  // ---------------------------------------------------------------- the Warnings page

  private warningsPage(out: HTMLElement): void {
    const p = this.project!;
    const card = el('div', 'si-card si-warn-list');
    const head = el('div', 'si-card-head');
    const h = el('h2', 'si-title', 'Warnings');
    addInfo(h, 'The automatic checks of every compound (HRMS, NMR, yields, spectra, IDs, general procedures), as Chem SI Assistant makes them. Warnings never block anything: dismiss those that don’t apply, with a reason. A dismissed warning comes back if the data it is about changes, and dismissals are shared with SI Assistant.');
    const show = el('label', 'si-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = this.showDismissed;
    box.addEventListener('change', () => { this.showDismissed = box.checked; this.shownKey = ''; this.refresh(); });
    show.append(box, document.createTextNode(' Show dismissed'));
    head.append(h, show);
    card.append(head);
    let any = false;
    for (const s of p.dataSections) {
      const rows: HTMLElement[] = [];
      for (const c of compoundsOf(s)) {
        const list = this.showDismissed ? this.warnings.get(c.id) ?? [] : this.activeWarnings(c);
        if (!list.length) continue;
        const who = el('button', 'si-warn-cpd');
        who.type = 'button';
        who.title = 'Open this compound';
        who.append(el('b', 'si-cid', this.idOf(c)), document.createTextNode(' ' + (compoundName(c) || 'unnamed compound')));
        who.addEventListener('click', () => this.go({ kind: 'compound', id: c.id }));
        rows.push(who, ...list.map((w) => this.warningLine(c, w, this.fieldName(c, w.field))));
      }
      if (!rows.length) continue;
      any = true;
      card.append(el('h3', 'si-sub', s.name), ...rows);
    }
    if (this.loadingFacts || p.compounds.some((c) => !this.warnings.has(c.id))) card.append(el('p', 'muted si-note', 'Still reading some structures…'));
    else if (!any) card.append(el('p', 'muted si-note', this.showDismissed ? 'No warnings.' : 'No warnings to look at.'));
    out.append(card);
  }

  private partsEditor(body: HTMLElement, c: SiCompound, def: FieldDef): void {
    const p = this.project!;
    const v = valuesOf(c)[def.key];
    const value = v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
    const wrap = el('div', 'si-parts');
    for (const part of def.parts ?? []) {
      const cell = el('label', 'si-part');
      if (part.label && (def.parts?.length ?? 0) > 1) cell.append(el('span', 'si-plabel', part.label));
      const now = partText(value[part.key]);
      let input: HTMLInputElement | HTMLSelectElement;
      if (part.kind === 'choice') {
        const sel = el('select');
        sel.add(new Option('', ''));
        for (const ch of part.choices ?? []) sel.add(new Option(part.choiceLabels?.[ch] ?? ch, ch));
        if (now && !(part.choices ?? []).includes(now)) sel.add(new Option(now, now));
        sel.value = now;
        input = sel;
      } else {
        const inp = el('input');
        inp.value = now;
        if (part.placeholder) inp.placeholder = part.placeholder;
        if (part.kind === 'number') { inp.inputMode = 'decimal'; inp.classList.add('si-num'); }
        if (part.kind === 'combo') {
          const listId = `si-dl-${def.key}-${part.key}`;
          let dl = document.getElementById(listId) as HTMLDataListElement | null;
          if (!dl) { dl = el('datalist'); dl.id = listId; document.body.append(dl); }
          const used = this.usedValues(def, part);
          dl.replaceChildren(...learnedChoices(part, used).map((x) => new Option(x, x)));
          inp.setAttribute('list', listId);
        }
        input = inp;
      }
      input.setAttribute('aria-label', `${def.label}${part.label ? ' ' + part.label : ''}`);
      input.addEventListener('change', () => void this.act(() => p.setPart(c, def.key, part.key, input.value), false));
      cell.append(input);
      if (part.suffix) cell.append(el('span', 'si-suffix', part.suffix));
      wrap.append(cell);
    }
    body.append(wrap);
  }

  private usedValues(def: FieldDef, part: Part): string[] {
    const p = this.project!;
    if (!part.learn) return [];
    const out = p.usedPartValues(def.key, part.key);
    for (const also of part.learnAlso ?? []) { const [f, k] = also.split('.'); out.push(...p.usedPartValues(f, k)); }
    return out;
  }

  private textBox(body: HTMLElement, c: SiCompound, key: string, placeholder = ''): void {
    const p = this.project!;
    const box = new SiRichBox(p.compoundText(c, key), { label: this.label, mentionable: this.mentionable, changed: (t) => void this.act(() => p.writeCompoundText(c, key, t), false) }, true, placeholder);
    this.boxes.push(box);
    body.append(box.el);
  }

  private procedureEditor(body: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const gps = p.dataSections.flatMap((x) => p.generalProcedures(x));
    const v = valuesOf(c).procedure;
    const choice = v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
    const gpId = partText(choice.gp);
    if (gps.length) {
      const r = el('label', 'si-part');
      r.append(el('span', 'si-plabel', 'General procedure'));
      const sel = el('select');
      sel.add(new Option('None (type the procedure)', ''));
      for (const gp of gps) sel.add(new Option(partText(gp.name) || 'General procedure', partText(gp.id)));
      sel.value = gpId;
      sel.addEventListener('change', () => void this.act(() => p.setValue(c, 'procedure', { ...choice, gp: sel.value, values: (choice.values as Json) ?? {} })));
      r.append(sel);
      body.append(r);
    }
    const gp = p.compoundGp(c);
    if (!gp) { this.textBox(body, c, 'procedure', 'Type the experimental procedure'); return; }
    // one box per word in {braces} of the general procedure's sentence; the automatic ones show what they become
    const vals = (choice.values && typeof choice.values === 'object' ? choice.values : {}) as Json;
    const AUTO: Record<string, string> = { gp: partText(gp.name), product: this.idOf(c), scale: this.autoScale(c), yield: this.autoYield(c), purification: this.autoPurification(c) };
    const wrap = el('div', 'si-parts');
    const seen = new Set<string>();
    for (const m of partText(gp.sentence).matchAll(/\{([^{}]+)\}/g)) {
      const name = m[1].trim();
      const k = name.toLowerCase().split(/\s+/).join(' ');
      if (seen.has(k) || k === 'gp') continue;
      seen.add(k);
      const stored = Object.keys(vals).find((x) => x.toLowerCase().split(/\s+/).join(' ') === k) ?? name;
      const cell = el('label', 'si-part si-gp-part');
      cell.append(el('span', 'si-plabel', name));
      const box = new SiRichBox(partText(vals[stored]), {
        label: this.label, mentionable: this.mentionable,
        changed: (t) => void this.act(() => p.setValue(c, 'procedure', { ...choice, values: { ...vals, [stored]: t } }), false),
      }, false, AUTO[k] ? `auto: ${AUTO[k]}` : '');
      this.boxes.push(box);
      cell.append(box.el);
      wrap.append(cell);
    }
    body.append(wrap);
  }

  private autoScale(c: SiCompound): string {
    const v = valuesOf(c).scale as Json | undefined;
    const n = v ? partText(v.value).trim() : '';
    return n ? `${n} ${partText(v!.unit).trim() || 'mmol'}` : '';
  }
  private autoYield(c: SiCompound): string {
    const v = valuesOf(c).yield as Json | undefined;
    const n = v ? partText(v.percent).trim() : '';
    return n ? `${n}%` : '';
  }
  private autoPurification(c: SiCompound): string {
    const v = valuesOf(c).purification as Json | undefined;
    if (!v || !partText(v.method).trim()) return '';
    const inside = [partText(v.phase).trim(), partText(v.eluent).trim()].filter(Boolean).join(', ');
    return partText(v.method).trim() + (inside ? ` (${inside})` : '');
  }

  private nmrEditor(body: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const reports = (Array.isArray(valuesOf(c).nmr) ? valuesOf(c).nmr : []) as Json[];
    const save = (): Promise<void> => p.setValue(c, 'nmr', reports);
    for (const r of reports) {
      const line = el('div', 'si-nmr');
      const sel = el('select');
      for (const n of NUCLEI) sel.add(new Option(nucleusLabel(n), n));
      const nuc = partText(r.nucleus);
      if (nuc && !(NUCLEI as readonly string[]).includes(nuc)) sel.add(new Option(nuc, nuc));
      sel.value = nuc;
      sel.setAttribute('aria-label', 'Nucleus');
      sel.addEventListener('change', () => { r.nucleus = sel.value; void this.act(save, false); });
      const box = new SiRichBox(partText(r.text), { label: this.label, changed: (t) => { r.text = t; void this.act(save, false); } }, false, `${nucleusLabel(nuc || '1H')} NMR (400 MHz, CDCl3) δ …`);
      this.boxes.push(box);
      const rm = el('button', 'si-mini', '✕');
      rm.type = 'button';
      rm.title = 'Remove this report';
      rm.addEventListener('click', () => { reports.splice(reports.indexOf(r), 1); void this.act(save); });
      line.append(sel, box.el, rm);
      body.append(line);
    }
    const add = el('button', 'si-btn', 'Add Report');
    add.type = 'button';
    add.title = 'Another NMR peak report (another nucleus, or another solvent)';
    add.addEventListener('click', () => { reports.push({ id: newId('r'), nucleus: '19F', label: '', text: '' }); void this.act(save); });
    body.append(add);
  }

  private citationsEditor(body: HTMLElement, c: SiCompound): void {
    const p = this.project!;
    const v = valuesOf(c).references;
    const value = (v && typeof v === 'object' && !Array.isArray(v) ? v : { text: '', refs: [] }) as Json;
    const refs = Array.isArray(value.refs) ? (value.refs as string[]) : [];
    const box = new SiRichBox(partText(value.text), { label: this.label, changed: (t) => void this.act(() => p.setValue(c, 'references', { ...value, text: t }), false) }, false);
    this.boxes.push(box);
    body.append(box.el);
    const chips = el('div', 'si-chips');
    for (const id of refs) {
      const r = p.reference(id);
      const n = p.references.findIndex((x) => x.id === id) + 1;
      const chip = el('span', 'si-chip', r ? `[${n}] ${shortRef(r)}` : `${id} (not in the project’s references)`);
      const x = el('button', 'si-x', '✕');
      x.type = 'button';
      x.title = 'Take this citation out';
      x.addEventListener('click', () => void this.act(() => p.setValue(c, 'references', { ...value, refs: refs.filter((y) => y !== id) })));
      chip.append(x);
      chips.append(chip);
    }
    const add = el('button', 'si-btn', 'Cite from My Library…');
    add.type = 'button';
    add.addEventListener('click', () => void this.citeFromLibrary(c));
    chips.append(add);
    body.append(chips);
  }

  // ---------------------------------------------------------------- commands

  /** Run a change to the project, then show it; a problem is said, not thrown. */
  private async act(f: () => Promise<unknown>, redraw = true): Promise<void> {
    try {
      await f();
    } catch (e) {
      this.host.flash(e instanceof SiProjectError ? e.message : `Could not save the change: ${e instanceof Error ? e.message : String(e)}`, 8000);
      this.shownKey = '';
    }
    if (redraw) this.shownKey = '';
    this.refresh();
  }

  private key(e: KeyboardEvent): void {
    const inText = (e.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]');
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); void this.run(e.key === 'ArrowUp' ? 'move-up' : 'move-down'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); void this.run('new-compound'); return; }
    if (inText) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const rows = [...this.tree.querySelectorAll<HTMLElement>('.si-row:not(.si-scheme)')];
      const at = rows.findIndex((r) => r.classList.contains('on'));
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowUp' ? -1 : 1)))];
      if (next) { e.preventDefault(); next.click(); this.tree.querySelector<HTMLElement>('.si-row.on')?.focus(); }
    }
  }

  /** Compile the project into a document (SI Assistant's layout), opened in a tab of its own; what was left out is said after. */
  private async compile(pdf: boolean): Promise<void> {
    const p = this.project;
    if (!p) return;
    this.host.flash('Compiling the SI…', 1500);
    let got;
    try {
      got = await compileSi(p, { contentsOf: (m) => this.host.contentsOf(m), sizeOf: (c) => this.host.sizeOf(c), facts: (m) => this.host.siFacts(m) });
    } catch (e) {
      this.host.flash(`Could not compile the SI: ${e instanceof Error ? e.message : String(e)}`, 6000);
      return;
    }
    await this.host.openCompiled(got.doc, `${p.title} SI`, pdf);
    if (got.notes.length) {
      await ask('Compile Notes', [], { noCancel: true, ok: 'OK', note: `The SI was compiled. ${got.notes.length === 1 ? 'One thing' : `${got.notes.length} things`} to know:`, points: got.notes });
    }
  }

  async run(cmd: string): Promise<void> {
    const p = this.project;
    if (!p) return;
    if (p.readOnly && !['reload', 'project-settings', 'warnings', 'compile-doc', 'compile-pdf'].includes(cmd)) { this.host.flash('This SI project is open read-only.'); return; }
    this.commitAll();
    const s = this.currentSection();
    const c = this.currentCompound();
    const data = s?.type === 'data' ? s : null;
    const needData = (): SiSection | null => {
      if (data) return data;
      const only = p.dataSections;
      if (only.length === 1) return only[0];
      this.host.flash(only.length ? 'Pick a Data section (or a compound in one) first.' : 'Make a Data section first: New Section ▸ Data section.');
      return null;
    };
    switch (cmd) {
      case 'new-compound': {
        const d = needData();
        if (!d) return;
        const at = c && c.sectionId === d.id && !c.schemeId ? d.items.indexOf(c) + 1 : undefined;
        await this.act(async () => { const made = await p.addCompound(d.id, at); this.pick = { kind: 'compound', id: made.id }; });
        return;
      }
      case 'new-section': {
        const got = await ask('New Section', [
          { name: 'type', label: 'Kind', value: 'data', options: [{ value: 'data', label: 'Data section (compounds)' }, { value: 'text', label: 'Custom section (text)' }] },
          { name: 'name', label: 'Name', value: '', placeholder: 'e.g. Synthesis and Characterization' },
        ], { ok: 'Make Section' });
        if (!got || !got.name.trim()) return;
        // (after the top-level section picked; sub-sections are made in Chem SI Assistant for now)
        let top = s;
        while (top?.parentId) top = p.section(top.parentId);
        const at = top ? p.top.indexOf(top) + 1 : undefined;
        await this.act(async () => { const made = await p.addSection(got.type as 'data' | 'text', got.name.trim(), at, null); this.pick = { kind: 'section', id: made.id }; });
        return;
      }
      case 'delete': {
        if (!c) { this.host.flash('Pick a compound to delete (sections are deleted in Chem SI Assistant for now).'); return; }
        const sure = await askChoice('Delete Compound', `Move ${this.idOf(c)} ${compoundName(c) || 'unnamed compound'} to the project's Trash? The compounds after it take the IDs before them. Chem SI Assistant's Trash can restore it.`, [{ value: 'delete', label: 'Delete', primary: true }, { value: 'keep', label: 'Cancel' }], 'keep');
        if (sure !== 'delete') return;
        const sec = p.section(c.sectionId);
        const i = sec.items.indexOf(c);
        await this.act(async () => {
          await p.deleteCompound(c.id);
          const next = sec.items[Math.min(i, sec.items.length - 1)];
          this.pick = next && next.kind === 'compound' ? { kind: 'compound', id: next.id } : { kind: 'section', id: sec.id };
        });
        return;
      }
      case 'move-up':
      case 'move-down': {
        const step = cmd === 'move-up' ? -1 : 1;
        if (c) {
          const sec = p.section(c.sectionId);
          const i = sec.items.indexOf(c);
          if (i < 0) { this.host.flash('Compounds on a scheme page are moved in the scheme (Chem SI Assistant) for now.'); return; }
          const j = i + step;
          if (j < 0 || j >= sec.items.length) return;
          await this.act(() => p.moveCompound(c.id, sec.id, step > 0 ? j + 1 : j));
        } else if (s) {
          const list = s.parentId ? p.section(s.parentId).children : p.top;
          const i = list.indexOf(s), j = i + step;
          if (j < 0 || j >= list.length) return;
          await this.act(() => p.moveSection(s.id, step > 0 ? j + 1 : j, s.parentId));
        }
        return;
      }
      case 'id-table': {
        const d = needData();
        if (d) this.go({ kind: 'section', id: d.id });
        return;
      }
      case 'fill-pattern': {
        const d = needData();
        if (!d) return;
        const got = await ask('Fill from Pattern', [
          { name: 'prefix', label: 'Starts with', value: '', placeholder: 'e.g. 3 or S' },
          { name: 'style', label: 'Then', value: 'letters', options: [{ value: 'letters', label: 'letters (a, b, c…)' }, { value: 'numbers', label: 'numbers (1, 2, 3…)' }] },
          { name: 'start', label: 'From', value: 'a', placeholder: 'a or 1' },
          { name: 'count', label: 'How many', value: String(Math.max(compoundsOf(d).length, 1)), type: 'number', min: 1, max: 999 },
        ], { ok: 'Fill', note: 'The ID table gets this many IDs, from row 1. Manual IDs on compounds stay as they are.' });
        if (!got) return;
        let ids: string[];
        try { ids = patternIds(got.prefix.trim(), got.style as 'letters' | 'numbers', got.start.trim(), Math.max(0, Math.round(Number(got.count) || 0))); } catch (e) { this.host.flash(e instanceof Error ? e.message : String(e)); return; }
        await this.act(() => p.setIdTable(d.id, ids));
        return;
      }
      case 'pages-for-ids': {
        const d = needData();
        if (!d) return;
        const ids = p.idsWithoutPages(d);
        if (!ids.length) { this.host.flash('Every ID in the table has a compound page already.'); return; }
        await this.act(async () => { for (const _ of ids) await p.addCompound(d.id); });
        this.host.flash(`Added ${ids.length} compound page${ids.length === 1 ? '' : 's'}: ${ids.join(', ')}.`);
        return;
      }
      case 'manual-id': {
        if (!c) { this.host.flash('Pick a compound first.'); return; }
        const got = await ask('Compound ID', [{ name: 'id', label: 'Manual ID', value: idOverride(c), placeholder: 'empty: the ID from the section’s table' }], { ok: 'Set ID', note: 'A Manual ID replaces the compound’s ID, but it still uses up its row of the ID table, so the compounds after it keep theirs.' });
        if (got) await this.act(() => p.setIdOverride(c, got.id));
        return;
      }
      case 'edit-structure':
        if (!c) { this.host.flash('Pick a compound first.'); return; }
        this.editStructure(c);
        return;
      case 'from-library': await this.fromLibrary(needData()); return;
      case 'to-library': {
        const list = c ? [c] : data ? compoundsOf(data) : p.compounds;
        await this.toLibrary(list);
        return;
      }
      case 'cite-library': await this.citeFromLibrary(c); return;
      case 'add-field': {
        if (!c) { this.host.flash('Pick a compound first (to change a whole section’s fields, pick the section).'); return; }
        const got = await this.chooseField(fieldKeys(c));
        if (got) await this.act(() => p.addField(c, got));
        return;
      }
      case 'apply-fields': {
        const d = needData();
        if (!d) return;
        let n = 0;
        await this.act(async () => { n = await p.applyDefaultFields(d.id); });
        this.host.flash(n ? `Updated the fields of ${n} compound page${n === 1 ? '' : 's'}.` : 'Every compound page has the section’s fields already.');
        return;
      }
      case 'warnings':
        this.go({ kind: 'warnings' });
        return;
      case 'compile-doc':
      case 'compile-pdf':
        await this.compile(cmd === 'compile-pdf');
        return;
      case 'reload':
        this.forgetStructure();
        await this.act(() => p.reload());
        this.host.changed();
        this.host.flash('Read the project folder again.');
        return;
      case 'project-settings': {
        const got = await ask('Project Settings', [
          { name: 'title', label: 'Title', value: p.title },
          { name: 'style', label: 'Journal style', value: String(p.settings.journal_style ?? 'ACS'), options: ['ACS', 'Wiley', 'RSC'].map((x) => ({ value: x, label: x })) },
          { name: 'ppm', label: 'HRMS tolerance', value: String(p.settings.hrms_tolerance_ppm ?? 5), unit: 'ppm', type: 'number', min: 0.1, max: 100 },
        ], { ok: 'Save', note: 'Authors, the cover page and the rest are set in Chem SI Assistant for now.' });
        if (!got || p.readOnly) return;
        await this.act(async () => {
          p.settings.title = got.title.trim() || p.title;
          p.settings.journal_style = got.style;
          const ppm = Number(got.ppm);
          if (Number.isFinite(ppm) && ppm > 0) p.settings.hrms_tolerance_ppm = ppm;
          await p.saveSettings();
        });
        if (this.tab) { this.tab.name = p.title; this.host.changed(); }
        return;
      }
    }
  }

  /** Pick one of the library's fields (or make one), leaving out those the page has. */
  private async chooseField(have: string[]): Promise<FieldEntry | null> {
    const options = [...CORE_FIELDS, ...LIBRARY_FIELDS].filter((f) => !have.includes(f.key) && f.kind !== 'structure').map((f) => ({ value: f.key, label: f.label }));
    options.push({ value: '+custom', label: 'A field of my own…' });
    const got = await ask('Add Field', [{ name: 'key', label: 'Field', value: options[0]?.value ?? '+custom', options }], { ok: 'Add' });
    if (!got) return null;
    if (got.key !== '+custom') return { key: got.key };
    const own = await ask('A Field of My Own', [
      { name: 'label', label: 'Name', value: '', placeholder: 'e.g. Purity' },
      { name: 'type', label: 'Kind', value: 'short_text', options: [{ value: 'short_text', label: 'Short text' }, { value: 'long_text', label: 'Long text' }, { value: 'number_unit', label: 'Number with unit' }, { value: 'file', label: 'File(s)' }] },
    ], { ok: 'Add' });
    if (!own || !own.label.trim()) return null;
    const key = 'custom_' + own.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    if (ALL_FIELDS.has(key) || have.includes(key)) { this.host.flash('There is a field with that name already.'); return null; }
    return { key, custom: { label: own.label.trim(), type: own.type } };
  }

  private editStructure(c: SiCompound): void {
    const p = this.project!;
    if (p.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
    void p.readStructure(c).then((mol) => {
      const contents = mol ? this.host.contentsOf(mol) : null;
      this.host.editStructure(contents, `${this.idOf(c)} ${compoundName(c) || 'Structure'}`.trim(), (got) => {
        if (!got) return;
        if (!got.atoms.length) { this.host.flash('Nothing was drawn, so the structure is as it was.'); return; }
        const m = this.host.molfileOf(got);
        if (!m.molblock) { this.host.flash(m.problem ?? 'The drawing could not be read as a structure.'); return; }
        void this.act(async () => { await p.setStructure(c, m.molblock!); this.forgetStructure(c); });
      });
    });
  }

  private async addFiles(c: SiCompound, def: FieldDef): Promise<void> {
    const p = this.project!;
    const files = await this.host.pickFiles(def.key === 'spectra' ? 'Spectra (PDF or pictures)' : 'Files (PDF or pictures)', ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'svg']);
    if (!files.length) return;
    await this.act(async () => {
      const list = (Array.isArray(valuesOf(c)[def.key]) ? valuesOf(c)[def.key] : (valuesOf(c)[def.key] = [])) as Json[];
      for (const f of files) {
        const name = await p.addAttachment(c, def.subdir || 'files', f.name, f.bytes);
        const item: Json = def.key === 'spectra' ? { file: name, type: guessSpectrum(name), title: '', struct_caption: '' } : { file: name, caption: '', placement: 'inline', label: '' };
        list.push(item);
      }
      await p.saveCompound(c);
    });
  }

  // ---------------------------------------------------------------- libraries

  private async structureIn(c: SiCompound): Promise<{ molfile: string; smiles: string; formula: string; mw: number; drawing?: Contents; label: string; name: string } | null> {
    const p = this.project!;
    const mol = await p.readStructure(c);
    if (!mol) return null;
    const [smiles, a] = await Promise.all([this.host.smiles(mol), this.host.analyze(mol)]);
    if (!smiles) return null;
    return { molfile: mol, smiles, formula: a?.formula ?? '', mw: a?.mw ?? 0, drawing: this.host.contentsOf(mol) ?? undefined, label: this.idOf(c) === 'ID?' ? '' : this.idOf(c), name: compoundName(c) };
  }

  /** Keep these compounds' structures in the Compound Library, with their SI IDs, and this project as where they appear. */
  private async toLibrary(list: SiCompound[]): Promise<void> {
    const p = this.project!;
    const ins = (await Promise.all(list.map((c) => this.structureIn(c)))).filter((x): x is NonNullable<typeof x> => !!x);
    if (!ins.length) { this.host.flash('None of these compounds has a structure yet.'); return; }
    const lib = await this.host.library();
    const { addStructures } = await import('./compound-library');
    const { noteMentions } = await import('../library/library');
    let added = 0, known = 0;
    lib.change((d) => {
      const got = addStructures(d, ins, p.folder.where);
      added = got.added.length;
      known = got.known.length;
      return noteMentions(got.lib, p.folder.where, ins.map((x) => ({ smiles: x.smiles, ...(x.label ? { label: x.label } : {}) })));
    });
    this.host.flash(`Compound Library: ${added} added${known ? `, ${known} already there` : ''}. Each lists this SI project as where it appears.`, 6000);
  }

  /** A new compound page with a compound from the Compound Library. */
  private async fromLibrary(d: SiSection | null): Promise<void> {
    const p = this.project!;
    if (!d) return;
    const lib = await this.host.library();
    const picked = await pickFromList<LibCompound>('From Compound Library', lib.now.compounds, (x) => `${x.label ? x.label + '  ' : ''}${x.name || x.formula}`, (x) => `${x.formula} · MW ${x.mw ? x.mw.toFixed(2) : '?'}`, 'Your Compound Library is empty: Add to Compound Library (here, or from a drawing) keeps structures there.');
    if (!picked.length) return;
    await this.act(async () => {
      let last: SiCompound | null = null;
      for (const x of picked) {
        const made = await p.addCompound(d.id, undefined, x.name);
        if (x.molfile) await p.setStructure(made, x.molfile);
        last = made;
      }
      if (last) this.pick = { kind: 'compound', id: last.id };
    });
  }

  /** Cite references from My Library in a compound's References field (they join the project's references). */
  private async citeFromLibrary(c: SiCompound | null): Promise<void> {
    const p = this.project!;
    const lib = await this.host.library();
    const picked = await pickFromList<LibReference>('Cite from My Library', lib.now.references, (r) => r.title || r.doi || 'Untitled', (r) => [r.authors[0], r.journal, r.year].filter(Boolean).join(', '), 'My Library has no references yet: add them in References ▸ My Library.');
    if (!picked.length) return;
    await this.act(async () => {
      const ids: string[] = [];
      for (const r of picked) {
        const ref: Json = { type: r.type, authors: r.authors, title: r.title, journal: r.journal, year: r.year, volume: r.volume, issue: r.issue, pages: r.pages, doi: r.doi, url: r.url, publisher: r.publisher, note: r.note };
        ids.push(await p.addReference(ref));
      }
      if (c) {
        if (!fieldKeys(c).includes('references')) await p.addField(c, { key: 'references' });
        const v = valuesOf(c).references as Json;
        const refs = Array.isArray(v.refs) ? (v.refs as string[]) : [];
        await p.setValue(c, 'references', { ...v, refs: [...refs, ...ids.filter((i) => !refs.includes(i))] });
      }
    });
    if (!c) this.host.flash(`Added to the project’s references: ${picked.length}.`);
  }
}

/** A formula with its numbers set low: C9H12O2 → C₉H₁₂O₂. */
function formulaNode(f: string): Node {
  const span = el('span', 'si-formula');
  for (const part of f.split(/(\d+)/)) {
    if (!part) continue;
    if (/^\d+$/.test(part)) span.append(el('sub', '', part)); else span.append(document.createTextNode(part));
  }
  return span;
}

function shortRef(r: Json): string {
  const a = Array.isArray(r.authors) && r.authors.length ? String(r.authors[0]).split(',')[0] : '';
  return [a && (Array.isArray(r.authors) && r.authors.length > 1 ? `${a} et al.` : a), partText(r.journal), partText(r.year)].filter(Boolean).join(', ') || partText(r.title) || partText(r.doi);
}

/** "2b_13C.pdf" is a ¹³C NMR spectrum. */
function guessSpectrum(name: string): string {
  const m = /(?:^|[^0-9])(1H|13C|19F|31P|11B)(?:[^0-9]|$)/i.exec(name);
  if (m) return m[1].toUpperCase();
  if (/hplc|sfc/i.test(name)) return 'HPLC/SFC';
  if (/\bir\b/i.test(name)) return 'IR';
  return '1H';
}

/** Check items in a list (searchable); resolves with those checked (none when cancelled). */
function pickFromList<T>(title: string, items: T[], main: (x: T) => string, sub: (x: T) => string, empty: string): Promise<T[]> {
  return new Promise((resolve) => {
    const d = el('dialog', 'ask si-pick');
    const form = el('form');
    form.method = 'dialog';
    form.append(el('h2', '', title));
    const search = el('input');
    search.type = 'search';
    search.placeholder = 'Search';
    search.setAttribute('aria-label', 'Search');
    const list = el('div', 'si-pick-list');
    const chosen = new Set<T>();
    const fill = (): void => {
      const q = search.value.trim().toLowerCase();
      const rows = items.filter((x) => !q || (main(x) + ' ' + sub(x)).toLowerCase().includes(q)).slice(0, 400).map((x) => {
        const l = el('label', 'si-pick-row');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = chosen.has(x);
        box.addEventListener('change', () => { if (box.checked) chosen.add(x); else chosen.delete(x); ok.disabled = !chosen.size; });
        l.append(box, el('span', '', main(x)), el('small', 'muted', sub(x)));
        return l;
      });
      list.replaceChildren(...(rows.length ? rows : [el('p', 'muted', items.length ? 'Nothing matches.' : empty)]));
    };
    search.addEventListener('input', fill);
    const buttons = el('div', 'ask-buttons');
    const ok = el('button', 'primary', 'Add');
    ok.value = 'ok';
    ok.disabled = true;
    const cancel = el('button', '', 'Cancel');
    cancel.value = 'cancel';
    buttons.append(cancel, ok);
    form.append(search, list, buttons);
    d.append(form);
    document.body.append(d);
    d.addEventListener('close', () => { d.remove(); resolve(d.returnValue === 'ok' ? [...chosen] : []); });
    fill();
    d.showModal();
    search.focus();
  });
}

