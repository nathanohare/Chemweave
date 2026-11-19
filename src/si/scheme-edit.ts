// Editing a scheme page's reaction scheme (SI Assistant's scheme editor, SPEC §13n.4), in the
// same scheme.json SI Assistant reads and writes:
//
//   "editor": {"starting": [box…], "steps": [{"id", "top", "bottom", "top_align"?, "bottom_align"?,
//              "products": [box…]}], "inline": {"s-…": {"structure": "editor/s-….mol", …}},
//              "layout": {…its own settings, only those that differ from the project's}}
//   box = {"id": "b-…", "compound"?: "c-…" (a compound page of the scheme: its structure is the
//          compound's), "structure"?: "editor/b-….mol", "picture"?: …, "label"?: "S1" or "@{c-…}",
//          "label_dx"/"label_dy" (pt), "yield"?: typed (absent = the compound's)}
//
// A box's structure drawn here is kept as a MOL file (SI Assistant draws it the same way); a
// picture pasted in SI Assistant is left as it is until a structure is drawn over it, when it
// goes to the Trash. Removed boxes go to the Trash as SI Assistant's "scheme_box" items, which
// it restores into their step. The scheme's compounds are kept in the order of their boxes.

import type { Json, SiCompound, SiProject, SiScheme } from './project';

const valuesOfCompound = (c: SiCompound): Json => (isObj(c.data.values) ? c.data.values : (c.data.values = {}));
import { newId } from './ids';
import { parseMarkup, STRUCT } from './markup';
import { SCHEME_DEFAULTS, schemeLayout, type SchemeLayout } from './scheme-draw';

export const START = 'start';
const FILES_DIR = 'editor';
/** SI Assistant's own built-in size of structures in the conditions (Chemweave's is 70 %). */
const SI_ASSISTANT_COND_PCT = 60;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v));
const join = (...parts: string[]): string => parts.filter(Boolean).join('/');

export interface Step { id: string; top: string; bottom: string; top_align?: string; bottom_align?: string; products: Json[] }

/** The editor's part of scheme.json, made (empty) when there is none and tidied as SI Assistant tidies it. */
export function editorData(k: SiScheme): { starting: Json[]; steps: Step[]; inline: Json; layout?: Json } & Json {
  let d = k.data.editor;
  if (!isObj(d)) d = k.data.editor = {};
  const data = d as Json;
  if (!Array.isArray(data.starting)) data.starting = [];
  if (!Array.isArray(data.steps)) data.steps = [];
  if (!isObj(data.inline)) data.inline = {};
  const box = (b: unknown): boolean => {
    if (!isObj(b)) return false;
    if (typeof b.id !== 'string' || !b.id) b.id = newId('b');
    for (const key of ['label', 'yield']) if (key in b && typeof b[key] !== 'string') b[key] = text(b[key]);
    for (const key of ['picture', 'structure', 'compound']) if (key in b && typeof b[key] !== 'string') delete b[key];
    return true;
  };
  const starting = data.starting as unknown[];
  starting.splice(0, starting.length, ...starting.filter(box));
  const steps = (data.steps as unknown[]).filter(isObj);
  for (const st of steps) {
    if (typeof st.id !== 'string' || !st.id) st.id = newId('st');
    if (Array.isArray(st.products)) { const ps = st.products as unknown[]; ps.splice(0, ps.length, ...ps.filter(box)); } else st.products = [];
    st.top = text(st.top);
    st.bottom = text(st.bottom);
  }
  (data.steps as unknown[]).splice(0, (data.steps as unknown[]).length, ...steps);
  return data as ReturnType<typeof editorData>;
}

/** Every box, left to right: [box, where] (where is START or its step's id). */
export function allBoxes(k: SiScheme): [Json, string][] {
  const d = editorData(k);
  return [...d.starting.map((b): [Json, string] => [b, START]), ...d.steps.flatMap((st) => st.products.map((b): [Json, string] => [b, st.id]))];
}

export function findBox(k: SiScheme, id: string): { box: Json; list: Json[]; where: string } | null {
  const d = editorData(k);
  const i = d.starting.findIndex((b) => b.id === id);
  if (i >= 0) return { box: d.starting[i], list: d.starting, where: START };
  for (const st of d.steps) {
    const j = st.products.findIndex((b) => b.id === id);
    if (j >= 0) return { box: st.products[j], list: st.products, where: st.id };
  }
  return null;
}

export function findStep(k: SiScheme, id: string): Step | null { return editorData(k).steps.find((s) => s.id === id) ?? null; }

/** The compound page a box shows (one of the scheme's), or null. */
export function boxCompound(k: SiScheme, box: Json): SiCompound | null {
  const cid = text(box.compound);
  return cid ? k.children.find((c) => c.id === cid) ?? null : null;
}

/** A box's structure as a MOL file ('' for none): its compound's, else its own. */
export async function boxMol(p: SiProject, k: SiScheme, box: Json): Promise<string> {
  const c = boxCompound(k, box);
  if (c) return p.hasStructure(c) ? p.readStructure(c) : '';
  const rel = text(box.structure);
  return rel ? (await p.folder.readText(join(k.folder, rel))) ?? '' : '';
}

/** A structure in the conditions as a MOL file ('' when it has none, e.g. only a pasted picture). */
export async function inlineMol(p: SiProject, k: SiScheme, sid: string): Promise<string> {
  const e = editorData(k).inline[sid];
  const rel = isObj(e) ? text(e.structure) : '';
  return rel ? (await p.folder.readText(join(k.folder, rel))) ?? '' : '';
}

/** The structures (@struct{s-…}) in a conditions text, in order. */
export function inlineIds(markup: string): string[] {
  return parseMarkup(markup).flatMap((para) => para.runs.filter((r) => r.ref?.startsWith(STRUCT)).map((r) => r.ref!.slice(STRUCT.length)));
}

/** The scheme's compounds in the order of their boxes (compounds without a box after them). */
export function syncChildren(k: SiScheme): void {
  const order = allBoxes(k).map(([b]) => text(b.compound)).filter((id) => id && k.children.some((c) => c.id === id));
  const linked = order.map((id) => k.children.find((c) => c.id === id)!);
  k.children.splice(0, k.children.length, ...linked, ...k.children.filter((c) => !order.includes(c.id)));
}

// ---------------------------------------------------------------- changes

export async function addBox(p: SiProject, k: SiScheme, where: string, index?: number): Promise<Json> {
  const list = where === START ? editorData(k).starting : findStep(k, where)?.products;
  if (!list) throw new Error('That step is no longer in the scheme.');
  const box: Json = { id: newId('b') };
  list.splice(index === undefined ? list.length : Math.max(0, Math.min(index, list.length)), 0, box);
  await p.saveScheme(k);
  return box;
}

/** A new step (an arrow with empty conditions and one empty product) at the end, or at `index`. */
export async function addStep(p: SiProject, k: SiScheme, index?: number): Promise<Step> {
  const steps = editorData(k).steps;
  const st: Step = { id: newId('st'), top: '', bottom: '', products: [{ id: newId('b') }] };
  steps.splice(index === undefined ? steps.length : Math.max(0, Math.min(index, steps.length)), 0, st);
  await p.saveScheme(k);
  return st;
}

/** Move a box left (-1) or right (+1) among its neighbours; false when it can't go further. */
export async function moveBox(p: SiProject, k: SiScheme, id: string, delta: number): Promise<boolean> {
  const f = findBox(k, id);
  if (!f) return false;
  const i = f.list.indexOf(f.box), j = i + delta;
  if (j < 0 || j >= f.list.length) return false;
  [f.list[i], f.list[j]] = [f.list[j], f.list[i]];
  syncChildren(k);
  await p.saveScheme(k);
  return true;
}

/** Move a step left (-1) or right (+1). */
export async function moveStep(p: SiProject, k: SiScheme, id: string, delta: number): Promise<boolean> {
  const steps = editorData(k).steps;
  const i = steps.findIndex((s) => s.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= steps.length) return false;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  syncChildren(k);
  await p.saveScheme(k);
  return true;
}

/** The box's own files that are in the folder: picture (and its pasted original beside it), structure. */
async function ownFiles(p: SiProject, k: SiScheme, box: Json): Promise<{ picture: string[]; structure: string[] }> {
  const out = { picture: [] as string[], structure: [] as string[] };
  const pic = text(box.picture);
  if (pic && (await p.folder.exists(join(k.folder, pic)))) {
    out.picture.push(join(k.folder, pic));
    const stem = join(k.folder, pic).replace(/\.[^./]+$/, '');
    for (const ext of ['.emf', '.cdxml', '.pdf']) {
      const o = stem + ext;
      if (o !== join(k.folder, pic) && (await p.folder.exists(o))) out.picture.push(o);
    }
  }
  const st = text(box.structure);
  if (st && (await p.folder.exists(join(k.folder, st)))) out.structure.push(join(k.folder, st));
  return out;
}

const PICTURE_KEYS = ['picture_source', 'image_bond_pt', 'image_bond_override'];

/**
 * Files a box no longer shows (a picture drawn over, or its own files from before it showed a
 * compound) go to the Trash, never deleted: as a "scheme_box" item, which either program puts
 * back as a box of its own in the same step, so the old structure can be had again.
 */
async function trashSuperseded(p: SiProject, k: SiScheme, box: Json, own: { picture: string[]; structure: string[] }): Promise<void> {
  const files = [...own.picture, ...own.structure];
  if (!files.length) return;
  const base = (f: string): string => f.slice(f.lastIndexOf('/') + 1);
  const kept: Json = {};
  const old: Json = { id: text(box.id) };
  if (own.picture.length) {
    kept.picture = base(own.picture[0]);
    old.picture = text(box.picture);
    for (const key of PICTURE_KEYS) if (key in box) old[key] = box[key];
  }
  if (own.structure.length) { kept.structure = base(own.structure[0]); old.structure = text(box.structure); }
  const where = findBox(k, text(box.id))?.where ?? START;
  await p.trashFiles(files, 'scheme_box', `earlier structure from scheme “${text(k.data.name)}”`, { scheme_id: k.id, scheme_name: text(k.data.name), where, box: old, files: kept });
}

/** Take a box out of the scheme: its own files go to the Trash (one item SI Assistant restores into its step); a compound it showed stays a compound of the page. */
export async function removeBox(p: SiProject, k: SiScheme, id: string): Promise<void> {
  const f = findBox(k, id);
  if (!f) return;
  const own = await ownFiles(p, k, f.box);
  const files = [...own.picture, ...own.structure];
  if (files.length) {
    const kept: Json = {};
    if (own.picture.length) kept.picture = own.picture[0].slice(own.picture[0].lastIndexOf('/') + 1);
    if (own.structure.length) kept.structure = own.structure[0].slice(own.structure[0].lastIndexOf('/') + 1);
    const box = Object.fromEntries(Object.entries(f.box).filter(([key]) => key !== 'compound'));
    await p.trashFiles(files, 'scheme_box', `structure from scheme “${text(k.data.name)}”`, { scheme_id: k.id, scheme_name: text(k.data.name), where: f.where, box, files: kept });
  }
  f.list.splice(f.list.indexOf(f.box), 1);
  syncChildren(k);
  await p.saveScheme(k);
}

/** Take a step (its arrow, conditions and products) out of the scheme. */
export async function removeStep(p: SiProject, k: SiScheme, id: string): Promise<void> {
  const st = findStep(k, id);
  if (!st) return;
  for (const b of [...st.products]) await removeBox(p, k, text(b.id));
  const steps = editorData(k).steps;
  steps.splice(steps.indexOf(st), 1);
  await p.saveScheme(k);
}

/** A free name in the scheme's editor/ folder for `stem` with `ext`, clear of pictures of the same name. */
async function freePath(p: SiProject, k: SiScheme, stem: string, ext: string): Promise<string> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? stem : `${stem} (${n})`;
    const taken = await Promise.all([ext, '.svg', '.png', '.jpg', '.emf', '.pdf', '.cdxml'].map((e) => p.folder.exists(join(k.folder, FILES_DIR, name + e))));
    if (!taken.some(Boolean)) return `${FILES_DIR}/${name}${ext}`;
  }
}

/**
 * A structure drawn for a box (a MOL file). A box showing a compound changes the compound's
 * structure (one source of truth); otherwise the box's own structure is written, and a picture
 * pasted for it in SI Assistant goes to the Trash (it no longer matches).
 */
export async function setBoxStructure(p: SiProject, k: SiScheme, id: string, molblock: string): Promise<void> {
  const f = findBox(k, id);
  if (!f) return;
  const c = boxCompound(k, f.box);
  if (c) { await p.setStructure(c, molblock); return; }
  const own = await ownFiles(p, k, f.box);
  await trashSuperseded(p, k, f.box, { picture: own.picture, structure: [] });
  for (const key of ['picture', ...PICTURE_KEYS]) delete f.box[key];
  const rel = own.structure.length ? text(f.box.structure) : await freePath(p, k, text(f.box.id), '.mol');
  await p.folder.writeText(join(k.folder, rel), molblock.endsWith('\n') ? molblock : molblock + '\n');
  f.box.structure = rel;
  await p.saveScheme(k);
}

/** A box's ID label (typed, or a mention "@{c-…}"), its yield (null: automatic) or the label's offset (pt). */
export async function setBoxValues(p: SiProject, k: SiScheme, id: string, change: { label?: string; yield?: string | null; label_dx?: number; label_dy?: number }): Promise<void> {
  const f = findBox(k, id);
  if (!f) return;
  if (change.label !== undefined) { if (change.label.trim()) f.box.label = change.label.trim(); else delete f.box.label; }
  if (change.yield !== undefined) { if (change.yield === null) delete f.box.yield; else f.box.yield = change.yield.trim(); }
  for (const key of ['label_dx', 'label_dy'] as const) {
    const v = change[key];
    if (v === undefined) continue;
    const n = Math.max(-200, Math.min(200, Math.round(v * 10) / 10));
    if (n) f.box[key] = n; else delete f.box[key];
  }
  await p.saveScheme(k);
}

/** The conditions above ('top') or under ('bottom') a step's arrow (SI markup). */
export async function setConditions(p: SiProject, k: SiScheme, stepId: string, which: 'top' | 'bottom', markup: string): Promise<void> {
  const st = findStep(k, stepId);
  if (!st || st[which] === markup) return;
  st[which] = markup;
  await p.saveScheme(k);
}

/** A step's own alignment of its conditions ('' = the scheme's Layout). */
export async function setConditionsAlign(p: SiProject, k: SiScheme, stepId: string, which: 'top' | 'bottom', align: '' | 'left' | 'center' | 'right'): Promise<void> {
  const st = findStep(k, stepId);
  if (!st) return;
  const key = `${which}_align` as const;
  if (align) st[key] = align; else delete st[key];
  await p.saveScheme(k);
}

/** A structure for the conditions (a MOL file): its id, for the text (@struct{s-…}). */
export async function addInlineStructure(p: SiProject, k: SiScheme, molblock: string): Promise<string> {
  const sid = newId('s');
  const rel = await freePath(p, k, sid, '.mol');
  await p.folder.writeText(join(k.folder, rel), molblock.endsWith('\n') ? molblock : molblock + '\n');
  editorData(k).inline[sid] = { structure: rel };
  await p.saveScheme(k);
  return sid;
}

/** A structure in the conditions drawn again (a MOL file). */
export async function setInlineStructure(p: SiProject, k: SiScheme, sid: string, molblock: string): Promise<void> {
  const inl = editorData(k).inline;
  const e = isObj(inl[sid]) ? (inl[sid] as Json) : (inl[sid] = {});
  let rel = text(e.structure);
  if (!rel) rel = await freePath(p, k, sid, '.mol');
  await p.folder.writeText(join(k.folder, rel), molblock.endsWith('\n') ? molblock : molblock + '\n');
  e.structure = rel;
  await p.saveScheme(k);
}

/** A box shows one of the scheme's compound pages (which has no box yet). */
export async function linkCompound(p: SiProject, k: SiScheme, id: string, compoundId: string): Promise<void> {
  const f = findBox(k, id);
  const c = k.children.find((x) => x.id === compoundId);
  if (!f || !c) return;
  if (allBoxes(k).some(([b]) => b.compound === compoundId)) throw new Error('That compound is already shown by another box.');
  // a compound with no structure takes the box's
  const own = text(f.box.structure);
  if (!p.hasStructure(c) && own) {
    const mol = await p.folder.readText(join(k.folder, own));
    if (mol) await p.setStructure(c, mol);
  }
  f.box.compound = compoundId;
  delete f.box.label;
  syncChildren(k);
  await p.saveScheme(k);
}

/** A box becomes a compound: a new compound page of the scheme (an ID, a data page) takes its structure. */
export async function markAsCompound(p: SiProject, k: SiScheme, id: string, name = ''): Promise<SiCompound | null> {
  const f = findBox(k, id);
  if (!f) return null;
  const linked = boxCompound(k, f.box);
  if (linked) return linked;
  let at = 0;
  for (const [b] of allBoxes(k)) { if (b.id === id) break; if (boxCompound(k, b)) at++; }
  const c = await p.addSchemeCompound(k, at, name);
  const own = text(f.box.structure);
  if (own) {
    const mol = await p.folder.readText(join(k.folder, own));
    if (mol) await p.setStructure(c, mol);
  }
  f.box.compound = c.id;
  delete f.box.label;
  syncChildren(k);
  await p.saveScheme(k);
  return c;
}

/** A box stops showing its compound (the compound page stays; the box keeps a copy of its structure and picture). */
export async function unlinkBox(p: SiProject, k: SiScheme, id: string): Promise<void> {
  const f = findBox(k, id);
  const c = f ? boxCompound(k, f.box) : null;
  if (!f || !c) return;
  await takeCompoundFiles(p, k, f.box, c);
  syncChildren(k);
  await p.saveScheme(k);
}

const PICTURE_ORIGINALS = ['.emf', '.pdf', '.cdxml'];

/**
 * A copy of the compound's structure and picture becomes the box's own, and the box no longer
 * shows the compound (the scheme still shows the same structure). The box's own files from
 * before go to the Trash (they were hidden while it showed the compound). Gives the files written.
 */
export async function takeCompoundFiles(p: SiProject, k: SiScheme, box: Json, c: SiCompound): Promise<string[]> {
  const written: string[] = [];
  const old = await ownFiles(p, k, box);
  const id = text(box.id) || 'box';
  const next: Json = {};
  if (p.hasStructure(c)) {
    const rel = await freePath(p, k, id, '.mol');
    await p.folder.writeText(join(k.folder, rel), await p.readStructure(c));
    written.push(join(k.folder, rel));
    next.structure = rel;
  }
  const v = valuesOfCompound(c).structure;
  const pic = isObj(v) ? text(v.image_override) : '';
  const bytes = pic ? await p.folder.readBytes(join(c.folder, pic)) : null;
  if (pic && bytes) {
    const ext = (/\.[^./]+$/.exec(pic)?.[0] ?? '.png').toLowerCase();
    const rel = await freePath(p, k, id, ext);
    await p.folder.writeBytes(join(k.folder, rel), bytes);
    written.push(join(k.folder, rel));
    next.picture = rel;
    const stem = pic.replace(/\.[^./]+$/, '');
    for (const e of PICTURE_ORIGINALS) {
      if (e === ext) continue;
      const original = await p.folder.readBytes(join(c.folder, stem + e));
      if (!original) continue;
      const to = join(k.folder, rel.replace(/\.[^./]+$/, e));
      await p.folder.writeBytes(to, original);
      written.push(to);
    }
  }
  await trashSuperseded(p, k, box, old);
  delete box.compound;
  delete box.structure;
  delete box.picture;
  Object.assign(box, next);
  return written;
}

/** A compound leaves this scheme page (moved out, or deleted): each box that showed it keeps a copy of its structure and picture. Saves the scheme unless `save` is false. */
export async function compoundLeaving(p: SiProject, k: SiScheme, compoundId: string, save = true): Promise<string[]> {
  if (!isObj(k.data.editor)) return [];  // (a scheme from before the scheme editor: no boxes)
  const boxes = allBoxes(k).map(([b]) => b).filter((b) => text(b.compound) === compoundId);
  const c = k.children.find((x) => x.id === compoundId) ?? null;
  const written: string[] = [];
  for (const b of boxes) {
    if (c) written.push(...await takeCompoundFiles(p, k, b, c));
    else delete b.compound;
  }
  if (boxes.length && save) await p.saveScheme(k);
  return written;
}

/** A scheme page made from a compound page (Change to Reaction Scheme…): an empty starting material, one step, and the compound as its product. */
export function startWithCompound(k: SiScheme, c: SiCompound): void {
  const data = editorData(k);
  data.starting = [{ id: newId('b') }];
  data.steps = [{ id: newId('st'), top: '', bottom: '', products: [{ id: newId('b'), compound: c.id }] }];
  k.data.mode = 'editor';
}

// ---------------------------------------------------------------- layout

/** The layout a scheme prints with (its own over the project's over the built-in ones). */
export function layoutOf(p: SiProject, k: SiScheme): SchemeLayout {
  return schemeLayout(isObj(p.settings.schemes) ? p.settings.schemes : null, isObj(editorData(k).layout) ? editorData(k).layout : null);
}

/** The project's defaults (Project Settings ▸ Schemes). */
export function projectLayout(p: SiProject): SchemeLayout {
  return schemeLayout(isObj(p.settings.schemes) ? p.settings.schemes : null, null);
}

function differences(values: Partial<SchemeLayout>, base: SchemeLayout): Json {
  const clean = schemeLayout(null, values as Json);
  const out: Json = {};
  for (const key of Object.keys(values) as (keyof SchemeLayout)[]) if (clean[key] !== base[key]) out[key] = clean[key];
  return out;
}

/** A scheme's own layout (only what differs from the project's defaults). */
export async function setSchemeLayout(p: SiProject, k: SiScheme, values: Partial<SchemeLayout>): Promise<void> {
  const diff = differences(values, projectLayout(p));
  const d = editorData(k);
  if (Object.keys(diff).length) d.layout = diff; else delete d.layout;
  await p.saveScheme(k);
}

/**
 * The project's scheme defaults (only what differs from the built-in ones). The size of
 * structures in the conditions is always written when it isn't SI Assistant's own (60 %), so
 * both programs print it alike.
 */
export async function setProjectLayout(p: SiProject, values: Partial<SchemeLayout>): Promise<void> {
  const diff = differences(values, SCHEME_DEFAULTS);
  const pct = schemeLayout(null, values as Json).cond_structure_pct;
  if (pct !== SI_ASSISTANT_COND_PCT) diff.cond_structure_pct = pct;
  if (Object.keys(diff).length) p.settings.schemes = diff; else delete p.settings.schemes;
  await p.saveSettings();
}
