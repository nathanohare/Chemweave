// General procedures' compound sentences filled in for a compound, as Chem SI Assistant does
// (core/procedures.py): "Prepared according to {GP} from {starting material} ({scale})." Typed
// values win over automatic ones, except {scale}, which follows the Reaction scale field.

import { MENTION, parseMarkup, type Run } from './markup';
import { partText } from './fields';
import { fieldKeys, valuesOf, type Json, type SiCompound } from './project';
import { gpKey, placeholders } from './checks';
import { R } from './format';

export const DEFAULT_GP_SENTENCE = 'Prepared according to {GP} from {starting material} ({scale}).';
export const PURIFICATION_START = 'The crude product was purified by ';
const PLACEHOLDER = /\{([^{}]+)\}/g;
/** The field's value is printed even if something is typed in the box. */
const AUTO_WINS = ['scale'];

const text = (v: unknown): string => partText(v).trim();
const dict = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

/** What the automatic placeholders become for this compound. */
export function autoValues(c: SiCompound, gp: Json): Record<string, Run[]> {
  const values = valuesOf(c), keys = fieldKeys(c);
  const out: Record<string, Run[]> = { gp: [R(partText(gp.name) || 'the general procedure')], product: [R('', { ref: MENTION + c.id })] };
  const scale = dict(values.scale);
  if (keys.includes('scale') && text(scale.value)) out.scale = [R(`${text(scale.value)} ${text(scale.unit ?? 'mmol') || 'mmol'}`)];
  const y = dict(values.yield);
  if (keys.includes('yield') && text(y.percent)) out.yield = [R(`${text(y.percent)}%`)];
  const p = purificationText(c);
  if (p) out.purification = [R(p)];
  return out;
}

function purificationValue(c: SiCompound): Record<string, string> {
  if (!fieldKeys(c).includes('purification')) return {};
  const v = valuesOf(c).purification;
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, text(x)])) : {};
}

/** "flash column chromatography (SiO₂, 10% EtOAc/hexanes)" ('' without a method). */
export function purificationTextOf(v: Record<string, string>): string {
  if (!v.method) return '';
  const inside = [v.phase ?? '', v.eluent ?? ''].filter(Boolean).join(', ');
  return v.method + (inside ? ` (${inside})` : '');
}
export const purificationText = (c: SiCompound): string => purificationTextOf(purificationValue(c));

/** The sentence at the end of the procedure: the one typed in "Printed as", else the automatic one. */
export function purificationSentence(c: SiCompound): string {
  const typed = purificationValue(c).sentence ?? '';
  if (typed) return typed;
  const t = purificationText(c);
  return t ? `${PURIFICATION_START}${t}.` : '';
}

/** Does the general procedure's sentence place {purification} itself? */
export const usesPurification = (gp: Json | null): boolean => !!gp && placeholders(partText(gp.sentence)).map(gpKey).includes('purification');

/** A typed placeholder value (stored markup, maybe with mentions) as runs. */
export function valueRuns(t: string): Run[] {
  const out: Run[] = [];
  parseMarkup(t).forEach((p, i) => {
    if (i && p.runs.length) out.push(R(' '));
    out.push(...p.runs);
  });
  return out;
}

/** The sentence with its placeholders filled in; one with no value prints as [name] and is said in `problems`. */
export function fillSentence(sentence: string, typed: Json, auto: Record<string, Run[]>, problems?: string[]): Run[] {
  const given = new Map<string, string>();
  for (const [k, v] of Object.entries(typed)) if (text(v)) given.set(gpKey(k), partText(v));
  const out: Run[] = [];
  for (const p of parseMarkup(sentence)) {
    if (out.length && p.runs.length) out.push(R(' '));
    for (const r of p.runs) {
      if (r.ref) { out.push(r); continue; }
      let pos = 0;
      for (const m of r.text.matchAll(PLACEHOLDER)) {
        if (m.index! > pos) out.push({ ...r, text: r.text.slice(pos, m.index) });
        const k = gpKey(m[1]);
        let value: Run[];
        if (AUTO_WINS.includes(k) && auto[k]) value = auto[k];
        else if (given.has(k)) value = valueRuns(given.get(k)!);
        else if (auto[k]) value = auto[k];
        else {
          value = [R(`[${m[1].trim()}]`)];
          problems?.push(`no value for {${m[1].trim()}}`);
        }
        for (const v of value) out.push(R(v.text, { bold: v.bold || r.bold, italic: v.italic || r.italic, valign: v.valign && v.valign !== 'normal' ? v.valign : r.valign, ref: v.ref, underline: v.underline || r.underline }));
        pos = m.index! + m[0].length;
      }
      if (pos < r.text.length) out.push({ ...r, text: r.text.slice(pos) });
    }
  }
  return out;
}
