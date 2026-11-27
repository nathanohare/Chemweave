// Warnings about an SI project as a whole, as Chem SI Assistant gives them (its
// core/checks.project_warnings, shown in their own group in the Warnings panel and counted on the
// project dashboard): two items with the same label, a mention in a text that is not a compound's
// whose figure, table or scheme is gone (a compound's own texts are its check 9), a citation of a
// reference no longer in the list, a figure's picture or a table's file that is missing, two
// general procedures with the same name, an X-ray structure that can't be drawn, and an author
// line that holds several authors. Same texts as SI Assistant. Warnings never block anything.

import { safeFilename } from './ids';
import { parseMarkup, mentionsIn, citationsIn } from './markup';
import { goneText, mentionKind } from './checks';
import { computeLabels, tablePath, textObjects, type SiLabels } from './labels';
import { readCif } from '../chem/cif';
import { CrystalError, grow, structureFromCif } from '../chem/crystal';
import { surname } from '../document/references';
import type { Json, SiProject, SiScheme, SiSection } from './project';

export interface ProjectWarning {
  /** 'label', 'mention', 'citation', 'object', 'gp_name', 'reference' or 'xray' (dashboard.ts CHECK_LABELS). */
  check: string;
  message: string;
  /** The tree item to open: ['front', 'general' | 'cover'], ['section', id], ['scheme', id], ['compound', id], ['references', 'references'] (['', ''] when there is none). */
  place: [string, string];
  /** For a compound: the field to scroll to. */
  field: string;
}

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const dict = (v: unknown): Json => (isObj(v) ? v : {});
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const join = (...parts: string[]): string => parts.filter(Boolean).join('/');
const pw = (check: string, message: string, place: [string, string], field = ''): ProjectWarning => ({ check, message, place, field });

/** One stored text that is not a compound's: what kind, whose, where (for messages) and its markup. */
interface TextPlace { kind: 'front' | 'section' | 'table' | 'gp' | 'gp_sentence' | 'scheme'; owner: string; where: string; text: string }

/** A table's cells (not empty ones) and footnotes, one a line, as SI Assistant reads them for links. */
function tableBody(t: Json): string {
  const cells: string[] = [];
  for (const row of Array.isArray(t.rows) ? t.rows : []) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (cell === null || cell === undefined) continue;
      const c = typeof cell === 'string' ? cell : text(dict(cell).text);
      if (c.trim()) cells.push(c);
    }
  }
  const notes = (Array.isArray(t.footnotes) ? t.footnotes : []).filter((n) => n !== null && n !== undefined).map((n) => (typeof n === 'string' ? n : String(n))).filter((n) => n.trim());
  return [...cells, ...notes].join('\n');
}

async function readJson(p: SiProject, rel: string): Promise<unknown> {
  const t = await p.folder.readText(rel);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

async function tableTexts(p: SiProject, owner: string, folder: string, body: string, where: string): Promise<TextPlace[]> {
  const out: TextPlace[] = [];
  for (const para of parseMarkup(body)) {
    if (!para.table) continue;
    const t = await readJson(p, tablePath(folder, para.table));
    if (!isObj(t)) continue;
    const cells = tableBody(t);
    if (cells) out.push({ kind: 'table', owner, where: `${where} ▸ table`, text: cells });
  }
  return out;
}

/** The scheme editor's conditions (above and under each arrow) and typed ID labels, read without changing the scheme. */
function schemeTexts(k: SiScheme, where: string): TextPlace[] {
  const out: TextPlace[] = [];
  const data = dict(k.data.editor);
  const steps = (Array.isArray(data.steps) ? data.steps : []).filter(isObj);
  steps.forEach((step, i) => {
    for (const [which, word] of [['top', 'above'], ['bottom', 'under']] as const) {
      const t = text(step[which]);
      if (t.trim()) out.push({ kind: 'scheme', owner: k.id, where: `${where} ▸ step ${i + 1}, conditions ${word} the arrow`, text: t });
    }
  });
  const boxes = [...(Array.isArray(data.starting) ? data.starting : []), ...steps.flatMap((st) => (Array.isArray(st.products) ? st.products : []))].filter(isObj);
  for (const box of boxes) {
    const label = text(box.label);
    if (label.trim() && !box.compound) out.push({ kind: 'scheme', owner: k.id, where: `${where} ▸ ID label`, text: label });
  }
  return out;
}

/** Every stored text that is not a compound's own, in document order. */
async function otherTexts(p: SiProject): Promise<TextPlace[]> {
  const out: TextPlace[] = [];
  for (const [key, where] of [['cover', 'Front matter ▸ Cover page'], ['general', 'Front matter ▸ General Information']] as const) {
    const t = await p.readFrontText(key);
    if (!t) continue;
    out.push({ kind: 'front', owner: key, where, text: t });
    if (key === 'general') out.push(...(await tableTexts(p, 'general', 'front', t, where)));
  }
  for (const s of p.sections) {
    if (s.type === 'text') {
      const t = await p.readSectionText(s);
      out.push({ kind: 'section', owner: s.id, where: s.name, text: t });
      out.push(...(await tableTexts(p, s.id, s.folder, t, s.name)));
    }
    if (s.type !== 'data') continue;
    for (const gp of p.generalProcedures(s)) {
      const id = text(gp.id), name = text(gp.name);
      out.push({ kind: 'gp', owner: id, where: `${s.name} ▸ ${name}`, text: await p.readGpText(s, id) });
      out.push({ kind: 'gp_sentence', owner: id, where: `${s.name} ▸ ${name} (compound sentence)`, text: text(gp.sentence) });
    }
    for (const k of s.items) if (k.kind === 'scheme') out.push(...schemeTexts(k, `${s.name} ▸ ${text(k.data.name) || 'Scheme'}`));
  }
  return out;
}

function textPlace(p: SiProject, t: TextPlace): [string, string] {
  if (t.kind === 'front') return ['front', t.owner];
  if (t.kind === 'scheme') return ['scheme', t.owner];
  if (t.kind === 'section' || t.kind === 'table') return t.owner === 'general' ? ['front', 'general'] : ['section', t.owner];
  const found = p.generalProcedure(t.owner);
  return found ? ['section', found.section.id] : ['', ''];
}

/** Figures and tables in General Information's or a Custom section's text whose picture or table file is no longer there. */
async function missingObjects(p: SiProject): Promise<ProjectWarning[]> {
  const out: ProjectWarning[] = [];
  const owners: { key: string; name: string; folder: string; section: SiSection | null }[] = [
    { key: 'general', name: 'General Information', folder: 'front', section: null },
    ...p.sections.filter((s) => s.type === 'text').map((s) => ({ key: s.id, name: s.name, folder: s.folder, section: s })),
  ];
  for (const o of owners) {
    const body = o.section ? await p.readSectionText(o.section) : await p.readFrontText('general');
    const place: [string, string] = o.key === 'general' ? ['front', 'general'] : ['section', o.key];
    let figures: Json | null = null;
    for (const obj of textObjects(body)) {
      if (obj.kind === 'figure') {
        figures ??= await p.ownerFigures(o.section ?? 'general');
        const file = text(dict(figures[obj.id]).file);
        if (!file || !(await p.folder.exists(join(o.folder, file)))) {
          out.push(pw('object', `${o.name}: a figure's picture is missing, so the figure is left out of the SI. Restore it from the Trash if it was removed, or replace the picture (right-click it).`, place));
        }
      } else if (obj.kind === 'table' && !(await p.folder.exists(join(o.folder, 'tables', `${safeFilename(obj.id)}.json`)))) {
        out.push(pw('object', `${o.name}: a table's file is missing, so the table is left out of the SI. Restore it from the Trash if it was removed.`, place));
      }
    }
  }
  return out;
}

/** A general procedure's name as names are compared: capitals and spaces ignored ("General Procedure A" = "generalprocedurea"). */
export const gpNameKey = (name: string): string => name.toLowerCase().replace(/\s+/g, '');

/** Two general procedures with the same name (ignoring capitals and spaces) anywhere in the project. */
function duplicateGpNames(p: SiProject): ProjectWarning[] {
  const out: ProjectWarning[] = [];
  const groups = new Map<string, [SiSection, Json][]>();
  for (const s of p.dataSections) {
    for (const gp of p.generalProcedures(s)) {
      const k = gpNameKey(text(gp.name));
      if (k) groups.set(k, [...(groups.get(k) ?? []), [s, gp]]);
    }
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const [s, gp] of group) {
      const others = group.filter(([, o]) => o !== gp).map(([os, o]) => `“${text(o.name)}” in “${os.name}”`).join('; ');
      out.push(pw('gp_name', `General procedure “${text(gp.name)}” (in “${s.name}”) has the same name as ${others}. Rename one of them (Data section ▸ General procedures).`, ['section', s.id]));
    }
  }
  return out;
}

// (a CIF is read again only when it changes, as SI Assistant keeps it: one result for each X-ray
// section, written over when its CIF, file or data block changes; a check of every section in turn
// then finds them all however many sections the project has)
const xrayCache = new Map<string, { file: string; wanted: string; cif: string; error: string }>();
/** A bound on the sections kept, over all the projects opened (the oldest goes first). */
const XRAY_CACHE_SIZE = 1024;

/** Why an X-ray structure section can't be drawn ('' when it can). */
export async function xrayError(p: SiProject, s: SiSection): Promise<string> {
  const file = text(s.data.file);
  if (!file) return 'No CIF file has been chosen yet.';
  const name = file.slice(file.replace(/\\/g, '/').lastIndexOf('/') + 1);
  const cif = await p.folder.readText(join(s.folder, file));
  if (cif === null) return `The CIF file ${name} is missing from the section's folder.`;
  const wanted = text(s.data.block);
  const key = `${p.folder.where}\u0000${s.folder}`;
  const hit = xrayCache.get(key);
  if (hit && hit.file === file && hit.wanted === wanted && hit.cif === cif) return hit.error;
  let error = '';
  try {
    const blocks = readCif(cif).filter((b) => b.rows('_atom_site_label').length);
    if (!blocks.length) error = `${name} holds no structure (no _atom_site_ table).`;
    else grow(structureFromCif(blocks.find((b) => b.name === wanted) ?? blocks[0]));
  } catch (e) {
    error = e instanceof CrystalError ? e.message : `${name} could not be read: ${e instanceof Error ? e.message : String(e)}`;
  }
  xrayCache.delete(key);
  while (xrayCache.size >= XRAY_CACHE_SIZE) xrayCache.delete(xrayCache.keys().next().value!);
  xrayCache.set(key, { file, wanted, cif, error });
  return error;
}

async function xrayProblems(p: SiProject): Promise<ProjectWarning[]> {
  const out: ProjectWarning[] = [];
  for (const s of [...p.sections.filter((x) => x.type === 'xray'), ...[...p.anchored.values()].flat()]) {
    const error = await xrayError(p, s);
    if (error) out.push(pw('xray', `X-ray structure “${s.name}”: ${error} It is left out of the SI until it can be drawn.`, ['section', s.id]));
  }
  return out;
}

/** A reference's authors as SI Assistant reads them (a line of text split at ";" and "and"; empty ones dropped). */
function authorsOf(r: Json): string[] {
  const v = r.authors;
  if (typeof v === 'string') return v.split(/\s*;\s*|\s+and\s+/).map((a) => a.trim()).filter(Boolean);
  return (Array.isArray(v) ? v : []).filter((a) => a !== null && a !== undefined).map((a) => String(a).trim()).filter(Boolean);
}

/** "Fulmer 2010", "Fulmer & Miller 2010", "Smith et al. 2020": how a reference is named in lists. */
function shortLabel(r: Json): string {
  const names = authorsOf(r).map(surname).filter(Boolean);
  const who = !names.length ? (text(r.title) || 'Untitled').slice(0, 30) : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} et al.`;
  return `${who} ${text(r.year).trim()}`.trim();
}

/**
 * What in a reference can't be printed as typed. (SI Assistant also reports a year that is not a
 * plain year and a web address Typst can't print; Chemweave prints both as typed, so they are not.)
 */
export function referenceProblems(r: Json): string[] {
  return authorsOf(r).filter((a) => a.includes(';') || (a.match(/,/g) ?? []).length >= 3).map((a) => `the author line “${a}” looks like several authors; put one author per line`);
}

/**
 * Warnings about the project as a whole, as SI Assistant's Warnings panel lists them: duplicate
 * labels, broken mentions and citations in texts that are not a compound's, missing figure and
 * table files, duplicate general-procedure names, X-ray structures that can't be drawn and
 * references that can't be printed as typed. Pass `labels` when they are already worked out.
 */
export async function projectWarnings(p: SiProject, labels?: SiLabels): Promise<ProjectWarning[]> {
  labels ??= await computeLabels(p);
  const out: ProjectWarning[] = [];
  for (const items of labels.duplicates.values()) {
    for (const item of items) {
      const others = items.filter((o) => o !== item).map((o) => o.where).join('; ');
      out.push(pw('label', `“${item.label}” (${item.where}) has the same label as ${others}. Give one of them its own label, or let both be numbered automatically.`, item.place, item.place[0] === 'compound' ? 'files' : ''));
    }
  }
  let exists: Set<string> | null = null;
  for (const t of await otherTexts(p)) {
    const ps = parseMarkup(t.text);
    const gone = [...new Set(mentionsIn(ps))].filter((m) => (mentionKind(m) === 'compound' ? !(exists ??= new Set(p.compounds.map((c) => c.id))).has(m) : !labels!.byId.has(m)));
    const missing = [...new Set(citationsIn(ps))].filter((r) => !p.reference(r));
    if (!gone.length && !missing.length) continue;
    const target = textPlace(p, t);
    for (const id of gone) out.push(pw('mention', `${t.where}: ` + goneText(p, id), target));
    for (let i = 0; i < missing.length; i++) out.push(pw('citation', `${t.where}: cites a reference that is no longer in the References list; it will be left out of the SI.`, target));
  }
  out.push(...(await missingObjects(p)));
  out.push(...duplicateGpNames(p));
  out.push(...(await xrayProblems(p)));
  for (const r of p.references) {
    for (const problem of referenceProblems(r)) out.push(pw('reference', `Reference “${shortLabel(r)}”: ${problem}. Edit it on the References page.`, ['references', 'references']));
  }
  return out;
}
