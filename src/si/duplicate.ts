// Home ▸ Duplicate in the SI Project tab: copies of a compound page or a scheme page, as Chem SI
// Assistant makes them (its SPEC §13q.3). A copy has the same fields as the original; which
// fields' contents are copied is the person's choice. Attached files never are (spectra,
// Additional files, HRMS report files, private files, NMR peak reports: they belong to the
// original), nor the manual ID, flags or dismissed warnings. Copies take their IDs from the ID
// table like any new compound: at the end of the section they take the next unused IDs and
// nothing is renumbered; right after the original, the compounds after them move up the table.
//
// A scheme page is copied with its drawing (boxes, steps, conditions with their structures, its
// layout; not its typed label or its Save Scheme lock) and every compound on it, each linked to
// the same box of the copy.

import { SiProjectError, fieldsOf, valuesOf, type Json, type SiCompound, type SiProject, type SiScheme } from './project';
import { DEFAULT_NMR_NUCLEI, fieldDef, type FieldDef } from './fields';
import { allBoxes, editorData, syncChildren } from './scheme-edit';
import { newId } from './ids';
import { cloneJson } from './pyjson';

export const NEVER_COPIED_KINDS = ['attachments', 'private', 'nmr'];
export const MAX_COPIES = 50;
export type Place = 'end' | 'after';
/** The HRMS value's report files (and where Found came from) belong to the original. */
const HRMS_FILE_KEYS = ['reports', 'found_from'];

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const join = (...parts: string[]): string => parts.filter(Boolean).join('/');

/** A compound's fields with what each is (page order). */
export function fieldDefs(c: SiCompound): FieldDef[] {
  return fieldsOf(c).map((e) => fieldDef(e)).filter((d): d is FieldDef => !!d);
}
/** The fields whose contents can be copied. */
export function copyableFields(c: SiCompound): FieldDef[] { return fieldDefs(c).filter((d) => !NEVER_COPIED_KINDS.includes(d.kind)); }
/** The fields that never are (for the window to say so). */
export function neverCopiedFields(c: SiCompound): FieldDef[] { return fieldDefs(c).filter((d) => NEVER_COPIED_KINDS.includes(d.kind)); }

/** "Route (copy)", or with several copies "Route (copy 1)", "Route (copy 2)"… */
export function copyName(name: string, n: number, copies: number): string {
  const base = name.trim() || 'Scheme';
  return copies === 1 ? `${base} (copy)` : `${base} (copy ${n})`;
}

/** The number of copies asked for, as a whole number from 1 to MAX_COPIES. */
export function checkCopies(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new SiProjectError('The number of copies must be a whole number.');
  if (n < 1 || n > MAX_COPIES) throw new SiProjectError(`Make between 1 and ${MAX_COPIES} copies at a time.`);
  return n;
}

async function copyFile(p: SiProject, from: string, to: string): Promise<boolean> {
  const b = await p.folder.readBytes(from);
  if (!b) return false;
  await p.folder.writeBytes(to, b);
  return true;
}

/** Give `copy` the fields of `original` and the contents of the fields in `keys`. */
async function fillCopy(p: SiProject, original: SiCompound, copy: SiCompound, keys: Set<string>): Promise<void> {
  copy.data.fields = cloneJson(original.data.fields ?? []);
  const values: Json = {};
  copy.data.values = values;
  const from = valuesOf(original);
  for (const def of fieldDefs(original)) {
    if (def.kind === 'nmr') { values[def.key] = DEFAULT_NMR_NUCLEI.map((nucleus) => ({ id: newId('r'), nucleus, label: '', text: '' })); continue; }
    if (!keys.has(def.key) || NEVER_COPIED_KINDS.includes(def.kind)) continue;
    if (def.kind === 'richtext' || def.kind === 'notes') {
      const text = p.compoundText(original, def.key);
      if (text) await p.writeCompoundText(copy, def.key, text);
    }
    if (def.kind === 'structure') {
      const mol = await p.readStructure(original);
      if (mol) await p.setStructure(copy, mol);
      const v = isObj(from.structure) ? cloneJson(from.structure) : null;
      if (v) {
        const pic = typeof v.image_override === 'string' ? v.image_override : '';
        if (pic && (await copyFile(p, join(original.folder, pic), join(copy.folder, pic)))) {
          const stem = pic.replace(/\.[^./]+$/, '');
          for (const ext of ['.emf', '.pdf', '.cdxml']) if (stem + ext !== pic) await copyFile(p, join(original.folder, stem + ext), join(copy.folder, stem + ext));
        } else delete v.image_override;
        values.structure = v;
      }
      continue;
    }
    if (def.key in from) {
      const v = cloneJson(from[def.key]);
      if (def.key === 'hrms' && isObj(v)) for (const k of HRMS_FILE_KEYS) delete v[k];
      values[def.key] = v;
    }
    if (def.key === 'scale' && 'scale_from_gp' in original.data) copy.data.scale_from_gp = cloneJson(original.data.scale_from_gp);
  }
  await p.saveCompound(copy);
}

/** Copies of a compound page with the contents of the fields in `keys`; one of a scheme page is copied as a compound page of its own (after the scheme page, or at the end). */
export async function duplicateCompound(p: SiProject, c: SiCompound, keys: Iterable<string>, copies = 1, place: Place = 'end'): Promise<SiCompound[]> {
  copies = checkCopies(copies);
  const want = new Set(keys);
  const s = p.section(c.sectionId);
  const top = c.schemeId ? p.scheme(c.schemeId) : c;
  const out: SiCompound[] = [];
  for (let n = 1; n <= copies; n++) {
    const made = await p.addCompound(s.id, place === 'end' ? undefined : s.items.indexOf(top) + n);
    out.push(made);
    await fillCopy(p, c, made, want);
  }
  return out;
}

/** Copies of a scheme page: its drawing and every compound on it (the contents of the fields in `keys`), each linked to the same box as in the original. */
export async function duplicateScheme(p: SiProject, k: SiScheme, keys: Iterable<string>, copies = 1, place: Place = 'end'): Promise<SiScheme[]> {
  copies = checkCopies(copies);
  const want = new Set(keys);
  const s = p.section(k.sectionId);
  const out: SiScheme[] = [];
  for (let n = 1; n <= copies; n++) {
    const made = await p.addScheme(s.id, place === 'end' ? undefined : s.items.indexOf(k) + n, copyName(String(k.data.name ?? ''), n, copies));
    const mapping = new Map<string, string>();
    try {
      for (const f of await p.folder.entries(join(k.folder, 'editor'))) if (!f.folder) await copyFile(p, join(k.folder, 'editor', f.name), join(made.folder, 'editor', f.name));
      const editor = cloneJson(editorData(k)) as Json;
      delete editor.locked;
      made.data.editor = editor;
      for (const child of k.children) {
        const copied = await p.addSchemeCompound(made, made.children.length);
        mapping.set(child.id, copied.id);
        await fillCopy(p, child, copied, want);
      }
    } finally {
      followCopies(made, mapping);
      syncChildren(made);
      await p.saveScheme(made);
    }
    out.push(made);
  }
  return out;
}

/** The copy's boxes show the copied compounds; an ID label or conditions mentioning one of the original's compounds name its copy instead. */
function followCopies(k: SiScheme, mapping: Map<string, string>): void {
  const follow = (t: string): string => { for (const [a, b] of mapping) t = t.split(`@{${a}}`).join(`@{${b}}`); return t; };
  for (const [box] of allBoxes(k)) {
    const linked = typeof box.compound === 'string' ? box.compound : '';
    if (linked && mapping.has(linked)) box.compound = mapping.get(linked)!;
    else if (linked) delete box.compound;
    const label = follow(typeof box.label === 'string' ? box.label : '');
    if (label) box.label = label;
  }
  for (const st of editorData(k).steps) { st.top = follow(st.top); st.bottom = follow(st.bottom); }
}
