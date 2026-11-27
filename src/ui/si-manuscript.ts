// The Manuscript Check page of the SI Project tab (SI Assistant SPEC §13o): an item in the tree
// just above References. The manuscript (PDF, Word, or a Chemweave document) and its ChemDraw
// files (.cdxml) are added to the project's manuscript/ folder; they are read and compared with
// the SI compound by compound, and the differences are listed. Double-click a row to open the
// compound at the field concerned. Every result is a warning: dismiss those that don't apply
// (they come back when the values change). The commands are on the contextual Manuscript Check
// tab of the ribbon.

import { markFilesTaken } from './window-drop';
import type { SiCompound, SiProject } from '../si/project';
import type { MolFacts } from '../si/chem';
import {
  CHEMDRAW_EXTENSIONS, DISMISSED, MANUSCRIPT_EXTENSIONS, NOTE, OK, PROBLEM, FIELD_OF,
  addManuscriptFile, checkManuscript, dismissFinding, findingWhat, forget, manuscriptFiles,
  readAll, removeManuscriptFile, restoreFinding, summary, type Finding, type Result,
} from '../si/ms-check';
import { Stopped, type Source } from '../si/ms-read';
import { addInfo } from './info-tip';
import { ask } from './ask';

export interface SiManuscriptHost {
  project: SiProject;
  flash(text: string, ms?: number): void;
  pickFiles(label: string, exts: string[]): Promise<{ name: string; bytes: Uint8Array }[]>;
  /** The documents open in Chemweave, each saved as .docx when asked. */
  openDocuments(): { name: string; bytes(): Promise<Uint8Array> }[];
  smiles(molfile: string): Promise<string | null>;
  facts(mols: string[]): Promise<(MolFacts | null)[]>;
  /** Run a change as one Undo step (the page and the tree are drawn again after). */
  act(label: string, f: () => Promise<unknown>): Promise<void>;
  openAt(c: SiCompound, field: string): void;
  /** The tree's count and the Warnings page follow a new result. */
  resultChanged(): void;
}

const STATUS_TEXT: Record<string, string> = { [PROBLEM]: '⚠ Check', [NOTE]: 'ℹ Note', [OK]: '✓ Agrees', [DISMISSED]: 'Dismissed' };
const KIND_OF: Record<string, string> = { '.pdf': 'PDF', '.docx': 'Word', '.cdxml': 'ChemDraw', '.cdx': 'ChemDraw (.cdx)', '.doc': 'Word (.doc)' };
export const MS_EXTS = [...MANUSCRIPT_EXTENSIONS, ...CHEMDRAW_EXTENSIONS].map((x) => x.slice(1));
const extOf = (name: string): string => (/\.[^.]+$/.exec(name)?.[0] ?? '').toLowerCase();

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** What the page keeps while another page shows (per project). */
export interface ManuscriptState {
  result: Result | null;
  sources: Source[] | null;
  filter: 'problems' | 'notes' | 'all';
  showDismissed: boolean;
  picked: string;
  file: string;
  /** Read once since the project opened (later visits use what was read, unless the files changed). */
  checked: boolean;
}
export const newManuscriptState = (): ManuscriptState => ({ result: null, sources: null, filter: 'problems', showDismissed: false, picked: '', file: '', checked: false });

export class SiManuscriptPage {
  readonly el = el('div', 'si-card si-ms');
  private filesBox = el('div', 'si-ms-files');
  private summaryEl = el('p', 'si-ms-summary');
  private notesEl = el('ul', 'si-ms-notes');
  private table = el('table', 'si-ms-table');
  private rows: Finding[] = [];
  private busy = false;
  /** A check asked for while one was running (with its `force`), made when that one ends. */
  private queued: boolean | null = null;
  private names: string[] = [];
  /** Why the last check failed ('' when it didn't), shown in the summary while there is no result. */
  private lastError = '';

  constructor(private host: SiManuscriptHost, private state: ManuscriptState) {
    const h = el('h2', 'si-title', 'Manuscript Check');
    addInfo(h, 'Add the manuscript (PDF, Word, or a Chemweave document) and its ChemDraw files (.cdxml): they are compared with the SI compound by compound: IDs, structures, yields, ee/er, dr, names and the conditions in footnotes. The files stay in the project’s “manuscript” folder and are never printed; nothing is sent anywhere. Double-click a result to open the compound at that field; Dismiss hides one that doesn’t apply (it comes back if the values change).');
    const filesHead = el('h3', 'si-sub', 'Files');
    addInfo(filesHead, 'The ChemDraw files of the schemes give exact structures, labels and values. A .cdx file must first be saved as .cdxml in ChemDraw (File ▸ Save As). Drop files here to add them.');
    const results = el('h3', 'si-sub', 'Results');
    this.table.setAttribute('role', 'grid');
    this.table.setAttribute('aria-label', 'Manuscript check results');
    this.el.append(h, filesHead, this.filesBox, results, this.summaryEl, this.notesEl, this.table);
    // files dropped on the page are added
    this.el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); this.el.classList.add('si-drop'); } });
    this.el.addEventListener('dragleave', () => this.el.classList.remove('si-drop'));
    this.el.addEventListener('drop', (e) => {
      this.el.classList.remove('si-drop');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      // (the window's own drop handler opens files as documents: not for files added here)
      e.preventDefault();
      markFilesTaken(e);
      void Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))).then((got) => this.add(got));
    });
    this.draw();
    void this.start();
  }

  private get p(): SiProject { return this.host.project; }

  private async start(): Promise<void> {
    this.names = await manuscriptFiles(this.p);
    this.drawFiles();
    // Always compare again (reading is cached), so the page stays current after Undo or SI edits.
    await this.check(false);
  }

  /** Read the files (unless nothing changed and not `force`) and compare. */
  async check(force: boolean): Promise<void> {
    // a check is running (a long PDF being read): this one is made right after it, so a file
    // added or a result dismissed meanwhile is not left out
    if (this.busy) { this.queued = this.queued === null ? force : this.queued || force; return; }
    // (busy from the start: a check asked for while the folder is listed is queued, not run beside this one)
    this.busy = true;
    this.el.classList.add('si-busy');
    this.lastError = '';
    try {
      this.names = await manuscriptFiles(this.p);
      if (!this.names.length) {
        forget(this.p);
        this.state.sources = [];
        this.state.result = await checkManuscript(this.p, [], { files: 0 });
        this.state.checked = true;
      } else {
        // (files that haven't changed since they were read are not read again, unless `force`)
        const sources = await readAll(this.p, {
          force,
          smiles: (m) => this.host.smiles(m),
          progress: (message) => { this.summaryEl.textContent = message; return this.el.isConnected; },
        });
        this.state.sources = sources;
        this.state.result = await checkManuscript(this.p, sources, { facts: (m) => this.host.facts(m), files: this.names.length });
        this.state.checked = true;
      }
    } catch (e) {
      if (e instanceof Stopped) { this.queued = null; this.summaryEl.textContent = 'The check was stopped. Click Check Again to finish it.'; return; }
      this.lastError = e instanceof Error ? e.message : String(e);
      this.host.flash(`The manuscript could not be checked: ${this.lastError}`, 8000);
    } finally {
      this.busy = false;
      this.el.classList.remove('si-busy');
    }
    const again = this.queued;
    this.queued = null;
    if (again !== null && this.el.isConnected) { await this.check(again); return; }
    if (!this.el.isConnected && !this.state.result) return;
    this.draw();
    this.host.resultChanged();
  }

  // ---------------------------------------------------------------- commands (the ribbon)

  async command(cmd: string, value = ''): Promise<void> {
    const ro = this.p.readOnly;
    if (['ms-add', 'ms-add-doc', 'ms-remove', 'ms-dismiss', 'ms-restore'].includes(cmd) && ro) { this.host.flash('This SI project is open read-only.'); return; }
    if (cmd === 'ms-add') {
      const files = await this.host.pickFiles('The manuscript (PDF or Word) and its ChemDraw files', MS_EXTS);
      await this.add(files);
    } else if (cmd === 'ms-add-doc') {
      const docs = this.host.openDocuments();
      if (!docs.length) { this.host.flash('No document is open. Open the manuscript in Chemweave (or add its .docx file with Add Files).', 6000); return; }
      let pick = docs[0];
      if (docs.length > 1) {
        const got = await ask('Add Open Document', [{ name: 'doc', label: 'Document', value: '0', options: docs.map((d, i) => ({ value: String(i), label: d.name })) }], { ok: 'Add', note: 'It is saved into the manuscript folder as a Word file as it is now; add it again after you change it.' });
        if (!got) return;
        pick = docs[Number(got.doc)] ?? docs[0];
      }
      let bytes: Uint8Array;
      try { bytes = await pick.bytes(); } catch (e) { this.host.flash(`The document could not be saved for the check: ${e instanceof Error ? e.message : String(e)}`, 8000); return; }
      const name = /\.docx$/i.test(pick.name) ? pick.name : `${pick.name.replace(/\.[^.]*$/, '') || 'Manuscript'}.docx`;
      // (the document added before is replaced by it as it is now: the old copy goes to the Trash)
      await this.add([{ name, bytes }], true);
    } else if (cmd === 'ms-remove') {
      const name = this.state.file;
      if (!name || !this.names.includes(name)) { this.host.flash('Select a file in the list first.'); return; }
      await this.host.act(`Remove Manuscript File ${name}`, () => removeManuscriptFile(this.p, name));
      this.host.flash(`Moved ${name} to the Trash (Project ▸ Trash, or Undo, puts it back).`);
      this.state.file = '';
      await this.check(false);
    } else if (cmd === 'ms-check') {
      await this.check(true);
    } else if (cmd === 'ms-open') {
      const f = this.pickedFinding();
      if (f) this.open(f); else this.host.flash('Select a result first.');
    } else if (cmd === 'ms-dismiss') {
      const f = this.pickedFinding();
      if (!f || f.status !== PROBLEM) { this.host.flash('Select a result marked “⚠ Check” first.'); return; }
      const got = await ask('Dismiss Result', [{ name: 'reason', label: 'Why is this OK? (optional, saved with the project)', value: '', placeholder: 'e.g. the yield was rounded in the paper' }], { ok: 'Dismiss', lines: [[f.message, '']] });
      if (!got) return;
      await this.host.act('Dismiss Result', () => dismissFinding(this.p, f, got.reason, this.p.lock?.user ?? ''));
      await this.check(false);
    } else if (cmd === 'ms-restore') {
      const f = this.pickedFinding();
      if (!f || f.status !== DISMISSED) { this.host.flash('Select a dismissed result first (Show Dismissed lists them).'); return; }
      await this.host.act('Restore Result', () => restoreFinding(this.p, f.key));
      await this.check(false);
    } else if (cmd === 'ms-filter') {
      this.state.filter = (['problems', 'notes', 'all'].includes(value) ? value : 'problems') as ManuscriptState['filter'];
      this.drawTable();
    } else if (cmd === 'ms-dismissed') {
      this.state.showDismissed = !this.state.showDismissed;
      this.drawTable();
    }
  }

  private async add(files: { name: string; bytes: Uint8Array }[], replace = false): Promise<void> {
    if (!files.length) return;
    if (this.p.readOnly) { this.host.flash('This SI project is open read-only.'); return; }
    const ok = files.filter((f) => MS_EXTS.includes(extOf(f.name).slice(1)));
    const not = files.filter((f) => !ok.includes(f));
    if (not.length) this.host.flash(`${not.map((f) => `“${f.name}”`).join(', ')} ${not.length === 1 ? 'is' : 'are'} not a PDF, Word or ChemDraw file.`, 6000);
    if (!ok.length) return;
    const added: string[] = [];
    await this.host.act(ok.length === 1 ? `Add Manuscript File ${ok[0].name}` : `Add ${ok.length} Manuscript Files`, async () => {
      for (const f of ok) added.push(await addManuscriptFile(this.p, f.name, f.bytes, replace));
    });
    if (added.some((a) => extOf(a) === '.cdx')) this.host.flash('ChemDraw files are read as .cdxml, not .cdx: open the file in ChemDraw, use File ▸ Save As…, choose “CDXML” and add that file.', 9000);
    else if (added.length) this.host.flash(`Added ${added.join(', ')}.`);
    if (added.length) { this.state.file = added[added.length - 1]; await this.check(false); }
  }

  private pickedFinding(): Finding | null {
    return this.state.result?.findings.find((f) => f.key === this.state.picked && this.rows.includes(f)) ?? null;
  }

  private open(f: Finding): void {
    const c = this.p.compounds.find((x) => x.id === f.compound_id);
    if (!c) { this.host.flash('This result is not about an SI compound.'); return; }
    this.host.openAt(c, FIELD_OF[f.kind] ?? '');
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    this.drawFiles();
    const r = this.state.result;
    this.summaryEl.textContent = r ? summary(r)
      : !this.names.length ? 'No manuscript added yet.'
      : this.lastError && !this.busy ? `The manuscript could not be checked: ${this.lastError.replace(/[.\s]+$/, '')}. Click Check Again.`
      : this.busy ? 'Reading the manuscript…' : 'The manuscript has not been checked yet. Click Check Again.';
    const notes = r ? [...new Set(r.notes)] : [];
    this.notesEl.replaceChildren(...notes.map((n) => el('li', '', n)));
    this.notesEl.hidden = !notes.length;
    this.drawTable();
  }

  private drawFiles(): void {
    const sources = this.state.sources ?? [];
    const rows: HTMLElement[] = [];
    for (const name of this.names) {
      const ext = extOf(name);
      const src = sources.find((s) => s.file === name);
      const bad = ext === '.cdx' || ext === '.doc' || !!src?.error;
      const row = el('div', `si-ms-file${bad ? ' si-bad' : ''}`);
      row.setAttribute('role', 'option');
      row.tabIndex = 0;
      row.setAttribute('aria-selected', String(name === this.state.file));
      row.append(el('span', 'si-ms-fname', `${bad ? '⚠ ' : ''}${name}`), el('span', 'si-ms-kind muted', KIND_OF[ext] ?? ext.slice(1)));
      const note = src ? [src.error, ...src.notes].filter(Boolean).join('\n') : '';
      row.title = note || name;
      const pick = (): void => { this.state.file = name; for (const x of rows) x.setAttribute('aria-selected', String(x === row)); };
      row.addEventListener('mousedown', pick);
      row.addEventListener('focus', pick);
      rows.push(row);
    }
    if (!rows.length) rows.push(el('p', 'muted si-note', 'No files yet: add the manuscript (PDF, Word or an open document) and, best, its ChemDraw files (.cdxml) with Add Files, or drop them here.'));
    this.filesBox.setAttribute('role', 'listbox');
    this.filesBox.setAttribute('aria-label', 'Manuscript files');
    this.filesBox.replaceChildren(...rows);
  }

  private drawTable(): void {
    const keep = new Set<string>({ problems: [PROBLEM], notes: [PROBLEM, NOTE], all: [PROBLEM, NOTE, OK] }[this.state.filter]);
    if (this.state.showDismissed) keep.add(DISMISSED);
    this.rows = (this.state.result?.findings ?? []).filter((f) => keep.has(f.status));
    const head = el('tr');
    for (const t of ['Compound', 'What', 'Manuscript', 'SI', 'Where', 'Status']) head.append(el('th', '', t));
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (const f of this.rows) {
      const tr = el('tr', `si-ms-${f.status}`);
      tr.tabIndex = 0;
      tr.setAttribute('aria-selected', String(f.key === this.state.picked));
      tr.title = f.message + (f.where ? `\n\nWhere: ${f.where}` : '') + (f.reason ? `\n\nDismissed: “${f.reason}”` : '');
      for (const t of [f.label, findingWhat(f), f.ms_value, f.si_value, f.where]) tr.append(el('td', '', t));
      tr.append(el('td', 'si-ms-status', STATUS_TEXT[f.status] ?? f.status));
      const pick = (): void => { this.state.picked = f.key; for (const x of body.children) x.setAttribute('aria-selected', String(x === tr)); };
      tr.addEventListener('mousedown', pick);
      tr.addEventListener('focus', pick);
      tr.addEventListener('dblclick', () => this.open(f));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.open(f); });
      body.append(tr);
    }
    this.table.replaceChildren(thead, body);
    this.table.hidden = !this.rows.length;
    if (!this.rows.length && this.state.result?.findings.length) {
      const hidden = this.state.result.findings.length;
      this.table.hidden = false;
      const tr = el('tr');
      const td = el('td', 'muted', `Nothing to show with this filter (${hidden} result${hidden === 1 ? '' : 's'} in all): choose “All Results” under Show.`);
      td.colSpan = 6;
      tr.append(td);
      body.append(tr);
    }
  }
}
