// Chemistry in text, as Chem SI Assistant recognizes it (core/chemtext.py): formulas whose
// digits are subscripts (CDCl3, Na2SO4, Et3N, Pd(PPh3)4, "under N2"), deuterated solvents
// (DMSO-d6), the nucleus before "NMR" (1H NMR) and number ranges (7.36-7.29). The compiled SI
// formats the same words SI Assistant does, so the two programs print a project alike.

const ELEMENTS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn '
  + 'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce '
  + 'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi D T').split(' ');
const GROUPS = ['Me', 'Et', 'Pr', 'Bu', 'Ph', 'Bn', 'Bz', 'Ac', 'Ts', 'Ms', 'Tf', 'Cy', 'Cp', 'Boc',
  'Cbz', 'Fmoc', 'Piv', 'Tol', 'Mes', 'TMS', 'TES'];
// Ligands written in lower case: part of a formula inside brackets (Pd2(dba)3); "pin" also after B (B2pin2).
const LIGANDS = ['dba', 'cod', 'nbd', 'bpy', 'bipy', 'dtbbpy', 'dtbpy', 'ppy', 'phen', 'py', 'acac',
  'pin', 'cat', 'dppf', 'dppe', 'dppp', 'dppb', 'tmeda'];
const BARE_LIGANDS = ['pin'];

// (longest first, as Python's sorted(…, key=len, reverse=True), which keeps ties in order)
const alternatives = (words: string[]): string => [...words].sort((a, b) => b.length - a.length).join('|');
/** The same words matched whatever their capitals (Python's (?i:…)). */
const anyCase = (alts: string): string => alts.replace(/[A-Za-z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);

const UNIT = `(?:(?<![A-Za-z])[inst]-?(?:Pr|Bu)|(?<=O)[int](?:Pr|Bu)|${alternatives([...ELEMENTS, ...GROUPS])})`;
const INNER = `(?:${alternatives(LIGANDS)}|${UNIT})`;
const PAREN = `\\((?:${INNER}\\d*)+\\)\\d*`;
const BRACKET = `\\[(?:${INNER}\\d*|${PAREN})+\\]\\d*`;
const ITEM = `(?:${UNIT}\\d*|(?:(?<=B)|(?<=B\\d))(?:${alternatives(BARE_LIGANDS)})\\d*|${PAREN}|${BRACKET})`;

// Words that look like formulas but are not (SN2, TS1, IC50, OD600, CDK2, HCT116…).
const FORMULA_EXCEPTIONS = 'S[NE][12]|TS\\d+|IC\\d+|CC\\d+|[IL]D\\d+|PS[12]|OD\\d+|SI\\d+|NIH3T3|'
  + 'COVID\\d*|HCT\\d+|HT\\d+|PC\\d+|PI3K\\w*|CDK\\d+|CDC\\d+|CYP\\w+|CB\\d+|'
  + 'P2[XY]\\d+|INT\\d+|HSP\\d+|NS\\d+|HIV\\d*|NK\\d+|SH[23]|PDK\\d+|CK\\d+|TBK\\d+';
// Molecules of one element: also atom labels (H2 in "1H, H2"), so they need the words around them.
const ALWAYS_MOLECULES = ['Cl2', 'Br2', 'I2', 'O3'];
const CONTEXT_MOLECULES = ['H2', 'D2', 'N2', 'O2', 'F2'];
const SINGLE_ELEMENT = [...ALWAYS_MOLECULES, ...CONTEXT_MOLECULES];
const MOLECULE_BEFORE = new Set(('under atmosphere balloon atm bar psi purged flushed backfilled sparged bubbled degassed '
  + 'evacuated dry anhydrous gaseous liquid pressurized pressure stream flow filled charged '
  + 'saturated excess hydrogenated hydrogenation').split(' '));
const MOLECULE_BRIDGE = new Set('of with a an the'.split(' '));
const MOLECULE_AFTER = new Set(('gas atmosphere atmospheres balloon atm bar psi mpa kpa torr pressure stream flow line '
  + 'inlet purge uptake evolution sparging bubbling manifold').split(' '));
const MOLECULE_HYPHEN = new Set('filled free saturated purged flushed atmosphere sparged'.split(' '));

const FORMULA = new RegExp(
  '(?<![A-Za-z0-9])(?=\\S{1,100}(?!\\S))'
  + `(?!(?:${FORMULA_EXCEPTIONS})(?![A-Za-z0-9]))`
  + `(?:(?=[A-Za-z()\\[\\]-]*\\d)(?:${ITEM}{2,}`
  + `|\\[(?:${INNER}\\d*|${PAREN}){2,}\\]\\d*${ITEM}*)`
  + `|(?:${SINGLE_ELEMENT.join('|')}))`
  + '(?![A-Za-z0-9])', 'g');

const DEUTERATED_NAMES = anyCase('DMSO|DMF|acetone|THF|toluene|benzene|methanol|MeOH|MeOD|MeCN|'
  + 'acetonitrile|pyridine|DCM|dichloromethane|chloroform|dioxane|cyclohexane|nitromethane');
/** "DMSO-d6", "chloroform-d": group 1 the name, group 2 the digits ('' for chloroform-d). */
export const DEUTERATED = new RegExp(`\\b(${DEUTERATED_NAMES})-d(\\d+|(?<=${anyCase('chloroform')}-d))(?![A-Za-z0-9])`, 'g');
/** "d6-DMSO": group 1 the digits. */
export const DEUTERATED_PREFIX = new RegExp(`(?<![A-Za-z0-9])d(\\d+)-(?=(?:${DEUTERATED_NAMES})\\b)`, 'g');
/** A nucleus only before "NMR" or a decoupling brace, so "(m, 2H)" is left alone. */
export const NUCLEUS = /(?<![A-Za-z0-9])(\d{1,3})(H|C|F|P|B|N|Si|Se|Sn|Pt|Li|O|Al)(?=\s*NMR\b|\{|\})/g;

/** A match: where it is in the text, and its groups (0 the whole). */
export interface Found { start: number; end: number; groups: string[] }

export function allMatches(re: RegExp, text: string): Found[] {
  const out: Found[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of text.matchAll(g)) out.push({ start: m.index!, end: m.index! + m[0].length, groups: [...m].map((x) => x ?? '') });
  return out;
}

const WORD_BEFORE = /([A-Za-z]+)[\s(]*$/;
const WORD_AFTER = /^\s*\(?\s*(?:\d+(?:\.\d+)?\s*)?([A-Za-z]+)/;
const DASHES = "-–—‐'′’";

/** Is the one-element word text[start:end] (N2, Cl2) the molecule here, not an atom label? */
function molecule(text: string, start: number, end: number): boolean {
  const word = text.slice(start, end);
  const after = text.slice(end, end + 30);
  let m = /^-([A-Za-z]+)/.exec(after);
  if (m && MOLECULE_HYPHEN.has(m[1].toLowerCase())) return true;   // "N2-filled glovebox"
  if ((after && DASHES.includes(after[0])) || (start > 0 && DASHES.includes(text[start - 1]))) return false;
  if (ALWAYS_MOLECULES.includes(word)) return true;
  let before = text.slice(Math.max(0, start - 50), start);
  for (let i = 0; i < 3; i++) {   // "under N2", "purged with N2", "under an atmosphere of N2"
    m = WORD_BEFORE.exec(before);
    if (!m) break;
    const prev = m[1].toLowerCase();
    if (MOLECULE_BEFORE.has(prev)) return true;
    if (!MOLECULE_BRIDGE.has(prev)) break;
    before = before.slice(0, m.index);
  }
  m = WORD_AFTER.exec(after);
  return !!m && MOLECULE_AFTER.has(m[1].toLowerCase());
}

/** The formulas in `text`, in order, with the context rules applied; words in `leave` (lower case) are skipped. */
export function formulaMatches(text: string, leave: ReadonlySet<string> = new Set()): Found[] {
  const out: Found[] = [];
  for (const m of allMatches(FORMULA, text)) {
    const word = m.groups[0];
    if (leave.size && leave.has(word.toLowerCase())) continue;
    if (/[DT]\d{3}/.test(word)) continue;   // OD600, HCT116
    if (SINGLE_ELEMENT.includes(word) && !molecule(text, m.start, m.end)) continue;
    out.push(m);
  }
  return out;
}

/** Is this word, on its own, a formula whose digits are subscripts? */
export const isFormula = (word: string): boolean => formulaMatches(word).some((m) => m.start === 0 && m.end === word.length);

const UNITS = ['mmol', 'µmol', 'μmol', 'nmol', 'mol', 'mg', 'µg', 'μg', 'kg', 'mL', 'µL', 'μL', 'nL',
  'mM', 'µM', 'μM', 'nM', 'Hz', 'kHz', 'MHz', 'GHz', 'min', 'nm', 'cm', 'mm', 'µm', 'μm',
  '°C', 'equiv', 'ppm', 'psi', 'mbar', 'bar', 'atm', 'Torr', 'kcal', 'kJ', 'wt%', 'mol%'];
const LONG_UNITS = alternatives(UNITS).split('|').map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const UNIT_START = new RegExp(`^(?:${LONG_UNITS}|wt|[ghsLMK])(?![A-Za-z])`);
const RANGE_CHAIN = /\d[\d.]*(?:-\d[\d.]*)+/g;

/**
 * Hyphens in number ranges ("7.36-7.29", "1-3"), as matches of the hyphen. Left alone: chains
 * of more than one hyphen (CAS numbers, dates), numbers stuck to a word before them (C2-3) and
 * numbers followed by letters that are not a unit (6-31G).
 */
export function rangeMatches(text: string): Found[] {
  const out: Found[] = [];
  for (const chain of allMatches(RANGE_CHAIN, text)) {
    const { start, end } = chain;
    if ((chain.groups[0].match(/-/g) ?? []).length > 1) continue;
    const before = text.slice(Math.max(0, start - 2), start);
    if (/[A-Za-z][-–]?$|\d[-–]$/.test(before)) continue;
    const rest = text.slice(end, end + 12);
    if (/^[-–]\d/.test(rest)) continue;
    if (/^\+*[A-Za-z]/.test(rest) && !UNIT_START.test(rest)) continue;
    const at = text.indexOf('-', start);
    out.push({ start: at, end: at + 1, groups: ['-'] });
  }
  return out;
}
