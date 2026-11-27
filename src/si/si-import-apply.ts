// Import SI, writing (SPEC §13u.4, §13u.6, §13u.16): what the review window kept of an
// ImportPlan (si-import.ts) written into the open SI project, as one Undo step (as SI
// Assistant's core/si_import_apply.py writes it, so the project reads the same in either):
//
// * the references (one the project has already, by its DOI, is not added again), so the
//   citations in everything written next can be linked to them;
// * the cover page's title, authors and affiliations (only where the project has none);
// * the SI's sections in reading order (si-import-text.ts): the General Information page,
//   Custom sections with their figures and tables, and a Data section for each part with
//   compounds, holding its general procedures and compounds;
// * or, into an existing Data section: all the compounds there (a compound whose ID is there
//   already is merged: only its empty fields are filled, nothing typed is overwritten), and
//   the other sections as new sections.
//
// New sections go before the Spectra section, so they print before the spectra.

import { ALL_FIELDS, type FieldEntry } from './fields';
import { journalOf } from './journal';
import { clean as cleanLayout } from './spectra';
import { compoundName, compoundsOf, fieldKeys, idTableOf, valuesOf, type Json, type SiCompound, type SiProject, type SiSection } from './project';
import { citationMap, linkCitations, type ImportedReference } from './si-import-refs';
import type { ImportedCompound, ImportedGP, ImportPlan } from './si-import';
import type { ImportedCover, ImportedFigure, ImportedSection } from './si-import-text';
import { hrmsSpecies } from './checks';
import { sameFormula, type MolFacts } from './chem';

export const PRINT_FROM_FIELDS = 'fields';        // the program writes the text from the fields
export const PRINT_AS_IMPORTED = 'as_imported';   // each compound's imported text, in its SI text field
export type PrintMode = typeof PRINT_FROM_FIELDS | typeof PRINT_AS_IMPORTED;

/** The order of the fields on an imported compound's page (= the order they print in). */
export const FIELD_ORDER = ['structure', 'name', 'procedure', 'scale', 'yield', 'physical_state', 'purification', 'rf', 'mp', 'ir', 'rotation', 'ee', 'dr', 'nmr', 'hrms', 'ea', 'xray', 'references', 'spectra', 'si_text'] as const;
const DEFAULT_SECTION_FIELDS = ['structure', 'name', 'procedure', 'yield', 'physical_state', 'nmr', 'hrms', 'spectra'];
const REQUIRED = new Set(['structure', 'procedure', 'yield', 'physical_state', 'nmr', 'hrms', 'spectra']);
export const notesHeading = (file: string): string => `Imported from ${file}, not recognized:`;
const DEFAULT_GENERAL_HEADING = 'General Information';

/** A spectrum found in the SI (si-import-spectra.ts): a Word Mnova picture (EMF), or a part of a PDF page (a picture, `ext`). */
export interface ImportedSpectrum {
  /** The compound it belongs to ('' not matched). */
  cid: string;
  /** The compound itself, once the review window has told (IDs can be empty, doubled or retyped there); it then counts instead of `cid`. null: not matched. */
  owner?: ImportedCompound | null;
  /** "1H", "13C", …, "Other NMR", "2D NMR", "HPLC/SFC", "IR", "Other". */
  type: string;
  kind: 'emf' | 'pdf';
  data: Uint8Array;
  keep: boolean;
  /** Where it was found, its header or title, and how its compound was found (in words). */
  where?: string;
  title?: string;
  how?: string;
  /** (PDF) the page shows the structure already: printed without the program's structure box. */
  shows_structure?: boolean;
  /** (PDF) the picture's type: ".png" (cut out of the page), ".pdf" (default). */
  ext?: string;
}

/** A picture to store: [bytes, ext, vector original or null, its ext]. */
export type Picture = [Uint8Array, string, Uint8Array | null, string];
/** A spectrum to store: [bytes, ext, original or null, its ext]. */
export type SpectrumPicture = [Uint8Array, string, Uint8Array | null, string];

export interface ApplyOptions {
  /** An existing Data section for the compounds (else new Data sections are made). */
  sectionId?: string | null;
  /** The new Data section's name, when there is just one. */
  sectionName?: string;
  mode?: PrintMode;
  /** A ChemDraw picture to store with a structure, from its EMF. */
  pictureFor?: ((emf: Uint8Array) => Promise<Picture | null>) | null;
  /** A figure's picture from an embedded drawing's EMF. */
  figureFor?: ((emf: Uint8Array) => Promise<Picture | null>) | null;
  /** A spectrum from a Word MestReNova picture (EMF). */
  spectrumFor?: ((emf: Uint8Array) => Promise<SpectrumPicture | null>) | null;
  /** The structure's facts (for the HRMS formula the structure now gives). */
  factsOf?: ((molblock: string) => Promise<MolFacts | null>) | null;
  /** How the spectra (the slow part) are going. */
  progress?: ((done: number, total: number, text: string) => void) | null;
}

export interface ApplyResult {
  section_id: string;                 // the (first) Data section
  created: string[];                  // new compounds' internal ids
  merged: Record<string, string[]>;   // ID -> fields kept as they were
  gps: string[];                      // new general procedures' ids
  notes: string[];
  spectra: number;
  sections: string[];                 // new sections' ids (text and data)
  general: boolean;                   // General Information written
  references: number;                 // references added
  references_known: number;           // …already in the project
  figures: number;
  tables: number;
  cover: string[];                    // cover values filled in
}

const newResult = (): ApplyResult => ({ section_id: '', created: [], merged: {}, gps: [], notes: [], spectra: 0, sections: [], general: false, references: 0, references_known: 0, figures: 0, tables: 0, cover: [] });
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

function usedKeys(compounds: ImportedCompound[], mode: PrintMode): string[] {
  const keys = new Set(DEFAULT_SECTION_FIELDS);
  for (const c of compounds) for (const k of Object.keys(c.values)) if (ALL_FIELDS.has(k)) keys.add(k);
  if (mode === PRINT_AS_IMPORTED) keys.add('si_text');
  return FIELD_ORDER.filter((k) => keys.has(k));
}

/** Links numbered citations in imported text to the imported references. */
class Citer {
  constructor(readonly numbers: Map<string, string[]> = new Map()) {}
  cite = (markup: string): string => (this.numbers.size ? linkCitations(markup, this.numbers) : markup);
  ids(cited: string[]): string[] {
    const out: string[] = [];
    for (const n of cited) for (const rid of this.numbers.get(n) ?? []) if (!out.includes(rid)) out.push(rid);
    return out;
  }
}

/**
 * Write what the review window kept of `plan` (see above), as one Undo step "Import SI from
 * <name>". The compounds go into `sectionId` (an existing Data section), or into new Data
 * sections, one for each part of the SI with compounds (named `sectionName` when there is just
 * one and it is given). Without `pictureFor`, structures are stored without their ChemDraw
 * picture; without `figureFor`/`spectrumFor`, such figures and Word spectra are left out.
 */
export async function applyPlan(project: SiProject, plan: ImportPlan, sourceName: string, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const j = journalOf(project.folder);
  const run = (): Promise<ApplyResult> => write(project, plan, sourceName, opts);
  return j ? j.step(`Import SI from ${sourceName}`, run) : run();
}

async function write(project: SiProject, plan: ImportPlan, sourceName: string, opts: ApplyOptions): Promise<ApplyResult> {
  const mode = opts.mode ?? PRINT_FROM_FIELDS;
  const gps = plan.gps.filter((g) => g.keep);
  const compounds = plan.compounds.filter((c) => c.keep);
  const result = newResult();
  const citer = new Citer(await addReferences(project, plan, result));
  await setCover(project, plan, result);
  const dataSections = await writeSections(project, plan, result, opts.figureFor ?? null, citer, !opts.sectionId);
  const gpIds = new Map<string, string>();
  const byCid = new Map<string, SiCompound>();
  const byObj = new Map<ImportedCompound, SiCompound>();
  const fill = (comp: SiCompound, c: ImportedCompound): Promise<void> => fillCompound(project, comp, c, gpIds, mode, sourceName, opts, citer);
  if (opts.sectionId) {
    const section = project.section(opts.sectionId);
    result.section_id = section.id;
    for (const [k, v] of await writeGps(project, section, gps, result, citer)) gpIds.set(k, v);
    const report = project.idReport();
    const existing = new Map<string, SiCompound>();
    for (const comp of compoundsOf(section)) {
      const shown = report.ids.get(comp.id);
      if (shown && !existing.has(shown)) existing.set(shown, comp);
    }
    for (const c of compounds) {
      const target = existing.get(c.cid);
      if (target) {
        result.merged[c.cid] = await mergeCompound(project, target, c, gpIds, mode, sourceName, opts, citer);
        byObj.set(c, target);
        if (!byCid.has(c.cid)) byCid.set(c.cid, target);
      } else {
        await makeRoomForId(project, section, c.cid);
        const comp = await project.addCompound(section.id, undefined, c.name);
        await fill(comp, c);
        result.created.push(comp.id);
        byObj.set(c, comp);
        if (!byCid.has(c.cid)) byCid.set(c.cid, comp);
      }
    }
  } else {
    const placed = new Set<unknown>(dataSections.flatMap(([, imp]) => [...imp.compounds, ...imp.gps]));
    const looseC = compounds.filter((c) => !placed.has(c));
    const looseG = gps.filter((g) => !placed.has(g));
    if (looseC.length || looseG.length || !dataSections.length) {
      // (no outline, or compounds outside it: one Data section, as before)
      const section = await project.addSection('data', opts.sectionName || plan.section_name || 'Synthesis and Characterization', beforeSpectra(project));
      result.sections.push(section.id);
      dataSections.push([section, { compounds: looseC, gps: looseG }]);
    } else if (opts.sectionName && dataSections.length === 1) {
      await project.renameSection(dataSections[0][0].id, opts.sectionName);
    }
    for (const [section, imp] of dataSections) {
      const mine = imp.compounds.filter((c) => c.keep);
      await project.setDefaultFields(section.id, usedKeys(mine, mode).map((k) => ({ key: k, required: REQUIRED.has(k) })));
      await project.setIdTable(section.id, mine.map((c) => c.cid));
      for (const [k, v] of await writeGps(project, section, imp.gps.filter((g) => g.keep), result, citer)) gpIds.set(k, v);
    }
    result.section_id = dataSections.length ? dataSections[0][0].id : '';
    for (const [section, imp] of dataSections) {
      for (const c of imp.compounds) {
        if (!c.keep) continue;
        const comp = await project.addCompound(section.id, undefined, c.name);
        await fill(comp, c);
        result.created.push(comp.id);
        byObj.set(c, comp);
        if (!byCid.has(c.cid)) byCid.set(c.cid, comp);
      }
    }
  }
  result.spectra = await attachSpectra(project, plan, byCid, byObj, opts, result);
  return result;
}

/** The top-level place just before the Spectra section (undefined: at the end). */
function beforeSpectra(project: SiProject): number | undefined {
  const spectra = project.sections.find((s) => s.type === 'spectra');
  if (!spectra || spectra.parentId) return undefined;
  return project.top.indexOf(spectra);
}

// ---------------------------------------------------------------------- references, cover

/** Add the kept references; {number as cited: [reference ids]} for the citations. */
async function addReferences(project: SiProject, plan: ImportPlan, result: ApplyResult): Promise<Map<string, string[]>> {
  const found = (plan.references ?? []) as ImportedReference[];
  const ids = new Map<number, string>();
  for (let k = 0; k < found.length; k++) {
    const r = found[k];
    if (!r.keep) continue;
    const before = project.references.length;
    ids.set(k, await project.addReference(r.ref as unknown as Json));
    if (project.references.length > before) result.references++;
    else result.references_known++;
  }
  return citationMap(found, ids);
}

/** The cover page's title, authors and affiliations, where the project has none (a title still the project's folder name counts as none). */
async function setCover(project: SiProject, plan: ImportPlan, result: ApplyResult): Promise<void> {
  const cover = plan.cover as ImportedCover | null;
  if (!cover || !cover.keep) return;
  const s = project.settings;
  const folderName = project.folder.where.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? '';
  const title = String(s.title ?? '').trim();
  let changed = false;
  if (cover.title && (!title || title === folderName)) { s.title = cover.title; result.cover.push('title'); changed = true; }
  if (cover.authors.length && !(Array.isArray(s.authors) && s.authors.length)) {
    s.authors = cover.authors.map((a) => ({ ...a, affiliations: [...a.affiliations] }));
    result.cover.push('authors');
    changed = true;
  }
  if (cover.affiliations.length && !(Array.isArray(s.affiliations) && s.affiliations.length)) {
    s.affiliations = cover.affiliations.map((a) => ({ ...a }));
    result.cover.push('affiliations');
    changed = true;
  }
  if (changed) await project.saveSettings();
}

/** The printed heading of the General Information page ("" prints none); the default is not stored. */
function storeGeneralHeading(settings: Json, text: string): void {
  text = text.trim();
  const info: Json = isObj(settings.general_information) ? { ...settings.general_information } : {};
  if (text === DEFAULT_GENERAL_HEADING) delete info.heading; else info.heading = text;
  if (Object.keys(info).length) settings.general_information = info; else delete settings.general_information;
}

// ---------------------------------------------------------------------- sections

type Loose = { compounds: ImportedCompound[]; gps: ImportedGP[] };

/** The kept sections, in order; [project Data section, imported section] for the Data sections made (`makeData`). */
async function writeSections(project: SiProject, plan: ImportPlan, result: ApplyResult, figureFor: ApplyOptions['figureFor'], citer: Citer, makeData: boolean): Promise<[SiSection, Loose][]> {
  const made = new Map<string, SiSection>();      // imported key -> project section
  const data: [SiSection, Loose][] = [];
  const sections = (plan.sections ?? []) as ImportedSection[];
  for (const s of sections) {
    if (s.kind === 'references' || s.kind === 'toc' || (s.kind === 'spectra' && !s.keep)) continue;
    if (s.kind === 'data') {
      if (!makeData || (!s.compounds.some((c) => c.keep) && !s.gps.some((g) => g.keep))) continue;
    } else if (!s.keep) continue;
    let parent = made.get(s.parent) ?? null;
    if (s.parent && !parent) parent = nearestMade(sections, s.parent, made);
    if (s.kind === 'general') {
      let text = await resolve(project, 'general', s, result, figureFor, citer);
      const old = await project.readFrontText('general');
      if (old.trim()) text = old.replace(/\n+$/, '') + '\n\n' + text;
      else if (s.name && s.name.trim().toLowerCase() !== 'general information') {
        storeGeneralHeading(project.settings, s.name);
        await project.saveSettings();
      }
      await project.writeFrontText('general', text);
      result.general = true;
      continue;
    }
    const kind = s.kind === 'data' ? 'data' : 'text';
    const name = s.name.trim() || (kind === 'data' ? 'Compounds' : 'Imported text');
    const section = parent ? await project.addSection(kind, name, undefined, parent.id) : await project.addSection(kind, name, beforeSpectra(project));
    made.set(s.key, section);
    result.sections.push(section.id);
    if (kind === 'data') data.push([section, s]);
    else await project.writeSectionText(section, await resolve(project, section, s, result, figureFor, citer));
  }
  return data;
}

/** The nearest section above `key` that was made (its parent was left out). */
function nearestMade(sections: ImportedSection[], key: string, made: Map<string, SiSection>): SiSection | null {
  const byKey = new Map(sections.map((s) => [s.key, s]));
  while (key) {
    const hit = made.get(key);
    if (hit) return hit;
    key = byKey.get(key)?.parent ?? '';
  }
  return null;
}

const PLACEHOLDER = /^(?<prefix>(?:!align\{\w+\}\s*)?)!(?<kind>figure|table)\{(?<key>\w+)\}(?<caption>.*)$/;

/**
 * The section's text with its figures and tables stored (their lines pointing to them) and its
 * citations linked. A figure that can't be stored (left out, or a PDF's picture that could not
 * be cut out) leaves its caption as text.
 */
async function resolve(project: SiProject, owner: SiSection | 'general', s: ImportedSection, result: ApplyResult, figureFor: ApplyOptions['figureFor'], citer: Citer): Promise<string> {
  const cite = citer.cite;
  const out: string[] = [];
  let skip: string[] = [];          // (a PDF figure's labels, under its caption: in its picture)
  for (const line of (s.text || '').split('\n')) {
    if (skip.length && line === skip[0]) { skip.shift(); continue; }
    skip = [];
    const m = PLACEHOLDER.exec(line);
    const g = m?.groups;
    if (!g || !s.figures.has(g.key)) { out.push(cite(line)); continue; }
    const fig = s.figures.get(g.key)!;
    if (fig.cut_below && fig.data) skip = [...fig.below_labels];
    // (the short lines above a PDF caption are the figure's labels only when its picture was cut from above it: otherwise they are text)
    if (fig.kind === 'cut' && !(fig.data && !fig.cut_below)) for (const l of fig.above_labels ?? []) out.push(cite(l));
    const caption = cite(g.caption.trim());
    if (!fig.keep) continue;
    if (fig.kind === 'table' && fig.table && Object.keys(fig.table).length) {
      const t = fig.table as Json;
      const rows = (Array.isArray(t.rows) ? t.rows : []) as (Json | null)[][];
      const table: Json = {
        id: '', label: fig.label, header_rows: t.header_rows ?? 0, columns: t.columns ?? [],
        rows: rows.map((row) => row.map((c) => (c === null ? null : { ...c, text: cite(String(c.text ?? '')) }))),
        footnotes: (Array.isArray(t.footnotes) ? t.footnotes : []).map((n) => cite(String(n))),
      };
      for (const [k, v] of Object.entries(t)) if (!(k in table)) table[k] = v;
      delete table.id;
      const stored = await project.addTextTable(owner, table);
      result.tables++;
      out.push(`${g.prefix}!table{${stored}} ${caption}`.trimEnd());
      continue;
    }
    const picture = await figurePicture(fig, figureFor);
    if (picture) {
      const [bytes, ext, vector, vectorExt] = picture;
      const stored = await project.addTextFigure(owner, bytes, ext, { vector, vectorExt, label: fig.label, width: fig.width_cm });
      result.figures++;
      out.push(`${g.prefix}!figure{${stored}} ${caption}`.trimEnd());
    } else if (fig.label || caption) {
      out.push(fig.label ? `**${fig.label}.** ${caption}`.trim() : caption);
    }
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

/** The picture to store for a figure, or null. */
async function figurePicture(fig: ImportedFigure, figureFor: ApplyOptions['figureFor']): Promise<Picture | null> {
  if (!fig.data) return null;
  if (fig.kind === 'object' || fig.ext === '.emf' || fig.ext === '.wmf') {
    if (!figureFor || fig.ext === '.wmf') return null;
    return figureFor(fig.data);
  }
  return [fig.data, fig.ext || '.png', null, ''];
}

// ---------------------------------------------------------------------- spectra

/**
 * The kept spectra of the plan (SPEC §13u.8), each in its compound's Spectra field: a Word
 * MestReNova picture converted like a pasted Mnova spectrum (its EMF kept beside it); a spectrum
 * cut out of a PDF page as a one-page PDF (printed without the program's structure box: the page
 * shows the structure already). Gives how many.
 */
async function attachSpectra(project: SiProject, plan: ImportPlan, byCid: Map<string, SiCompound>, byObj: Map<ImportedCompound, SiCompound>, opts: ApplyOptions, result: ApplyResult): Promise<number> {
  // (its compound as the review window told it; else by its ID, and a spectrum without one belongs to no compound)
  const compOf = (s: ImportedSpectrum): SiCompound | undefined => (s.owner !== undefined ? (s.owner ? byObj.get(s.owner) : undefined) : s.cid ? byCid.get(s.cid) : undefined);
  const todo = ((plan.spectra ?? []) as ImportedSpectrum[]).filter((s) => s.keep && compOf(s));
  let count = 0, skipped = 0;
  for (let k = 0; k < todo.length; k++) {
    const s = todo[k];
    opts.progress?.(k, todo.length, `Spectrum ${k + 1} of ${todo.length} (${s.cid}, ${s.type})`);
    const comp = compOf(s)!;
    if (!fieldKeys(comp).includes('spectra')) await project.addFields(comp, [{ key: 'spectra' }]);
    const subdir = ALL_FIELDS.get('spectra')?.subdir || 'spectra';
    const item: Json = {};
    if (s.kind === 'emf') {
      const picture = opts.spectrumFor ? await opts.spectrumFor(s.data) : null;
      if (!picture) { skipped++; continue; }
      const [bytes, ext, original, originalExt] = picture;
      const stem = `pasted ${s.type.replace(/\//g, '-')}`;
      const e = ext.replace(/^\./, ''), oe = (originalExt || '.emf').replace(/^\./, '');
      let name = `${stem}.${e}`;
      for (let n = 2; (await project.folder.exists(`${comp.folder}/${subdir}/${name}`)) || (await project.folder.exists(`${comp.folder}/${subdir}/${name.replace(/\.[^.]+$/, `.${oe}`)}`)); n++) name = `${stem} (${n}).${e}`;
      item.file = await project.addAttachment(comp, subdir, name, bytes);
      item.type = s.type;
      item.original = await project.addAttachment(comp, subdir, String(item.file).replace(/\.[^.]+$/, `.${oe}`), original ?? s.data);
    } else {
      item.file = await project.addAttachment(comp, subdir, `${s.cid || 'spectrum'} ${s.type.replace(/\//g, '-')}${s.ext || '.pdf'}`, s.data);
      item.type = s.type;
      if (s.shows_structure) item.layout = cleanLayout({ struct_box: false }, false, true);
    }
    Object.assign(item, { title: item.title ?? '', struct_caption: item.struct_caption ?? '' });
    const values = valuesOf(comp);
    const list = (Array.isArray(values.spectra) ? values.spectra : (values.spectra = [])) as Json[];
    list.push(item);
    await project.saveCompound(comp);
    count++;
  }
  if (skipped) result.notes.push(`${skipped} spectrum picture(s) could not be converted here and were left out.`);
  return count;
}

// ---------------------------------------------------------------------- general procedures, compounds

/** {plan key: GP id}: new general procedures; one whose name the section has already is not made again, and its compounds keep their own sentence (not linked). */
async function writeGps(project: SiProject, section: SiSection, gps: ImportedGP[], result: ApplyResult, citer: Citer): Promise<Map<string, string>> {
  const low = (n: unknown): string => String(n ?? '').trim().toLowerCase();
  const have = new Set(project.generalProcedures(section).map((g) => low(g.name)));
  // (a general procedure's name is its own in the whole project, as a new one's is)
  const elsewhere = new Set(project.dataSections.filter((s) => s !== section).flatMap((s) => project.generalProcedures(s).map((g) => low(g.name))));
  const out = new Map<string, string>();
  // (names given by this import: a second procedure of the same name is told apart from one elsewhere)
  const imported = new Set<string>();
  for (const g of gps) {
    if (have.has(low(g.name))) {
      result.notes.push(`${g.name} is already in this section, so it was not imported again; its compounds keep their own sentence.`);
      continue;
    }
    const gp = await project.addGeneralProcedure(section.id);
    const id = String(gp.id);
    let name = g.name.trim() || String(gp.name);
    if (imported.has(low(name))) {
      result.notes.push(`This import has two general procedures named ${name}, so the second was named ${String(gp.name)}. You can rename it on its page.`);
      name = String(gp.name);
    } else if (elsewhere.has(low(name))) {
      result.notes.push(`The project already has a ${name} in another section, so the imported one was named ${String(gp.name)}. You can rename it on its page.`);
      name = String(gp.name);
    }
    imported.add(low(name));
    await project.updateGeneralProcedure(id, { name, title: g.title, sentence: citer.cite(g.sentence) });
    await project.writeGpText(id, citer.cite(g.text));
    out.set(g.key, id);
    result.gps.push(id);
  }
  return out;
}

/**
 * A compound added at the end of an existing section takes the ID table's row at its position:
 * put the imported ID there (the rows after it, IDs no page has yet, move down one).
 */
async function makeRoomForId(project: SiProject, section: SiSection, cid: string): Promise<void> {
  const table = [...idTableOf(section)];
  const pos = compoundsOf(section).length;
  while (table.length < pos) table.push('');
  if (pos < table.length && table[pos].trim() === cid) return;
  // (a row further down that was waiting for this ID is this one: it moves up, and is not left behind as a second one)
  const waiting = cid ? table.findIndex((t, i) => i > pos && t.trim() === cid) : -1;
  if (waiting >= 0) table.splice(waiting, 1);
  table.splice(pos, 0, cid);
  await project.setIdTable(section.id, table);
}

function procedureText(c: ImportedCompound, linked: boolean): string {
  if (linked || !c.gp_sentence) return c.procedure;
  return (c.gp_sentence.trim() + (c.procedure ? ' ' + c.procedure : '')).trim();
}

function valuesFor(c: ImportedCompound, citer: Citer): Json {
  const values: Json = structuredClone(c.values) as Json;
  for (const k of Object.keys(values)) if (!ALL_FIELDS.has(k)) delete values[k];
  const refs = values.references;
  if (isObj(refs) && c.cites.length) {
    // the literature sentence's citation numbers → the imported references
    const ids = citer.ids(c.cites);
    refs.refs = ids.length ? ids : (refs.refs ?? []);
  }
  return values;
}

/**
 * The imported structure (with its ChemDraw picture when `pictureFor` makes one). A typed HRMS
 * formula that the structure now gives is dropped (the structure gives it). Gives whether it was set.
 */
async function setStructure(project: SiProject, comp: SiCompound, c: ImportedCompound, opts: ApplyOptions): Promise<boolean> {
  if (c.picture_pdf && c.use_structure && !c.structure) {
    // From a PDF: only the drawing, as the structure's picture (its formula, for the HRMS, is the typed one).
    await setStructureImage(project, comp, c.picture_pdf, c.picture_ext || '.pdf', null, '', 'user');
    return true;
  }
  if (!(c.structure && c.use_structure)) return false;
  try {
    await project.setStructure(comp, c.structure);
  } catch {
    return false;
  }
  const picture = opts.pictureFor && c.structure_picture ? await opts.pictureFor(c.structure_picture).catch(() => null) : null;
  if (picture) await setStructureImage(project, comp, picture[0], picture[1], picture[2], picture[3], 'chemdraw');
  const hrms = valuesOf(comp).hrms;
  if (isObj(hrms) && String(hrms.formula ?? '').trim() && opts.factsOf) {
    try {
      const typed = hrmsSpecies(null, hrms)?.info.counts;
      const facts = await opts.factsOf(c.structure);
      const drawn = hrmsSpecies(facts, { ...hrms, formula: '' });
      if (typed && drawn && sameFormula(typed, drawn.info.counts)) {
        hrms.formula = '';
        await project.saveCompound(comp);
      }
    } catch { /* (a formula that can't be read: kept as typed) */ }
  }
  return true;
}

/** A picture stored as the structure's own (structure_image.<ext>, its vector original beside it), as SI Assistant keeps a pasted ChemDraw picture. */
async function setStructureImage(project: SiProject, comp: SiCompound, bytes: Uint8Array, ext: string, vector: Uint8Array | null, vectorExt: string, source: string): Promise<void> {
  const e = ext.startsWith('.') ? ext : `.${ext}`;
  const name = `structure_image${e}`;
  await project.folder.writeBytes(`${comp.folder}/${name}`, bytes);
  const ve = vectorExt ? (vectorExt.startsWith('.') ? vectorExt : `.${vectorExt}`).toLowerCase() : '';
  if (vector && ve && ve !== e) await project.folder.writeBytes(`${comp.folder}/structure_image${ve}`, vector);
  const values = valuesOf(comp);
  const old = isObj(values.structure) ? values.structure : {};
  values.structure = { ...old, image_override: name, image_source: source };
  await project.saveCompound(comp);
}

async function fillCompound(project: SiProject, comp: SiCompound, c: ImportedCompound, gpIds: Map<string, string>, mode: PrintMode, sourceName: string, opts: ApplyOptions, citer: Citer): Promise<void> {
  const linked = !!(c.gp_key && gpIds.has(c.gp_key));
  const values = valuesFor(c, citer);
  const v = valuesOf(comp);
  Object.assign(v, values);
  if (c.name) v.name = { text: c.name };
  if (linked) v.procedure = { gp: gpIds.get(c.gp_key)!, values: { ...c.gp_values } };
  const keys: string[] = FIELD_ORDER.filter((k) => k in values || k === 'procedure');
  if (mode === PRINT_AS_IMPORTED) keys.push('si_text');
  await project.addFields(comp, keys.map((k) => ({ key: k })));
  await project.writeCompoundText(comp, 'procedure', citer.cite(procedureText(c, linked)));
  if (mode === PRINT_AS_IMPORTED) await project.writeCompoundText(comp, 'si_text', citer.cite(c.original));
  await writeNotes(project, comp, c, sourceName);
  await setStructure(project, comp, c, opts);
}

/** Fill the existing compound's empty fields; the labels of those left as they were. */
async function mergeCompound(project: SiProject, comp: SiCompound, c: ImportedCompound, gpIds: Map<string, string>, mode: PrintMode, sourceName: string, opts: ApplyOptions, citer: Citer): Promise<string[]> {
  const kept: string[] = [];
  const values = valuesFor(c, citer);
  const added: string[] = [];
  const v = valuesOf(comp);
  if (c.name && !compoundName(comp)) { v.name = { text: c.name }; added.push('name'); }
  for (const [key, value] of Object.entries(values)) {
    const def = ALL_FIELDS.get(key)!;
    // (a value typed in is kept even when its field was taken off the page: removing a field keeps its value)
    if (project.fieldFilled(comp, def)) { kept.push(def.label); continue; }
    v[key] = value;
    added.push(key);
  }
  const proc = ALL_FIELDS.get('procedure')!;
  if (project.fieldFilled(comp, proc)) {
    if (c.procedure || c.gp_sentence) kept.push(proc.label);
  } else {
    const linked = !!(c.gp_key && gpIds.has(c.gp_key));
    if (linked) v.procedure = { gp: gpIds.get(c.gp_key)!, values: { ...c.gp_values } };
    await project.writeCompoundText(comp, 'procedure', citer.cite(procedureText(c, linked)));
    added.push('procedure');
  }
  if (mode === PRINT_AS_IMPORTED && !project.compoundText(comp, 'si_text').trim()) {
    await project.writeCompoundText(comp, 'si_text', citer.cite(c.original));
    added.push('si_text');
  }
  await project.addFields(comp, FIELD_ORDER.filter((k) => added.includes(k)).map((k): FieldEntry => ({ key: k })));
  if ((c.structure || c.picture_pdf) && c.use_structure) {
    const image = isObj(v.structure) && String(v.structure.image_override ?? '');
    if (project.hasStructure(comp) || image) kept.push(ALL_FIELDS.get('structure')!.label);
    else await setStructure(project, comp, c, opts);
  }
  await writeNotes(project, comp, c, sourceName);
  return kept;
}

async function writeNotes(project: SiProject, comp: SiCompound, c: ImportedCompound, sourceName: string): Promise<void> {
  if (!c.unrecognised.length) return;
  const old = project.compoundText(comp, 'notes').replace(/\s+$/, '');
  const text = notesHeading(sourceName) + '\n' + c.unrecognised.join('\n');
  await project.writeCompoundText(comp, 'notes', old ? old + '\n\n' + text : text);
}
