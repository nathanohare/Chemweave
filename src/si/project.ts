// An SI project: the folder Chem SI Assistant keeps a Supporting Information in, read and
// written here the same way, so one project can be worked on in either program.
//
//   My SI/
//   ├── project.json        title, authors, settings, the section tree
//   ├── references.json     the bibliography
//   ├── .lock               who has the project open
//   ├── front/              cover text, General Information, their pictures and tables
//   ├── sections/<id>_<slug>/section.json (+ content.txt, procedures/, tables/, images/)
//   │       └── compounds/<id>_<slug>/compound.json, structure.mol, <field>.txt, spectra/, files/
//   ├── trash/              deleted items, restorable in SI Assistant
//   ├── snapshots/, build/
//
// Every file keeps what this program doesn't know about: each JSON file is kept whole in
// memory and only the values changed here are changed in it, then written back in the same
// layout SI Assistant writes (pyjson.ts). Nothing here is user interface, so it is tested
// directly (tests/si-project.test.ts).

import { cloneJson, copyFloats, dumpPyJson, markFloat, parsePyJson } from './pyjson';
import { UNDO_HOLDING, type SiFolder } from './folder';
import { newId, safeFilename, slugify } from './ids';
import { parseMarkup } from './markup';
import { DEFAULT_NMR_NUCLEI, DEFAULT_SECTION_FIELDS, emptyValue, fieldDef, isFilled, partText, type FieldDef, type FieldEntry } from './fields';
import { checkIds, type IdReport } from './compound-ids';
import { NEW_PROJECT_PER_PAGE, defaultsJson, sectionDefaults, type SpectrumLayout } from './spectra';
import { newProjectStyleLooks, SI_STYLES_FILE, styleLooksJson } from './si-styles';
import { compoundAnchor, emptyFlagFile, FLAGS_FILE, flagFileJson, flagRecord, newFlagId, noteAnchor, parseAnchor, parseFlagFile, sectionAnchor, threadOf, type FlagFile, type FlagRecord, type FlagThread } from './flag-threads';

/** A flag or comment as the project lists it (`isFlag` false: a comment only). */
export interface FlagEntry { anchor: string; flag: FlagRecord; resolved: boolean; isFlag: boolean; thread: FlagThread }

/** The Spectra section's name (SI Assistant's spectra.DEFAULT_NAME). */
const SPECTRA_NAME = 'Spectra';

/** The project.json format this reads and writes. A newer one opens read-only (it may hold what this would lose). */
export const FORMAT_VERSION = 1;
export const PROJECT_FILE = 'project.json';
export const REFERENCES_FILE = 'references.json';
export const SECTIONS_DIR = 'sections';
export const TRASH_DIR = 'trash';
export const SECTION_FILE = 'section.json';
export const COMPOUNDS_DIR = 'compounds';
export const COMPOUND_FILE = 'compound.json';
export const SCHEME_FILE = 'scheme.json';
export const STRUCTURE_FILE = 'structure.mol';
/** A compound's stored files and folders (Store additional files and folders: never printed). */
export const PRIVATE_DIR = 'private';
export const NOTES_FILE = 'notes.txt';
export const TEXT_CONTENT_FILE = 'content.txt';
/** A new general procedure's compound sentence (SI Assistant's). */
export const DEFAULT_GP_SENTENCE = 'Prepared according to {GP} from {starting material} ({scale}).';
export const GP_DIR = 'procedures';
export const LOCK_FILE = '.lock';
export const MAX_SECTION_DEPTH = 3;
const SECTION_SLUG = 20;
const ITEM_SLUG = 14;

/** Section kinds: shown names ("text" sections are Custom, "file" ones Attachment). */
export const TYPE_LABELS: Record<string, string> = { text: 'Custom', file: 'Attachment', data: 'Data', xray: 'X-ray structure', spectra: 'Spectra' };

export type Json = Record<string, unknown>;

export interface SiSection {
  id: string;
  type: string;
  name: string;
  /** Its folder, from the project folder. */
  folder: string;
  /** All of section.json. */
  data: Json;
  /** Data sections: compounds and scheme pages, in order. */
  items: (SiCompound | SiScheme)[];
  /** Custom sections: their sub-sections. */
  children: SiSection[];
  parentId: string | null;
}

export interface SiCompound {
  kind: 'compound';
  id: string;
  folder: string;
  /** All of compound.json: {id, id_override, fields: [{key}], values: {…}, flags: {…}}. */
  data: Json;
  sectionId: string;
  /** Set when it is a compound of a scheme page. */
  schemeId: string | null;
}

export interface SiScheme {
  kind: 'scheme';
  id: string;
  folder: string;
  data: Json;
  sectionId: string;
  children: SiCompound[];
}

export interface SiLock { user: string; computer: string; opened_at: string; session: string }

export class SiProjectError extends Error {}

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The settings a new project starts with (and that a project missing one of them gets). */
export function defaultSettings(title: string): Json {
  const s: Json = {
    title,
    // each author: {name, affiliations: ["a"], corresponding, email}; each affiliation: {marker, text}
    authors: [],
    affiliations: [],
    journal_style: 'ACS',
    hrms_tolerance_ppm: 5.0,
    auto_nmr_31P: false,
    auto_nmr_11B: false,
    compile_structures: 'pictures',
    format_text: true,
    paste_dpi: 1200,
  };
  markFloat(s, 'hrms_tolerance_ppm');
  return s;
}

/** A compound's fields, values and flags (made when missing). */
export const fieldsOf = (c: SiCompound): FieldEntry[] => {
  if (!Array.isArray(c.data.fields)) c.data.fields = [];
  return c.data.fields as FieldEntry[];
};
export const valuesOf = (c: SiCompound): Json => {
  if (!isObj(c.data.values)) c.data.values = {};
  return c.data.values as Json;
};
export const flagsOf = (c: SiCompound): Record<string, Json> => {
  if (!isObj(c.data.flags)) c.data.flags = {};
  return c.data.flags as Record<string, Json>;
};
export const fieldKeys = (c: SiCompound): string[] => fieldsOf(c).map((e) => e.key);
/** The compound's name ("" when it has none). */
export const compoundName = (c: SiCompound): string => {
  const n = valuesOf(c).name;
  return isObj(n) ? partText(n.text).trim() : '';
};
export const idOverride = (c: SiCompound): string => str(c.data.id_override).trim() || (typeof c.data.id_override === 'number' ? String(c.data.id_override) : '');
/** A section's ID table, as text. */
export const idTableOf = (s: SiSection): string[] => {
  if (!Array.isArray(s.data.id_table)) s.data.id_table = [];
  return (s.data.id_table as unknown[]).map((v) => (v === null || v === undefined ? '' : String(v)));
};
export const defaultFieldsOf = (s: SiSection): FieldEntry[] => {
  if (!Array.isArray(s.data.default_fields)) s.data.default_fields = cloneJson(DEFAULT_SECTION_FIELDS) as FieldEntry[];
  return s.data.default_fields as FieldEntry[];
};
/** Every compound of a Data section in order (those of its scheme pages too): IDs follow this order. */
export const compoundsOf = (s: SiSection): SiCompound[] => s.items.flatMap((i) => (i.kind === 'scheme' ? i.children : [i]));

const join = (...parts: string[]): string => parts.filter(Boolean).join('/');
const parentOf = (rel: string): string => rel.slice(0, Math.max(0, rel.lastIndexOf('/')));
const nameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);

export class SiProject {
  settings: Json = {};
  /** The top level of the section tree. */
  top: SiSection[] = [];
  /** X-ray structures shown under a compound (not in the tree): compound id → them. */
  anchored = new Map<string, SiSection[]>();
  references: Json[] = [];
  /** Problems found reading the project, said once when it opens. */
  warnings: string[] = [];
  /** Chemweave's additions to the flags (flag-threads.ts): replies, resolved flags, flags on section headings. */
  flagFile: FlagFile = emptyFlagFile();
  /** chemweave-flags.json is there but can't be read: shown empty and never written over. */
  flagFileUnread = false;
  savedFormat = FORMAT_VERSION;
  savedBy = '';
  readOnly = false;
  lock: SiLock | null = null;
  /** The texts of compounds' rich-text fields, as last read or written: file → text. */
  private texts = new Map<string, string>();
  /** Files that are there (structure.mol, texts), as last read or written. */
  private present = new Set<string>();
  /** Items whose JSON couldn't be read: kept in the saved orders until they can be (id → folder). */
  private skipped = new Map<string, string>();
  private savedTree: unknown[] = [];
  /** Keys project.json had, in its order, that are not settings. */
  private programVersion: string;
  /** Pages and sections sent to the Trash: a late save of one (a lookup that finishes afterwards) must not make its folder again. */
  private gone = new WeakSet<object>();
  /** Goes up each time the project is read again: its sections, pages and compounds are new objects from then on (the ones from before must not be saved). */
  revision = 0;
  /** Why the project became read-only while open (the lock was taken over, or the folder moved); '' otherwise. */
  lostWhy = '';
  /** Told when the project becomes read-only while open, with what to tell the person. */
  onReadOnly: ((message: string) => void) | null = null;
  private lockChecked = 0;
  /** JSON files being read ahead while the project opens: file → its text (or why not). */
  private ahead = new Map<string, Promise<{ text: string | null } | { why: string }>>();
  /** Changes to the project's structure (adding, moving, deleting pages and sections, reading it again) run one at a time. */
  private chain: Promise<unknown> = Promise.resolve();

  private exclusive<T>(f: () => Promise<T>): Promise<T> {
    const run = this.chain.then(f, f);
    this.chain = run.catch(() => {});
    return run;
  }

  /**
   * The project file (.chemsi) it is saved in, when it is one (its folder is then a working copy
   * of the file, packed back into it on Save: si/packed.ts); null for a project folder, or one
   * not saved as a file yet.
   */
  file: string | null = null;
  /** What the project is known by (linked documents, open tabs): its file, else its folder. */
  get key(): string { return this.file ?? this.folder.where; }

  private constructor(readonly folder: SiFolder, programVersion: string) {
    this.programVersion = programVersion;
  }

  /** Open the project in `folder`. */
  static async open(folder: SiFolder, opts: { readOnly?: boolean; programVersion?: string } = {}): Promise<SiProject> {
    const p = new SiProject(folder, opts.programVersion ?? '');
    p.readOnly = !!opts.readOnly;
    await p.read();
    // every change to the folder first asks this project whether it may still be made (see guard)
    if (!p.readOnly) {
      let disk: SiFolder = folder;
      while ((disk as { inner?: SiFolder }).inner) disk = (disk as unknown as { inner: SiFolder }).inner;
      if ('beforeChange' in disk) disk.beforeChange = () => p.guard();
    }
    return p;
  }

  /** Make a new, empty project in `folder` (which should be empty). */
  static async create(folder: SiFolder, title: string, opts: { programVersion?: string } = {}): Promise<SiProject> {
    if (!title.trim()) throw new SiProjectError('Please give the project a name.');
    if (await folder.exists(PROJECT_FILE)) throw new SiProjectError(`There is an SI project in ${folder.where} already: open it instead.`);
    const settings = defaultSettings(title.trim());
    // a new project prints two spectra on a page (as SI Assistant's): carried into the Spectra section when it is added
    settings.spectra_per_page = NEW_PROJECT_PER_PAGE;
    const out: Json = { format_version: FORMAT_VERSION, saved_by_version: opts.programVersion ?? '', ...settings, section_tree: [] };
    copyFloats(settings, out);
    await folder.writeText(PROJECT_FILE, dumpPyJson(out));
    await folder.writeText(REFERENCES_FILE, dumpPyJson([]));
    // Project Settings ▸ Styles ▸ Use for New SI Projects
    const looks = newProjectStyleLooks();
    if (Object.keys(looks).length) await folder.writeText(SI_STYLES_FILE, styleLooksJson(looks));
    return SiProject.open(folder, opts);
  }

  /** Whether project.json was saved by a newer format than this reads (it is then opened read-only). */
  get newerFormat(): boolean { return this.savedFormat > FORMAT_VERSION; }

  get title(): string { return str(this.settings.title) || nameOf(this.folder.where.replace(/\\/g, '/')) || 'SI Project'; }

  private async readJson(rel: string): Promise<{ ok: true; data: unknown } | { ok: false; why: string }> {
    let text: string | null;
    const early = this.ahead.get(rel);
    if (early) {
      this.ahead.delete(rel);
      const got = await early;
      if ('why' in got) return { ok: false, why: got.why };
      text = got.text;
    } else {
      try {
        text = await this.folder.readText(rel);
      } catch (e) {
        return { ok: false, why: `could not be read (${e instanceof Error ? e.message : String(e)})` };
      }
    }
    if (text === null) return { ok: true, data: undefined };
    try {
      return { ok: true, data: parsePyJson(text) };
    } catch {
      return { ok: false, why: 'could not be read (it is damaged, or was edited by hand)' };
    }
  }

  /**
   * Read the whole project again from its files. Everything is read first and only then replaces
   * what is in memory, so a failure part-way changes nothing (and nothing sees a half-read project).
   */
  reload(): Promise<void> { return this.exclusive(() => this.reloadNow()); }

  private async reloadNow(): Promise<void> {
    this.revision++;
    const fresh = new SiProject(this.folder, this.programVersion);
    fresh.readOnly = this.readOnly;
    await fresh.read();
    this.settings = fresh.settings;
    this.top = fresh.top;
    this.anchored = fresh.anchored;
    this.references = fresh.references;
    this.refsUnread = fresh.refsUnread;
    this.flagFile = fresh.flagFile;
    this.flagsChanged();
    this.flagFileUnread = fresh.flagFileUnread;
    this.warnings = fresh.warnings;
    this.savedFormat = fresh.savedFormat;
    this.savedBy = fresh.savedBy;
    // (never writable again here: the lock may have been found lost while the folder was read)
    this.readOnly = this.readOnly || fresh.readOnly;
    this.texts = fresh.texts;
    this.present = fresh.present;
    this.skipped = fresh.skipped;
    this.savedTree = fresh.savedTree;
  }

  private async read(): Promise<void> {
    const got = await this.readJson(PROJECT_FILE);
    if (!got.ok) throw new SiProjectError(`${PROJECT_FILE} ${got.why}.`);
    if (got.data === undefined) throw new SiProjectError(`This folder is not an SI project (no ${PROJECT_FILE} found): ${this.folder.where}`);
    if (!isObj(got.data)) throw new SiProjectError(`${PROJECT_FILE} could not be read: it does not hold the project's settings.`);
    const raw = { ...got.data };
    let tree = raw.section_tree;
    const order = raw.section_order;
    delete raw.section_tree;
    delete raw.section_order;
    if (!Array.isArray(tree)) tree = Array.isArray(order) ? order.filter((x): x is string => typeof x === 'string').map((id) => ({ id })) : [];
    const fv = Number(raw.format_version);
    this.savedFormat = Number.isFinite(fv) && fv >= 1 ? Math.floor(fv) : 1;
    this.savedBy = str(raw.saved_by_version);
    delete raw.format_version;
    delete raw.saved_by_version;
    const defaults = defaultSettings(nameOf(this.folder.where.replace(/\\/g, '/')));
    const settings: Json = { ...defaults, ...raw };
    // (a value the file has keeps its own form: 5 stays 5, 5.0 stays 5.0)
    if (!('hrms_tolerance_ppm' in raw)) copyFloats(defaults, settings);
    copyFloats(got.data, settings);
    if (typeof settings.journal_style !== 'string') settings.journal_style = 'ACS';
    this.warnings = [];
    this.skipped = new Map();
    this.texts = new Map();
    this.present = new Set();
    const files = await this.folder.list(SECTIONS_DIR, ['json', 'txt', 'mol']);
    for (const f of files) this.present.add(f);
    // the sections', compounds' and scheme pages' files are all asked for at once, then read in order
    this.ahead = new Map();
    for (const f of files) {
      if (!/\/(section|compound|scheme)\.json$/.test(f)) continue;
      this.ahead.set(f, this.folder.readText(f).then((text) => ({ text }), (e: unknown) => ({ why: `could not be read (${e instanceof Error ? e.message : String(e)})` })));
    }
    let top: SiSection[];
    try {
      top = await this.loadSections(tree as unknown[], files);
    } finally {
      this.ahead = new Map();
    }
    const refs = await this.readJson(REFERENCES_FILE);
    if (!refs.ok) this.warnings.push(`${REFERENCES_FILE} ${refs.why}; the reference list is shown empty and is not saved over.`);
    this.references = refs.ok && Array.isArray(refs.data) ? refs.data.filter(isObj) : [];
    this.refsUnread = !refs.ok;
    const flagText = await this.folder.readText(FLAGS_FILE).catch(() => undefined);
    const flagFile = flagText === undefined ? null : parseFlagFile(flagText);
    this.flagFile = flagFile ?? emptyFlagFile();
    this.flagFileUnread = !flagFile;
    if (!flagFile) this.warnings.push(`${FLAGS_FILE} could not be read; flag replies and resolved flags are shown empty and are not saved over.`);
    // the compounds' texts are small: read now, so whether each is filled in is known
    const textFiles = files.filter((f) => f.endsWith('.txt') && f.includes(`/${COMPOUNDS_DIR}/`));
    await Promise.all(textFiles.map(async (f) => this.texts.set(f, (await this.folder.readText(f)) ?? '')));
    this.settings = settings;
    this.top = top;
    this.savedTree = cloneJson(tree as unknown[]);
    if (this.newerFormat) {
      this.readOnly = true;
      this.warnings.unshift(`This project was saved by a newer version (file format ${this.savedFormat}), so it is open read-only here: saving could lose what that version added.`);
    }
  }
  private refsUnread = false;

  private async loadSections(tree: unknown[], files: string[]): Promise<SiSection[]> {
    const found = new Map<string, SiSection>();
    const sectionFiles = files.filter((f) => f.split('/').length === 3 && f.endsWith('/' + SECTION_FILE));
    for (const f of sectionFiles) {
      const folder = parentOf(f);
      const got = await this.readJson(f);
      const fid = nameOf(folder).split('_')[0];
      if (!got.ok || !isObj(got.data)) {
        this.skipped.set(fid, folder);
        this.warnings.push(`${nameOf(folder)}/${SECTION_FILE} ${got.ok ? 'does not hold what was expected' : got.why}. It is not shown, but keeps its place: repair it, then reopen the project.`);
        continue;
      }
      const data = got.data;
      for (const k of ['id', 'name', 'type']) if (data[k] !== undefined && data[k] !== null && typeof data[k] !== 'string') data[k] = String(data[k]);
      if (Array.isArray(data.id_table)) data.id_table = data.id_table.map((v) => (v === null || v === undefined ? '' : String(v).trim()));
      else if ('id_table' in data && data.id_table !== null) {
        data['id_table (could not be read)'] = data.id_table;
        delete data.id_table;
        this.warnings.push(`${nameOf(folder)}/${SECTION_FILE}: “id_table” is not in the expected form, so it is ignored. It is kept in the file as “id_table (could not be read)”.`);
      }
      if ('compound_order' in data) data.compound_order = Array.isArray(data.compound_order) ? data.compound_order.filter((x) => typeof x === 'string') : [];
      let sid = str(data.id);
      if (!sid) sid = data.id = fid;
      if (found.has(sid)) { this.warnings.push(`Two section folders share the ID ${sid}; ${nameOf(folder)} is not shown.`); continue; }
      const s: SiSection = { id: sid, type: str(data.type) || 'text', name: typeof data.name === 'string' ? data.name : nameOf(folder), folder, data, items: [], children: [], parentId: null };
      if (s.type === 'data') s.items = await this.loadItems(s, files);
      found.set(sid, s);
    }
    // X-ray structures under a compound sit there; one whose compound is gone goes in the tree
    const compounds = new Set([...found.values()].filter((s) => s.type === 'data').flatMap((s) => compoundsOf(s).map((c) => c.id)));
    this.anchored = new Map();
    const order = (s: SiSection): number => (typeof s.data.anchor_order === 'number' ? s.data.anchor_order : 0);
    for (const s of [...found.values()].sort((a, b) => order(a) - order(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (s.type !== 'xray' || !s.data.anchored) continue;
      const cid = str(s.data.compound);
      if (cid && compounds.has(cid)) {
        this.anchored.set(cid, [...(this.anchored.get(cid) ?? []), s]);
        found.delete(s.id);
      } else s.data.anchored = false;
    }
    const top = this.placeTree(tree, found, 1, null);
    // folders not in the saved tree (added by a sync) go at the end
    for (const s of found.values()) { s.parentId = null; top.push(s); }
    return top;
  }

  /** One level of the section tree; sub-sections that can't be where they were saved go after their parent. */
  private placeTree(nodes: unknown[], found: Map<string, SiSection>, depth: number, parent: SiSection | null): SiSection[] {
    const out: SiSection[] = [];
    for (let node of Array.isArray(nodes) ? nodes : []) {
      if (typeof node === 'string') node = { id: node };
      if (!isObj(node)) continue;
      const kids = Array.isArray(node.children) ? node.children : [];
      const id = str(node.id);
      const s = id ? found.get(id) : undefined;
      if (!s) { out.push(...this.placeTree(kids, found, depth, parent)); continue; }
      found.delete(id);
      s.parentId = parent?.id ?? null;
      out.push(s);
      if (s.type === 'text' && depth < MAX_SECTION_DEPTH) s.children = this.placeTree(kids, found, depth + 1, s);
      else { s.children = []; out.push(...this.placeTree(kids, found, depth, parent)); }
    }
    return out;
  }

  private async loadItems(s: SiSection, files: string[]): Promise<(SiCompound | SiScheme)[]> {
    const base = join(s.folder, COMPOUNDS_DIR) + '/';
    const read = async (json: string): Promise<Map<string, [string, Json]>> => {
      const out = new Map<string, [string, Json]>();
      for (const f of files.filter((x) => x.startsWith(base) && x.slice(base.length).split('/').length === 2 && x.endsWith('/' + json))) {
        const folder = parentOf(f);
        const fid = nameOf(folder).split('_')[0];
        const got = await this.readJson(f);
        if (!got.ok || !isObj(got.data)) {
          this.skipped.set(fid, folder);
          this.warnings.push(`${s.name} ▸ ${nameOf(folder)}/${json} ${got.ok ? 'does not hold what was expected' : got.why}. It is not shown, and the compound IDs after it may be shifted, until it can be read: repair it, then reopen the project.`);
          continue;
        }
        let id = str(got.data.id);
        if (!id) id = fid;
        if (out.has(id)) { this.skipped.set(id, folder); this.warnings.push(`Two folders share the ID ${id} in ${s.name}: ${nameOf(folder)} is not shown. Delete the copy you don't need, then reopen the project.`); continue; }
        got.data.id = id;
        out.set(id, [folder, got.data]);
      }
      return out;
    };
    const compounds = new Map<string, SiCompound>();
    for (const [id, [folder, data]] of await read(COMPOUND_FILE)) {
      cleanCompound(data, `${s.name} ▸ ${nameOf(folder)}`, this.warnings);
      compounds.set(id, { kind: 'compound', id, folder, data, sectionId: s.id, schemeId: null });
    }
    const all = new Map<string, SiCompound | SiScheme>();
    for (const [id, [folder, data]] of await read(SCHEME_FILE)) {
      const kids: SiCompound[] = [];
      for (const cid of Array.isArray(data.children) ? data.children : []) {
        const c = typeof cid === 'string' ? compounds.get(cid) : undefined;
        if (!c) continue;
        compounds.delete(cid as string);
        c.schemeId = id;
        kids.push(c);
      }
      all.set(id, { kind: 'scheme', id, folder, data, sectionId: s.id, children: kids });
    }
    for (const [id, c] of compounds) all.set(id, c);
    const ordered: (SiCompound | SiScheme)[] = [];
    for (const id of (Array.isArray(s.data.compound_order) ? s.data.compound_order : []) as string[]) {
      const it = all.get(id);
      if (it) { ordered.push(it); all.delete(id); }
    }
    ordered.push(...all.values());
    return ordered;
  }

  // ---------------------------------------------------------------- finding things

  /** Every section in document order (sub-sections after their section). */
  get sections(): SiSection[] {
    const out: SiSection[] = [];
    const walk = (list: SiSection[]): void => { for (const s of list) { out.push(s); walk(s.children); } };
    walk(this.top);
    return out;
  }
  section(id: string): SiSection {
    const s = this.sections.find((x) => x.id === id) ?? [...this.anchored.values()].flat().find((x) => x.id === id);
    if (!s) throw new SiProjectError(`No section ${id}.`);
    return s;
  }
  get dataSections(): SiSection[] { return this.sections.filter((s) => s.type === 'data'); }
  get compounds(): SiCompound[] { return this.dataSections.flatMap(compoundsOf); }
  compound(id: string): SiCompound {
    const c = this.compounds.find((x) => x.id === id);
    if (!c) throw new SiProjectError(`No compound ${id}.`);
    return c;
  }
  /** A compound by its id, or null when there is none. */
  compoundById(id: string): SiCompound | null { return this.compounds.find((x) => x.id === id) ?? null; }
  parent(s: SiSection): SiSection | null { return s.parentId ? this.section(s.parentId) : null; }
  depth(s: SiSection): number { let d = 1; for (let p = this.parent(s); p; p = this.parent(p)) d++; return d; }

  /** Every compound's ID, with the ID warnings (missing and duplicate IDs). */
  idReport(): IdReport {
    return checkIds(this.dataSections.map((s) => {
      const cs = compoundsOf(s);
      return { sectionId: s.id, sectionName: s.name, table: idTableOf(s), compoundIds: cs.map((c) => c.id), overrides: cs.map(idOverride), compoundNames: cs.map(compoundName) };
    }));
  }

  // ---------------------------------------------------------------- saving

  private checkWritable(): void {
    if (this.readOnly) throw new SiProjectError(this.lostWhy || 'This SI project is open read-only.');
  }

  /** A page or section in the Trash is not saved again (its folder would be made again, with only that file in it). */
  private checkThere(x: object, name: string): void {
    if (this.gone.has(x)) throw new SiProjectError(`“${name}” is in the project’s Trash, so the change to it was not saved. Restore it from the Trash (Project ▸ Trash) to change it.`);
  }

  /**
   * Asked before every change to the project's files. While this program has the lock, the lock
   * is read again (at most every second or so): if someone took the project over, or the folder
   * was renamed or moved, nothing more is written (it would overwrite their changes, or make the
   * old folder again with only the changed files in it) and the project becomes read-only.
   */
  private async guard(): Promise<void> {
    this.checkWritable();
    if (!this.lock || this.sure || Date.now() - this.lockChecked < 1500) return;
    if (!(await this.checkLock())) throw new SiProjectError(`${this.lostWhy} The last change was not saved.`);
  }

  /**
   * `f` with the lock checked once, now, and not again until it is done: Undo puts several files
   * back, and a check that failed half-way would leave them half put back.
   */
  async whileSure<T>(f: () => Promise<T>): Promise<T> {
    this.checkWritable();
    if (this.lock && !(await this.checkLock())) throw new SiProjectError(this.lostWhy || 'This SI project is open read-only.');
    this.sure++;
    try { return await f(); } finally { this.sure--; }
  }
  private sure = 0;

  /**
   * Whether the project is still this program's to change: false once the lock is someone else's
   * or gone (the project is read-only from then on, and `onReadOnly` is told why). A lock that
   * can't be read just now (being synced) is "don't know": nothing changes.
   */
  async checkLock(): Promise<boolean> {
    if (this.readOnly) return false;
    const mine = this.lock;
    if (!mine) return true;
    const got = await this.readJson(LOCK_FILE);
    if (this.lock !== mine || this.readOnly) return !this.readOnly;
    if (!got.ok) return true;
    if (isObj(got.data) && str(got.data.session) === mine.session) { this.lockChecked = Date.now(); return true; }
    let why: string;
    if (isObj(got.data)) {
      why = `${str(got.data.user) || 'Someone'} has taken this project over for editing${str(got.data.computer) ? ` on ${str(got.data.computer)}` : ''}, so it is read-only here now. Close it and open it again to see their changes.`;
    } else if (!(await this.folder.exists(PROJECT_FILE).catch(() => true))) {
      why = `The project folder is no longer at ${this.folder.where}: it may have been renamed or moved, so nothing more is saved there. Close the project and open it again from its new place.`;
    } else {
      why = 'This project’s lock is gone: it may have been opened and closed in another program since. So that nothing changed there is overwritten, it is read-only here now. Close it and open it again to go on editing.';
    }
    this.readOnly = true;
    this.lostWhy = why;
    this.lock = null;
    this.onReadOnly?.(why);
    return false;
  }

  /**
   * Put a file Chemweave made in this same step out of the project (into build/chemweave-undo,
   * emptied when the project closes): project files are never deleted outright.
   */
  async setAside(path: string): Promise<void> {
    if (!(await this.folder.exists(path))) return;
    await this.folder.move(path, `${UNDO_HOLDING}/${Date.now().toString(36)}-${newId('h').slice(2)}/${path}`);
  }

  private async writeJson(rel: string, data: unknown): Promise<void> {
    await this.folder.writeText(rel, dumpPyJson(data));
  }

  /** The section tree as saved: sections that couldn't be read keep their places. */
  private treeJson(list: SiSection[]): Json[] {
    return list.map((s) => ({ id: s.id, ...(s.children.length ? { children: this.treeJson(s.children) } : {}) }));
  }

  private mergeTree(now: Json[], old: unknown[]): Json[] {
    if (!this.skipped.size) return now;
    const present = new Set<string>();
    const collect = (ns: Json[]): void => { for (const n of ns) { present.add(n.id as string); collect((n.children as Json[]) ?? []); } };
    collect(now);
    const find = (ns: Json[], id: string): Json | null => {
      for (const n of ns) { if (n.id === id) return n; const hit = find((n.children as Json[]) ?? [], id); if (hit) return hit; }
      return null;
    };
    const walk = (olds: unknown, parentId: string | null): void => {
      const before: string[] = [];
      for (let node of Array.isArray(olds) ? olds : []) {
        if (typeof node === 'string') node = { id: node };
        if (!isObj(node) || typeof node.id !== 'string') continue;
        const id = node.id;
        if (!present.has(id) && this.skipped.has(id)) {
          const parent = parentId ? find(now, parentId) : null;
          const sibs = parent ? ((parent.children as Json[] | undefined) ?? (parent.children = [])) as Json[] : now;
          const ids = sibs.map((n) => n.id);
          const after = [...before].reverse().find((b) => ids.includes(b));
          sibs.splice(after !== undefined ? ids.indexOf(after) + 1 : 0, 0, { id });
          present.add(id);
        }
        before.push(id);
        walk(node.children, id);
      }
    };
    walk(old, null);
    return now;
  }

  /** An order to save (compounds, or a scheme's), with the ids of items that couldn't be read put back after the one they followed. */
  private mergeIds(now: string[], old: unknown): string[] {
    const out = [...now];
    const list = Array.isArray(old) ? old : [];
    list.forEach((id, n) => {
      if (typeof id !== 'string' || out.includes(id) || !this.skipped.has(id)) return;
      const before = [...list.slice(0, n)].reverse().find((b) => typeof b === 'string' && out.includes(b)) as string | undefined;
      out.splice(before !== undefined ? out.indexOf(before) + 1 : 0, 0, id);
    });
    return out;
  }

  /** A front-matter text (front/cover_text.txt, front/general_information.txt); '' when there is none. */
  async readFrontText(which: 'cover' | 'general'): Promise<string> {
    return (await this.folder.readText(`front/${which === 'cover' ? 'cover_text' : 'general_information'}.txt`)) ?? '';
  }
  async writeFrontText(which: 'cover' | 'general', text: string): Promise<void> {
    this.checkWritable();
    await this.folder.writeText(`front/${which === 'cover' ? 'cover_text' : 'general_information'}.txt`, text);
  }

  async saveSettings(): Promise<void> {
    this.checkWritable();
    const tree = this.mergeTree(this.treeJson(this.top), this.savedTree);
    const out: Json = { format_version: FORMAT_VERSION, saved_by_version: this.programVersion || this.savedBy, ...this.settings, section_tree: tree };
    copyFloats(this.settings, out);
    await this.writeJson(PROJECT_FILE, out);
    this.savedTree = cloneJson(tree);
  }

  /**
   * Put a section's saved tree (a node of project.json's section_tree, as the Trash keeps it) at
   * `index` among the sections of `parentId` (the top level when that is gone or can't hold it),
   * save, and read the project again. Gives a note when it went to the top level instead.
   */
  restoreTreeNode(node: Json, parentId: string | null, index: number | null): Promise<string> { return this.exclusive(() => this.restoreTreeNodeNow(node, parentId, index)); }

  private async restoreTreeNodeNow(node: Json, parentId: string | null, index: number | null): Promise<string> {
    this.checkWritable();
    const tree = this.mergeTree(this.treeJson(this.top), this.savedTree);
    const find = (ns: Json[], id: string): Json | null => {
      for (const n of ns) { if (n.id === id) return n; const hit = find((n.children as Json[]) ?? [], id); if (hit) return hit; }
      return null;
    };
    let note = '';
    let list = tree;
    if (parentId) {
      const parent = find(tree, parentId);
      const ok = parent && this.sections.some((x) => x.id === parentId && x.type === 'text');
      if (ok) list = ((parent.children as Json[] | undefined) ?? (parent.children = [])) as Json[];
      else note = ' Its parent section no longer exists, so it was put at the top level.';
    }
    const at = note || index === null ? list.length : Math.max(0, Math.min(index, list.length));
    list.splice(at, 0, node);
    const out: Json = { format_version: FORMAT_VERSION, saved_by_version: this.programVersion || this.savedBy, ...this.settings, section_tree: tree };
    copyFloats(this.settings, out);
    await this.writeJson(PROJECT_FILE, out);
    await this.reloadNow();
    return note;
  }

  async saveSection(s: SiSection): Promise<void> {
    this.checkWritable();
    this.checkThere(s, s.name);
    Object.assign(s.data, { id: s.id, type: s.type, name: s.name });
    if (s.type === 'data') s.data.compound_order = this.mergeIds(s.items.map((i) => i.id), s.data.compound_order);
    await this.writeJson(join(s.folder, SECTION_FILE), s.data);
  }

  async saveCompound(c: SiCompound): Promise<void> {
    this.flagsChanged();
    this.checkWritable();
    this.checkThere(c, compoundName(c) || 'This compound');
    c.data.id = c.id;
    await this.writeJson(join(c.folder, COMPOUND_FILE), c.data);
  }

  async saveScheme(k: SiScheme): Promise<void> {
    this.checkWritable();
    this.checkThere(k, str(k.data.name) || 'This scheme page');
    Object.assign(k.data, { id: k.id, children: this.mergeIds(k.children.map((c) => c.id), k.data.children) });
    await this.writeJson(join(k.folder, SCHEME_FILE), k.data);
  }

  /** Every scheme page of the project. */
  get schemes(): SiScheme[] { return this.dataSections.flatMap((s) => s.items.filter((i): i is SiScheme => i.kind === 'scheme')); }
  scheme(id: string): SiScheme {
    const k = this.schemes.find((x) => x.id === id);
    if (!k) throw new SiProjectError(`No scheme page ${id}.`);
    return k;
  }

  /** A new scheme page in a Data section (one empty starting material and one step, as SI Assistant starts one), at `index` (the end when not given). */
  addScheme(sectionId: string, index?: number, name = ''): Promise<SiScheme> { return this.exclusive(() => this.addSchemeNow(sectionId, index, name)); }

  private async addSchemeNow(sectionId: string, index?: number, name = ''): Promise<SiScheme> {
    this.checkWritable();
    const s = this.dataSection(sectionId);
    const id = newId('k');
    const n = s.items.filter((i) => i.kind === 'scheme').length + 1;
    const title = name.trim() || `Scheme ${n}`;
    const folder = join(s.folder, COMPOUNDS_DIR, `${id}_${slugify(title, ITEM_SLUG)}`);
    const data: Json = { id, name: title, children: [], mode: 'editor', editor: { starting: [{ id: newId('b') }], steps: [{ id: newId('st'), top: '', bottom: '', products: [{ id: newId('b') }] }], inline: {} } };
    const k: SiScheme = { kind: 'scheme', id, folder, data, sectionId: s.id, children: [] };
    await this.saveScheme(k);
    s.items.splice(index === undefined ? s.items.length : Math.max(0, Math.min(index, s.items.length)), 0, k);
    await this.saveSection(s);
    return k;
  }

  /** A new compound page of a scheme page (a box marked as a compound), at `index` among its compounds. */
  addSchemeCompound(k: SiScheme, index: number, name = ''): Promise<SiCompound> { return this.exclusive(() => this.addSchemeCompoundNow(k, index, name)); }

  private async addSchemeCompoundNow(k: SiScheme, index: number, name = ''): Promise<SiCompound> {
    this.checkWritable();
    const s = this.dataSection(k.sectionId);
    const id = newId('c');
    const folder = join(s.folder, COMPOUNDS_DIR, `${id}_${slugify(name || 'compound', ITEM_SLUG)}`);
    const c: SiCompound = { kind: 'compound', id, folder, data: { id, id_override: '', fields: [], values: {}, flags: {} }, sectionId: s.id, schemeId: k.id };
    for (const e of defaultFieldsOf(s)) this.addFieldEntry(c, e);
    if (name) valuesOf(c).name = { text: name };
    await this.saveCompound(c);
    k.children.splice(Math.max(0, Math.min(index, k.children.length)), 0, c);
    await this.saveScheme(k);
    return c;
  }

  /** Files sent to the Trash as one entry, as SI Assistant's Trash shows and restores them. */
  trashFiles(paths: string[], kind: string, name: string, extra: Json): Promise<void> {
    this.checkWritable();
    return this.moveToTrash(paths, kind, name, extra);
  }

  async saveReferences(): Promise<void> {
    this.checkWritable();
    if (this.refsUnread) throw new SiProjectError(`${REFERENCES_FILE} could not be read when the project opened, so it is not saved over. Repair it, then reopen the project.`);
    await this.writeJson(REFERENCES_FILE, this.references);
  }

  // ---------------------------------------------------------------- sections

  /** A new section at `index` among the top-level ones, or in the Custom section `parentId`. */
  addSection(type: 'text' | 'data' | 'file' | 'xray', name: string, index?: number, parentId: string | null = null): Promise<SiSection> { return this.exclusive(() => this.addSectionNow(type, name, index, parentId)); }

  private async addSectionNow(type: 'text' | 'data' | 'file' | 'xray', name: string, index?: number, parentId: string | null = null): Promise<SiSection> {
    this.checkWritable();
    const parent = parentId ? this.section(parentId) : null;
    if (parent && (parent.type !== 'text' || this.depth(parent) >= MAX_SECTION_DEPTH)) throw new SiProjectError(`A sub-section can only go in a Custom section, at most ${MAX_SECTION_DEPTH} levels deep.`);
    const id = newId('s');
    const folder = join(SECTIONS_DIR, `${id}_${slugify(name, SECTION_SLUG)}`);
    const data: Json = { id, type, name };
    if (type === 'file') Object.assign(data, { file: null, heading: '', caption: '' });
    if (type === 'data') Object.assign(data, { id_table: [], default_fields: cloneJson(DEFAULT_SECTION_FIELDS), compound_order: [] });
    // (as SI Assistant makes one, SPEC §13v: the CIF in "file", the view, the compound it shows, the captions and the crystal data table)
    if (type === 'xray') Object.assign(data, { file: null, block: '', view: {}, compound: '', anchored: false, caption: '', table: true, table_caption: '', table_values: {}, table_hidden: [] });
    const s: SiSection = { id, type, name, folder, data, items: [], children: [], parentId };
    await this.saveSection(s);
    if (type === 'text') { await this.folder.writeText(join(folder, TEXT_CONTENT_FILE), ''); }
    const list = parent ? parent.children : this.top;
    list.splice(index === undefined ? list.length : Math.max(0, Math.min(index, list.length)), 0, s);
    await this.saveSettings();
    return s;
  }

  /**
   * The Spectra section (SI Assistant's ensure_spectra_section): every project has one, where the
   * compounds' spectra print and their pages are set out. A project without one (made here, or
   * before SI Assistant had it) gets it at the end of its tree when it is opened for editing, its
   * settings started from the older ones in project.json ("spectra_per_page", "structure_corner",
   * then taken out) and `extra` (Chemweave's own starting values). Null when the project is
   * read-only or a section that couldn't be read may be it.
   */
  ensureSpectraSection(extra: Partial<SpectrumLayout> = {}): Promise<SiSection | null> {
    return this.exclusive(async () => {
      const have = this.sections.find((s) => s.type === 'spectra');
      if (have || this.readOnly) return have ?? null;
      if ([...this.skipped.values()].some((f) => f.split('/').length === 2 && f.startsWith(SECTIONS_DIR + '/'))) return null;
      const id = newId('s');
      const folder = join(SECTIONS_DIR, `${id}_${slugify(SPECTRA_NAME, SECTION_SLUG)}`);
      const data: Json = { id, type: 'spectra', name: SPECTRA_NAME, defaults: defaultsJson({ ...sectionDefaults(null, this.settings), ...extra }) };
      const s: SiSection = { id, type: 'spectra', name: SPECTRA_NAME, folder, data, items: [], children: [], parentId: null };
      await this.saveSection(s);
      this.top.push(s);
      delete this.settings.spectra_per_page;
      delete this.settings.structure_corner;
      await this.saveSettings();
      return s;
    });
  }

  /** Rename a section (its folder keeps its first name: renaming folders upsets sync programs). */
  async renameSection(id: string, name: string): Promise<void> {
    this.checkWritable();
    const s = this.section(id);
    if (!name.trim()) throw new SiProjectError('Please give the section a name.');
    s.name = name.trim();
    await this.saveSection(s);
  }

  /** Move a section to `index` among the sections of `parentId` (null: the top level). */
  moveSection(id: string, index: number, parentId: string | null): Promise<void> { return this.exclusive(() => this.moveSectionNow(id, index, parentId)); }

  private async moveSectionNow(id: string, index: number, parentId: string | null): Promise<void> {
    this.checkWritable();
    const s = this.section(id);
    const parent = parentId ? this.section(parentId) : null;
    if (parent) {
      if (parent.type !== 'text') throw new SiProjectError('Sections can only go inside a Custom section.');
      for (let p: SiSection | null = parent; p; p = this.parent(p)) if (p === s) throw new SiProjectError('A section cannot go inside itself.');
      const height = (x: SiSection): number => 1 + Math.max(0, ...x.children.map(height));
      if (this.depth(parent) + height(s) > MAX_SECTION_DEPTH) throw new SiProjectError(`Sections go at most ${MAX_SECTION_DEPTH} levels deep.`);
    }
    const from = s.parentId ? this.section(s.parentId).children : this.top;
    const at = from.indexOf(s);
    if (at < 0) throw new SiProjectError(`“${s.name}” can’t be moved from where it is (an X-ray structure under a compound is moved from its own page).`);
    from.splice(at, 1);
    const to = parent ? parent.children : this.top;
    if (to === from && index > at) index--;
    to.splice(Math.max(0, Math.min(index, to.length)), 0, s);
    s.parentId = parent?.id ?? null;
    await this.saveSettings();
  }

  /**
   * Move a section, with its sub-sections, to the project's Trash as one item, in the form SI
   * Assistant's Trash shows and restores (the Spectra section stays: it can't be deleted).
   */
  deleteSection(id: string): Promise<void> { return this.exclusive(() => this.deleteSectionNow(id)); }

  private async deleteSectionNow(id: string): Promise<void> {
    this.checkWritable();
    const s = this.section(id);
    const all = this.subtree(s);
    if (all.some((x) => x.type === 'spectra')) {
      throw new SiProjectError(s.type === 'spectra' ? 'The Spectra section can’t be deleted: it holds the compounds’ spectra pages. Leave it out of the compiled SI in Compile instead.' : `“${s.name}” holds the Spectra section, which can’t be deleted. Move the Spectra section out of it first.`);
    }
    const anchoredTo = s.type === 'xray' && s.data.anchored ? str(s.data.compound) : '';
    const list = anchoredTo ? (this.anchored.get(anchoredTo) ?? []) : s.parentId ? this.section(s.parentId).children : this.top;
    const index = list.indexOf(s);
    const tree = this.mergeTree(this.treeJson([s]), this.savedTree)[0] ?? { id: s.id };
    await this.moveToTrash(all.map((x) => x.folder), 'section', s.name, {
      section_id: s.id, type: s.type, original_index: index, parent_id: s.parentId ?? '', tree, subsections: all.length - 1,
      ...(anchoredTo ? { anchored_to: anchoredTo } : {}),
    });
    if (index >= 0) list.splice(index, 1);
    for (const x of all) { this.gone.add(x); for (const i of x.items) { this.gone.add(i); if (i.kind === 'scheme') for (const c of i.children) this.gone.add(c); } }
    if (anchoredTo && !list.length) this.anchored.delete(anchoredTo);
    await this.saveSettings();
    // X-ray structures under the compounds of a deleted Data section stay in the project, in the tree
    await this.freeAnchored(all.filter((x) => x.type === 'data').flatMap((x) => compoundsOf(x).map((c) => c.id)), null);
  }

  /**
   * X-ray structures under compounds that are going away: put in the tree (after `after`'s
   * top-level section, else at the end), not under a compound any more, as SI Assistant does.
   */
  private async freeAnchored(compoundIds: string[], after: SiSection | null): Promise<void> {
    const freed: SiSection[] = [];
    for (const cid of compoundIds) { freed.push(...(this.anchored.get(cid) ?? [])); this.anchored.delete(cid); }
    if (!freed.length) return;
    let top = after;
    while (top && top.parentId) top = this.parent(top);
    let index = top && this.top.includes(top) ? this.top.indexOf(top) + 1 : this.top.length;
    for (const x of freed) {
      x.data.anchored = false;
      x.parentId = null;
      this.top.splice(index++, 0, x);
      // (one that can't be saved now comes back into the tree at the next opening anyway)
      await this.saveSection(x).catch(() => {});
    }
    await this.saveSettings();
  }

  /** A section and the sections under it, the section first. */
  subtree(s: SiSection): SiSection[] { return [s, ...s.children.flatMap((c) => this.subtree(c))]; }

  /** Move a scheme page, with its compound pages, to the Trash as one item SI Assistant restores. */
  deleteScheme(id: string): Promise<void> { return this.exclusive(() => this.deleteSchemeNow(id)); }

  private async deleteSchemeNow(id: string): Promise<void> {
    this.checkWritable();
    const k = this.scheme(id);
    const s = this.section(k.sectionId);
    const index = s.items.indexOf(k);
    const folders = k.children.map((c) => c.folder);
    await this.moveToTrash([k.folder, ...folders], 'scheme', str(k.data.name) || 'Scheme', {
      scheme_id: k.id, section_id: s.id, section_name: s.name, original_index: index, children: folders.map(nameOf),
    });
    if (index >= 0) s.items.splice(index, 1);
    this.gone.add(k);
    for (const c of k.children) this.gone.add(c);
    await this.saveSection(s);
    await this.freeAnchored(k.children.map((c) => c.id), s);
  }

  /** The text of a Custom section. */
  readSectionText(s: SiSection): Promise<string> {
    return this.folder.readText(join(s.folder, TEXT_CONTENT_FILE)).then((t) => t ?? '');
  }
  async writeSectionText(s: SiSection, text: string): Promise<void> {
    this.checkWritable();
    await this.folder.writeText(join(s.folder, TEXT_CONTENT_FILE), text);
  }

  /** A table of a Custom section's text (tables/t-….json), null when it is missing or can't be read. */
  async readTable(s: SiSection, id: string): Promise<Json | null> {
    const got = await this.readJson(join(s.folder, 'tables', `${id}.json`));
    return got.ok && got.data && typeof got.data === 'object' && !Array.isArray(got.data) ? (got.data as Json) : null;
  }
  async writeTable(s: SiSection, table: Json): Promise<void> {
    this.checkWritable();
    await this.writeJson(join(s.folder, 'tables', `${String(table.id)}.json`), table);
  }

  /** A file of a section's (a picture in images/), or null. */
  readSectionFile(s: SiSection, rel: string): Promise<Uint8Array | null> {
    return this.folder.readBytes(join(s.folder, rel));
  }

  /**
   * Put a picture in a section's images/ folder under a name no picture there has, whatever its
   * extension (as SI Assistant names them), with its originals beside it under the same name
   * (`others`: extension → bytes, e.g. a drawing's CDXML); gives its path from the section's folder.
   */
  async addSectionPicture(s: SiSection, name: string, bytes: Uint8Array, others: Record<string, Uint8Array> = {}): Promise<string> {
    return this.addPictureIn(s.folder, name, bytes, others);
  }

  private async addPictureIn(folder: string, name: string, bytes: Uint8Array, others: Record<string, Uint8Array> = {}): Promise<string> {
    this.checkWritable();
    const s = { folder };
    const clean = safeFilename(name);
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean, ext = dot > 0 ? clean.slice(dot) : '';
    const taken = new Set((await this.folder.list(join(s.folder, 'images'), ['png', 'jpg', 'jpeg', 'svg', 'pdf', 'emf', 'tif', 'tiff', 'gif', 'bmp', 'cdxml', 'cdx'])).map((f) => {
      const n = f.slice(f.lastIndexOf('/') + 1);
      const d = n.lastIndexOf('.');
      return (d > 0 ? n.slice(0, d) : n).toLowerCase();
    }));
    let pick = stem;
    for (let n = 2; taken.has(pick.toLowerCase()); n++) pick = `${stem} (${n})`;
    await this.folder.writeBytes(join(s.folder, 'images', pick + ext), bytes);
    for (const [e, b] of Object.entries(others)) await this.folder.writeBytes(join(s.folder, 'images', `${pick}.${e}`), b);
    return `images/${pick}${ext}`;
  }

  // ---------------------------------------------------------------- texts with figures and tables
  // A text owner is a Custom section, or 'general' (General Information: its pictures and tables
  // in front/, its figures in front/front.json), as SI Assistant keeps them.

  /** The figures an owner has stored: {figure id: {file, label, width?}}. */
  async ownerFigures(owner: SiSection | 'general'): Promise<Json> {
    const data = owner === 'general' ? await this.frontData() : owner.data;
    return isObj(data.figures) ? data.figures : {};
  }

  private async frontData(): Promise<Json> {
    const got = await this.readJson('front/front.json');
    return got.ok && isObj(got.data) ? got.data : {};
  }

  /**
   * Store a picture as a new figure of a text (images/figure.png, under a name no picture there
   * has, with its vector original beside it when given); gives its id ("!figure{id}" in the text).
   */
  async addTextFigure(owner: SiSection | 'general', bytes: Uint8Array, ext: string, opts: { vector?: Uint8Array | null; vectorExt?: string; label?: string; width?: number | null; stem?: string } = {}): Promise<string> {
    this.checkWritable();
    const folder = owner === 'general' ? 'front' : owner.folder;
    const others: Record<string, Uint8Array> = {};
    const vext = (opts.vectorExt ?? '').toLowerCase().replace(/^\./, '');
    if (opts.vector && ['emf', 'pdf', 'cdxml', 'cdx'].includes(vext)) others[vext] = opts.vector;
    const rel = await this.addPictureIn(folder, (opts.stem || 'figure') + (ext.startsWith('.') ? ext : `.${ext}`), bytes, others);
    const id = newId('f');
    const entry: Json = { file: rel, label: (opts.label ?? '').trim() };
    if (opts.width) { entry.width = Math.round(opts.width * 100) / 100; markFloat(entry, 'width'); }
    if (owner === 'general') {
      const data = await this.frontData();
      const figs = isObj(data.figures) ? data.figures : (data.figures = {});
      figs[id] = entry;
      await this.writeJson('front/front.json', data);
    } else {
      const figs = isObj(owner.data.figures) ? owner.data.figures : (owner.data.figures = {});
      figs[id] = entry;
      await this.saveSection(owner);
    }
    return id;
  }

  /** Store a table of a text (tables/<id>.json); gives its id ("!table{id}" in the text). */
  async addTextTable(owner: SiSection | 'general', table: Json): Promise<string> {
    this.checkWritable();
    const id = str(table.id) || newId('t');
    const folder = owner === 'general' ? 'front' : owner.folder;
    await this.writeJson(join(folder, 'tables', `${safeFilename(id)}.json`), { ...table, id });
    return id;
  }

  /** Several fields added to a compound at once (those it has are left), saved once. */
  async addFields(c: SiCompound, entries: FieldEntry[]): Promise<void> {
    this.checkWritable();
    for (const e of entries) this.addFieldEntry(c, e);
    await this.saveCompound(c);
  }

  async setIdTable(sectionId: string, ids: string[]): Promise<void> {
    this.checkWritable();
    const s = this.dataSection(sectionId);
    s.data.id_table = ids.map((i) => String(i).trim());
    await this.saveSection(s);
  }

  async setDefaultFields(sectionId: string, entries: FieldEntry[]): Promise<void> {
    this.checkWritable();
    const s = this.dataSection(sectionId);
    s.data.default_fields = cloneJson(entries);
    await this.saveSection(s);
  }

  /** The general procedures of a Data section: {id, name, title, sentence}. */
  generalProcedures(s: SiSection): Json[] {
    if (!Array.isArray(s.data.general_procedures)) return [];
    return (s.data.general_procedures as unknown[]).filter(isObj);
  }
  generalProcedure(gpId: string): { section: SiSection; gp: Json } | null {
    for (const s of this.dataSections) for (const gp of this.generalProcedures(s)) if (gp.id === gpId) return { section: s, gp };
    return null;
  }
  /** The general procedure a compound was made by (null: none, or it has no Procedure field). */
  compoundGp(c: SiCompound): Json | null {
    const v = valuesOf(c).procedure;
    const id = isObj(v) ? str(v.gp) : '';
    if (!id || !fieldKeys(c).includes('procedure')) return null;
    return this.generalProcedure(id)?.gp ?? null;
  }
  async readGpText(s: SiSection, gpId: string): Promise<string> {
    return (await this.folder.readText(join(s.folder, GP_DIR, `${safeFilename(gpId)}.txt`))) ?? '';
  }

  /** Add a general procedure to a Data section, named after the first free letter ("General Procedure C"). */
  async addGeneralProcedure(sectionId: string): Promise<Json> {
    this.checkWritable();
    const s = this.dataSection(sectionId);
    const used = new Set(this.dataSections.flatMap((x) => this.generalProcedures(x).map((g) => str(g.name))));
    const marks = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...Array.from({ length: 998 }, (_, i) => String(i + 1))];
    const name = `General Procedure ${marks.find((m) => !used.has(`General Procedure ${m}`))}`;
    const gp: Json = { id: newId('gp'), name, title: '', sentence: DEFAULT_GP_SENTENCE };
    if (!Array.isArray(s.data.general_procedures)) s.data.general_procedures = [];
    (s.data.general_procedures as Json[]).push(gp);
    await this.saveSection(s);
    return gp;
  }

  /** Change a general procedure's name, title or compound sentence. */
  async updateGeneralProcedure(gpId: string, changes: { name?: string; title?: string; sentence?: string }): Promise<void> {
    this.checkWritable();
    const found = this.generalProcedure(gpId);
    if (!found) return;
    for (const k of ['name', 'title', 'sentence'] as const) if (changes[k] !== undefined) found.gp[k] = changes[k];
    await this.saveSection(found.section);
  }

  /** Move a general procedure up (-1) or down (+1) in its section's list (the order they print in). */
  async moveGeneralProcedure(gpId: string, step: number): Promise<void> {
    this.checkWritable();
    const found = this.generalProcedure(gpId);
    if (!found) return;
    const list = found.section.data.general_procedures as Json[];
    const i = list.indexOf(found.gp), j = Math.max(0, Math.min(list.length - 1, i + step));
    list.splice(j, 0, ...list.splice(i, 1));
    await this.saveSection(found.section);
  }

  async writeGpText(gpId: string, text: string): Promise<void> {
    this.checkWritable();
    const found = this.generalProcedure(gpId);
    if (!found) return;
    await this.folder.writeText(join(found.section.folder, GP_DIR, `${safeFilename(gpId)}.txt`), text);
  }

  /** The compounds made by a general procedure (they keep the choice when it is deleted, with a warning). */
  gpUsers(gpId: string): SiCompound[] {
    return this.compounds.filter((c) => { const v = valuesOf(c).procedure; return isObj(v) && v.gp === gpId; });
  }

  /** Move a general procedure (its text) to the Trash, where SI Assistant can restore it. */
  async deleteGeneralProcedure(gpId: string): Promise<void> {
    this.checkWritable();
    const found = this.generalProcedure(gpId);
    if (!found) return;
    const { section: s, gp } = found;
    const path = join(s.folder, GP_DIR, `${safeFilename(gpId)}.txt`);
    if (!(await this.folder.exists(path))) await this.folder.writeText(path, '');
    const list = s.data.general_procedures as Json[];
    await this.moveToTrash([path], 'gp', str(gp.name) || 'General procedure', { section_id: s.id, section_name: s.name, gp: cloneJson(gp), index: list.indexOf(gp) });
    list.splice(list.indexOf(gp), 1);
    await this.saveSection(s);
  }

  /**
   * Take a figure or table out of a Custom section: its paragraph leaves the text, and its picture
   * (with the drawing or metafile it was made from) or its table's file goes to the Trash, as SI
   * Assistant's Trash shows and restores them.
   */
  async deleteTextObject(s: SiSection, kind: 'figure' | 'table', id: string): Promise<void> {
    this.checkWritable();
    const text = await this.readSectionText(s);
    const lines = text.split('\n');
    const mark = `!${kind}{${id}}`;
    const at = lines.findIndex((l) => l.replace(/^!align\{[^}]*\}\s*/, '').startsWith(mark));
    const line = at >= 0 ? lines[at] : '';
    const align = /^!align\{([^}]*)\}/.exec(line)?.[1] ?? '';
    const caption = line.replace(/^!align\{[^}]*\}\s*/, '').slice(mark.length).trim();
    const figs = isObj(s.data.figures) ? s.data.figures : {};
    const fig = kind === 'figure' && isObj(figs[id]) ? (figs[id] as Json) : {};
    const file = kind === 'figure' ? str(fig.file) : `tables/${safeFilename(id)}.json`;
    if (file && (await this.folder.exists(join(s.folder, file)))) {
      const main = join(s.folder, file);
      const stem = main.replace(/\.[^./]+$/, '');
      const companions = kind === 'figure' && stem !== main ? [`${stem}.cdxml`, `${stem}.emf`].filter((x) => x !== main) : [];
      const plain = parseMarkup(caption).map((p) => p.runs.map((r) => r.text).join('')).join(' ').trim();
      await this.moveToTrash([main, ...companions], kind, `${kind === 'figure' ? 'Figure' : 'Table'}: ${plain.slice(0, 40) || nameOf(file)} (${s.name})`, {
        owner: s.id, owner_name: s.name, object_id: id, caption, label: str(fig.label),
        ...(align ? { align } : {}), ...(fig.width ? { width: fig.width } : {}),
      });
    }
    if (at >= 0) { lines.splice(at, 1); await this.writeSectionText(s, lines.join('\n')); }
    if (kind === 'figure' && id in figs) { delete figs[id]; await this.saveSection(s); }
  }

  /**
   * A file for a section of its own (an X-ray structure's CIF): copied into the section's folder,
   * the one it replaces going to the Trash first. An X-ray structure starts again from the best
   * view of the new file's first structure, without values typed for the old one.
   */
  async attachSectionFile(s: SiSection, name: string, bytes: Uint8Array): Promise<string> {
    this.checkWritable();
    const old = str(s.data.file);
    const passing = join(s.folder, `.incoming-${newId('t').slice(2)}`);
    await this.folder.writeBytes(passing, bytes);
    try {
      if (old) await this.moveToTrash([join(s.folder, old)], 'file', nameOf(old), { section_id: s.id, section_name: s.name });
    } catch (e) {
      await this.setAside(passing).catch(() => {});
      throw e;
    }
    const clean = safeFilename(name) || 'structure.cif';
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean, ext = dot > 0 ? clean.slice(dot) : '';
    let pick = clean;
    for (let n = 2; await this.folder.exists(join(s.folder, pick)); n++) pick = `${stem} (${n})${ext}`;
    await this.folder.move(passing, join(s.folder, pick));
    s.data.file = pick;
    if (s.type === 'xray') Object.assign(s.data, { block: '', view: {}, table_values: {} });
    await this.saveSection(s);
    return pick;
  }

  /**
   * Move files into one new Trash entry (trash/<when>-<id>/), the first the item and the rest its
   * companions, all or nothing: the entry is described first (marked pending), and anything
   * already moved is put back when one can't be.
   */
  private async moveToTrash(paths: string[], kind: string, name: string, extra: Json): Promise<void> {
    const present: string[] = [];
    for (const x of paths) if (await this.folder.exists(x)) present.push(x);
    if (!present.length) return;
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-`;
    const entry = join(TRASH_DIR, stamp + newId('t').slice(2));
    const info: Json = { kind, name, item: nameOf(present[0]), deleted_at: localIso(now), deleted_by: this.lock?.user ?? '', ...extra };
    if (present.length > 1) info.companions = present.slice(1).map(nameOf);
    await this.writeJson(join(entry, 'entry.json'), { ...info, pending: true });
    const done: [string, string][] = [];
    try {
      for (const x of present) { const to = join(entry, nameOf(x)); await this.folder.move(x, to); done.push([x, to]); }
    } catch (e) {
      for (const [from, to] of done.reverse()) await this.folder.move(to, from).catch(() => {});
      await this.dropEntry(entry);
      throw new SiProjectError(`“${name}” could not be moved to the Trash, so nothing was deleted. A file in it is probably open in another program or being synced: close it and try again. (${e instanceof Error ? e.message : String(e)})`);
    }
    await this.writeJson(join(entry, 'entry.json'), info);
  }

  /** A Trash entry that was begun and holds nothing but its description (the deletion failed) goes again. */
  private async dropEntry(entry: string): Promise<void> {
    try {
      const inside = await this.folder.entries(entry);
      if (inside.every((e) => e.name === 'entry.json')) await this.folder.removeTrash(entry);
    } catch { /* (it shows in the Trash as a deletion that did not finish) */ }
  }

  private dataSection(id: string): SiSection {
    const s = this.section(id);
    if (s.type !== 'data') throw new SiProjectError(`“${s.name}” is not a Data section.`);
    return s;
  }

  // ---------------------------------------------------------------- compounds

  private defaultNmrReports(): Json[] {
    return DEFAULT_NMR_NUCLEI.map((nucleus) => ({ id: newId('r'), nucleus, label: '', text: '' }));
  }

  /** Add a field to a compound (no save). Adding back a field taken off brings back its value. */
  private addFieldEntry(c: SiCompound, entry: FieldEntry): void {
    const def = fieldDef(entry);
    if (!def || fieldKeys(c).includes(def.key)) return;
    const e: FieldEntry = { key: def.key };
    if (def.custom) e.custom = { ...def.custom };
    const fields = fieldsOf(c);
    // the reaction scheme always first; notes always last
    const pos = def.key === 'scheme' ? 0 : fields.length && fields[fields.length - 1].key === 'notes' ? fields.length - 1 : fields.length;
    fields.splice(pos, 0, e);
    const values = valuesOf(c);
    if (!(def.key in values)) {
      if (def.kind === 'nmr') values[def.key] = this.defaultNmrReports();
      else {
        const empty = emptyValue(def);
        if (empty !== null) values[def.key] = empty;
      }
    }
    if (!fieldKeys(c).includes('notes')) fields.push({ key: 'notes' });
  }

  /** A new compound page in a Data section, at `index` (the end when not given). */
  addCompound(sectionId: string, index?: number, name = ''): Promise<SiCompound> { return this.exclusive(() => this.addCompoundNow(sectionId, index, name)); }

  private async addCompoundNow(sectionId: string, index?: number, name = ''): Promise<SiCompound> {
    this.checkWritable();
    const s = this.dataSection(sectionId);
    const id = newId('c');
    const folder = join(s.folder, COMPOUNDS_DIR, `${id}_${slugify(name || 'compound', ITEM_SLUG)}`);
    const c: SiCompound = { kind: 'compound', id, folder, data: { id, id_override: '', fields: [], values: {}, flags: {} }, sectionId: s.id, schemeId: null };
    for (const e of defaultFieldsOf(s)) this.addFieldEntry(c, e);
    if (name) valuesOf(c).name = { text: name };
    await this.saveCompound(c);
    s.items.splice(index === undefined ? s.items.length : Math.max(0, Math.min(index, s.items.length)), 0, c);
    await this.saveSection(s);
    return c;
  }

  /** The ID table's entries no compound has yet (one blank page each makes them). */
  idsWithoutPages(s: SiSection): string[] {
    const t = idTableOf(s).map((v) => v.trim());
    while (t.length && !t[t.length - 1]) t.pop();
    return t.slice(compoundsOf(s).length);
  }

  async addField(c: SiCompound, entry: FieldEntry): Promise<void> {
    this.checkWritable();
    this.addFieldEntry(c, entry);
    await this.saveCompound(c);
  }

  /** Take a field off a compound page (its value is kept, so adding it back brings it back). */
  async removeField(c: SiCompound, key: string): Promise<void> {
    this.checkWritable();
    const def = fieldDef({ key });
    if (def && def.removable === false) throw new SiProjectError(`The ${def.label} field can't be removed.`);
    c.data.fields = fieldsOf(c).filter((e) => e.key !== key);
    await this.saveCompound(c);
  }

  /** Give every compound of the section the section's fields, in its order (others kept after them). */
  async applyDefaultFields(sectionId: string, removeOthers = false): Promise<number> {
    this.checkWritable();
    const s = this.dataSection(sectionId);
    const keys = defaultFieldsOf(s).map((e) => e.key);
    let changed = 0;
    for (const c of compoundsOf(s)) {
      const before = JSON.stringify(fieldsOf(c));
      for (const e of defaultFieldsOf(s)) if (!fieldKeys(c).includes(e.key)) this.addFieldEntry(c, e);
      const by = new Map(fieldsOf(c).map((e) => [e.key, e]));
      const extra = fieldsOf(c).filter((e) => !keys.includes(e.key) && e.key !== 'notes');
      const next = keys.filter((k) => by.has(k)).map((k) => by.get(k)!);
      if (!removeOthers) next.push(...extra);
      if (by.has('notes')) next.push(by.get('notes')!);
      c.data.fields = next;
      if (JSON.stringify(next) !== before) { await this.saveCompound(c); changed++; }
    }
    return changed;
  }

  /** Set a field's stored value (a parts field's {part: text}, the NMR reports…) and save. */
  async setValue(c: SiCompound, key: string, value: unknown): Promise<void> {
    this.checkWritable();
    // (where a name came from PubChem is kept only while it is the name, as SI Assistant keeps it)
    if (key === 'name' && isObj(value) && isObj(value.from_pubchem) && value.from_pubchem.name !== value.text) delete value.from_pubchem;
    valuesOf(c)[key] = value;
    await this.saveCompound(c);
  }

  /** Change one part of a parts field ("yield" ▸ "percent") and save. */
  async setPart(c: SiCompound, key: string, part: string, text: string, before: readonly string[] = []): Promise<void> {
    this.checkWritable();
    this.checkThere(c, compoundName(c) || 'This compound');
    const values = valuesOf(c);
    let v = isObj(values[key]) ? (values[key] as Json) : (values[key] = {});
    // (a new part goes before `before`'s keys, where SI Assistant writes it, so the files stay alike)
    if (!(part in v) && before.some((b) => b in v)) {
      const out: Json = {};
      for (const [k, x] of Object.entries(v)) { if (before.includes(k) && !(part in out)) out[part] = text; out[k] = x; }
      v = values[key] = out;
    }
    v[part] = text;
    await this.setValue(c, key, v);
  }

  /** A compound's Manual ID ('' for the ID from the section's table). */
  async setIdOverride(c: SiCompound, id: string): Promise<void> {
    this.checkWritable();
    c.data.id_override = id.trim();
    await this.saveCompound(c);
  }

  /** Flag a field for checking (a comment the person writes), or take the flag off (Delete: its replies go too). */
  async setFlag(c: SiCompound, key: string, flagged: boolean, comment = ''): Promise<void> {
    this.checkWritable();
    const flags = flagsOf(c);
    const anchor = compoundAnchor(c.id, key);
    if (flagged && !(key in flags) && this.flagFile.threads[anchor]) {
      // (a new flag on a field whose last one was resolved: that one, with its replies, is kept as a
      // resolved note on the field; replies left from a flag taken off elsewhere go)
      const was = this.flagFile.threads[anchor];
      await this.changeFlagFile((f) => { if (was.resolved) f.threads[noteAnchor(c.id, key, newFlagId())] = was; delete f.threads[anchor]; });
    }
    if (flagged) {
      const old = isObj(flags[key]) ? flags[key] : {};
      flags[key] = { comment, by: str(old.by) || this.lock?.user || '', at: str(old.at) || localIso(new Date()) };
    } else delete flags[key];
    await this.saveCompound(c);
    if (!flagged && this.flagFile.threads[anchor]) await this.changeFlagFile((f) => { delete f.threads[anchor]; });
  }

  // -------------------------------------------------------------- flag threads (flag-threads.ts)

  /** Who can be @mentioned: the authors, everyone who flagged or replied, and whoever has the project open. */
  get people(): string[] {
    const out = new Set<string>();
    for (const a of Array.isArray(this.settings.authors) ? this.settings.authors : []) if (isObj(a) && str(a.name).trim()) out.add(str(a.name).trim());
    for (const f of this.allFlags()) { if (f.flag.by) out.add(f.flag.by); for (const r of f.thread.replies) if (r.by) out.add(r.by); if (f.thread.resolved?.by) out.add(f.thread.resolved.by); }
    if (this.lock?.user) out.add(this.lock.user);
    return [...out];
  }

  /**
   * Every flag and comment, open or resolved, in the tree's order: on sections' headings, then on
   * their compounds' fields. `isFlag` false: a comment only.
   */
  allFlags(): FlagEntry[] {
    // (kept for the rest of this task: a page's every field button asks)
    if (this.flagsNow) return this.flagsNow;
    const out = this.listFlags();
    this.flagsNow = out;
    queueMicrotask(() => { this.flagsNow = null; });
    return out;
  }
  private flagsNow: FlagEntry[] | null = null;
  private byPlace: { all: FlagEntry[]; map: Map<string, FlagEntry[]> } | null = null;
  /** (a flag or compound changed: the flags are listed again) */
  private flagsChanged(): void { this.flagsNow = null; }

  /** The open flags and comments of each compound's field ("<compound id>/<field>"), and of each section's heading ("s:<section id>"). */
  openFlagsByPlace(): Map<string, FlagEntry[]> {
    const all = this.allFlags();
    if (this.byPlace?.all === all) return this.byPlace.map;
    const out = new Map<string, FlagEntry[]>();
    this.byPlace = { all, map: out };
    for (const x of all) {
      if (x.resolved) continue;
      const at = parseAnchor(x.anchor);
      if (!at) continue;
      const k = at.kind === 'section' ? `s:${at.id}` : `${at.id}/${at.field}`;
      out.set(k, [...(out.get(k) ?? []), x]);
    }
    return out;
  }

  private listFlags(): FlagEntry[] {
    const out: FlagEntry[] = [];
    const seen = new Set<string>();
    const add = (anchor: string, open: FlagRecord | null): void => {
      if (seen.has(anchor)) return;
      const thread = this.flagFile.threads[anchor] ?? { replies: [] };
      const flag = open ?? thread.resolved?.flag;
      if (!flag) return;
      seen.add(anchor);
      out.push({ anchor, flag, resolved: !open, isFlag: flag.flag !== false, thread });
    };
    // (the side file's anchors by their section's or compound's id, gathered once)
    const kept = new Map<string, string[]>();
    for (const a of new Set([...Object.keys(this.flagFile.notes), ...Object.keys(this.flagFile.threads)])) {
      const at = parseAnchor(a);
      if (!at) continue;
      const k = `${at.kind === 'section' ? 's' : 'c'}:${at.id}`;
      kept.set(k, [...(kept.get(k) ?? []), a]);
    }
    const walk = (list: SiSection[]): void => {
      for (const s of list) {
        for (const a of kept.get(`s:${s.id}`) ?? []) add(a, this.flagFile.notes[a] ?? null);
        for (const c of s.type === 'data' ? compoundsOf(s) : []) {
          for (const [key, f] of Object.entries(isObj(c.data.flags) ? c.data.flags : {})) { const r = flagRecord(f); if (r) add(compoundAnchor(c.id, key), r); }
          for (const a of kept.get(`c:${c.id}`) ?? []) add(a, this.flagFile.notes[a] ?? null);
        }
        walk(s.children);
      }
    };
    walk(this.top);
    return out;
  }

  /** The flag or comment at `anchor` while open (null: resolved, or none). */
  openFlag(anchor: string): FlagRecord | null {
    const at = parseAnchor(anchor);
    if (!at) return null;
    if (at.kind !== 'compound') return this.flagFile.notes[anchor] ?? null;
    const c = this.compoundById(at.id);
    const r = c && isObj(c.data.flags) ? flagRecord(c.data.flags[at.field]) : null;
    return r ? { comment: r.comment, by: r.by, at: r.at } : null;
  }

  /**
   * A comment left in the Live Preview, on a compound's field (`field`) or a section's heading:
   * a flag (`flag`) or a comment only. A flag on a compound's field with none yet is SI
   * Assistant's own flag; anything else is kept in Chemweave's file. Its anchor.
   */
  async addFlagNote(on: { compound: string; field: string } | { section: string }, comment: string, flag: boolean): Promise<string> {
    this.checkWritable();
    const rec: FlagRecord = { comment, by: this.lock?.user || '', at: localIso(new Date()), ...(flag ? {} : { flag: false as const }) };
    if ('compound' in on) {
      const c = this.compound(on.compound);
      const flags = flagsOf(c);
      if (flag && !(on.field in flags)) { await this.setFlag(c, on.field, true, comment); return compoundAnchor(c.id, on.field); }
      const anchor = noteAnchor(c.id, on.field, newFlagId());
      await this.changeFlagFile((f) => { f.notes[anchor] = rec; });
      return anchor;
    }
    this.section(on.section);
    const anchor = sectionAnchor(on.section, newFlagId());
    await this.changeFlagFile((f) => { f.notes[anchor] = rec; });
    return anchor;
  }

  /** Reply to a flag (it may mention people with @Name). */
  async replyToFlag(anchor: string, text: string): Promise<void> {
    this.checkWritable();
    if (!text.trim()) return;
    await this.changeFlagFile((f) => { threadOf(f, anchor).replies.push({ text: text.trim(), by: this.lock?.user || '', at: localIso(new Date()) }); });
  }

  /** Change a reply's text (`reply` its place), or the flag's own (`reply` null). */
  async editFlagNote(anchor: string, reply: number | null, text: string): Promise<void> {
    this.checkWritable();
    if (reply !== null) { await this.changeFlagFile((f) => { const r = f.threads[anchor]?.replies[reply]; if (r) r.text = text; }); return; }
    const at = parseAnchor(anchor);
    if (!at) return;
    if (at.kind === 'compound') {
      const c = this.compoundById(at.id);
      const open = c && isObj(c.data.flags) && isObj(c.data.flags[at.field]) ? (c.data.flags[at.field] as Json) : null;
      if (c && open) { open.comment = text; await this.saveCompound(c); return; }
    }
    await this.changeFlagFile((f) => { const r = f.notes[anchor] ?? f.threads[anchor]?.resolved?.flag; if (r) r.comment = text; });
  }

  async removeFlagReply(anchor: string, reply: number): Promise<void> {
    this.checkWritable();
    await this.changeFlagFile((f) => { f.threads[anchor]?.replies.splice(reply, 1); });
  }

  /**
   * Resolve a flag (done) or reopen it. SI Assistant's flag leaves compound.json while resolved,
   * so SI Assistant's warnings clear too; the record stays in chemweave-flags.json.
   */
  async resolveFlag(anchor: string, done: boolean): Promise<void> {
    this.checkWritable();
    const at = parseAnchor(anchor);
    if (!at) return;
    this.flagFileToChange();
    const stamp = (): { by: string; at: string } => ({ by: this.lock?.user || '', at: localIso(new Date()) });
    if (done) {
      const open = this.openFlag(anchor);
      if (!open) return;
      if (at.kind === 'compound') {
        const c = this.compoundById(at.id)!;
        // (the flag file first: a failed write leaves the flag open, never lost)
        await this.changeFlagFile((f) => { threadOf(f, anchor).resolved = { ...stamp(), flag: open }; });
        delete flagsOf(c)[at.field];
        await this.saveCompound(c);
      } else await this.changeFlagFile((f) => { threadOf(f, anchor).resolved = { ...stamp(), flag: open }; delete f.notes[anchor]; });
      return;
    }
    const was = this.flagFile.threads[anchor]?.resolved;
    if (!was) return;
    if (at.kind === 'compound') {
      const c = this.compoundById(at.id);
      if (!c) throw new SiProjectError('Its compound is gone, so the flag can’t be reopened.');
      flagsOf(c)[at.field] = { comment: was.flag.comment, by: was.flag.by, at: was.flag.at };
      await this.saveCompound(c);
      await this.changeFlagFile((f) => { delete threadOf(f, anchor).resolved; });
    } else {
      if (at.kind === 'section') this.section(at.id); else this.compound(at.id);
      await this.changeFlagFile((f) => { f.notes[anchor] = { ...was.flag }; delete threadOf(f, anchor).resolved; });
    }
  }

  /** Delete a flag or comment, open or resolved, with its replies. */
  async deleteFlag(anchor: string): Promise<void> {
    this.checkWritable();
    const at = parseAnchor(anchor);
    if (!at) return;
    if (at.kind === 'compound') {
      const c = this.compoundById(at.id);
      if (c && isObj(c.data.flags) && at.field in c.data.flags) { delete flagsOf(c)[at.field]; await this.saveCompound(c); }
      if (this.flagFile.threads[anchor]) await this.changeFlagFile((f) => { delete f.threads[anchor]; });
      return;
    }
    await this.changeFlagFile((f) => { delete f.threads[anchor]; delete f.notes[anchor]; });
  }

  private flagFileToChange(): FlagFile {
    if (this.flagFileUnread) throw new SiProjectError(`${FLAGS_FILE} in the project folder can’t be read (half synced, or changed by hand), so it wasn’t saved over. Fix or remove it, then try again.`);
    return this.flagFile;
  }

  /** Change chemweave-flags.json: on a copy, kept only once written. */
  private async changeFlagFile(f: (file: FlagFile) => void): Promise<void> {
    const next = JSON.parse(JSON.stringify(this.flagFileToChange())) as FlagFile;
    f(next);
    await this.folder.writeText(FLAGS_FILE, flagFileJson(next));
    this.flagFile = next;
    this.flagsChanged();
  }

  /** Hide an automatic warning for this compound (SI Assistant's SPEC §8): it comes back when the data it was about changes (its fingerprint no longer matches). */
  async dismissWarning(c: SiCompound, warning: { key: string; fingerprint: string; message: string }, reason = ''): Promise<void> {
    this.checkWritable();
    const before = cloneJson(c.data.dismissed);
    if (!isObj(c.data.dismissed)) c.data.dismissed = {};
    (c.data.dismissed as Json)[warning.key] = { fingerprint: warning.fingerprint, message: warning.message, reason: reason.trim(), by: this.lock?.user || '', at: localIso(new Date()) };
    await this.saveDismissed(c, before);
  }

  /** Show a dismissed warning again. */
  async restoreWarning(c: SiCompound, key: string): Promise<void> {
    this.checkWritable();
    const before = cloneJson(c.data.dismissed);
    const d = c.data.dismissed;
    if (!isObj(d) || !(key in d)) return;
    delete d[key];
    await this.saveDismissed(c, before);
  }

  /** Save a dismissal or restore; if it can't be saved, the compound in memory goes back as it was, to match its file. */
  private async saveDismissed(c: SiCompound, before: unknown): Promise<void> {
    try {
      await this.saveCompound(c);
    } catch (e) {
      if (before === undefined) delete c.data.dismissed; else c.data.dismissed = before as Json;
      throw e;
    }
  }

  /** The file a compound's text field (procedure, notes…) is kept in. */
  textPath(c: SiCompound, key: string): string {
    return join(c.folder, key === 'notes' ? NOTES_FILE : `${safeFilename(key)}.txt`);
  }
  /** A compound's text field, as stored (markup.ts). */
  compoundText(c: SiCompound, key: string): string {
    return this.texts.get(this.textPath(c, key)) ?? '';
  }
  async writeCompoundText(c: SiCompound, key: string, text: string): Promise<void> {
    this.checkWritable();
    this.checkThere(c, compoundName(c) || 'This compound');
    const path = this.textPath(c, key);
    if (!text && !this.present.has(path)) return;
    await this.folder.writeText(path, text);
    this.texts.set(path, text);
    this.present.add(path);
  }

  /** The structure's molfile ('' when there is none). */
  async readStructure(c: SiCompound): Promise<string> {
    return (await this.folder.readText(join(c.folder, STRUCTURE_FILE))) ?? '';
  }
  hasStructure(c: SiCompound): boolean { return this.present.has(join(c.folder, STRUCTURE_FILE)); }

  /** Store a structure drawn here (a V2000 molfile). A ChemDraw picture pasted with an earlier structure no longer matches it, so it stops being used. */
  async setStructure(c: SiCompound, molblock: string): Promise<void> {
    this.checkWritable();
    this.checkThere(c, compoundName(c) || 'This compound');
    const values = valuesOf(c);
    const old = isObj(values.structure) ? (values.structure as Json) : {};
    if (old.image_override && old.image_source === 'chemdraw') { old.image_override = ''; old.image_source = ''; }
    await this.folder.writeText(join(c.folder, STRUCTURE_FILE), molblock.endsWith('\n') ? molblock : molblock + '\n');
    this.present.add(join(c.folder, STRUCTURE_FILE));
    // (the same object, so the numbers in it are written as they were read)
    old.from_scheme = false;
    values.structure = old;
    await this.saveCompound(c);
  }

  /** Copy a file into the compound's folder (spectra/ or files/), under a name no file there has; gives the name used. */
  async addAttachment(c: SiCompound, subdir: string, name: string, bytes: Uint8Array): Promise<string> {
    this.checkWritable();
    this.checkThere(c, compoundName(c) || 'This compound');
    const clean = safeFilename(name);
    const dot = clean.lastIndexOf('.');
    const stem = dot > 0 ? clean.slice(0, dot) : clean, ext = dot > 0 ? clean.slice(dot) : '';
    let pick = clean;
    for (let n = 2; await this.folder.exists(join(c.folder, subdir, pick)); n++) pick = `${stem} (${n})${ext}`;
    await this.folder.writeBytes(join(c.folder, subdir, pick), bytes);
    return pick;
  }

  /** The path of a compound's attached file (a spectrum, an additional file). */
  attachmentPath(c: SiCompound, def: FieldDef, file: string): string { return join(c.folder, def.subdir || 'files', file); }

  /**
   * Take a file off a compound's Spectra or Additional files: the file (and a pasted one's
   * original beside it) goes to the Trash with the values it had, as SI Assistant restores it.
   */
  async removeAttachment(c: SiCompound, def: FieldDef, file: string): Promise<void> {
    this.checkWritable();
    const items = valuesOf(c)[def.key];
    if (!Array.isArray(items)) return;
    const item = (items as Json[]).find((i) => isObj(i) && i.file === file);
    if (!item) return;
    const path = this.attachmentPath(c, def, file);
    // The original kept for this file is the one its entry names. An entry that names none (an older
    // one) has the .cdxml or .emf of its own stem, unless that file is another entry's file or original:
    // "1H.pdf" never takes "1H.emf", the original of "1H.svg", to the Trash with it.
    const original = str(item.original);
    let originals: string[];
    if (original) originals = original !== file ? [this.attachmentPath(c, def, original)].filter((x) => x !== path) : [];
    else {
      const used = new Set<string>();
      for (const v of Object.values(valuesOf(c))) {
        if (!Array.isArray(v)) continue;
        for (const other of v as unknown[]) if (isObj(other) && other !== item) { used.add(str(other.file).toLowerCase()); used.add(str(other.original).toLowerCase()); }
      }
      const stem = file.replace(/\.[^./]+$/, '');
      originals = stem !== file ? [`${stem}.cdxml`, `${stem}.emf`].filter((x) => x !== file && !used.has(x.toLowerCase())).map((x) => this.attachmentPath(c, def, x)) : [];
    }
    await this.moveToTrash([path, ...originals], 'compound_file', file, { compound_id: c.id, field_key: def.key, item: nameOf(path), item_values: cloneJson(item), compound_name: compoundName(c) });
    (items as Json[]).splice((items as Json[]).indexOf(item), 1);
    await this.saveCompound(c);
  }

  // ---- Store additional files and folders: in the compound's private/ folder, listed in private_files (never printed)

  /** Copy a file into the compound's private/ folder and list it (as SI Assistant does: file, kind, note); gives the name used. */
  async addPrivateFile(c: SiCompound, name: string, bytes: Uint8Array): Promise<string> {
    const pick = await this.addAttachment(c, PRIVATE_DIR, name, bytes);
    const values = valuesOf(c);
    const items = Array.isArray(values.private_files) ? (values.private_files as Json[]) : (values.private_files = []) as Json[];
    items.push({ file: pick, kind: 'file', note: '' });
    await this.saveCompound(c);
    return pick;
  }

  /** A stored file's (or folder's) note. */
  async setPrivateNote(c: SiCompound, name: string, note: string): Promise<void> {
    this.checkWritable();
    const items = valuesOf(c).private_files;
    const item = Array.isArray(items) ? (items as Json[]).find((i) => isObj(i) && i.file === name) : undefined;
    if (!item || str(item.note) === note) return;
    item.note = note;
    await this.saveCompound(c);
  }

  /** Move a stored file or folder to the Trash and take it off the list. */
  async removePrivateItem(c: SiCompound, name: string): Promise<void> {
    this.checkWritable();
    const items = valuesOf(c).private_files;
    if (!Array.isArray(items)) return;
    // (a plain name only: a hand-edited "../structure.mol" never leaves private/)
    const item = (items as Json[]).find((i) => isObj(i) && i.file === name && /^[^/\\]+$/.test(name) && !/^\.\.?$/.test(name));
    if (!item) return;
    const path = join(c.folder, PRIVATE_DIR, name);
    if (await this.folder.exists(path)) await this.moveToTrash([path], 'compound_file', name, { compound_id: c.id, field_key: 'private_files', item: name, item_values: cloneJson(item), compound_name: compoundName(c) });
    (items as Json[]).splice((items as Json[]).indexOf(item), 1);
    await this.saveCompound(c);
  }

  // ---- HRMS report files (§13n.3): in the compound's hrms/ folder, listed in hrms.reports

  /** The HRMS field's value, made when there is none (a hand-edited one that isn't an object too). */
  hrmsValue(c: SiCompound): Json {
    const values = valuesOf(c);
    if (!isObj(values.hrms)) values.hrms = (emptyValue(fieldDef({ key: 'hrms' })!) as Json | null) ?? {};
    return values.hrms as Json;
  }

  /** Copy an instrument's report file into hrms/ and list it (not saved: `then` may fill Found first, in the same save). */
  async addHrmsReport(c: SiCompound, name: string, bytes: Uint8Array, then?: () => Promise<void>): Promise<string> {
    const pick = await this.addAttachment(c, 'hrms', name, bytes);
    const value = this.hrmsValue(c);
    const items = Array.isArray(value.reports) ? (value.reports as Json[]) : (value.reports = []) as Json[];
    items.push({ file: pick, kind: 'file' });
    if (then) await then();
    await this.saveCompound(c);
    return pick;
  }

  /** Move a report file (or folder) to the Trash and take it off the list; `then` may fill or clear Found, in the same save. */
  async removeHrmsReport(c: SiCompound, name: string, then?: () => Promise<void>): Promise<void> {
    this.checkWritable();
    const value = this.hrmsValue(c);
    const items = Array.isArray(value.reports) ? (value.reports as Json[]) : [];
    const item = items.find((i) => isObj(i) && i.file === name && /^[^/\\]+$/.test(name) && !/^\.\.?$/.test(name));
    if (!item) return;
    const path = join(c.folder, 'hrms', name);
    await this.moveToTrash([path], 'compound_file', name, { compound_id: c.id, field_key: 'hrms_reports', item: name, item_values: cloneJson(item), compound_name: compoundName(c) });
    items.splice(items.indexOf(item), 1);
    if (!items.length) delete value.reports;
    if (then) await then();
    await this.saveCompound(c);
  }

  /** Print this compound's HRMS reports (true), not (false), or as the Spectra section says (null). */
  async setHrmsPrint(c: SiCompound, on: boolean | null): Promise<void> {
    this.checkWritable();
    const value = this.hrmsValue(c);
    if (on === null) delete value.print_reports; else value.print_reports = on;
    await this.saveCompound(c);
  }

  /** Whether a field counts as filled in. */
  fieldFilled(c: SiCompound, def: FieldDef): boolean {
    if (def.key === 'procedure' && this.compoundGp(c)) return true; // "Prepared according to General Procedure A…"
    if (def.kind === 'richtext' || def.kind === 'notes') return isFilled(def, null, this.compoundText(c, def.key));
    if (def.kind === 'structure') return this.hasStructure(c);
    return isFilled(def, valuesOf(c)[def.key]);
  }

  /** Required fields filled, required fields in all, and the names of those missing. A required field the page doesn't have isn't counted. */
  completion(c: SiCompound): { filled: number; total: number; missing: string[] } {
    const s = this.section(c.sectionId);
    const required = new Set(defaultFieldsOf(s).filter((e) => e.required).map((e) => e.key));
    const missing: string[] = [];
    let total = 0;
    for (const e of fieldsOf(c)) {
      const def = fieldDef(e);
      if (!def || !required.has(def.key)) continue;
      total++;
      if (!this.fieldFilled(c, def)) missing.push(def.label);
    }
    return { filled: total - missing.length, total, missing };
  }

  /** Every value one part of a field has on the project's compounds (for drop-downs that learn). */
  usedPartValues(fieldKey: string, part: string): string[] {
    const out: string[] = [];
    for (const c of this.compounds) {
      if (!fieldKeys(c).includes(fieldKey)) continue;
      const v = valuesOf(c)[fieldKey];
      if (isObj(v)) out.push(partText(v[part]));
    }
    return out;
  }

  /** The list a compound sits in (its section's pages, or its scheme page's compounds), with the section and the scheme page (null: none) whose file keeps that order. */
  private containerOf(sectionId: string, schemeId: string | null): { list: (SiCompound | SiScheme)[]; section: SiSection; scheme: SiScheme | null } {
    const section = this.dataSection(sectionId);
    if (!schemeId) return { list: section.items, section, scheme: null };
    const scheme = this.scheme(schemeId);
    if (scheme.sectionId !== section.id) throw new SiProjectError('That scheme page is in a different section.');
    return { list: scheme.children, section, scheme };
  }

  private async saveContainer(where: { section: SiSection; scheme: SiScheme | null }): Promise<void> {
    if (where.scheme) await this.saveScheme(where.scheme); else await this.saveSection(where.section);
  }

  /** [section id, scheme page id or null, index among the compounds there] of a compound. */
  position(c: SiCompound): [string, string | null, number] {
    return [c.sectionId, c.schemeId, this.containerOf(c.sectionId, c.schemeId).list.indexOf(c)];
  }

  /**
   * Move a compound to `index` of a Data section, or of a scheme page in it (`schemeId`), within
   * and between sections and scheme pages (SI Assistant's move_compound). A compound leaving a
   * scheme page leaves a copy of its structure and picture in the box that showed it; a scheme
   * page's compounds stay in the order of their boxes.
   */
  moveCompound(id: string, sectionId: string, index: number, schemeId: string | null = null): Promise<void> { return this.exclusive(() => this.moveCompoundNow(id, sectionId, index, schemeId)); }

  private async moveCompoundNow(id: string, sectionId: string, index: number, schemeId: string | null = null): Promise<void> {
    this.checkWritable();
    const c = this.compound(id);
    const src = this.containerOf(c.sectionId, c.schemeId);
    const dst = this.containerOf(sectionId, schemeId);
    const E = await import('./scheme-edit');
    if (src.scheme && src.scheme !== dst.scheme) await E.compoundLeaving(this, src.scheme, c.id);
    const at = src.list.indexOf(c);
    if (at < 0) throw new SiProjectError('That compound is no longer where it was: nothing was moved.');
    const before = [...src.list];
    src.list.splice(at, 1);
    if (src.section !== dst.section) {
      // (another section: its folder moves into that section's compounds folder)
      const dest = await this.freeFolder(join(dst.section.folder, COMPOUNDS_DIR), nameOf(c.folder));
      try {
        await this.folder.move(c.folder, dest);
      } catch (e) {
        src.list.splice(0, src.list.length, ...before);
        throw e;
      }
      this.renameKnown(c.folder, dest);
      c.folder = dest;
    } else if (src.list === dst.list && index > at) index--;
    c.sectionId = dst.section.id;
    c.schemeId = dst.scheme?.id ?? null;
    dst.list.splice(Math.max(0, Math.min(index, dst.list.length)), 0, c);
    if (dst.scheme) E.syncChildren(dst.scheme);
    if (src.list !== dst.list) await this.saveContainer(src);
    await this.saveContainer(dst);
  }

  /** A compound page made a scheme page (Change to Reaction Scheme…): the new scheme page takes its place, with the compound as the product of its one step (its data and ID kept). */
  convertToScheme(id: string): Promise<SiScheme> { return this.exclusive(() => this.convertToSchemeNow(id)); }

  private async convertToSchemeNow(id: string): Promise<SiScheme> {
    this.checkWritable();
    const c = this.compound(id);
    if (c.schemeId) throw new SiProjectError('This compound is already part of a scheme page.');
    const [sectionId, , index] = this.position(c);
    const name = compoundName(c);
    const k = await this.addSchemeNow(sectionId, index, name ? `Scheme: ${name}` : '');
    await this.moveCompoundNow(c.id, sectionId, 0, k.id);
    (await import('./scheme-edit')).startWithCompound(k, c);
    await this.saveScheme(k);
    return k;
  }

  /** Move a scheme page, with its compound pages, to `index` among the pages of a Data section. */
  moveScheme(id: string, sectionId: string, index: number): Promise<void> { return this.exclusive(() => this.moveSchemeNow(id, sectionId, index)); }

  private async moveSchemeNow(id: string, sectionId: string, index: number): Promise<void> {
    this.checkWritable();
    const k = this.scheme(id);
    const from = this.section(k.sectionId);
    const to = this.dataSection(sectionId);
    const at = from.items.indexOf(k);
    if (at < 0) throw new SiProjectError('That scheme page is no longer where it was: nothing was moved.');
    if (to === from) {
      from.items.splice(at, 1);
      if (index > at) index--;
      to.items.splice(Math.max(0, Math.min(index, to.items.length)), 0, k);
      await this.saveSection(to);
      return;
    }
    // its folder and its compounds' folders move together; any that can't is put back
    const moves: [string, string][] = [];
    const base = join(to.folder, COMPOUNDS_DIR);
    try {
      for (const f of [k.folder, ...k.children.map((c) => c.folder)]) {
        const dest = await this.freeFolder(base, nameOf(f));
        await this.folder.move(f, dest);
        moves.push([f, dest]);
      }
    } catch (e) {
      for (const [a, b] of moves.reverse()) await this.folder.move(b, a).catch(() => {});
      throw new SiProjectError(`“${str(k.data.name)}” could not be moved, so nothing was changed. A file in it is probably open in another program or being synced. (${e instanceof Error ? e.message : String(e)})`);
    }
    const [[, kDest], ...rest] = moves;
    this.renameKnown(k.folder, kDest);
    k.folder = kDest;
    k.sectionId = to.id;
    k.children.forEach((c, i) => { this.renameKnown(c.folder, rest[i][1]); c.folder = rest[i][1]; c.sectionId = to.id; });
    from.items.splice(at, 1);
    to.items.splice(Math.max(0, Math.min(index, to.items.length)), 0, k);
    await this.saveSection(from);
    await this.saveSection(to);
  }

  private async freeFolder(parent: string, name: string): Promise<string> {
    let dest = join(parent, name);
    for (let n = 2; await this.folder.exists(dest); n++) dest = join(parent, `${name} (${n})`);
    return dest;
  }

  private renameKnown(from: string, to: string): void {
    const re = (m: Map<string, string> | Set<string>): void => {
      for (const k of [...m.keys()]) {
        if (!k.startsWith(from + '/')) continue;
        const nk = to + k.slice(from.length);
        if (m instanceof Map) { m.set(nk, m.get(k)!); m.delete(k); } else { m.delete(k); m.add(nk); }
      }
    };
    re(this.texts);
    re(this.present);
  }

  /**
   * Move a compound to the project's Trash (trash/<when>-<id>/), in the form SI Assistant's
   * Trash shows and restores.
   */
  deleteCompound(id: string): Promise<void> { return this.exclusive(() => this.deleteCompoundNow(id)); }

  private async deleteCompoundNow(id: string): Promise<void> {
    this.checkWritable();
    const c = this.compound(id);
    const where = this.containerOf(c.sectionId, c.schemeId);
    const s = where.section, k = where.scheme;
    const index = where.list.indexOf(c);
    if (index < 0) throw new SiProjectError('That compound is no longer where it was: nothing was deleted.');
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-`;
    const entry = join(TRASH_DIR, stamp + newId('t').slice(2));
    const info: Json = {
      kind: 'compound', name: compoundName(c) || 'unnamed compound', item: nameOf(c.folder), deleted_at: localIso(now), deleted_by: this.lock?.user ?? '',
      compound_id: c.id, section_id: s.id, section_name: s.name, scheme_id: k?.id ?? '', original_index: index,
    };
    // A scheme page's box that showed it keeps a copy of its structure and picture.
    const editorBefore = k ? cloneJson(k.data.editor) : undefined;
    // (the box's own files from before go to the Trash only once the compound has: `after`)
    const after: (() => Promise<void>)[] = [];
    const copies = k ? await (await import('./scheme-edit')).compoundLeaving(this, k, c.id, false, after) : [];
    const putBack = async (): Promise<void> => {
      where.list.splice(index, 0, c);
      if (k) {
        k.data.editor = editorBefore;
        for (const f of copies) await this.setAside(f).catch(() => {});
      }
      await this.saveContainer(where).catch(() => {});
    };
    // the order without it is saved first: if that can't be written, nothing has changed
    where.list.splice(index, 1);
    try {
      await this.saveContainer(where);
    } catch (e) {
      await putBack();
      throw e;
    }
    const inTrash = join(entry, nameOf(c.folder));
    try {
      await this.writeJson(join(entry, 'entry.json'), { ...info, pending: true });
      await this.folder.move(c.folder, inTrash);
      await this.writeJson(join(entry, 'entry.json'), info);
    } catch (e) {
      // (moved already, and only its description could not be finished: it comes back first)
      if (await this.folder.exists(inTrash).catch(() => false)) await this.folder.move(inTrash, c.folder).catch(() => {});
      await this.dropEntry(entry);
      await putBack();
      throw new SiProjectError(`“${info.name}” could not be moved to the Trash, so nothing was deleted. A file in it is probably open in another program or being synced: close it and try again. (${e instanceof Error ? e.message : String(e)})`);
    }
    this.renameKnown(c.folder, inTrash);
    this.gone.add(c);
    for (const f of after) await f().catch(() => { /* (the files stay in the scheme's folder, unused) */ });
    // its X-ray structures stay in the project, in the tree after its section
    await this.freeAnchored([c.id], s).catch(() => {});
  }

  // ---------------------------------------------------------------- references

  reference(id: string): Json | undefined { return this.references.find((r) => r.id === id); }

  /** Add a reference (from My Library, or typed): it gets an id of its own; one already there with the same DOI is used instead. */
  async addReference(ref: Json): Promise<string> {
    this.checkWritable();
    if (this.refsUnread) throw new SiProjectError(`${REFERENCES_FILE} could not be read when the project opened, so it is not saved over. Repair it, then reopen the project.`);
    const doi = str(ref.doi).trim().toLowerCase();
    const same = doi ? this.references.find((r) => str(r.doi).trim().toLowerCase() === doi) : undefined;
    if (same) return str(same.id);
    const id = newId('r');
    this.references.push({ ...ref, id });
    try { await this.saveReferences(); } catch (e) { this.references.pop(); throw e; }
    return id;
  }

  /** Change a reference (its id stays, so its citations still point to it). */
  async updateReference(ref: Json): Promise<void> {
    this.checkWritable();
    const before = [...this.references];
    const i = this.references.findIndex((r) => r.id === ref.id);
    if (i >= 0) this.references[i] = { ...ref }; else this.references.push({ ...ref });
    try { await this.saveReferences(); } catch (e) { this.references.splice(0, this.references.length, ...before); throw e; }
  }

  /** Take a reference off the list; citations of it stay in the text and are flagged, as SI Assistant does. */
  async deleteReference(id: string): Promise<void> {
    this.checkWritable();
    const before = [...this.references];
    this.references.splice(0, this.references.length, ...before.filter((r) => r.id !== id));
    try { await this.saveReferences(); } catch (e) { this.references.splice(0, this.references.length, ...before); throw e; }
  }

  /** Where each reference is cited: compounds (by id), and texts ("General Information", sections' and procedures' names). */
  async referenceUses(): Promise<Map<string, { compounds: string[]; texts: string[] }>> {
    const out = new Map<string, { compounds: string[]; texts: string[] }>();
    const at = (id: string) => { let u = out.get(id); if (!u) out.set(id, (u = { compounds: [], texts: [] })); return u; };
    const ids = (text: string): string[] => [...text.matchAll(/@cite\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean));
    for (const c of this.compounds) {
      const v = valuesOf(c);
      const found = new Set(ids(JSON.stringify(v)));
      const refs = isObj(v.references) && Array.isArray(v.references.refs) ? v.references.refs.map(String) : [];
      for (const r of refs) found.add(r);
      for (const r of found) at(r).compounds.push(c.id);
    }
    const texts: [string, string][] = [['General Information', (await this.folder.readText('front/general_information.txt')) ?? '']];
    for (const s of this.sections) {
      if (s.type === 'text') texts.push([s.name, await this.readSectionText(s)]);
      for (const gp of s.type === 'data' ? this.generalProcedures(s) : []) texts.push([str(gp.name) || 'a general procedure', await this.readGpText(s, str(gp.id))]);
    }
    for (const [name, text] of texts) for (const r of new Set(ids(text))) at(r).texts.push(name);
    return out;
  }

  // ---------------------------------------------------------------- lock

  /** Who has the project open now, as its .lock says (null: nobody). */
  async currentLock(): Promise<SiLock | null> {
    const got = await this.readJson(LOCK_FILE);
    if (!got.ok) return { user: 'unknown user', computer: 'unknown computer', opened_at: '', session: '' };
    if (!isObj(got.data)) return null;
    const d = got.data;
    return { user: str(d.user) || 'unknown user', computer: str(d.computer) || 'unknown computer', opened_at: str(d.opened_at), session: str(d.session) };
  }

  /** Claim the project (SI Assistant then opens it read-only, saying who has it). */
  async acquireLock(user: string, computer: string): Promise<void> {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    this.lock = { user, computer: computer || 'unknown computer', opened_at: localIso(new Date()), session: [...b].map((x) => x.toString(16).padStart(2, '0')).join('') };
    await this.writeJson(LOCK_FILE, this.lock);
  }

  /** Whether the lock is still ours (someone may have taken the project over in SI Assistant). */
  async lockStillOurs(): Promise<boolean> {
    if (!this.lock) return false;
    const now = await this.currentLock();
    return !!now && now.session === this.lock.session;
  }

  /** Let go of the project: the lock goes, if it is still ours. */
  async release(): Promise<void> {
    if (!this.lock) return;
    if (await this.lockStillOurs().catch(() => false)) await this.folder.remove(LOCK_FILE).catch(() => {});
    this.lock = null;
  }
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** "2026-11-17T09:41:05": local time to the second, as SI Assistant writes times. */
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** What each kind of field stores in compound.json's values (other kinds are left alone). */
const VALUE_TYPES: Record<string, 'dict' | 'list'> = { parts: 'dict', citations: 'dict', structure: 'dict', nmr: 'list', attachments: 'list', private: 'list' };

/**
 * compound.json with values of the wrong kind (a hand edit) made usable in memory. As in SI
 * Assistant, such a value is never thrown away: it is kept in the file as "<key> (could not
 * be read)", and the page shows the field empty.
 */
function cleanCompound(data: Json, where: string, warnings: string[]): void {
  const aside = (holder: Json, key: string): void => {
    const v = holder[key];
    delete holder[key];
    if (v === null || v === undefined) return;
    holder[`${key} (could not be read)`] = v;
    warnings.push(`${where}: “${key}” is not in the expected form, so it is ignored. It is kept in the file as “${key} (could not be read)”.`);
  };
  for (const k of ['values', 'flags', 'dismissed']) if (k in data && !isObj(data[k])) aside(data, k);
  if ('fields' in data) {
    const f = data.fields;
    const good = Array.isArray(f) ? f.filter((e) => isObj(e) && typeof e.key === 'string') : null;
    if (!good || good.length !== (f as unknown[]).length) { aside(data, 'fields'); if (good) data.fields = good; }
  }
  const values = data.values;
  if (!isObj(values)) return;
  for (const [key, v] of Object.entries(values)) {
    const entry = (Array.isArray(data.fields) ? (data.fields as FieldEntry[]) : []).find((e) => e.key === key);
    const def = fieldDef(entry ?? { key });
    if (!def || v === null) continue;
    const want = key === 'procedure' ? 'dict' : VALUE_TYPES[def.kind];
    if (!want) continue;
    if (want === 'dict' && (typeof v === 'string' || typeof v === 'number') && def.kind === 'parts' && def.parts?.some((p) => p.key === 'text')) values[key] = { text: String(v) };
    else if (want === 'dict' ? !isObj(v) : !Array.isArray(v)) aside(values, key);
    else if (want === 'list' && !(v as unknown[]).every(isObj)) { aside(values, key); values[key] = (v as unknown[]).filter(isObj); }
  }
}
