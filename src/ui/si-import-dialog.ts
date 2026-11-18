// SI Project ▸ Import SI…: the review window (SI Assistant SPEC §13u), showing everything read
// from a Word or PDF SI (si/si-import*.ts) before anything is written (si/si-import-apply.ts).
// Every value can be changed and every item left out; a compound's text that was not recognized
// is shown and goes to its private Notes. On the left the list (general procedures, compounds,
// sections, cover page, references), on the right the page of the item picked, below how the
// compounds print and where they go.

import { ALL_FIELDS, SPECTRUM_TYPES, nucleusLabel, type FieldDef } from '../si/fields';
import { parseMarkup } from '../si/markup';
import { fetchDoi } from '../document/references';
import type { ImportedCompound, ImportedGP, ImportPlan } from '../si/si-import';
import type { ReadResult, Para } from '../si/si-import-read';
import { outline, type ImportedCover, type ImportedFigure, type ImportedSection } from '../si/si-import-text';
import type { ImportedReference } from '../si/si-import-refs';
import { PRINT_AS_IMPORTED, PRINT_FROM_FIELDS, type ApplyResult, type ImportedSpectrum, type PrintMode } from '../si/si-import-apply';
import { addInfo } from './info-tip';
import { askChoice } from './ask';

export interface SiImportDialogHost {
  /** A structure's picture (SVG markup), drawn in the house style. */
  pictureOf(molfile: string): string | null;
  /** Its formula. */
  analyze(molfile: string): Promise<{ formula: string } | null>;
  /** The open project's Data sections (null: no project open that can be changed). */
  dataSections: { id: string; name: string }[] | null;
  /** A new project can be made to import into (the desktop app). */
  canMakeProject: boolean;
  /** After a heading's level changes and the sections are worked out again (a PDF's figures are cut out again). */
  afterOutline?: (plan: ImportPlan) => Promise<void>;
}

export interface SiImportChoice {
  mode: PrintMode;
  /** Into a new project (made after the window closes). */
  newProject: boolean;
  /** The existing Data section chosen (null: new Data sections). */
  sectionId: string | null;
}

const WARN = '⚠ ';
const NEW_SECTION = '__new__';
const KIND_NOTES: Record<string, string> = {
  general: 'Goes to the front matter’s General Information page',
  text: 'A section', data: 'A section of compounds',
  references: 'The reference list (see “References”)',
  spectra: 'Spectra: not imported (Chemweave prints its own Spectra section)',
  toc: 'Table of contents: not imported (Chemweave makes its own)',
};
const LEVELS: [number, string][] = [[1, 'Section'], [2, 'Sub-section'], [3, 'Heading in the text'], [0, 'Not a heading']];
const REF_COLUMNS: [string, string][] = [['number', 'No.'], ['authors', 'Authors'], ['title', 'Title'], ['journal', 'Journal'], ['year', 'Year'], ['volume', 'Volume'], ['pages', 'Pages'], ['doi', 'DOI']];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Stored text without its formatting marks. */
const plainMarkup = (text: string): string => parseMarkup(text || '').map((p) => p.runs.map((r) => r.text).join('')).join('\n');

/** A text box about as tall as its text (2 to `max` lines). */
function textBox(value: string, onInput: ((v: string) => void) | null, max = 8, label = ''): HTMLTextAreaElement {
  const t = el('textarea', 'si-imp-text');
  t.value = value;
  t.rows = Math.min(max, Math.max(2, (value || '').split('\n').reduce((n, l) => n + 1 + Math.floor(l.length / 110), 0)));
  if (label) t.setAttribute('aria-label', label);
  if (onInput) t.addEventListener('input', () => onInput(t.value)); else t.readOnly = true;
  return t;
}

function lineBox(value: string, onInput: (v: string) => void, label: string, placeholder = ''): HTMLInputElement {
  const i = el('input');
  i.type = 'text';
  i.value = value;
  i.placeholder = placeholder;
  i.setAttribute('aria-label', label);
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

/** A row of a page: its name, then what it shows. */
function row(form: HTMLElement, name: string, ...content: (Node | string)[]): HTMLElement {
  const r = el('div', 'si-imp-row');
  r.append(el('span', 'si-imp-name', name), ...content);
  form.append(r);
  return r;
}

/** A picture with what goes with it beside it (a row of the form). */
function pair(pic: HTMLElement, side: HTMLElement): HTMLElement {
  const p = el('div', 'si-imp-pair');
  p.append(pic, side);
  return p;
}

function check(label: string, on: boolean, changed: (on: boolean) => void): HTMLLabelElement {
  const l = el('label', 'si-imp-check');
  const b = el('input');
  b.type = 'checkbox';
  b.checked = on;
  b.addEventListener('change', () => changed(b.checked));
  l.append(b, ' ', label);
  return l;
}

/** A picture (PNG, JPEG, EMF or PDF bytes) drawn into `box` (the first time it is shown). */
async function drawPicture(box: HTMLElement, data: Uint8Array, ext: string): Promise<void> {
  try {
    let src = '';
    if (ext === '.pdf') src = (await import('../render/pdf-page').then((m) => m.pdfFirstPage(data)))?.src ?? '';
    else if (ext === '.emf') {
      const svg = (await import('../render/emf-read')).emfToSvg(data);
      if (svg) src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.svg);
    } else if (ext !== '.wmf') src = URL.createObjectURL(new Blob([data.slice()], { type: ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg' }));
    if (!src) { box.textContent = '(no preview here)'; return; }
    const img = el('img');
    img.alt = '';
    img.src = src;
    box.replaceChildren(img);
  } catch {
    box.textContent = '(no preview here)';
  }
}

/** Ask what to import, showing everything read; null when cancelled. The plan is changed as the person changes it. */
export function askImport(plan: ImportPlan, read: ReadResult, host: SiImportDialogHost): Promise<SiImportChoice | null> {
  return new Promise((resolve) => {
    const d = el('dialog', 'ask si-import');
    d.setAttribute('aria-label', `Import SI: ${read.file_name}`);
    const form = el('form');
    form.method = 'dialog';
    const nC = plan.compounds.length, nG = plan.gps.length;
    const h = el('h2', '', `Import SI: ${read.file_name}`);
    addInfo(h, 'Check what was read, change anything read wrongly, and untick what you don’t want, then import. Nothing is written until you click Import, and the import is one step of Edit ▸ Undo.');
    const intro = el('p', 'si-imp-intro', `Found ${nC} compound${nC === 1 ? '' : 's'} and ${nG} general procedure${nG === 1 ? '' : 's'}.`);
    const notes = [...read.notes, ...plan.warnings];
    const other = (plan.sections as ImportedSection[]).filter((s) => s.kind !== 'data' && s.kind !== 'references');
    if (plan.spectra.length) {
      const matched = plan.spectra.filter((s) => s.cid).length;
      notes.push(`${plan.spectra.length} spectra found, ${matched} matched to their compound (shown on its page)${matched < plan.spectra.length ? `; ${plan.spectra.length - matched} not matched.` : '.'}`);
    }
    if (other.length || plan.references.length || plan.cover) {
      const bits = [...(other.length ? [`${other.length} other section(s)`] : []), ...(plan.references.length ? [`${plan.references.length} reference(s)`] : []), ...(plan.cover ? ['the cover page'] : [])];
      intro.textContent += ` Also: ${bits.join(', ')}.`;
    }
    const noteList = el('ul', 'si-imp-notes');
    for (const n of notes) noteList.append(el('li', '', plan.warnings.includes(n) ? WARN + n : n));

    // ---- the list and the pages
    const tree = el('div', 'si-imp-tree');
    tree.setAttribute('role', 'tree');
    tree.setAttribute('aria-label', 'What was found');
    const pane = el('div', 'si-imp-page');
    pane.append(el('p', 'muted', 'Pick a general procedure, a compound or a section to see what was read.'));
    const pages = new Map<HTMLElement, () => HTMLElement>();
    const built = new Map<HTMLElement, HTMLElement>();
    let current: HTMLElement | null = null;
    const show = (item: HTMLElement): void => {
      current?.classList.remove('on');
      current = item;
      item.classList.add('on');
      let page = built.get(item);
      if (!page) { page = pages.get(item)!(); built.set(item, page); }
      pane.replaceChildren(page);
      pane.scrollTop = 0;
    };
    const group = (title: string, page?: () => HTMLElement): { head: HTMLElement; list: HTMLElement } => {
      const head = el('div', 'si-imp-item si-imp-head');
      const name = el('button', 'si-imp-label', title);
      name.type = 'button';
      head.append(name);
      if (page) { pages.set(head, page); name.addEventListener('click', () => show(head)); } else name.disabled = true;
      const list = el('div', 'si-imp-group');
      list.setAttribute('role', 'group');
      tree.append(head, list);
      return { head, list };
    };
    const item = (list: HTMLElement, title: string, obj: { keep: boolean }, page: () => HTMLElement, tip = '', ticked?: () => void): { item: HTMLElement; label: HTMLButtonElement; box: HTMLInputElement } => {
      const it = el('div', 'si-imp-item');
      it.setAttribute('role', 'treeitem');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = obj.keep;
      box.setAttribute('aria-label', `Import ${title}`);
      box.addEventListener('change', () => { obj.keep = box.checked; ticked?.(); });
      const label = el('button', 'si-imp-label', title);
      label.type = 'button';
      if (tip) label.title = tip;
      label.addEventListener('click', () => show(it));
      it.append(box, label);
      pages.set(it, page);
      list.append(it);
      return { item: it, label, box };
    };

    const gpNames = new Map(plan.gps.map((g) => [g.key, g.name]));
    let first: HTMLElement | null = null;
    if (plan.gps.length) {
      const { list } = group('General procedures');
      for (const g of plan.gps) {
        const users = plan.compounds.filter((c) => c.gp_key === g.key).map((c) => c.cid);
        const { item: it, label } = item(list, `${g.name}${g.title ? `: ${g.title}` : ''}`, g, () => gpPage(g, users, (t) => { label.textContent = t; }));
        first ??= it;
      }
    }
    const compoundItems = new Set<HTMLElement>();
    if (plan.compounds.length) {
      const { list } = group('Compounds');
      for (const c of plan.compounds) {
        const flag = c.warnings.length || c.unrecognised.length ? WARN : '';
        const tip = [...c.warnings, ...(c.unrecognised.length ? ['Some of its text was not recognized (see “Not recognized”).'] : [])].join('\n');
        const { item: it, label } = item(list, `${flag}${c.cid}  ${c.name}`.trimEnd(), c, () => compoundPage(c, gpNames.get(c.gp_key) ?? '', (t) => { label.textContent = `${flag}${t}`; }), tip);
        first ??= it;
        compoundItems.add(it);
      }
    }
    // the other text: sections, cover page, references
    let sectionsList: HTMLElement | null = null;
    let sectionsHead: HTMLElement | null = null;
    const sectionItems = new Map<string, { label: HTMLButtonElement; box: HTMLInputElement; item: HTMLElement }>();
    const refreshSectionsPage = (): void => { if (sectionsHead && built.has(sectionsHead)) { const page = sectionsPage(); built.set(sectionsHead, page); if (current === sectionsHead) pane.replaceChildren(page); } };
    const sectionChanged = (s: ImportedSection, fromOwnPage: boolean): void => {
      const got = sectionItems.get(s.key);
      if (got) { got.label.textContent = s.name || '(no name)'; got.box.checked = s.keep; }
      if (fromOwnPage) refreshSectionsPage();
      destinationChanged();
    };
    const fillSections = (): void => {
      if (!sectionsList) return;
      for (const [, v] of sectionItems) { pages.delete(v.item); built.delete(v.item); }
      sectionItems.clear();
      if (current && !current.isConnected) current = null;
      sectionsList.replaceChildren();
      for (const s of plan.sections as ImportedSection[]) {
        if (s.kind === 'data' || s.kind === 'references') continue;
        const got = item(sectionsList, s.name || '(no name)', s, () => sectionPage(s), '', () => refreshSectionsPage());
        sectionItems.set(s.key, got);
      }
    };
    if (plan.sections.length) {
      const g = group('Sections', () => sectionsPage());
      sectionsHead = g.head;
      sectionsList = g.list;
      fillSections();
    }
    if (plan.cover) {
      const list = el('div', 'si-imp-group si-imp-top');
      tree.append(list);
      item(list, 'Cover page', plan.cover, () => coverPage(plan.cover as ImportedCover));
    }
    if (plan.references.length) group(`References (${plan.references.length})`, () => referencesPage(plan.references as ImportedReference[]));
    // spectra no compound was found for (each can be given one)
    const unmatchedCount = (): number => plan.spectra.filter((x) => !x.cid).length;
    const unmatched = unmatchedCount() ? group(`Spectra not matched (${unmatchedCount()})`, () => unmatchedPage()) : null;
    /** A spectrum given another compound: the pages showing spectra are made again when next shown. */
    const spectraMoved = (): void => {
      for (const it of [...built.keys()]) if (it !== current && (compoundItems.has(it) || it === unmatched?.head)) built.delete(it);
      if (unmatched) unmatched.head.querySelector('.si-imp-label')!.textContent = `Spectra not matched (${unmatchedCount()})`;
    };

    function spectrumRow(f: HTMLElement, s: ImportedSpectrum): void {
      const pic = el('div', 'si-imp-thumb', '…');
      void drawPicture(pic, s.data, s.kind === 'emf' ? '.emf' : s.ext || '.pdf');
      const side = el('span', 'si-imp-side');
      const which = el('select');
      which.setAttribute('aria-label', 'Compound');
      which.append(new Option('(not matched)', ''), ...plan.compounds.map((c) => new Option(`${c.cid}  ${c.name}`.trimEnd(), c.cid)));
      which.value = s.cid;
      which.addEventListener('change', () => { s.cid = which.value; s.how = 'chosen by you'; spectraMoved(); });
      const kind = el('select');
      kind.setAttribute('aria-label', 'Type');
      const types = [...new Set([...SPECTRUM_TYPES, s.type])];
      kind.append(...types.map((t) => new Option(t, t)));
      kind.value = s.type;
      kind.addEventListener('change', () => { s.type = kind.value; });
      const pickers = el('span', 'si-imp-parts');
      pickers.append(which, kind);
      const where = s.where ? `${s.where.startsWith('page') ? 'On' : 'In'} ${s.where}` : '';
      const says = [s.how ? `Matched ${s.how}.` : '', where ? `${where}.` : ''].filter(Boolean).join(' ');
      side.append(check('Import this spectrum', s.keep, (on) => { s.keep = on; }), pickers);
      if (s.title) side.append(el('span', '', s.title));
      if (says) side.append(el('span', 'muted', says));
      row(f, 'Spectrum', pair(pic, side));
    }

    function unmatchedPage(): HTMLElement {
      const f = el('div', 'si-imp-form');
      const left = plan.spectra.filter((x) => !x.cid);
      f.append(el('p', 'muted', left.length ? 'No compound could be told for these spectra. Pick each one’s compound to import it; one left “not matched” is not imported.' : 'Every spectrum has its compound (shown on the compound’s page).'));
      for (const s of left) spectrumRow(f, s);
      return f;
    }

    // ---- the pages
    function gpPage(g: ImportedGP, users: string[], retitle: (t: string) => void): HTMLElement {
      const f = el('div', 'si-imp-form');
      const name = (): void => retitle(`${g.name}${g.title ? `: ${g.title}` : ''}`);
      row(f, 'Name', lineBox(g.name, (v) => { g.name = v.trim(); name(); }, 'Name'));
      row(f, 'Title', lineBox(g.title, (v) => { g.title = v.trim(); name(); }, 'Title'));
      const s = row(f, 'Compound sentence', lineBox(g.sentence, (v) => { g.sentence = v; }, 'Compound sentence'));
      addInfo(s.firstElementChild, 'The sentence printed in each compound made by this procedure. Words in {braces} are filled in for each compound; {GP}, {product}, {scale} and {yield} are filled in by Chemweave.');
      row(f, 'Text', textBox(g.text, (v) => { g.text = v; }, 12, 'Text'));
      row(f, '', el('span', 'muted', users.length ? `Used by: ${users.join(', ')}` : 'No compound was found citing this procedure.'));
      row(f, 'As printed', textBox(g.original, null, 8, 'As printed'));
      return f;
    }

    function partsRow(def: FieldDef, value: Record<string, unknown>): HTMLElement {
      const r = el('span', 'si-imp-parts');
      for (const part of def.parts ?? []) {
        const box = lineBox(String(value[part.key] ?? ''), (v) => { value[part.key] = v; }, `${def.label}: ${part.label || part.key}`, part.label || part.key);
        box.title = part.label || part.key;
        if (part.label) r.append(el('span', 'si-imp-part-name', part.label));
        r.append(box);
        if (part.suffix) r.append(el('span', 'muted', part.suffix));
      }
      return r;
    }

    function compoundPage(c: ImportedCompound, gpName: string, retitle: (t: string) => void): HTMLElement {
      const f = el('div', 'si-imp-form');
      const title = (): void => retitle(`${c.cid}  ${c.name}`.trimEnd());
      const idBox = lineBox(c.cid, (v) => {
        const old = c.cid;
        c.cid = v.trim();
        for (const s of plan.spectra) if (s.cid === old) s.cid = c.cid;   // (its spectra follow)
        title();
      }, 'ID');
      idBox.classList.add('si-imp-id');
      row(f, 'ID', idBox);
      row(f, 'Name', lineBox(c.name, (v) => { c.name = v.trim(); title(); }, 'Name'));
      if (c.structure || c.picture_pdf) {
        const pic = el('div', 'si-imp-thumb', '…');
        const note = el('span', 'muted', c.structure_note || 'found');
        if (c.structure) {
          const svg = host.pictureOf(c.structure);
          if (svg) pic.innerHTML = svg; else pic.textContent = '(can’t be drawn)';
          void host.analyze(c.structure).then((a) => { if (a?.formula) note.textContent = `${a.formula}, ${note.textContent}`; });
        } else void drawPicture(pic, c.picture_pdf!, c.picture_ext || '.pdf');
        if (c.structure_picture) note.textContent += ' (with ChemDraw’s picture)';
        const side = el('span', 'si-imp-side');
        side.append(note, check('Import this structure', c.use_structure, (on) => { c.use_structure = on; }));
        row(f, 'Structure', pair(pic, side));
      }
      if (c.warnings.length) row(f, '', el('span', 'si-imp-warn', c.warnings.map((w) => WARN + w).join('\n')));
      if (gpName) {
        const vals = Object.entries(c.gp_values).map(([k, v]) => `${k} = ${v}`).join('; ');
        row(f, 'General procedure', el('span', '', `Made by ${gpName}; its sentence: ${plainMarkup(c.gp_sentence)}${vals ? `\nIts values: ${vals}` : ''}`));
      }
      row(f, 'Procedure', textBox(c.procedure, (v) => { c.procedure = v; }, 8, 'Procedure'));
      for (const key of Object.keys(c.values)) {
        const def = ALL_FIELDS.get(key);
        if (!def) continue;
        const value = c.values[key];
        if (key === 'nmr' && Array.isArray(value)) {
          for (const report of value as Record<string, string>[]) {
            const head = el('span', 'si-imp-parts');
            head.append(lineBox(report.label ?? '', (v) => { report.label = v; }, 'NMR label', 'label, e.g. major rotamer'));
            const box = el('span', 'si-imp-stack');
            box.append(head, textBox(report.text ?? '', (v) => { report.text = v; }, 6, `${nucleusLabel(report.nucleus ?? '')} NMR`));
            row(f, `${nucleusLabel(report.nucleus ?? '')} NMR`, box);
          }
        } else if (key === 'references' && value && typeof value === 'object') {
          const ref = value as Record<string, unknown>;
          const r = row(f, def.label, lineBox(String(ref.text ?? ''), (v) => { ref.text = v; }, def.label));
          if (c.cites.length) r.append(el('span', 'muted', `cites ${c.cites.join(', ')}`));
        } else if (def.kind === 'parts' && value && typeof value === 'object') {
          row(f, def.label, partsRow(def, value as Record<string, unknown>));
        }
      }
      const un = row(f, 'Not recognized', textBox(c.unrecognised.join('\n'), (v) => { c.unrecognised = v.split('\n').filter((t) => t.trim()); }, 6, 'Not recognized'));
      addInfo(un.firstElementChild, 'Text of this compound that is neither its procedure nor a recognized value. It goes to the compound’s private Notes (never printed); delete what you don’t need.');
      for (const s of plan.spectra.filter((x) => x.cid === c.cid)) spectrumRow(f, s);
      row(f, 'As printed', textBox(c.original, null, 10, 'As printed'));
      return f;
    }

    function lineForReview(line: string, figures: Map<string, ImportedFigure>): string {
      const m = /^!(figure|table)\{(\w+)\}\s*(.*)$/.exec(line);
      if (m && figures.has(m[2])) {
        const fig = figures.get(m[2])!;
        return `[${fig.label || m[1]}: ${plainMarkup(m[3])}]`;
      }
      return plainMarkup(line);
    }

    function sectionPage(s: ImportedSection): HTMLElement {
      const f = el('div', 'si-imp-form');
      const name = lineBox(s.name, (v) => { s.name = v.trim(); sectionChanged(s, false); }, 'Name');
      name.addEventListener('change', () => sectionChanged(s, true));
      row(f, 'Name', name);
      const kind = KIND_NOTES[s.kind] ?? '';
      row(f, '', el('span', 'muted', kind + (s.note && !kind.includes(s.note) ? `. ${s.note}` : '')));
      if (s.heading) row(f, 'Heading as printed', el('span', '', s.heading));
      row(f, 'Text', textBox(s.text.split('\n').map((l) => lineForReview(l, s.figures)).join('\n'), null, 16, 'Text'));
      for (const fig of s.figures.values()) {
        const pic = el('div', 'si-imp-thumb', '…');
        if (fig.kind === 'table') pic.textContent = fig.table?.rows ? `Table: ${fig.table.rows.length} rows` : 'Table';
        else if (!fig.data) pic.textContent = '(not cut out: its caption is imported as text)';
        else void drawPicture(pic, fig.data, fig.ext);
        const side = el('span', 'si-imp-side');
        const label = lineBox(fig.label, (v) => { fig.label = v.trim(); }, 'Label', 'automatic (Figure S1…)');
        label.title = 'The label as printed; empty: numbered by Chemweave';
        side.append(label, el('span', '', plainMarkup(fig.caption) || '(no caption)'), check(fig.kind === 'table' ? 'Import this table' : 'Import this figure', fig.keep, (on) => { fig.keep = on; }));
        row(f, fig.kind === 'table' ? 'Table' : 'Figure', pair(pic, side));
      }
      return f;
    }

    function coverPage(cover: ImportedCover): HTMLElement {
      const f = el('div', 'si-imp-form');
      row(f, '', el('span', 'muted', 'For the project’s own cover page, where it has no title, authors or affiliations yet.'));
      row(f, 'Title', lineBox(cover.title, (v) => { cover.title = v.trim(); }, 'Title'));
      const authors = el('table', 'si-imp-table');
      const drawAuthors = (): void => {
        authors.replaceChildren();
        const hr = el('tr');
        for (const t of ['Name', 'Affiliations (marks)', 'Corresponding', 'Email', '']) hr.append(el('th', '', t));
        authors.append(hr);
        cover.authors.forEach((a, i) => {
          const tr = el('tr');
          const td = (n: Node): void => { const c = el('td'); c.append(n); tr.append(c); };
          td(lineBox(a.name, (v) => { a.name = v.trim(); }, 'Name'));
          td(lineBox(a.affiliations.join(', '), (v) => { a.affiliations = v.split(',').map((m) => m.trim()).filter(Boolean); }, 'Affiliation marks'));
          const star = el('input');
          star.type = 'checkbox';
          star.checked = a.corresponding;
          star.setAttribute('aria-label', 'Corresponding author');
          star.addEventListener('change', () => { a.corresponding = star.checked; });
          td(star);
          td(lineBox(a.email, (v) => { a.email = v.trim(); }, 'Email'));
          const rm = el('button', 'link', 'Remove');
          rm.type = 'button';
          rm.addEventListener('click', () => { cover.authors.splice(i, 1); drawAuthors(); });
          td(rm);
          authors.append(tr);
        });
      };
      drawAuthors();
      const add = el('button', '', 'Add Author');
      add.type = 'button';
      add.addEventListener('click', () => { cover.authors.push({ name: '', affiliations: [], corresponding: false, email: '' }); drawAuthors(); });
      const box = el('span', 'si-imp-stack');
      box.append(authors, add);
      row(f, 'Authors', box);
      const affs = el('table', 'si-imp-table');
      const hr = el('tr');
      for (const t of ['Mark', 'Affiliation']) hr.append(el('th', '', t));
      affs.append(hr);
      for (const a of cover.affiliations) {
        const tr = el('tr');
        const m = el('td'), t = el('td');
        m.append(lineBox(a.marker, (v) => { a.marker = v.trim(); }, 'Mark'));
        t.append(lineBox(a.text, (v) => { a.text = v.trim(); }, 'Affiliation'));
        tr.append(m, t);
        affs.append(tr);
      }
      row(f, 'Affiliations', affs);
      row(f, 'As printed', textBox(cover.lines.join('\n'), null, 8, 'As printed'));
      return f;
    }

    function referencesPage(refs: ImportedReference[]): HTMLElement {
      const f = el('div', 'si-imp-form');
      const h3 = el('p', 'muted', 'Each reference as read (hover over a row for the entry as printed). Numbered citations in the imported text are linked to them; one the project has already (same DOI) is not added again.');
      const table = el('table', 'si-imp-table si-imp-refs');
      const draw = (): void => {
        table.replaceChildren();
        const hr = el('tr');
        for (const t of ['Import', ...REF_COLUMNS.map(([, n]) => n)]) hr.append(el('th', '', t));
        table.append(hr);
        for (const r of refs) {
          const tr = el('tr');
          tr.title = r.text + (r.looked_up && r.looked_up !== 'done' ? `\n\nCrossref: ${r.looked_up}` : '');
          const keep = el('td');
          keep.append(check('', r.keep, (on) => { r.keep = on; }));
          tr.append(keep);
          const ref = r.ref as unknown as Record<string, unknown>;
          for (const [key, name] of REF_COLUMNS) {
            const td = el('td');
            if (key === 'number') td.textContent = r.number;
            else if (key === 'authors') td.append(lineBox(((ref.authors as string[] | undefined) ?? []).join('; '), (v) => { ref.authors = v.split(';').map((a) => a.trim()).filter(Boolean); }, name));
            else td.append(lineBox(String(ref[key] ?? ''), (v) => { ref[key] = v.trim(); }, name));
            tr.append(td);
          }
          table.append(tr);
        }
      };
      draw();
      const withDoi = refs.filter((r) => (r.ref as unknown as Record<string, unknown>).doi).length;
      const look = el('button', '', `Look Up ${withDoi} DOI${withDoi === 1 ? '' : 's'} on Crossref`);
      look.type = 'button';
      look.disabled = !withDoi;
      look.title = 'Fill each reference that has a DOI from Crossref’s record (needs the internet; only the DOIs are sent)';
      const status = el('span', 'muted');
      look.addEventListener('click', async () => {
        const todo = refs.filter((r) => (r.ref as unknown as Record<string, unknown>).doi && r.looked_up !== 'done');
        let done = 0, failed = 0;
        look.disabled = true;
        for (let k = 0; k < todo.length; k++) {
          const r = todo[k];
          status.textContent = `Looking up ${k + 1} of ${todo.length}…`;
          try {
            const found = await fetchDoi(String((r.ref as unknown as Record<string, unknown>).doi));
            r.ref = { ...found, id: r.ref.id ?? found.id };
            r.looked_up = 'done';
            done++;
          } catch (e) {
            r.looked_up = e instanceof Error ? e.message : String(e);
            failed++;
            if (/connect|network|fetch/i.test(r.looked_up)) break;
          }
        }
        look.disabled = false;
        draw();
        status.textContent = `${done} filled in from Crossref${failed ? `; ${failed} could not be (hover over the row to see why).` : '.'}`;
      });
      const bar = el('div', 'si-imp-bar');
      bar.append(look, status);
      f.append(h3, table, bar);
      return f;
    }

    function sectionsPage(): HTMLElement {
      const f = el('div', 'si-imp-form');
      f.append(el('p', 'muted', 'The SI’s text outside its compounds becomes these sections, in this order. Untick what you don’t want and change names here. If a heading was read at the wrong level (or isn’t a heading), change it below: the sections are worked out again.'));
      const made = el('div', 'si-imp-made');
      const byKey = new Map((plan.sections as ImportedSection[]).map((s) => [s.key, s]));
      const depth = (s: ImportedSection): number => { let n = 0; for (let p = byKey.get(s.parent); p; p = byKey.get(p.parent)) n++; return n; };
      for (const s of plan.sections as ImportedSection[]) {
        const r = el('div', 'si-imp-made-row');
        r.style.paddingLeft = `${depth(s) * 18}px`;
        if (s.kind !== 'data' && s.kind !== 'references') {
          const b = el('input');
          b.type = 'checkbox';
          b.checked = s.keep;
          b.setAttribute('aria-label', `Import ${s.name}`);
          b.addEventListener('change', () => { s.keep = b.checked; sectionChanged(s, false); });
          r.append(b);
        } else r.append(el('span', 'si-imp-nobox'));
        const name = lineBox(s.name, (v) => { s.name = v.trim() || s.name; sectionChanged(s, false); }, 'Section name');
        const what = KIND_NOTES[s.kind] + (s.kind === 'data' ? ` (${s.compounds.filter((c) => c.keep).length} compounds)` : '');
        r.append(name, el('span', 'muted', what));
        made.append(r);
      }
      const heads = el('table', 'si-imp-table si-imp-heads');
      const hr = el('tr');
      hr.append(el('th', '', 'Heading found'), el('th', '', 'Read as'));
      heads.append(hr);
      for (const p of plan.headings.slice(0, 500)) {
        const level = plan.levels.get(p) ?? 0;
        const tr = el('tr');
        const text = p.runs.map((r) => r.text).join('');
        const name = el('td', '', text);
        name.style.paddingLeft = `${4 + Math.max(0, level - 1) * 16}px`;
        const pick = el('select');
        pick.setAttribute('aria-label', `Level of ${text}`);
        for (const [v, t] of LEVELS) pick.append(new Option(t, String(v), false, v === level));
        pick.addEventListener('change', () => void setLevel(p, Number(pick.value)));
        const cell = el('td');
        cell.append(pick);
        tr.append(name, cell);
        heads.append(tr);
      }
      f.append(made, el('h3', 'si-sub', 'Headings'), heads);
      return f;
    }

    /** A heading's level changed: the sections are worked out again (names and ticks changed so far are kept). */
    async function setLevel(p: Para, level: number): Promise<void> {
      plan.level_overrides.set(p, level);
      outline(plan, plan.body_size);
      await host.afterOutline?.(plan);
      fillSections();
      refreshSectionsPage();
      destinationChanged();
    }

    // ---- how the compounds print, and where they go
    const bottom = el('div', 'si-imp-bottom');
    const modeBox = el('fieldset', 'si-imp-choice');
    modeBox.append(el('legend', '', 'How the imported compounds print'));
    const radio = (name: string, value: string, label: string, on: boolean): HTMLInputElement => {
      const l = el('label', 'si-imp-check');
      const r = el('input');
      r.type = 'radio';
      r.name = name;
      r.value = value;
      r.checked = on;
      l.append(r, ' ', label);
      return r;
    };
    const fromFields = radio('mode', PRINT_FROM_FIELDS, 'From the fields, in Chemweave’s format (recommended)', true);
    const asImported = radio('mode', PRINT_AS_IMPORTED, 'Exactly as imported (in each compound’s “SI text” field; the fields are filled too)', false);
    modeBox.append(fromFields.parentElement!, asImported.parentElement!);
    const destBox = el('fieldset', 'si-imp-choice');
    destBox.append(el('legend', '', 'Import into'));
    const usable = !!host.dataSections;
    const toOpen = radio('dest', 'open', 'This project:', usable);
    const toNew = radio('dest', 'new', 'A new project', !usable);
    toOpen.disabled = !usable;
    toNew.disabled = !host.canMakeProject;
    const sectionPick = el('select');
    sectionPick.setAttribute('aria-label', 'Data section');
    sectionPick.append(new Option('new Data sections', NEW_SECTION));
    for (const s of host.dataSections ?? []) sectionPick.append(new Option(`“${s.name}” (compounds with the same ID: only their empty fields are filled)`, s.id));
    const openRow = el('div', 'si-imp-dest');
    openRow.append(toOpen.parentElement!, sectionPick);
    const destNote = el('p', 'muted si-imp-dest-note');
    destBox.append(openRow, toNew.parentElement!, destNote);
    function destinationChanged(): void {
      const newSection = !toOpen.checked || sectionPick.value === NEW_SECTION;
      sectionPick.disabled = !toOpen.checked;
      const nData = (plan.sections as ImportedSection[]).filter((s) => s.kind === 'data').length;
      destNote.textContent = newSection
        ? (nData > 1 ? `The compounds go into ${nData} new Data sections, as in the SI (their names: see “Sections”).` : 'The compounds go into a new Data section (its name: see “Sections”).')
        : 'All the compounds go into this section; the other sections are added as new sections.';
    }
    for (const r of [toOpen, toNew]) r.addEventListener('change', destinationChanged);
    sectionPick.addEventListener('change', destinationChanged);
    destinationChanged();
    bottom.append(modeBox, destBox);

    const buttons = el('p', 'ask-buttons');
    const cancel = el('button', '', 'Cancel');
    cancel.type = 'button';
    const go = el('button', 'primary', 'Import');
    go.type = 'submit';
    go.disabled = !(plan.compounds.length || plan.gps.length || plan.sections.length);
    buttons.append(cancel, go);

    const body = el('div', 'si-imp-body');
    body.append(tree, pane);
    form.append(h, intro);
    if (notes.length) form.append(noteList);
    form.append(body, bottom, buttons);
    d.append(form);

    const finish = (v: SiImportChoice | null): void => { d.remove(); resolve(v); };
    cancel.addEventListener('click', () => { d.close(); finish(null); });
    d.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const kept = plan.compounds.filter((c) => c.keep);
      const ids = kept.map((c) => c.cid);
      const missing = kept.filter((c) => !c.cid).map((c) => c.name || 'a compound');
      const doubled = [...new Set(ids.filter((i, k) => i && ids.indexOf(i) !== k))].sort();
      const problems = [...(missing.length ? [`These compounds have no ID: ${missing.slice(0, 5).join(', ')}.`] : []), ...(doubled.length ? [`These IDs are used by more than one ticked compound: ${doubled.join(', ')}.`] : [])];
      if (problems.length) {
        const sure = await askChoice('Import Anyway?', `${problems.join(' ')} You can correct the IDs afterwards, in the section’s ID table.`, [{ value: 'go', label: 'Import Anyway', primary: true }, { value: 'no', label: 'Go Back' }], 'no');
        if (sure !== 'go') return;
      }
      d.close();
      finish({ mode: asImported.checked ? PRINT_AS_IMPORTED : PRINT_FROM_FIELDS, newProject: toNew.checked, sectionId: toOpen.checked && sectionPick.value !== NEW_SECTION ? sectionPick.value : null });
    });
    document.body.append(d);
    d.showModal();
    if (first) show(first);
  });
}

/** What the import did, a line for each kind of thing. */
export function importSummary(result: ApplyResult, plan: ImportPlan): string[] {
  const lines = [`${result.created.length} compound page(s) made${result.gps.length ? `, ${result.gps.length} general procedure(s)` : ''}.`];
  const merged = Object.entries(result.merged);
  if (merged.length) {
    lines.push(`${merged.length} compound(s) already in the section: only their empty fields were filled.`);
    const kept = merged.filter(([, l]) => l.length).map(([cid, l]) => `${cid}: ${l.join(', ')}`);
    if (kept.length) lines.push(`Kept as they were (already filled): ${kept.slice(0, 8).join('; ')}${kept.length > 8 ? ' …' : ''}`);
  }
  const withNotes = plan.compounds.filter((c) => c.keep && c.unrecognised.length).length;
  if (withNotes) lines.push(`${withNotes} compound(s) have text that was not recognized: it is in their Notes field.`);
  lines.push(...result.notes);
  const kept = plan.compounds.filter((c) => c.keep);
  const withStructure = kept.filter((c) => c.structure && c.use_structure).length;
  const withPicture = kept.filter((c) => c.picture_pdf && !c.structure && c.use_structure).length;
  if (kept.length) {
    const got = withStructure ? `${withStructure} of ${kept.length} compound(s) got their structure from the SI’s ChemDraw drawings` : '';
    const pics = withPicture ? `${withPicture} got a picture of their structure cut out of the PDF (paste the structure itself from ChemDraw for its formula and masses)` : '';
    const missing = kept.length - withStructure - withPicture;
    lines.push([got, pics].filter(Boolean).join('; ') + (missing ? `${got || pics ? '; ' : ''}${missing} have no structure yet: paste them from ChemDraw.` : '.'));
  }
  if (result.spectra) lines.push(`${result.spectra} spectra attached to their compounds.`);
  const other = [...(result.general ? ['the General Information page'] : []), ...(result.sections.length ? [`${result.sections.length} section(s)`] : []), ...(result.figures || result.tables ? [`${result.figures} figure(s) and ${result.tables} table(s)`] : [])];
  if (other.length) lines.push(`Made: ${other.join(', ')}.`);
  if (result.references || result.references_known) lines.push(`${result.references} reference(s) added${result.references_known ? ` (${result.references_known} the project already had)` : ''}; numbered citations in the imported text are linked to them.`);
  if (result.cover.length) lines.push(`Cover page: ${result.cover.join(', ')} filled in.`);
  return lines;
}
