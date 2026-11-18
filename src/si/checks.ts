// The automatic checks of a compound page, as Chem SI Assistant makes them (core/checks.py):
// every result is a warning, never a block. A warning can be dismissed for a compound (with a
// reason); the dismissal keeps a fingerprint of the data the warning was about, worked out
// exactly as SI Assistant works it out (pyrepr.ts), so it comes back if that data changes, and
// a dismissal made in either program holds in the other.
//
// The checks: HRMS (ppm error against the nearest isotope peak, an adduct or typed formula that
// can't be used, an already-charged M, a typed M formula unlike the structure's); ¹³C signal
// count; ¹H integration; solvent and impurity peaks; large ¹H couplings; yield from mass, scale
// and MW; spectra present; NMR frequencies; heteroatom NMR; IDs; broken mentions and citations;
// the general procedure chosen (gone, a placeholder without a value, {scale} unlike the field,
// a Purification sentence it doesn't print).

import * as chem from './chem';
import { type MolFacts, type MolInfo, ChemError } from './chem';
import { fieldDef, nucleusLabel, partText, NUCLEI, SPECTRUM_TYPES } from './fields';
import { parseMarkup, mentionsIn, citationsIn } from './markup';
import * as nmr from './nmr';
import { fp, pyF, pyG, pySigned1, sortedFp } from './pyrepr';
import { isFloat } from './pyjson';
import { type IdReport } from './compound-ids';
import { type SiCompound, type SiProject, fieldKeys, fieldsOf, valuesOf } from './project';
import { differsMessage, r6, type Match } from './ms-reports';
import { reportItems } from './spectra';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Json => (isObj(v) ? v : {});

export const ID_KEY = 'id';
export const GENERIC_STRUCTURE_KEY = 'structure:generic';
export const LARGE_J_HZ = 20;

export interface SiWarning {
  check: string;
  /** The field it is about ("id" for ID problems). */
  field: string;
  message: string;
  /** Which warning of the compound it is (a dismissal is kept under it). */
  key: string;
  fingerprint: string;
  /** The fingerprint an earlier SI Assistant gave the same warning ('' if none). */
  legacy: string;
}

const w = (check: string, field: string, message: string, key: string, fingerprint: string, legacy = ''): SiWarning => ({ check, field, message, key, fingerprint, legacy });

export const genericStructureMessage = (atoms: string[]): string =>
  `The structure has a generic atom (${atoms.join(', ')}), so no formula or masses can be calculated. Draw the actual group, or type the M formula in the HRMS field (✎) if you need the calculated m/z.`;

// ---------------------------------------------------------------- HRMS

export interface HrmsResult {
  adduct: string;
  peaks: chem.Peak[];
  found: number | null;
  /** The calculated peak nearest the found value. */
  matched: chem.Peak | null;
  ppm: number | null;
  tolerance: number;
}
export const monoisotopic = (r: HrmsResult): chem.Peak => r.peaks.find((p) => p.mono) ?? r.peaks[0];
export const outOfTolerance = (r: HrmsResult): boolean => r.ppm !== null && Math.abs(r.ppm) > r.tolerance;

/** A number typed in a box ("145,0625" and "−3" too); null when it isn't one. */
export function parseNumber(text: unknown): number | null {
  const t = partText(text).trim().replace(/,/g, '.').replace(/−/g, '-');
  if (!t || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t.replace(/_/g, ''))) {
    return /^[+-]?(inf(inity)?|nan)$/i.test(t) ? null : null;
  }
  const n = Number(t.replace(/_/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** The calculated isotope peaks, and the ppm error against the nearest one. Throws ChemError for an adduct that can't be used. */
export function hrmsCalc(info: MolInfo, adduct: string, foundText: string, tolerance: number): HrmsResult {
  adduct = adduct || '[M+H]+';
  const peaks = chem.isotopePattern(info, adduct, 1, 12);
  if (!peaks.some((p) => p.mono)) peaks.push(chem.monoisotopicPeak(info, adduct));
  const r: HrmsResult = { adduct, peaks, found: null, matched: null, ppm: null, tolerance };
  const found = parseNumber(foundText);
  if (found !== null && found > 0) {
    r.found = found;
    r.matched = chem.nearestPeak(peaks, found);
    r.ppm = chem.ppmError(found, r.matched.mz);
    if (Math.abs(r.ppm) > tolerance) {
      r.matched = monoisotopic(r);
      r.ppm = chem.ppmError(found, r.matched.mz);
    }
  }
  return r;
}

export interface HrmsSpecies {
  info: MolInfo;
  /** The M formula was typed. */
  manual: boolean;
  /** A salt's pieces: [key, label, info]. */
  choices: [string, string, MolInfo][] | null;
  /** The piece chosen ('' = automatic). */
  key: string;
  /** The piece Automatic stands for. */
  automatic: [string, string, MolInfo] | null;
}

/** M for the HRMS field: the typed formula, else the chosen piece of a salt, else the whole structure; null without a structure. */
export function hrmsSpecies(facts: MolFacts | null, value: Json): HrmsSpecies | null {
  const formula = partText(value.formula).trim();
  if (formula) {
    const [counts, charge] = chem.parseMFormulaAndCharge(formula);
    return { info: chem.infoFromCounts(counts, charge), manual: true, choices: null, key: '', automatic: null };
  }
  if (!facts?.info) return null;
  if (facts.pieces.length <= 1) return { info: facts.info, manual: false, choices: null, key: '', automatic: null };
  const choices: [string, string, MolInfo][] = [['whole', `Whole structure (${chem.speciesLabel(facts.info)})`, facts.info]];
  for (const p of facts.pieces) choices.push([`frag:${p.smiles}`, chem.speciesLabel(p.info), p.info]);
  const automatic = choices[1 + chem.mainSpecies(facts.pieces)];
  let key = String(value.species ?? '');
  let chosen = choices.find((c) => c[0] === key);
  if (!chosen) { key = ''; chosen = automatic; }
  return { info: chosen[2], manual: false, choices, key, automatic };
}

/** For an ion already charged as drawn: [M]+, [M]2+, [M]-… */
export function suggestedAdduct(info: MolInfo): string | null {
  if (!info.charge) return null;
  const n = Math.abs(info.charge);
  return `[M]${n > 1 ? n : ''}${info.charge > 0 ? '+' : '-'}`;
}

/** A gentle warning when M is already an ion but the adduct adds atoms or charge. */
export function chargedAdductHint(info: MolInfo, adduct: string): string {
  if (!info.charge) return '';
  let a: chem.Adduct;
  try { a = chem.parseAdduct(adduct || '[M+H]+'); } catch { return ''; }
  if (!a.delta.size && a.charge === info.charge && a.multimer === 1) return '';
  return `M is already charged (${chem.speciesLabel(info)}); it is usually reported as ${chem.adductDisplay(suggestedAdduct(info)!)}.`;
}

/** The project's HRMS tolerance in ppm (5 unless it says otherwise). */
export function hrmsTolerance(settings: Json): number {
  const v = settings.hrms_tolerance_ppm;
  const n = v === undefined ? 5 : typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim() || 'x') : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** [result, problem] for a compound's HRMS field (problem '' when none). */
export function compoundHrms(project: SiProject, c: SiCompound, facts: MolFacts | null): [HrmsResult | null, string] {
  if (!fieldKeys(c).includes('hrms')) return [null, ''];
  const value = obj(valuesOf(c).hrms);
  let sp: HrmsSpecies | null;
  try { sp = hrmsSpecies(facts, value); } catch (e) { if (e instanceof ChemError) return [null, `HRMS formula: ${e.message}`]; throw e; }
  if (!sp) return [null, ''];
  let r: HrmsResult;
  try { r = hrmsCalc(sp.info, partText(value.adduct), partText(value.found), hrmsTolerance(project.settings)); } catch (e) { if (e instanceof ChemError) return [null, e.message]; throw e; }
  if (outOfTolerance(r)) return [r, `HRMS error ${pySigned1(r.ppm!)} ppm is outside the ±${pyG(r.tolerance)} ppm tolerance.`];
  return [r, ''];
}

// ---------------------------------------------------------------- the checks

const NMR_RATIOS: Record<string, number> = { '13C': 0.2515, '19F': 0.9408, '31P': 0.4048, '11B': 0.3209, '15N': 0.1014, '29Si': 0.1987, '2H': 0.1535 };
const MASS_TO_MG: Record<string, number> = { mg: 1, g: 1000, 'µg': 0.001, ug: 0.001 };
const AMOUNT_TO_MMOL: Record<string, number> = { mmol: 1, mol: 1000, 'µmol': 0.001, umol: 0.001 };

const reportText = (r: Json): string => parseMarkup(partText(r.text)).map((p) => p.runs.map((x) => x.text).join('')).join(' ');

/** One NMR report (or spectrum entry) as the checks read it: odd values read as text, a missing id as its position. */
function cleanReport(r: unknown, i = 0): Json {
  if (!isObj(r)) return {};
  const out: Json = { ...r };
  for (const k of ['id', 'nucleus', 'label', 'type']) if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'string') out[k] = partText(r[k]);
  if (out.id === '' && r.id !== '') out.id = String(i);
  return out;
}

const pyStrOf = (v: unknown): string => (v === undefined || v === null || v === '' || v === false || v === 0 ? '' : typeof v === 'string' ? v : partText(v));

/** A value from a project file, kept a decimal when it was written as one ("5.0"), for fingerprints. */
function asRead(holder: Json, key: string): unknown {
  const v = holder[key];
  return typeof v === 'number' && isFloat(holder, key) ? pyF(v) : v;
}

function hrmsFp(smiles: string, value: Json, tolerance: unknown): string {
  return fp(smiles, pyStrOf(value.formula).trim(), pyStrOf(value.species), pyStrOf(value.adduct) || '[M+H]+', pyStrOf(value.found).trim(), tolerance);
}

/** The placeholders of a general procedure's sentence, as written, in order, once each. */
export function placeholders(sentence: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const p of parseMarkup(sentence)) for (const r of p.runs) {
    if (r.ref) continue;
    for (const m of r.text.matchAll(/\{([^{}]+)\}/g)) {
      const k = gpKey(m[1]);
      if (!seen.has(k)) { seen.add(k); out.push(m[1].trim()); }
    }
  }
  return out;
}
export const gpKey = (name: string): string => name.toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/** What the automatic placeholders become (only whether there is a value matters here). */
function autoValues(c: SiCompound): Set<string> {
  const keys = fieldKeys(c), v = valuesOf(c);
  const out = new Set(['gp', 'product']);
  if (keys.includes('scale') && partText(obj(v.scale).value).trim()) out.add('scale');
  if (keys.includes('yield') && partText(obj(v.yield).percent).trim()) out.add('yield');
  if (keys.includes('purification') && partText(obj(v.purification).method).trim()) out.add('purification');
  return out;
}

const SCALE = /^\s*(\d*[.,]?\d+)\s*(mmol|[µμu]mol|mol)\s*\.?\s*$/i;
const TO_MMOL: Record<string, number> = { mmol: 1, 'µmol': 0.001, mol: 1000 };
function parseScale(text: string): [string, string] | null {
  const m = SCALE.exec(text);
  if (!m) return null;
  const u = m[2].toLowerCase().replace('μ', 'µ');
  const unit = u === 'umol' ? 'µmol' : u;
  if (!(unit in TO_MMOL)) return null;
  let n = m[1].replace(',', '.');
  if (n.startsWith('.')) n = '0' + n;
  return [n, unit];
}
const scaleMmol = (v: string, unit: string): number | null => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && v.trim() ? n * (TO_MMOL[unit || 'mmol'] ?? 1) : null; };

/** The {scale} box and the Reaction scale field disagree ('' when they agree or either is empty). */
function scaleConflict(c: SiCompound, gp: Json): string {
  if (!fieldKeys(c).includes('scale')) return '';
  const typedEntry = Object.entries(obj(obj(valuesOf(c).procedure).values)).find(([n]) => gpKey(n) === 'scale');
  const typed = typedEntry ? partText(typedEntry[1]).trim() : '';
  if (!typed || !placeholders(partText(gp.sentence)).map(gpKey).includes('scale')) return '';
  const field = obj(valuesOf(c).scale);
  const value = partText(field.value).trim(), unit = partText(field.unit).trim() || 'mmol';
  if (!value) return '';
  const plain = parseMarkup(typed).map((p) => p.runs.map((r) => r.text).join('')).filter((x, i, a) => x || i < a.length).join(' ').trim();
  const parsed = parseScale(plain);
  if (parsed) {
    const x = scaleMmol(...parsed), y = scaleMmol(value, unit);
    if (x !== null && y !== null && Math.abs(x - y) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y), 1e-12)) return '';
  }
  return `The {scale} box of “${partText(gp.name) || 'the general procedure'}” says “${plain}”, but the Reaction scale field says ${value} ${unit}. The Reaction scale field is printed: change whichever is wrong.`;
}

/** The NMR reports a structure calls for beyond ¹H and ¹³C. */
export function heteroatomNuclei(settings: Json, info: MolInfo): string[] {
  const out: string[] = [];
  if (info.elements.has('F')) out.push('19F');
  if (info.elements.has('P') && settings.auto_nmr_31P) out.push('31P');
  if (info.elements.has('B') && settings.auto_nmr_11B) out.push('11B');
  return out;
}

const hetero = (which: string): string => {
  const l = which.replace(/[^A-Za-z]/g, '').toUpperCase();
  for (const a of ['F', 'P']) if (l === 'H' + a || l === a + 'H') return a;
  return '';
};

function largeJMessage(r: Json, large: nmr.Coupling[], fpAtoms: string[]): string {
  const label = r.label ? ` (${r.label})` : '';
  const listed = (vs: nmr.Coupling[]): string => {
    const plain = vs.filter((c) => !hetero(c.which)).map((c) => `${c.written} Hz`);
    const out = plain.length ? [`J = ${plain.join(', ')}`] : [];
    for (const c of vs) if (hetero(c.which)) out.push(`J${c.which} = ${c.written} Hz`);
    return out.join(', ');
  };
  const be = (vs: unknown[]): string => (vs.length === 1 ? 'is' : 'are');
  const head = `¹H NMR${label}: `;
  const limit = `larger than ${pyG(LARGE_J_HZ)} Hz`;
  const het = large.filter((c) => hetero(c.which)), plain = large.filter((c) => !hetero(c.which));
  if (fpAtoms.length) {
    const atoms = [...new Set([...fpAtoms, ...het.map((c) => hetero(c.which))])];
    let text = `${head}${listed(large)} ${be(large)} ${limit}, which may be correct: the structure contains ${fpAtoms.join(' and ')}, and ${atoms.map((a) => `H–${a}`).join(' or ')} couplings can be this large.`;
    if (plain.length) {
      const one = plain.length === 1;
      const who = het.length ? listed(plain) : one ? 'it' : 'they';
      text += ` If ${who} ${one ? 'is an H–H coupling' : 'are H–H couplings'}, check for a typo.`;
    }
    return text;
  }
  const parts: string[] = [];
  if (plain.length) parts.push(`${listed(plain)} ${be(plain)} ${limit}. H–H coupling constants are rarely this large: check ${plain.length === 1 ? 'it' : 'them'} for a typo.`);
  if (het.length) {
    const kinds = [...new Set(het.map((c) => hetero(c.which)))].map((a) => `H–${a}`).join(' and ');
    const one = het.length === 1;
    parts.push(`${listed(het)} ${be(het)} ${limit}, which may be correct: ${one ? 'it is labelled as an' : 'they are labelled as'} ${kinds} coupling${one ? '' : 's'}, and these can be this large.`);
  }
  return head + parts.join(' ');
}

/** Every warning for a compound, dismissed or not. `facts`: its structure's (null: none, or unreadable). */
export function allWarnings(project: SiProject, c: SiCompound, ids: IdReport, facts: MolFacts | null, reportMatch: Match | null = null): SiWarning[] {
  const out: SiWarning[] = [];
  const keys = new Set(fieldKeys(c));
  const values = valuesOf(c);
  const info = facts?.info ?? null;
  const smiles = info?.smiles ?? '';

  // IDs
  for (const msg of ids.compoundWarnings.get(c.id) ?? []) out.push(w('id', ID_KEY, msg, `id:${fp(msg)}`, fp(msg)));

  // a generic atom (R, X…): kept, but no formula or masses
  if (facts && !facts.info && keys.has('structure') && facts.generic.length) out.push(w('structure', 'structure', genericStructureMessage(facts.generic), GENERIC_STRUCTURE_KEY, fp(facts.generic)));

  // 1. HRMS
  if (keys.has('hrms')) {
    const value = obj(values.hrms);
    const tol = asRead(project.settings, 'hrms_tolerance_ppm');
    let f = hrmsFp(smiles, value, tol);
    let old = fp(smiles, value, tol);
    let sp: HrmsSpecies | null = null, unreadable: string | null = null;
    try { sp = hrmsSpecies(facts, value); } catch (e) { if (!(e instanceof ChemError)) throw e; unreadable = e.message; }
    if (sp?.automatic && !sp.key && sp.automatic !== sp.choices![1]) { f = fp(f, chem.speciesLabel(sp.info)); old = ''; }
    if (unreadable !== null) out.push(w('hrms', 'hrms', `HRMS formula: ${unreadable}`, 'hrms:formula-unreadable', f, old));
    const [, problem] = compoundHrms(project, c, facts);
    if (problem && !problem.startsWith('HRMS formula')) out.push(w('hrms', 'hrms', problem, 'hrms:ppm', f, old));
    if (sp) {
      const hint = chargedAdductHint(sp.info, partText(value.adduct));
      if (hint) out.push(w('hrms', 'hrms', hint, 'hrms:charged', f, old));
      if (sp.manual && info) {
        let auto: HrmsSpecies | null = null;
        try { auto = hrmsSpecies(facts, { ...value, formula: '' }); } catch { auto = null; }
        if (auto && !chem.sameFormula(auto.info.counts, sp.info.counts)) out.push(w('hrms', 'hrms', `The typed M formula (${sp.info.formula}) differs from the structure's (${auto.info.formula}).`, 'hrms:formula-differs', f, old));
      }
    }
    // a found m/z typed by hand that the report files don't back up (§13n.3a); `reportMatch`: the reports' value, read by the caller
    if (reportItems(c).length && reportMatch) {
      const message = differsMessage(value, reportMatch, hrmsTolerance(project.settings));
      if (message) {
        const where = [reportMatch.file, pyF(r6(reportMatch.mz))];
        out.push(w('hrms', 'hrms', message, 'hrms:report-differs', fp(f, ...where), old ? fp(old, ...where) : ''));
      }
    }
  }

  const raw = keys.has('nmr') && Array.isArray(values.nmr) ? (values.nmr as unknown[]) : [];
  const reports = raw.map((r, i) => cleanReport(r, i));
  const idOf = (r: Json, i: number): string => (r.id === undefined || r.id === null ? String(i) : String(r.id));
  const texts = new Map<string, string>(reports.map((r, i) => [idOf(r, i), reportText(r)]));
  const textOf = (r: Json, i: number): string => texts.get(idOf(r, i)) ?? '';

  // 2. ¹³C signal count, 3. ¹H integration (approximate by design)
  if (facts?.info) {
    reports.forEach((r, i) => {
      const rid = idOf(r, i), text = textOf(r, i);
      if (!text.trim()) return;
      const label = r.label ? ` (${r.label})` : '';
      if (r.nucleus === '13C') {
        const n = nmr.carbonSignalCount(text);
        if (n && n !== facts.uniqueCarbons) out.push(w('c13', 'nmr', `¹³C NMR${label} lists ${n} signals; the structure has ${facts.uniqueCarbons} symmetry-distinct carbons. (Approximate: C–F coupling, rotamers and overlapping signals can make these differ.)`, `c13:${rid}`, fp(text, smiles)));
      }
      if (r.nucleus === '1H') {
        const total = nmr.protonCount(text);
        if (total && Math.abs(total - facts.hTotal) > 0.05) {
          let note = '';
          if (facts.hExch && Math.abs(facts.hTotal - total - facts.hExch) <= 0.05) note = ` The difference matches the ${facts.hExch} NH/OH hydrogen${facts.hExch !== 1 ? 's' : ''}, which often exchange and are not seen.`;
          out.push(w('h1', 'nmr', `¹H NMR${label} integrations add up to ${pyG(total)} H; the structure has ${facts.hTotal} H.${note}`, `h1:${rid}`, fp(text, smiles)));
        }
      }
    });
  }

  // 4. solvent and impurity peaks (Fulmer et al., Organometallics 2010, 29, 2176)
  const table = nmr.projectImpurityTable(project.settings);
  const [tolH, tolC] = nmr.impurityTolerances(project.settings);
  reports.forEach((r, i) => {
    const rid = idOf(r, i), text = textOf(r, i);
    const solvent = nmr.solventOf(text);
    const nucleus = String(r.nucleus ?? '');
    if (!solvent || (nucleus !== '1H' && nucleus !== '13C')) return;
    for (const p of nmr.peaks(text)) {
      if (p.end !== null) continue;
      const singlet = ['s', 'br s', 'brs', 'bs', 'br. s'].includes(nmr.multiplicity(p));
      const what = nmr.impurityMatch(solvent, nucleus, p.shift, singlet, table, tolH, tolC);
      if (what) out.push(w('impurity', 'nmr', `${nucleusLabel(nucleus)} NMR: δ ${pyG(p.shift)}${nucleus === '1H' ? ' (s)' : ''} is where ${what} appears in ${nmr.prettySolvent(solvent)} — check it isn't a solvent or impurity peak.`, `impurity:${rid}:${pyG(p.shift)}`, fp(text)));
    }
  });

  // 4b. large ¹H coupling constants (H–F and H–P can be that large)
  const fpAtoms = info ? ['F', 'P'].filter((a) => info.elements.has(a)) : [];
  reports.forEach((r, i) => {
    if (r.nucleus !== '1H') return;
    const large = nmr.couplings(textOf(r, i)).filter((x) => x.value > LARGE_J_HZ);
    if (large.length) out.push(w('coupling', 'nmr', largeJMessage(r, large, fpAtoms), `coupling:${idOf(r, i)}`, fp(large.map((x) => x.written))));
  });

  // 5. yield
  if (keys.has('yield') && info) {
    const y = obj(values.yield), s = keys.has('scale') ? obj(values.scale) : {};
    const pct = parseNumber(y.percent), mass = parseNumber(y.mass), scale = parseNumber(s.value);
    const massUnit = partText(y.mass_unit) || 'mg', scaleUnit = partText(s.unit) || 'mmol';
    if (pct !== null && mass && scale) {
      const expected = ((mass * (MASS_TO_MG[massUnit] ?? 1)) / (scale * (AMOUNT_TO_MMOL[scaleUnit] ?? 1) * info.mw)) * 100;
      if (Math.abs(expected - pct) > 1) out.push(w('yield', 'yield', `${partText(y.mass)} ${massUnit} of this compound (MW ${info.mw.toFixed(2)}) from ${partText(s.value)} ${scaleUnit} is ${expected.toFixed(1)}%, not ${pyG(pct)}%. (If the yield is based on a different reagent or stoichiometry, dismiss this warning.)`, 'yield', fp(y, s, smiles)));
    }
  }

  // 6. spectra present
  if (keys.has('nmr') && keys.has('spectra')) {
    const reported = new Set(reports.flatMap((r, i) => (textOf(r, i).trim() ? [r.nucleus as string | undefined] : [])));
    const items = (Array.isArray(values.spectra) ? (values.spectra as unknown[]) : []).filter(isObj).map((x) => cleanReport(x));
    const attached = new Set(items.map((x) => x.type as string | undefined));
    const old = sortedFp(new Set([...reported].map((x) => x ?? null)), new Set([...attached].map((x) => x ?? null)));
    for (const n of [...reported].filter((x): x is string => typeof x === 'string' && (SPECTRUM_TYPES as readonly string[]).includes(x)).sort()) {
      if (attached.has(n)) continue;
      const idsN = reports.flatMap((r, i) => (r.nucleus === n && textOf(r, i).trim() ? [String(r.id ?? i)] : [])).sort();
      out.push(w('spectra', 'spectra', `There is a ${nucleusLabel(n)} NMR report but no ${nucleusLabel(n)} spectrum attached.`, `spectra:missing:${n}`, fp('missing', n, idsN), old));
    }
    for (const n of [...attached].filter((x): x is string => typeof x === 'string' && (NUCLEI as readonly string[]).includes(x)).sort()) {
      if (reported.has(n)) continue;
      const files = items.filter((x) => x.type === n).map((x) => (x.file ? pyStrOf(x.file) : '')).sort();
      out.push(w('spectra', 'nmr', `A ${nucleusLabel(n)} spectrum is attached but there is no ${nucleusLabel(n)} NMR report.`, `spectra:extra:${n}`, fp('extra', n, files), old));
    }
  }

  // 7. NMR frequencies (¹³C ≈ ¹H × 0.2515: 400 → 101 MHz)
  const hFreqs = reports.flatMap((r, i) => (r.nucleus === '1H' ? [nmr.frequency(textOf(r, i))] : [])).filter((x): x is number => !!x);
  if (hFreqs.length) {
    reports.forEach((r, i) => {
      const n = String(r.nucleus ?? ''), text = textOf(r, i);
      const f = nmr.frequency(text);
      if (!(n in NMR_RATIOS) || !f) return;
      const expected = hFreqs.map((h) => h * NMR_RATIOS[n]);
      if (expected.every((e) => Math.abs(f - e) / e > 0.03)) {
        const hs = [...new Set(hFreqs)].sort((a, b) => a - b), es = [...new Set(expected)].sort((a, b) => a - b);
        out.push(w('frequency', 'nmr', `${nucleusLabel(n)} NMR at ${pyG(f)} MHz doesn't match ¹H at ${hs.map(pyG).join(', ')} MHz (expected ≈ ${es.map((e) => e.toFixed(0)).join(', ')} MHz).`, `frequency:${r.id ?? i}`, fp(text, hFreqs.map(pyF))));
      }
    });
  }

  // 8. heteroatom NMR
  if (info && keys.has('nmr')) {
    const have = new Set(reports.flatMap((r, i) => (textOf(r, i).trim() ? [r.nucleus as string | undefined] : [])));
    for (const n of heteroatomNuclei(project.settings, info)) {
      if (have.has(n)) continue;
      const element = n.replace(/^\d+/, '');
      out.push(w('heteroatom', 'nmr', `The structure contains ${element} but there is no ${nucleusLabel(n)} NMR data.`, `heteroatom:${n}`, fp(smiles, n), sortedFp(smiles, new Set([...have].map((x) => x ?? null)))));
    }
  }

  // 9. broken mentions and citations
  const seen = new Set<string>();
  const exists = new Set(project.compounds.map((x) => x.id));
  const gp = project.compoundGp(c);
  const places: [string, string][] = [];
  for (const e of fieldsOf(c)) {
    const def = fieldDef(e);
    if (!def) continue;
    if (def.kind === 'richtext') places.push([def.key, project.compoundText(c, def.key)]);
    else if (def.kind === 'citations') {
      const refs = obj(values[def.key]).refs;
      if (Array.isArray(refs) && refs.length) places.push([def.key, '@cite{' + refs.map(String).join(',') + '}']);
    }
  }
  if (gp) {
    const used = new Set(placeholders(partText(gp.sentence)).map(gpKey));
    for (const [name, v] of Object.entries(obj(obj(values.procedure).values))) if (used.has(gpKey(name))) places.push(['procedure', String(v)]);
  }
  for (const [field, text] of places) {
    const ps = parseMarkup(text);
    const gone = [...new Set(mentionsIn(ps))].filter((m) => mentionKind(m) === 'compound' && !exists.has(m));
    const missing = [...new Set(citationsIn(ps))].filter((r) => !project.reference(r));
    for (const id of gone) {
      const x = w('mention', field, `This text mentions a compound that has been deleted (printed as “??”). Restore it from the Trash, or remove the mention.`, `mention:${field}:${id}`, fp(id));
      if (!seen.has(x.key)) { seen.add(x.key); out.push(x); }
    }
    for (const id of missing) {
      const x = w('citation', field, 'This cites a reference that is no longer in the References list; it will be left out of the SI.', `citation:${field}:${id}`, fp(id));
      if (!seen.has(x.key)) { seen.add(x.key); out.push(x); }
    }
  }

  // the general procedure chosen
  const choice = obj(values.procedure);
  if (keys.has('procedure') && choice.gp) {
    if (!gp) out.push(w('gp', 'procedure', 'The general procedure chosen for this compound no longer exists (it may have been deleted). Choose another, or restore it from the Trash.', 'gp:missing', fp(choice.gp)));
    else {
      const typedRaw = choice.values;
      const typed = obj(typedRaw);
      const sentence = partText(gp.sentence);
      const typedKeys = new Set(Object.entries(typed).filter(([, v]) => partText(v).trim()).map(([k]) => gpKey(k)));
      const auto = autoValues(c);
      const name = partText(gp.name);
      for (const ph of placeholders(sentence)) {
        const k = gpKey(ph);
        if (typedKeys.has(k) || auto.has(k)) continue;
        out.push(w('gp', 'procedure', `“${name || 'The general procedure'}” needs a value for {${ph}} (it would be printed as [${ph}]).`, `gp:value:${k}`, fp(sentence, k), fp(sentence, typedRaw ?? {})));
      }
      const conflict = scaleConflict(c, gp);
      if (conflict) out.push(w('gp', 'procedure', conflict, 'gp:scale-differs', fp(typedRaw ?? {}, values.scale)));
      const pur = values.purification;
      const own = isObj(pur) ? pyStrOf(pur.sentence).trim() : '';
      if (keys.has('purification') && own && placeholders(sentence).map(gpKey).includes('purification')) {
        out.push(w('gp', 'purification', `“${name || 'The general procedure'}” places {purification} itself, so the sentence typed in “Printed as” is not printed. To print your own wording, type it in the {purification} box under the general procedure (Experimental procedure field), or take {purification} out of the general procedure's sentence.`, 'gp:purification-sentence', fp(own, sentence)));
      }
    }
  }
  return out;
}

/** "compound", "figure", "table" or "scheme" for a mentioned id. */
export function mentionKind(id: string): string {
  if (!id.includes('-')) return 'compound';
  return ({ f: 'figure', t: 'table', k: 'scheme' } as Record<string, string>)[id.split('-')[0]] ?? 'compound';
}

/** Whether a warning is dismissed for its compound (and its data hasn't changed since). */
export function isDismissed(c: SiCompound, x: SiWarning): boolean {
  const d = obj(c.data.dismissed)[x.key];
  return isObj(d) && (d.fingerprint === x.fingerprint || d.fingerprint === (x.legacy || x.fingerprint));
}

/** The warnings shown (not dismissed), by field. */
export function activeByField(list: SiWarning[], c: SiCompound): Map<string, SiWarning[]> {
  const out = new Map<string, SiWarning[]>();
  for (const x of list) if (!isDismissed(c, x)) out.set(x.field, [...(out.get(x.field) ?? []), x]);
  return out;
}
