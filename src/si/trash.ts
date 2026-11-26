// The project's Trash (File ▸ Trash in the SI Project tab): the trash/ folder inside the project,
// shared with Chem SI Assistant. Each deletion is one folder trash/<when>-<id>/ holding the
// deleted files and an entry.json saying what they were and where they came from:
//
//   {"kind": "section" | "compound" | "scheme" | "gp" | "figure" | "table" | "file" |
//            "compound_file" | "scheme_box" | "scheme_file" | "manuscript_file",
//    "name": "…", "item": "<the main file or folder's name>", "deleted_at", "deleted_by",
//    "companions": [other files moved with it], …what each kind needs to be put back}
//
// "pending": true marks a deletion that stopped part-way (a crash); a folder with no entry.json
// is listed as an unfinished deletion. Chemweave lists all of them, restores the kinds it makes,
// and leaves the rest for SI Assistant (its old pasted scheme pictures, the manuscript check's
// files, unfinished deletions), saying so; nothing is ever deleted except by Empty Trash.

import { parsePyJson, dumpPyJson } from './pyjson';
import { newId, safeFilename } from './ids';
import { COMPOUND_FILE, COMPOUNDS_DIR, GP_DIR, PRIVATE_DIR, SCHEME_FILE, SECTION_FILE, SECTIONS_DIR, SiProjectError, TRASH_DIR, compoundsOf, fieldKeys, fieldsOf, valuesOf, type Json, type SiProject } from './project';
import { editorData, findStep, START, syncChildren } from './scheme-edit';
import { fieldDef } from './fields';

export interface TrashEntry {
  /** The entry's folder name (trash/<id>). */
  id: string;
  kind: string;
  name: string;
  /** "2026-11-18T09:30:12" ('' when not recorded). */
  deletedAt: string;
  deletedBy: string;
  /** The deletion stopped part-way. */
  pending: boolean;
  info: Json;
}

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const join = (...parts: string[]): string => parts.filter(Boolean).join('/');
/** A plain file or folder name (never a path, such as "../x", from a hand-edited entry.json). */
const safeName = (n: unknown): n is string => typeof n === 'string' && !!n && n !== '.' && n !== '..' && !/[\\/]/.test(n);
const names = (info: Json, key: string): string[] => (Array.isArray(info[key]) ? (info[key] as unknown[]).filter(safeName) : []);
const indexOf = (info: Json, key = 'original_index'): number | null => {
  const n = Number(info[key]);
  return info[key] !== null && info[key] !== '' && Number.isInteger(n) ? n : null;
};

/** What each kind is called in the Trash window. */
export const KIND_NAMES: Record<string, string> = {
  section: 'Section', compound: 'Compound', scheme: 'Scheme page', gp: 'General procedure', figure: 'Figure', table: 'Table',
  file: 'Section file', compound_file: 'Compound file', scheme_box: 'Scheme structure', scheme_file: 'Scheme picture',
  manuscript_file: 'Manuscript file', incomplete: 'Unfinished deletion',
};

/** Kinds Chemweave puts back; the others are restored in SI Assistant. */
export const RESTORABLE = new Set(['section', 'compound', 'scheme', 'gp', 'figure', 'table', 'file', 'compound_file', 'scheme_box', 'manuscript_file']);

/** Everything in the Trash, newest first. */
export async function listTrash(p: SiProject): Promise<TrashEntry[]> {
  const out: TrashEntry[] = [];
  for (const e of (await p.folder.entries(TRASH_DIR)).reverse()) {
    if (!e.folder) continue;
    let info: unknown = null;
    const text = await p.folder.readText(join(TRASH_DIR, e.name, 'entry.json')).catch(() => null);
    if (text !== null) { try { info = parsePyJson(text); } catch { info = null; } }
    if (isObj(info)) {
      const pending = !!info.pending;
      const name = info.name === undefined || info.name === null || info.name === '' ? e.name : String(info.name);
      out.push({ id: e.name, kind: typeof info.kind === 'string' ? info.kind : '?', name: pending ? `${name} (deletion did not finish)` : name, deletedAt: str(info.deleted_at), deletedBy: str(info.deleted_by), pending, info });
    } else {
      const inside = (await p.folder.entries(join(TRASH_DIR, e.name))).map((x) => x.name);
      if (inside.length) out.push({ id: e.name, kind: 'incomplete', name: `Unfinished deletion: ${inside.join(', ')}`, deletedAt: '', deletedBy: '', pending: false, info: { item: '' } });
    }
  }
  return out;
}

/** Delete everything in the Trash (it can't be undone). */
export async function emptyTrash(p: SiProject): Promise<void> {
  if (p.readOnly) throw new SiProjectError('This SI project is open read-only.');
  await p.folder.removeTrash(TRASH_DIR);
}

/** Delete one item from the Trash for good. */
export async function deleteFromTrash(p: SiProject, id: string): Promise<void> {
  if (p.readOnly) throw new SiProjectError('This SI project is open read-only.');
  if (!safeName(id)) throw new SiProjectError('That item is no longer in the Trash.');
  await p.folder.removeTrash(join(TRASH_DIR, id));
}

const damaged = (folder: string): SiProjectError => new SiProjectError(`This item's description in the Trash is damaged, so it can't be put back automatically. Its files are still in the Trash folder (${folder}).`);

/** Put an item back where it came from (the project is read again). Gives a short message for the person. */
export async function restoreFromTrash(p: SiProject, id: string): Promise<string> {
  if (p.readOnly) throw new SiProjectError('This SI project is open read-only.');
  const entry = (await listTrash(p)).find((e) => e.id === id);
  if (!entry) throw new SiProjectError('That item is no longer in the Trash.');
  const folder = join(TRASH_DIR, entry.id);
  if (!RESTORABLE.has(entry.kind)) {
    throw new SiProjectError(entry.kind === 'incomplete'
      ? `Chemweave can't tell where these files belong. Move them back by hand from the Trash folder (${folder}).`
      : `${KIND_NAMES[entry.kind] ?? 'This kind of item'}s can't be put back here. It is still in the Trash folder (${folder}), to move back by hand.`);
  }
  const item = entry.info.item;
  if (!safeName(item)) throw damaged(folder);
  const message = await RESTORE[entry.kind](p, entry, folder, item);
  // what was put back has left the entry; the entry goes unless files it didn't describe are left
  const left = (await p.folder.entries(folder)).filter((e) => e.name !== 'entry.json');
  if (!left.length) await p.folder.removeTrash(folder);
  else if (entry.kind === 'section' || entry.kind === 'scheme') {
    // (its description is set aside, so the Trash shows the rest as an unfinished deletion)
    await p.folder.move(join(folder, 'entry.json'), join(folder, `.restored-${newId('t').slice(2)}`)).catch(() => {});
    return `${message} Some files deleted with it were not put back, because the Trash's description of them is damaged; they are still in the Trash (${left.map((e) => e.name).join(', ')}).`;
  }
  return message;
}

type Restore = (p: SiProject, e: TrashEntry, folder: string, item: string) => Promise<string>;

async function readTrashedJson(p: SiProject, path: string): Promise<Json> {
  const text = await p.folder.readText(path);
  if (text === null) return {};
  try {
    const v = parsePyJson(text);
    return isObj(v) ? v : {};
  } catch {
    throw new SiProjectError(`Can't restore: ${path} could not be read (it may be damaged). Nothing was restored; repair it, then try again.`);
  }
}

const RESTORE: Record<string, Restore> = {
  async section(p, e, folder, item) {
    const all = [item, ...names(e.info, 'companions')];
    const present: string[] = [];
    for (const n of all) if (await p.folder.exists(join(folder, n))) present.push(n);
    if (!present.length) throw new SiProjectError('This Trash item is empty: there is nothing to restore.');
    for (const n of present) if (await p.folder.exists(join(SECTIONS_DIR, n))) throw new SiProjectError(`Can't restore: ${n} is already in the project.`);
    for (const n of present) await readTrashedJson(p, join(folder, n, SECTION_FILE));
    for (const n of present) await p.folder.move(join(folder, n), join(SECTIONS_DIR, n));
    const sid = str(e.info.section_id) || item.split('_')[0];
    const tree = isObj(e.info.tree) ? e.info.tree : { id: sid };
    const anchored = str(e.info.anchored_to);
    if (anchored && p.compounds.some((c) => c.id === anchored)) {
      await p.reload();
      return `Restored X-ray structure “${e.name}” under its compound.`;
    }
    if (anchored) {
      // its compound is gone: it goes in the tree
      const path = join(SECTIONS_DIR, item, SECTION_FILE);
      const data = await readTrashedJson(p, path);
      data.anchored = false;
      await p.folder.writeText(path, dumpPyJson(data));
    }
    const note = await p.restoreTreeNode(tree, str(e.info.parent_id) || null, indexOf(e.info));
    const subs = present.length - 1;
    return `Restored section “${e.name}”${subs ? ` with ${subs} sub-section${subs > 1 ? 's' : ''}` : ''}.${note}`;
  },

  async compound(p, e, folder, item) {
    const s = p.dataSections.find((x) => x.id === str(e.info.section_id));
    if (!s) throw new SiProjectError(`The Data section “${str(e.info.section_name) || '?'}” this compound belonged to no longer exists. Restore that section first.`);
    const dest = join(s.folder, COMPOUNDS_DIR, item);
    if (await p.folder.exists(dest)) throw new SiProjectError(`Can't restore: ${item} is already there.`);
    const data = await readTrashedJson(p, join(folder, item, COMPOUND_FILE));
    const cid = str(data.id) || str(e.info.compound_id) || item.split('_')[0];
    await p.folder.move(join(folder, item), dest);
    const k = s.items.find((x) => x.kind === 'scheme' && x.id === str(e.info.scheme_id));
    const at = indexOf(e.info);
    if (k && k.kind === 'scheme') {
      const order = Array.isArray(k.data.children) ? (k.data.children as unknown[]).filter((x) => x !== cid) : [];
      order.splice(at === null ? order.length : Math.max(0, Math.min(at, order.length)), 0, cid);
      k.data.children = order;
      await p.folder.writeText(join(k.folder, SCHEME_FILE), dumpPyJson(k.data));
    } else {
      const order = s.items.map((x) => x.id).filter((x) => x !== cid);
      order.splice(at === null ? order.length : Math.max(0, Math.min(at, order.length)), 0, cid);
      s.data.compound_order = order;
      await p.folder.writeText(join(s.folder, SECTION_FILE), dumpPyJson(s.data));
    }
    await p.reload();
    if (k && k.kind === 'scheme') {
      const now = p.schemes.find((x) => x.id === k.id);
      if (now && editorData(now).steps.length) { syncChildren(now); await p.saveScheme(now); }
    }
    return `Restored compound “${e.name}” to “${s.name}”.`;
  },

  async scheme(p, e, folder, item) {
    const s = p.dataSections.find((x) => x.id === str(e.info.section_id));
    if (!s) throw new SiProjectError(`The Data section “${str(e.info.section_name) || '?'}” this scheme belonged to no longer exists. Restore that section first.`);
    const base = join(s.folder, COMPOUNDS_DIR);
    const moving = [item];
    for (const n of names(e.info, 'children')) if (await p.folder.exists(join(folder, n))) moving.push(n);
    for (const n of moving) if (await p.folder.exists(join(base, n))) throw new SiProjectError(`Can't restore: ${n} is already there.`);
    const data = await readTrashedJson(p, join(folder, item, SCHEME_FILE));
    const kid = str(data.id) || str(e.info.scheme_id) || item.split('_')[0];
    for (const n of moving) await p.folder.move(join(folder, n), join(base, n));
    const order = s.items.map((x) => x.id).filter((x) => x !== kid);
    const at = indexOf(e.info);
    order.splice(at === null ? order.length : Math.max(0, Math.min(at, order.length)), 0, kid);
    s.data.compound_order = order;
    await p.folder.writeText(join(s.folder, SECTION_FILE), dumpPyJson(s.data));
    await p.reload();
    return `Restored scheme “${e.name}” to “${s.name}”.`;
  },

  async gp(p, e, folder, item) {
    const s = p.dataSections.find((x) => x.id === str(e.info.section_id));
    if (!s) throw new SiProjectError(`The section this general procedure belonged to no longer exists. Its text is still in the Trash folder (${folder}).`);
    if (!(await p.folder.exists(join(folder, item)))) throw new SiProjectError('This Trash item is empty: there is nothing to restore.');
    const gp: Json = isObj(e.info.gp) ? { ...e.info.gp } : {};
    if (!str(gp.id) || p.generalProcedure(str(gp.id))) gp.id = newId('gp');
    if (!str(gp.name)) gp.name = e.name;
    await p.folder.move(join(folder, item), join(s.folder, GP_DIR, `${safeFilename(str(gp.id))}.txt`));
    if (!Array.isArray(s.data.general_procedures)) s.data.general_procedures = [];
    const list = s.data.general_procedures as Json[];
    const at = indexOf(e.info, 'index');
    list.splice(at === null ? list.length : Math.max(0, Math.min(at, list.length)), 0, gp);
    await p.saveSection(s);
    return `Restored “${str(gp.name)}” to “${s.name}”.`;
  },

  async figure(p, e, folder, item) { return restoreObject(p, e, folder, item, 'figure'); },
  async table(p, e, folder, item) { return restoreObject(p, e, folder, item, 'table'); },

  async file(p, e, folder, item) {
    const s = p.sections.find((x) => x.id === str(e.info.section_id)) ?? [...p.anchored.values()].flat().find((x) => x.id === str(e.info.section_id));
    if (!s) throw new SiProjectError(`The section this file belonged to no longer exists. The file is still in the Trash folder (${folder}).`);
    const bytes = await p.folder.readBytes(join(folder, item));
    if (!bytes) throw new SiProjectError('This Trash item is empty: there is nothing to restore.');
    // (the section's current file goes to the Trash, as a newly chosen one does)
    await p.attachSectionFile(s, item, bytes);
    await p.folder.removeTrash(folder).catch(() => {});
    return `Restored ${item} to “${s.name}”.`;
  },

  async compound_file(p, e, folder, item) {
    const c = p.compounds.find((x) => x.id === str(e.info.compound_id));
    if (!c) throw new SiProjectError(`The compound this file belonged to no longer exists. The file is still in the Trash folder (${folder}).`);
    const key = str(e.info.field_key);
    if (!key) throw damaged(folder);
    if (key === 'structure') {
      if (await p.folder.exists(join(c.folder, 'structure.mol'))) throw new SiProjectError('This compound already has a structure. Clear it first, then restore the old one.');
      const mol = await p.folder.readText(join(folder, item));
      if (!mol) throw new SiProjectError('This Trash item is empty: there is nothing to restore.');
      await p.setStructure(c, mol);
      await p.folder.removeTrash(folder).catch(() => {});
      return `Restored the structure of “${e.name}”.`;
    }
    if (key === 'hrms_reports') {
      // an HRMS report file (§13n.3): back into hrms/ and onto the HRMS field's list (Found is filled again when the page opens)
      let pick = item;
      const dot = item.lastIndexOf('.');
      const stem = dot > 0 ? item.slice(0, dot) : item, ext = dot > 0 ? item.slice(dot) : '';
      for (let n = 2; await p.folder.exists(join(c.folder, 'hrms', pick)); n++) pick = `${stem} (${n})${ext}`;
      await p.folder.move(join(folder, item), join(c.folder, 'hrms', pick));
      const value = p.hrmsValue(c);
      const list = Array.isArray(value.reports) ? (value.reports as Json[]) : (value.reports = []) as Json[];
      const kept = isObj(e.info.item_values) ? { ...e.info.item_values } : {};
      list.push({ kind: 'file', ...kept, file: pick });
      await p.saveCompound(c);
      return `Restored ${pick} to “${str(e.info.compound_name) || 'the compound'}”.`;
    }
    if (key === 'private_files') {
      // a stored file or folder: back into private/ and onto the field's list, with its note
      let pick = item;
      const dot = item.lastIndexOf('.');
      const stem = dot > 0 ? item.slice(0, dot) : item, ext = dot > 0 ? item.slice(dot) : '';
      for (let n = 2; await p.folder.exists(join(c.folder, PRIVATE_DIR, pick)); n++) pick = `${stem} (${n})${ext}`;
      await p.folder.move(join(folder, item), join(c.folder, PRIVATE_DIR, pick));
      const values = valuesOf(c);
      if (!fieldKeys(c).includes('private_files')) await p.addField(c, { key: 'private_files' });
      const list = Array.isArray(values.private_files) ? (values.private_files as Json[]) : (values.private_files = []) as Json[];
      const kept = isObj(e.info.item_values) ? { ...e.info.item_values } : {};
      list.push({ kind: 'file', note: '', ...kept, file: pick });
      await p.saveCompound(c);
      return `Restored ${pick} to “${str(e.info.compound_name) || 'the compound'}”.`;
    }
    const def = fieldDef(fieldsOf(c).find((x) => x.key === key) ?? { key });
    if (!def || !def.subdir) throw new SiProjectError(`Files of this field can't be put back here. The file is still in the Trash folder (${folder}), to move back by hand.`);
    const values = valuesOf(c);
    const list = Array.isArray(values[key]) ? (values[key] as Json[]) : (values[key] = []) as Json[];
    let pick = item;
    const dot = item.lastIndexOf('.');
    const stem = dot > 0 ? item.slice(0, dot) : item, ext = dot > 0 ? item.slice(dot) : '';
    for (let n = 2; await p.folder.exists(join(c.folder, def.subdir, pick)); n++) pick = `${stem} (${n})${ext}`;
    await p.folder.move(join(folder, item), join(c.folder, def.subdir, pick));
    const newStem = pick.slice(0, pick.length - ext.length);
    for (const other of names(e.info, 'companions')) {
      const oe = other.slice(other.lastIndexOf('.'));
      if (await p.folder.exists(join(folder, other))) await p.folder.move(join(folder, other), join(c.folder, def.subdir, newStem + oe)).catch(() => {});
    }
    const kept = isObj(e.info.item_values) ? { ...e.info.item_values } : {};
    list.push({ ...kept, file: pick });
    await p.saveCompound(c);
    return `Restored ${pick} to “${str(e.info.compound_name) || 'the compound'}”.`;
  },

  async manuscript_file(p, _e, folder, item) {
    // a file of the manuscript check: back into manuscript/ (a name now taken gets " (2)")
    const dot = item.lastIndexOf('.');
    const stem = dot > 0 ? item.slice(0, dot) : item, ext = dot > 0 ? item.slice(dot) : '';
    let pick = item;
    for (let n = 2; await p.folder.exists(join('manuscript', pick)); n++) pick = `${stem} (${n})${ext}`;
    await p.folder.move(join(folder, item), join('manuscript', pick));
    return `Restored ${pick} to the manuscript check.`;
  },

  async scheme_box(p, e, folder) {
    const k = p.schemes.find((x) => x.id === str(e.info.scheme_id));
    if (!k) throw new SiProjectError(`The scheme page this structure belonged to no longer exists. Its files are still in the Trash folder (${folder}).`);
    const box: Json = isObj(e.info.box) ? structuredClone(e.info.box) : {};
    box.id = newId('b');
    delete box.picture; delete box.structure;
    const files = isObj(e.info.files) ? e.info.files : {};
    for (const key of ['picture', 'structure'] as const) {
      const name = files[key];
      if (!safeName(name) || !(await p.folder.exists(join(folder, name)))) continue;
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      let pick = `${box.id}${ext}`;
      for (let n = 2; await p.folder.exists(join(k.folder, 'editor', pick)); n++) pick = `${box.id} (${n})${ext}`;
      await p.folder.move(join(folder, name), join(k.folder, 'editor', pick));
      box[key] = `editor/${pick}`;
      if (key === 'picture') {
        const stem = name.slice(0, name.lastIndexOf('.'));
        for (const o of ['.emf', '.pdf', '.cdxml']) if (o !== ext && (await p.folder.exists(join(folder, stem + o)))) await p.folder.move(join(folder, stem + o), join(k.folder, 'editor', pick.slice(0, -ext.length) + o)).catch(() => {});
      }
    }
    const ed = editorData(k);
    const where = str(e.info.where) || START;
    if (where === START) ed.starting.push(box);
    else {
      const st = findStep(k, where);
      if (st) st.products.push(box);
      else {
        if (!ed.steps.length) ed.steps.push({ id: newId('st'), top: '', bottom: '', products: [] });
        ed.steps[ed.steps.length - 1].products.push(box);
      }
    }
    await p.saveScheme(k);
    return `Restored a structure of the scheme “${str(k.data.name)}”.`;
  },
};

/** A figure or table goes back at the end of its section's text (under its own ID when that is free). */
async function restoreObject(p: SiProject, e: TrashEntry, folder: string, item: string, kind: 'figure' | 'table'): Promise<string> {
  const s = p.sections.find((x) => x.id === str(e.info.owner));
  if (!s) throw new SiProjectError(`“${str(e.info.owner_name) || '?'}”, where this ${kind} was, isn't a section Chemweave can put it back in (it may have been deleted, or be the General Information page). The file is still in the Trash folder (${folder}), to move back by hand.`);
  if (!(await p.folder.exists(join(folder, item)))) throw new SiProjectError('This Trash item is empty: there is nothing to restore.');
  const used = new Set<string>();
  for (const x of p.sections) {
    if (isObj(x.data.figures)) for (const k of Object.keys(x.data.figures)) used.add(k);
    for (const m of ((await p.readSectionText(x).catch(() => '')).match(/!(?:figure|table)\{([^}]*)\}/g) ?? [])) used.add(m.slice(m.indexOf('{') + 1, -1));
  }
  let id = str(e.info.object_id);
  const text = await p.readSectionText(s);
  const lines = text.split('\n');
  const mark = (x: string): string => `!${kind}{${x}}`;
  const inText = !!id && lines.some((l) => l.replace(/^!align\{[^}]*\}\s*/, '').startsWith(mark(id)));
  const hasFile = kind === 'figure' ? isObj(s.data.figures) && id in s.data.figures : !!id && (await p.folder.exists(join(s.folder, 'tables', `${safeFilename(id)}.json`)));
  const refill = inText && !hasFile;
  if (!refill && (!id || used.has(id))) id = newId(kind === 'figure' ? 'f' : 't');
  if (kind === 'figure') {
    const ext = item.slice(item.lastIndexOf('.'));
    const stem = item.slice(0, item.length - ext.length);
    const others: Record<string, Uint8Array> = {};
    // (a cropped or rotated picture's original, deleted with it: put back beside it, with how it was edited)
    const edited = new Set(names(e.info, 'edited_files'));
    for (const o of names(e.info, 'companions')) { if (edited.has(o)) continue; const b = await p.folder.readBytes(join(folder, o)); if (b) others[o.slice(o.lastIndexOf('.') + 1)] = b; }
    const path = await p.addSectionPicture(s, stem + ext, (await p.folder.readBytes(join(folder, item)))!, others);
    let editRec: Record<string, unknown> | null = null;
    const orig = str(e.info.edited_original);
    if (orig && edited.has(orig) && isObj(e.info.edited)) {
      const bytes = await p.folder.readBytes(join(folder, orig));
      if (bytes) {
        const ost = orig.replace(/\.[^.]+$/, '');
        const oothers: Record<string, Uint8Array> = {};
        for (const o of edited) if (o !== orig && o.startsWith(ost + '.')) { const b = await p.folder.readBytes(join(folder, o)); if (b) oothers[o.slice(o.lastIndexOf('.') + 1)] = b; }
        const opath = await p.addSectionPicture(s, orig, bytes, oothers);
        editRec = { ...e.info.edited, original: opath, copy: path };
      }
    }
    const figs = isObj(s.data.figures) ? s.data.figures : (s.data.figures = {});
    figs[id] = { file: path, ...(str(e.info.label) ? { label: str(e.info.label) } : {}), ...(e.info.width ? { width: e.info.width } : {}), ...(editRec ? { chemweave_picture: editRec } : {}) };
    await p.saveSection(s);
  } else {
    const table = await readTrashedJson(p, join(folder, item));
    table.id = id;
    await p.writeTable(s, table);
  }
  await p.folder.removeTrash(folder).catch(() => {});
  if (refill) return `Restored the ${kind} in “${s.name}”.`;
  const align = str(e.info.align);
  const line = `${align === 'left' || align === 'right' ? `!align{${align}} ` : ''}${mark(id)} ${str(e.info.caption)}`.trimEnd();
  const body = text.replace(/\n+$/, '');
  await p.writeSectionText(s, (body ? body + '\n' : '') + line);
  return `Restored the ${kind} at the end of “${s.name}”.`;
}

/** Compounds a section held (to say what deleting it takes with it). */
export function compoundsUnder(p: SiProject, sectionId: string): number {
  const s = p.sections.find((x) => x.id === sectionId);
  return s ? p.subtree(s).reduce((n, x) => n + (x.type === 'data' ? compoundsOf(x).length : 0), 0) : 0;
}
