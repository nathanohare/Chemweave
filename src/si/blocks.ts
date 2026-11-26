// The text of one compound's block in the compiled SI, ACS style, as Chem SI Assistant writes
// it (compile/blocks.py):
//
//   **1-Phenylethan-1-ol (2a).**  [structure]
//   <procedure>
//   Colorless oil (57.4 mg, 94%). *R*f = 0.23 (…). **¹H NMR** (500 MHz, CDCl₃) δ 7.39–7.34 (m, 4H), …
//   **HRMS** (ESI) *m/z*: [M+Na]⁺ calcd for C₈H₁₀NaO 145.0624; found 145.0625.
//
// Paragraphs of runs, the stored text format, so the user's own "SI text" field can replace the
// generated text exactly as typed.

import { CITE, parseMarkup, type Paragraph, type Run } from './markup';
import { eeWithUnit, fieldDef, partText, type FieldDef } from './fields';
import { fieldKeys, fieldsOf, valuesOf, compoundName, type Json, type SiCompound, type SiProject } from './project';
import { hrmsCalc, hrmsSpecies, hrmsTolerance, monoisotopic, outOfTolerance, parseNumber, printedIonLabel } from './checks';
import { ChemError, type MolFacts } from './chem';
import { nameRuns } from './chem-names';
import { R, but, chargeRuns, formatChemistry, formatNmr, formulaRuns, plain, type Leave } from './format';
import { DEFAULT_GP_SENTENCE, autoValues, fillSentence, purificationSentence, usesPurification } from './procedures';
import { compoundSrc, tag } from './source-map';
import { after } from '../regex-behind';

export const SI_TEXT_KEY = 'si_text';
const SKIP = new Set(['structure', 'name', 'notes', 'private_files', 'spectra', 'files', 'scale', SI_TEXT_KEY]);

export interface InlineFigure { field: string; file: string; caption: string }

export interface CompoundBlock {
  title: Run[];
  paragraphs: Paragraph[];
  figures: InlineFigure[];
  /** The user's own SI text replaced the generated text. */
  customText: boolean;
}

/** What building a block needs besides the project: the structure's facts and how to format. */
export interface BlockOptions {
  facts: MolFacts | null;
  /** Format chemistry in the text (the project's "format_text", on unless turned off). */
  helpers: boolean;
  leave?: Leave;
  /** Where a peak report's "¹H NMR" links to: the compound's spectrum of that nucleus (`#` and its bookmark), or null. */
  nmrLink?: (nucleus: string) => string | null;
}

const dict = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const valueOf = (c: SiCompound, key: string): Json => dict(valuesOf(c)[key]);
const itemsOf = (c: SiCompound, key: string): Json[] => {
  const v = valuesOf(c)[key];
  return Array.isArray(v) ? v.filter((i): i is Json => !!i && typeof i === 'object' && !Array.isArray(i)) : [];
};
const fieldDefs = (c: SiCompound): FieldDef[] => fieldsOf(c).map(fieldDef).filter((d): d is FieldDef => d !== null);

function endSentence(runs: Run[]): Run[] {
  const t = plain(runs).trimEnd();
  return t && !'.;:!?'.includes(t[t.length - 1]) ? [...runs, R('.')] : runs;
}
const dashRanges = (t: string): string => t.replace(after(/\s*-\s*(?=\d)/g, /\d/), '–');
const withSpace = (runs: Run[]): Run[] => (runs.length ? [...runs, R(' ')] : runs);

/** The first n characters made bold. */
function boldPrefix(runs: Run[], n: number): Run[] {
  const out: Run[] = [];
  let left = n;
  for (const r of runs) {
    if (left <= 0) out.push(r);
    else if (r.text.length <= left) { out.push(but(r, { bold: true })); left -= r.text.length; }
    else { out.push(but(r, { text: r.text.slice(0, left), bold: true }), but(r, { text: r.text.slice(left) })); left = 0; }
  }
  return out;
}

/** Characters `from` up to `to` linked to `link`. */
function linkSpan(runs: Run[], from: number, to: number, link: string): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const r of runs) {
    const s0 = at, s1 = at + r.text.length;
    at = s1;
    const a = Math.max(from, s0), b = Math.min(to, s1);
    if (b <= a) { out.push(r); continue; }
    if (a > s0) out.push(but(r, { text: r.text.slice(0, a - s0) }));
    out.push(but(r, { text: r.text.slice(a - s0, b - s0), link }));
    if (b < s1) out.push(but(r, { text: r.text.slice(b - s0) }));
  }
  return out;
}

/** `text` put in at character `index`. */
function insertAt(runs: Run[], index: number, t: string): Run[] {
  const out: Run[] = [];
  let pos = 0, done = false;
  for (const r of runs) {
    if (!done && pos <= index && index <= pos + r.text.length) {
      const cut = index - pos;
      out.push(but(r, { text: r.text.slice(0, cut) }), R(t), but(r, { text: r.text.slice(cut) }));
      done = true;
    } else out.push(r);
    pos += r.text.length;
  }
  if (!done) out.push(R(t));
  return out.filter((r) => r.text);
}

const NMR_HEADER = /^\s*\d{1,3}\s*[A-Z][a-z]?(?:\s*\{\s*\d{1,3}\s*[A-Z][a-z]?\s*\})?\s*NMR/;

/** One peak report as a sentence, starting with its bold "¹H NMR". */
export function nmrSentence(report: Json, o: BlockOptions, src?: { text: string; field: string }): Run[] {
  const paras = parseMarkup(partText(report.text));
  let runs = paras.flatMap((p) => [...(src ? tag(p.runs, src.text) : p.runs), R(' ')]).slice(0, -1);
  if (!plain(runs).trim()) return [];
  if (o.helpers) runs = formatNmr(runs, o.leave);
  const t = plain(runs);
  const m = NMR_HEADER.exec(t);
  const label = partText(report.label).trim();
  const link = o.nmrLink?.(partText(report.nucleus) || '1H') ?? null;
  if (m) {
    const end = m[0].length;
    runs = boldPrefix(runs, end);
    // (the "¹H NMR" goes to the spectrum; the white space before it doesn't)
    if (link) runs = linkSpan(runs, /^\s*/.exec(t)![0].length, end, link);
    if (label) {
      const par = /^\s*\(([^)]*)\)/.exec(t.slice(end));
      runs = par ? insertAt(runs, end + par[0].length - 1, `, ${label}`) : insertAt(runs, end, ` (${label})`);
    }
  } else {
    const n = partText(report.nucleus) || '1H';
    const digits = /^\d*/.exec(n)![0];
    const header = [...(digits ? [R(digits, { bold: true, valign: 'super', link: link ?? undefined })] : []), R(n.slice(digits.length) + ' NMR', { bold: true, link: link ?? undefined })];
    runs = [...header, ...(label ? [R(` (${label})`)] : []), R(' '), ...runs];
  }
  return src ? tag(endSentence(runs), src.field) : endSentence(runs);
}

/** "HRMS (ESI) m/z: [M+Na]⁺ calcd for C₈H₁₀NaO 145.0624; found 145.0625." */
export function hrmsSentence(p: SiProject, c: SiCompound, facts: MolFacts | null): Run[] {
  const value = valueOf(c, 'hrms');
  const foundText = partText(value.found);
  const found = parseNumber(foundText);
  const ion = partText(value.ionization).trim();
  const adduct = partText(value.adduct).trim() || '[M+H]+';
  // (the label printed may differ from the adduct, e.g. [M−Br]⁺ for a salt: SI Assistant SPEC §13f.3)
  const label = printedIonLabel(p.settings, facts, value);
  const at = (part: string): string => compoundSrc(c.id, 'hrms', part);
  let runs = [R('HRMS', { bold: true }), ...(ion ? [R(' ('), R(ion, { src: at('ionization') }), R(')')] : []), R(' '), R('m/z', { italic: true }), R(': '), ...chargeRuns(label)];
  let result = null;
  try {
    const sp = hrmsSpecies(facts, value);
    result = sp ? hrmsCalc(sp.info, adduct, foundText, hrmsTolerance(p.settings)) : null;
  } catch (e) {
    if (!(e instanceof ChemError)) throw e;
  }
  if (result) {
    const peak = result.matched && !outOfTolerance(result) ? result.matched : monoisotopic(result);
    runs = [...runs, R(' calcd for '), ...formulaRuns(peak.formula), R(` ${peak.mz.toFixed(4)}`)];
    if (found !== null) runs.push(R('; found '), R(found.toFixed(4), { src: at('found') }));
  } else if (found !== null) runs.push(R(' found '), R(found.toFixed(4), { src: at('found') }));
  else return [];
  return tag(endSentence(runs), compoundSrc(c.id, 'hrms'));
}

// (one digit at a time inside the repeat: "\d+" there let a long run of digits split many ways, which is slow on a bad piece)
const FORMULA_PIECE = /^(\d+(?:\.\d+)?)?((?:\[\d+[A-Z][a-z]?\]|[A-Z][a-z]?|\d)+)$/;

/** A typed formula, maybe a solvate ("C12H15NO·0.25H2O"): only atom counts subscripted; anything else as typed. */
export function typedFormulaRuns(t: string): Run[] {
  const pieces = t.trim().split(/\s*([·•∙])\s*/);
  const out: Run[] = [];
  for (let i = 0; i < pieces.length; i++) {
    if (i % 2) { out.push(R(pieces[i])); continue; }
    const m = FORMULA_PIECE.exec(pieces[i]);
    if (!m) return [R(t.trim())];
    if (m[1]) out.push(R(m[1]));
    out.push(...formulaRuns(m[2]));
  }
  return out;
}

/** "99% ee. HPLC (Chiralpak ID, …): tR (major) = 12.3 min, tR (minor) = 14.8 min." */
export function eeSentence(v: Record<string, string>, fmt: (runs: Run[]) => Run[] = (r) => r, srcOf: (part: string) => string | undefined = () => undefined): Run[] {
  const value = eeWithUnit(v.value ?? '');
  if (!value) return [];
  // (each typed value its own run, so the Live Preview knows which part it is)
  const V = (part: string, text = v[part] ?? ''): Run => R(text, { src: srcOf(part) });
  const valueRun = value.startsWith(v.value ?? '') && v.value ? [V('value'), R(value.slice((v.value ?? '').length))] : [R(value)];
  const conditions: Run[][] = [];
  if (v.column) conditions.push([V('column')]);
  if (v.eluent) conditions.push([V('eluent')]);
  if (v.flow) conditions.push([V('flow'), R(' mL/min')]);
  if (v.wavelength) conditions.push([V('wavelength'), R(' nm')]);
  const times: Run[][] = [];
  for (const [which, k] of [['major', 't_major'], ['minor', 't_minor']]) {
    if (v[k]) times.push([R('t', { italic: true }), R('R', { valign: 'sub' }), R(` (${which}) = `), V(k), R(' min')]);
  }
  const method = v.method ?? '';
  if (!conditions.length && !times.length) return endSentence([...valueRun, ...(method ? [R(' ('), V('method'), R(')')] : [])]);
  let runs = [...endSentence(valueRun), R(' '), method ? V('method') : R('HPLC')];
  if (conditions.length) runs = [...runs, R(' ('), ...fmt(conditions.flatMap((x, i) => (i ? [R(', '), ...x] : x))), R(')')];
  if (times.length) {
    runs.push(R(': '));
    times.forEach((t, i) => { if (i) runs.push(R(', ')); runs.push(...t); });
  }
  return endSentence(runs);
}

/** "Colorless oil (57.4 mg, 94%)." */
export function stateAndYield(c: SiCompound): Run[] {
  const keys = fieldKeys(c);
  const state = keys.includes('physical_state') ? partText(valueOf(c, 'physical_state').text).trim() : '';
  const y = keys.includes('yield') ? valueOf(c, 'yield') : {};
  const [mass, unit, pct, note] = ['mass', 'mass_unit', 'percent', 'note'].map((k) => partText(y[k]).trim());
  // (each typed value its own run, so the Live Preview knows which part it is)
  const Y = (part: string, text: string): Run => R(text, { src: compoundSrc(c.id, 'yield', part) });
  const join = (parts: Run[][], sep: string): Run[] => parts.filter((x) => x.length).flatMap((x, i) => (i ? [R(sep), ...x] : x));
  const massRuns = mass ? (unit ? [Y('mass', mass), R(' '), Y('mass_unit', unit)] : [Y('mass', mass)]) : [];
  let amounts = join([massRuns, pct ? [Y('percent', pct), R('%')] : []], ', ');
  if (note) amounts = pct ? [...amounts, R(' '), Y('note', note)] : join([amounts, [Y('note', note)]], ', ');
  let runs: Run[];
  if (state) runs = [R(state[0].toUpperCase() + state.slice(1), { src: compoundSrc(c.id, 'physical_state', 'text') }), ...(amounts.length ? [R(' ('), ...amounts, R(')')] : [])];
  else if (amounts.length) runs = [R('Yield: '), ...amounts];
  else return [];
  return endSentence(runs);
}

/** The chosen general procedure's compound sentence, filled in. */
export function gpSentence(p: SiProject, c: SiCompound, problems?: string[]): Run[] {
  const gp = p.compoundGp(c);
  if (!gp) return [];
  const choice = valueOf(c, 'procedure');
  const runs = fillSentence(partText(gp.sentence) || DEFAULT_GP_SENTENCE, dict(choice.values), autoValues(c, gp), problems, (k) => compoundSrc(c.id, 'procedure', `values.${k}`));
  return runs.length ? endSentence(runs) : [];
}

/** "Spectral data matched those reported in the literature.¹²" */
export function citationSentence(c: SiCompound, key = 'references'): Run[] {
  const value = valueOf(c, key);
  const ids = Array.isArray(value.refs) ? value.refs.filter((i): i is string => typeof i === 'string' && !!i) : [];
  const t = partText(value.text).trim();
  if (!ids.length && !t) return [];
  let runs = t ? tag(parseMarkup(t).flatMap((x) => x.runs), compoundSrc(c.id, key, 'text')) : [];
  if (runs.length) runs = endSentence(runs);
  if (ids.length) runs.push(R('', { ref: CITE + ids.join(',') }));
  return runs;
}

function partsSentence(c: SiCompound, def: FieldDef, o: BlockOptions): Run[] {
  const v: Record<string, string> = Object.fromEntries(Object.entries(valueOf(c, def.key)).map(([k, x]) => [k, partText(x).trim()]));
  const fmt = (runs: Run[]): Run[] => (o.helpers ? formatChemistry(runs, o.leave) : runs);
  // (each typed value its own run, so the Live Preview knows which part it is: source-map.ts)
  const srcOf = (part: string): string => compoundSrc(c.id, def.key, part);
  const V = (part: string, text = v[part] ?? '', look: Parameters<typeof R>[1] = {}): Run => R(text, { ...look, src: srcOf(part) });
  const joined = (parts: string[], sep: string): Run[] => parts.filter((k) => v[k]).flatMap((k, i) => (i ? [R(sep), V(k)] : [V(k)]));
  switch (def.key) {
    case 'rf': {
      if (!v.value) return [];
      const extra = joined(['eluent', 'visualization'], '; ');
      return endSentence([R('R', { italic: true }), R('f', { italic: true, valign: 'sub' }), R(' = '), V('value'), ...fmt(extra.length ? [R(' ('), ...extra, R(')')] : [])]);
    }
    case 'mp': {
      if (!v.value) return [];
      return endSentence([R('mp'), R(' '), V('value', dashRanges(v.value)), R(' °C'), ...fmt(v.solvent ? [R(' ('), V('solvent'), R(')')] : [])]);
    }
    case 'ir': {
      if (!v.bands) return [];
      return endSentence([R('IR', { bold: true }), ...(v.method ? [R(' ('), V('method'), R(')')] : []), R(' '), R('ν', { italic: true }), R('max', { valign: 'sub' }), R(' '), V('bands'), R(' cm'), R('−1', { valign: 'super' })]);
    }
    case 'rotation': {
      if (!v.value) return [];
      let runs = [R('[α]'), R('D', { valign: 'sub' })];
      if (v.temperature) runs.push(V('temperature', v.temperature, { valign: 'super' }));
      runs.push(R(' '), V('value'));
      let inside = v.c ? [R('c', { italic: true }), R(' '), V('c')] : [];
      if (v.solvent) inside = [...inside, ...(inside.length ? [R(', ')] : []), ...fmt([V('solvent')])];
      if (inside.length) runs = [...runs, R(' ('), ...inside, R(')')];
      return endSentence(runs);
    }
    case 'ee': return eeSentence(v, fmt, srcOf);
    case 'dr': {
      if (!v.value) return [];
      let runs = [R('d.r. = '), V('value')];
      if (v.method) runs = [...runs, R(' (determined by '), ...(o.helpers ? formatNmr([V('method')], o.leave) : [V('method')]), R(')')];
      return endSentence(runs);
    }
    case 'ea': {
      if (!v.calcd && !v.found) return [];
      const runs = [R('Anal.')];
      if (v.calcd) {
        runs.push(R(' Calcd'));
        if (v.formula) runs.push(R(' for '), ...tag(typedFormulaRuns(v.formula), srcOf('formula')));
        else if (o.facts?.info) runs.push(R(' for '), ...formulaRuns(o.facts.info.formula));
        runs.push(R(': '), V('calcd'), ...(v.found ? [R('.')] : []));
      }
      if (v.found) runs.push(R(' Found: '), V('found'));
      return endSentence(runs);
    }
    case 'xray': return v.ccdc ? endSentence([R('CCDC '), V('ccdc')]) : [];
  }
  if (def.custom) {
    const parts = joined(['text', 'value', 'unit'], ' ');
    return parts.length ? endSentence([R(`${def.label}: `), ...fmt(parts)]) : [];
  }
  return [];
}

/** The title: "Name (2a)." in bold, or "Compound 2a." */
export function compoundTitle(c: SiCompound, displayId: string): Run[] {
  const name = compoundName(c);
  const own = compoundSrc(c.id, 'name');
  // the name with its conventional italics (N-, tert-, (E)-…, or as typed with *…*)
  return name ? [...tag(nameRuns(name, { bold: true }), compoundSrc(c.id, 'name', 'text')), R(` (${displayId}).`, { bold: true, src: own })] : [R(`Compound ${displayId}.`, { bold: true, src: own })];
}

/** The text the program writes for this compound: the procedure, then the data. */
export function generatedParagraphs(p: SiProject, c: SiCompound, o: BlockOptions): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let data: Run[] = [];
  let didState = false;
  const keys = fieldKeys(c);
  const chemistry = (runs: Run[]): Run[] => (o.helpers ? formatChemistry(runs, o.leave) : runs);
  // (every run marked with the field it is from: source-map.ts)
  const own = (key: string, runs: Run[]): Run[] => tag(runs, compoundSrc(c.id, key));
  // the Purification field's sentence ends the procedure, unless the GP's sentence places it
  let purification = purificationSentence(c);
  if (purification && usesPurification(p.compoundGp(c))) purification = '';
  const withProcedure = keys.includes('procedure');
  for (const def of fieldDefs(c)) {
    if (SKIP.has(def.key)) continue;
    if (def.key === 'purification') {
      if (purification && !withProcedure) paragraphs.push({ runs: own('purification', chemistry([R(purification)])) });
      continue;
    }
    if (def.kind === 'richtext') {
      const typed = parseMarkup(p.compoundText(c, def.key)).filter((x) => x.runs.length).map((x) => ({ ...x, runs: tag(x.runs, compoundSrc(c.id, def.key, '@text')) }));
      if (def.key === 'procedure') {
        const sentence = own('procedure', gpSentence(p, c));
        if (sentence.length) {
          const first = typed.length ? typed.shift()!.runs : [];
          typed.unshift({ runs: [...sentence, ...(first.length ? [R(' '), ...first] : [])] });
        }
        if (purification) {
          const last = typed.length ? typed.pop()!.runs : [];
          typed.push({ runs: [...(last.length ? [...last, R(' ')] : []), R(purification, { src: compoundSrc(c.id, 'purification') })] });
        }
      }
      for (const x of typed) paragraphs.push({ runs: chemistry(x.runs) });
      continue;
    }
    if (def.kind === 'citations') { data = [...data, ...withSpace(own(def.key, citationSentence(c, def.key)))]; continue; }
    if (def.key === 'physical_state' || def.key === 'yield') {
      if (!didState) { data = [...data, ...withSpace(own('yield', stateAndYield(c)))]; didState = true; }
      continue;
    }
    if (def.kind === 'nmr') {
      // (a report's place in the stored list is its path)
      const all = valuesOf(c).nmr;
      for (const report of itemsOf(c, 'nmr')) {
        const i = Array.isArray(all) ? all.indexOf(report) : -1;
        const field = compoundSrc(c.id, 'nmr');
        data = [...data, ...withSpace(nmrSentence(report, o, { text: i >= 0 ? compoundSrc(c.id, 'nmr', `#${i}.text`) : field, field }))];
      }
      continue;
    }
    if (def.key === 'hrms') { data = [...data, ...withSpace(hrmsSentence(p, c, o.facts))]; continue; }
    if (def.kind === 'parts') data = [...data, ...withSpace(own(def.key, partsSentence(c, def, o)))];
  }
  if (data.length) paragraphs.push({ runs: data[data.length - 1].text === ' ' ? data.slice(0, -1) : data });
  return paragraphs;
}

/** The files of a compound's file fields shown with it (not Spectra): "Inline with compound" and named. */
export function inlineFigures(c: SiCompound): InlineFigure[] {
  const out: InlineFigure[] = [];
  for (const def of fieldDefs(c)) {
    if (def.kind !== 'attachments' || def.key === 'spectra') continue;
    for (const item of itemsOf(c, def.key)) {
      if ((item.placement ?? 'inline') === 'inline' && partText(item.file)) out.push({ field: def.key, file: partText(item.file), caption: partText(item.caption) });
    }
  }
  return out;
}

export function compoundBlock(p: SiProject, c: SiCompound, displayId: string, o: BlockOptions): CompoundBlock {
  const title = compoundTitle(c, displayId);
  const custom = fieldKeys(c).includes(SI_TEXT_KEY) ? p.compoundText(c, SI_TEXT_KEY).trim() : '';
  const paragraphs = custom
    ? parseMarkup(custom).filter((x) => x.runs.length).map((x) => ({ runs: tag(x.runs, compoundSrc(c.id, SI_TEXT_KEY, '@text')), ...(x.heading ? { heading: x.heading } : {}) }))
    : generatedParagraphs(p, c, o);
  return { title, paragraphs, figures: inlineFigures(c), customText: !!custom };
}
