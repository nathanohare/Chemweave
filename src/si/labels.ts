// Figure, table and scheme labels of an SI project, as Chem SI Assistant works them out (its
// core/labels.py, SPEC §13k.5a): numbered in the order the items appear in the SI (General
// Information, then every section in tree order; a Data section's scheme pages that show their
// label, the files its compounds show "Inline with compound" and the X-ray structures under
// them), with the rules of Project settings ▸ Labels. A label typed over still uses up its
// number. Each item says where it is ("Optimization ▸ 3a"), so two items with the same label
// can be reported (project-warnings.ts). The compiler numbers its labels the same way.

import { compoundName, fieldsOf, valuesOf, type Json, type SiCompound, type SiProject, type SiSection } from './project';
import { displayId, type IdReport } from './compound-ids';
import { fieldDef, partText } from './fields';
import { parseMarkup } from './markup';
import { safeFilename } from './ids';
import { schemeLayout } from './scheme-draw';
import { countText, type CountStyle } from './heading-format';

export const LABEL_KINDS = ['figure', 'table', 'scheme'] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

export interface LabelItem {
  kind: LabelKind;
  /** Its internal id ('' for an older picture paragraph that has none yet). */
  id: string;
  /** 'general', a section's, a compound's or a scheme's id. */
  owner: string;
  /** Its place among the owner's labeled items (0, 1, …). */
  index: number;
  /** The automatic label ("Table S2"). */
  auto: string;
  /** The label typed over it ('' = automatic). */
  custom: string;
  /** The label printed: the typed one, else the automatic one. */
  label: string;
  /** For messages: "General Information", "Optimization ▸ 3a (benzaldehyde)". */
  where: string;
  /** The tree item to open: ['front', 'general'], ['section', id], ['scheme', id] or ['compound', id]. */
  place: [string, string];
}

export interface SiLabels {
  items: LabelItem[];
  /** The first item with each id. */
  byId: Map<string, LabelItem>;
  /** Items that share a label (ignoring capitals and runs of spaces), by the first one's label. */
  duplicates: Map<string, LabelItem[]>;
}

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const dict = (v: unknown): Json => (isObj(v) ? v : {});
/** Python's str(v or ''): what SI Assistant makes of a hand-edited value that is not text. */
const pyText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? (v ? String(v) : '') : v === true ? 'True' : '');
/** Capitals and runs of spaces ignored, as SI Assistant compares labels. */
export const labelKey = (s: string): string => s.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

type Rule = { word: string; prefix: string; style: string };

/** The rule in effect for each kind (Project settings ▸ Labels; a figure's word follows the journal style). */
export function labelRules(settings: Json): Record<LabelKind, Rule> {
  const journal = typeof settings.journal_style === 'string' ? settings.journal_style : 'ACS';
  const raw = dict(settings.labels);
  const out = {} as Record<LabelKind, Rule>;
  for (const kind of LABEL_KINDS) {
    const rule = { word: kind === 'figure' && journal === 'RSC' ? 'Fig.' : kind[0].toUpperCase() + kind.slice(1), prefix: 'S', style: '1' };
    const stored = dict(raw[kind]);
    if (typeof stored.word === 'string') rule.word = stored.word.trim();
    if (typeof stored.prefix === 'string') rule.prefix = stored.prefix.trim();
    if (typeof stored.style === 'string' && ['1', 'I', 'i', 'a'].includes(stored.style)) rule.style = stored.style;
    out[kind] = rule;
  }
  return out;
}

/** "Table S2" for the second table. */
export function autoLabel(rule: Rule, n: number): string {
  const number = rule.prefix + countText(n, rule.style as CountStyle);
  return rule.word ? `${rule.word} ${number}` : number;
}

/** The (kind, id) of each figure and table paragraph of a text, in order (an older picture paragraph: a figure with no id). */
export type TextObject = { kind: 'figure' | 'table' | 'image'; id: string };
export function textObjects(text: string): TextObject[] {
  return parseMarkup(text).flatMap((p): TextObject[] => (p.figure ? [{ kind: 'figure', id: p.figure }] : p.table ? [{ kind: 'table', id: p.table }] : p.image ? [{ kind: 'image', id: p.image }] : []));
}

/** A table file's path from the project folder (an owner's tables/<id>.json). */
export const tablePath = (ownerFolder: string, id: string): string => [ownerFolder, 'tables', `${safeFilename(id)}.json`].filter(Boolean).join('/');

async function readJson(p: SiProject, rel: string): Promise<unknown> {
  const t = await p.folder.readText(rel);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

/** Whether a compound's attached file is printed as a figure with it ("Inline with compound", with a file name). */
export function isInlineFigure(item: unknown): boolean {
  return isObj(item) && ('placement' in item ? item.placement : 'inline') === 'inline' && !!partText(item.file);
}

/**
 * Every figure, table and scheme label of the project, in document order. `live` ({owner key:
 * text}) uses a text being edited instead of the saved one.
 */
export async function computeLabels(p: SiProject, live: Record<string, string> = {}, report?: IdReport): Promise<SiLabels> {
  const rules = labelRules(p.settings);
  const counters: Record<LabelKind, number> = { figure: 0, table: 0, scheme: 0 };
  const items: LabelItem[] = [];
  const add = (kind: LabelKind, id: string, owner: string, index: number, custom: unknown, where: string, place: [string, string]): void => {
    const auto = autoLabel(rules[kind], ++counters[kind]);
    const typed = pyText(custom).trim();
    items.push({ kind, id, owner, index, auto, custom: typed, label: typed || auto, where, place });
  };

  const textOwner = async (key: string, name: string, folder: string, text: string, figures: () => Promise<Json>, place: [string, string]): Promise<void> => {
    const found = textObjects(key in live ? live[key] : text);
    const figs = found.some((o) => o.kind === 'figure') ? await figures() : {};
    for (let index = 0; index < found.length; index++) {
      const o = found[index];
      if (o.kind === 'table') {
        const t = await readJson(p, tablePath(folder, o.id));
        add('table', o.id, key, index, isObj(t) ? t.label : '', name, place);
      } else add('figure', o.kind === 'figure' ? o.id : '', key, index, o.kind === 'figure' ? dict(figs[o.id]).label : '', name, place);
    }
  };

  const xray = (s: SiSection, where: string): void => {
    if (!s.data.file) return;
    add('figure', s.id, s.id, 0, s.data.label, where, ['section', s.id]);
    if (!('table' in s.data) || s.data.table) add('table', s.id + '#table', s.id, 1, s.data.table_label, where, ['section', s.id]);
  };

  const inlineFiles = (c: SiCompound, where: string): void => {
    let index = 0;
    for (const e of fieldsOf(c)) {
      const def = fieldDef(e);
      if (!def || def.kind !== 'attachments' || def.key === 'spectra') continue;
      const list = valuesOf(c)[def.key];
      for (const item of Array.isArray(list) ? list : []) {
        if (!isInlineFigure(item)) continue;
        const x = item as Json;
        add('figure', typeof x.id === 'string' ? x.id : typeof x.id === 'number' ? String(x.id) : '', c.id, index++, x.label, where, ['compound', c.id]);
      }
    }
  };

  await textOwner('general', 'General Information', 'front', await p.readFrontText('general'), () => p.ownerFigures('general'), ['front', 'general']);
  for (const s of p.sections) {
    if (s.type === 'text') await textOwner(s.id, s.name, s.folder, s.id in live ? '' : await p.readSectionText(s), () => p.ownerFigures(s), ['section', s.id]);
    else if (s.type === 'xray') xray(s, s.name);
    else if (s.type === 'data') {
      report ??= p.idReport();
      for (const entry of s.items) {
        const name = pyText(entry.data.name) || 'Scheme';
        if (entry.kind === 'scheme' && schemeLayout(dict(p.settings.schemes), dict(dict(entry.data.editor).layout)).show_label) {
          add('scheme', entry.id, entry.id, 0, entry.data.label, `${s.name} ▸ ${name}`, ['scheme', entry.id]);
        }
        for (const c of entry.kind === 'scheme' ? entry.children : [entry]) {
          const shown = displayId(report, c.id);
          const cname = compoundName(c);
          inlineFiles(c, `${s.name} ▸ ${shown}` + (cname ? ` (${cname})` : ''));
          for (const x of p.anchored.get(c.id) ?? []) xray(x, `${s.name} ▸ ${shown} ▸ ${x.name}`);
        }
      }
    }
  }

  const byId = new Map<string, LabelItem>();
  const groups = new Map<string, LabelItem[]>();
  for (const item of items) {
    if (item.id && !byId.has(item.id)) byId.set(item.id, item);
    const k = labelKey(item.label);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  const duplicates = new Map<string, LabelItem[]>();
  for (const group of groups.values()) if (group.length > 1) duplicates.set(group[0].label, group);
  return { items, byId, duplicates };
}
