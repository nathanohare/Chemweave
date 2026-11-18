// The reference list of an imported SI and the citations in its text (Chem SI Assistant's
// core/si_import_refs.py, SPEC §13u.9).
//
// * splitEntries(texts): the reference list's paragraphs into numbered entries, found by their
//   numbers counting up ("(1)", "[1]", "1." or "1 "); without numbers each paragraph is one entry.
//   An entry with parts "a) …; b) …" gives one reference per part ("3a", "3b").
// * parseReference(text): an entry's authors, title, journal, year, volume, issue, pages, DOI and
//   web address in the common styles (ACS, RSC/Wiley, Nature). What can't be read stays whole as
//   the title of an "Other", so nothing is lost.
// * linkCitations(markup, numbers): numbered citations in imported text ("…^{3,4}", "[3]") become
//   the program's citations (@cite{r-…}); numbers with no reference are left as they are.

import { blankRef, cleanRef, type Reference } from '../document/references';
import { finditer, fullmatch, isDigit, isUpper, isSpace, match, rx, search, split, strip, rstrip, sub } from './py';

export interface ImportedReference {
  /** "1", "3a" (as numbered in the SI; "" = none). */
  number: string;
  /** The entry as printed (plain text). */
  text: string;
  ref: Reference;
  keep: boolean;
  /** "" / "done" / why Crossref could not fill it. */
  looked_up: string;
}

const MARKERS: [string, string, RegExp][] = [
  ['paren', '\\(\\s*{n}\\s*\\)', /^\(\s*(\d{1,3})\s*\)\s*\S/],
  ['bracket', '\\[\\s*{n}\\s*\\]', /^\[\s*(\d{1,3})\s*\]\s*\S/],
  ['dot', '{n}\\.', /^(\d{1,3})\.\s+\S/],
  ['plain', '{n}', /^(\d{1,3})\s+[A-ZÀ-ɏ]/],
];

/** [the numbering style of a list starting with `first`, its first number]. */
function style(first: string): [string, number] {
  for (const [name, , start] of MARKERS) {
    const m = start.exec(first);
    if (m) return [name, Number(m[1])];
  }
  return ['', 0];
}

/** [number, text] of a reference list's paragraphs. */
export function splitEntries(textsIn: string[]): [string, string][] {
  const texts = textsIn.filter((t) => t && strip(t)).map((t) => strip(t.replace(/\s+/g, ' ')));
  if (!texts.length) return [];
  const [kind, first] = style(texts[0]);
  if (!kind) return texts.flatMap((t, i) => parts(String(i + 1), t));
  const joined = ' ' + texts.join(' ');
  const pattern = MARKERS.find(([n]) => n === kind)![1];
  const starts: [number, number, number][] = [];
  let pos = 0, n = first;
  for (;;) {
    // the next number, after a space (the end of the entry before)
    const m = search(rx('(?<=\\s)' + pattern.replace('{n}', String(n)) + '\\s*(?=\\S)'), joined, pos);
    if (!m) break;
    if (n > first && (kind === 'plain' || kind === 'dot') && !search(rx('[.)\\]\\d/a-z]\\s*$'), joined.slice(0, m.index))) {
      pos = m.end;          // ("… 100 159–185": a number inside an entry)
      continue;
    }
    starts.push([n, m.index, m.end]);
    pos = m.end;
    n++;
  }
  if (!starts.length) return texts.map((t, i) => [String(i + 1), t]);
  return starts.flatMap(([num, , e], k) => parts(String(num), strip(joined.slice(e, k + 1 < starts.length ? starts[k + 1][1] : joined.length))));
}

/** An entry with parts "(a) …; (b) …" or "a) …; b) …" as one entry per part. */
function parts(number: string, text: string): [string, string][] {
  const marks = [...finditer(rx('(?:^|(?<=[;.]\\s))\\(?([a-z])\\)\\s+(?=\\S)'), text)];
  const letters = marks.map((m) => m.group(1)!);
  if (marks.length < 2 || letters.some((l, i) => l !== String.fromCharCode(97 + i))) return [[number, strip(text)]];
  return marks.map((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].index : text.length;
    return [number + m.group(1), strip(rstrip(strip(text.slice(m.end, end)), ';'))];
  });
}

// Common journal abbreviations (CASSI), longest first when matched, so the title and the journal can be told apart.
const JOURNALS = [
  'J. Am. Chem. Soc.', 'J. Org. Chem.', 'Org. Lett.', 'Angew. Chem. Int. Ed.', 'Angew. Chem.',
  'Chem. Sci.', 'Nat. Chem.', 'Nature Chemistry', 'Science', 'Nature', 'Organometallics',
  'Inorg. Chem.', 'ACS Catal.', 'Chem. Eur. J.', 'Chem. - Eur. J.', 'Org. Synth.',
  'Eur. J. Org. Chem.', 'Tetrahedron Lett.', 'Tetrahedron: Asymmetry', 'Tetrahedron',
  'Synthesis', 'Synlett', 'Chem. Commun.', 'Phys. Chem. Chem. Phys.', 'J. Chem. Phys.',
  'J. Phys. Chem. A', 'J. Phys. Chem. B', 'J. Phys. Chem. C', 'J. Phys. Chem. Lett.',
  'J. Comput. Chem.', 'J. Chem. Theory Comput.', 'Chem. Rev.', 'Acc. Chem. Res.',
  'Org. Process Res. Dev.', 'Adv. Synth. Catal.', 'Beilstein J. Org. Chem.',
  'J. Med. Chem.', 'ACS Med. Chem. Lett.', 'Org. Biomol. Chem.', 'Green Chem.',
  'Dalton Trans.', 'JACS Au', 'ACS Cent. Sci.', 'Nat. Commun.', 'Nat. Catal.',
  'Nat. Synth.', 'Proc. Natl. Acad. Sci. U.S.A.', 'Proc. Natl. Acad. Sci. USA',
  'Bioorg. Med. Chem. Lett.', 'Bioorg. Med. Chem.', 'J. Nat. Prod.', 'Org. Chem. Front.',
  'Chin. J. Chem.', 'CCS Chem.', 'Chem. Soc. Rev.', 'J. Fluorine Chem.',
  'Synth. Commun.', 'Helv. Chim. Acta', 'Bull. Chem. Soc. Jpn.', 'Chem. Lett.',
  'J. Organomet. Chem.', 'Polyhedron', 'ChemCatChem', 'ChemistrySelect',
  'Asian J. Org. Chem.', 'Chem. Asian J.', 'Chem. - Asian J.', 'Eur. J. Inorg. Chem.',
  'RSC Adv.', 'New J. Chem.', 'Theor. Chem. Acc.', 'J. Mol. Struct.', 'Chem',
  'Cell Rep. Phys. Sci.', 'iScience', 'ACS Omega', 'Molecules', 'Org. React.',
  'Chem. Rec.', 'Synth. Met.', 'Macromolecules', 'ACS Macro Lett.', 'Polym. Chem.',
  'J. Chem. Inf. Model.', 'J. Chem. Educ.', 'Anal. Chem.', 'ChemBioChem',
  'ChemMedChem', 'ChemPhysChem', 'ChemSusChem', 'ChemPlusChem', 'Biochemistry',
  'J. Biol. Chem.', 'Nat. Chem. Biol.', 'ACS Chem. Biol.', 'Cell Chem. Biol.',
  'Chem. Biol.', 'J. Antibiot.', 'Appl. Environ. Microbiol.', 'Nucleic Acids Res.',
  'Mol. Microbiol.', 'J. Bacteriol.', 'Phys. Rev. Lett.', 'Phys. Rev. B',
  'Theoret. chim. Acta', 'Theor. Chim. Acta', 'Coord. Chem. Rev.', 'Chem. Mater.',
  'J. Mater. Chem. A', 'J. Mater. Chem.', 'Adv. Mater.', 'Adv. Funct. Mater.',
  'J. Catal.', 'Catal. Sci. Technol.', 'Faraday Discuss.', 'Chem. Phys. Lett.',
  'Mol. Phys.', 'J. Chem. Soc., Perkin Trans. 1', 'J. Chem. Soc., Chem. Commun.',
  'J. Chem. Soc.', 'Liebigs Ann. Chem.', 'Chem. Ber.', 'Synth. Met.', 'Heterocycles',
  'Carbohydr. Res.', 'Steroids', 'Phytochemistry', 'Org. Prep. Proced. Int.',
  'Can. J. Chem.', 'Aust. J. Chem.', 'Collect. Czech. Chem. Commun.',
  'Russ. Chem. Rev.', 'Mendeleev Commun.', 'Chem. Pharm. Bull.', 'J. Heterocycl. Chem.',
];
// (Python's sort is stable: equal lengths keep their order)
const JOURNAL_RE = [...JOURNALS].map((j, i) => [j, i] as const).sort((a, b) => b[0].length - a[0].length || a[1] - b[1])
  .map(([j]) => j.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&').replace(/ /g, '\\s?')).join('|');

const DOI = rx('(?:https?://\\s?(?:dx\\.)?doi\\.\\s?org/\\s?|doi:\\s*|DOI:?\\s*)?(?P<doi>10\\.\\s?\\d{4,9}/\\s?[^\\s]+?)(?=[.,;]?(?:\\s|$))', 'i');
const URL_RE = rx('https?://\\S+');
const UP = 'A-ZÀ-ÞĀ-ſ';       // capitals (with accents)
const LOW = "a-zß-ÿĀ-ſ'’\\-";
const SURNAME = `(?:(?:van|von|der|de|del|da|di|le|la|du|ten|ter)\\s)*[${UP}][${LOW}]*(?:['’]?[${UP}][${LOW}]+)*(?:[\\s\\-][${UP}][${LOW}]+(?:['’]?[${UP}][${LOW}]+)*)*`;
const INITIALS = `(?:[${UP}][a-z]?\\s?\\.\\s?-?\\s?)+`;
const AUTHOR_SF = `${SURNAME},\\s?${INITIALS}(?:,?\\s?(?:Jr|Sr|II|III)\\.?)?`;
const AUTHOR_IF = `${INITIALS}\\s?${SURNAME}(?![.\\w])`;
const SEP = '(?:\\s?[;,]\\s?(?:and\\s|&\\s)?|\\s(?:and|&)\\s)';
const YEAR = '(?:1[89]|20)\\d\\d';
const PAGES = '[A-Za-z]?\\d+[A-Za-z]?(?:\\s?[-–—]\\s?[A-Za-z]?\\d+[A-Za-z]?)?';

export function tidy(text: string): string {
  let t = strip(text.replace(/\s+/g, ' '));
  t = sub(rx(`(?<=[A-Za-z.])(?=${YEAR}\\s?,)`), ' ', t);    // "Chem.1978," (PDF)
  t = sub(rx('\\s+([,;:.])(?=\\s|$)'), '\\1', t);            // "10 , 6615"
  t = sub(rx('([A-Z])\\s\\.'), '\\1.', t);                    // "V . R." (PDF)
  return t;
}

type Found = Partial<Record<keyof Reference, unknown>>;

/** A reference from one entry as printed. Never fails: what can't be read is kept as the title of an "Other". */
export function parseReference(text: string): Reference {
  let t = tidy(text);
  const ref: Found = { ...blankRef('article') };
  let m = search(DOI, t);
  if (m) {
    ref.doi = rstrip(m.group('doi')!.replace(/\s/g, ''), '.');
    t = strip(t.slice(0, m.index) + t.slice(m.end));
  }
  m = search(URL_RE, t);
  if (m) {
    ref.url = rstrip(m[0], '.,;');
    t = strip(t.slice(0, m.index) + t.slice(m.end));
  }
  t = strip(rstrip(strip(sub(rx('\\s*(?:Available\\s+online|Retrieved\\s+from|Accessed|DOI:?)\\s*[.:]?\\s*$', 'i'), '', t)), '.,; '));
  for (const reader of [acs, initialsFirst, nature, authorsAndTitle]) {
    const found = reader(t);
    if (found) {
      for (const [k, v] of Object.entries(found)) if (v && !(Array.isArray(v) && !v.length)) (ref as Record<string, unknown>)[k] = v;
      return cleanRef(ref);
    }
  }
  ref.type = 'misc';
  ref.title = t;
  return cleanRef(ref);
}

const authorsOf = (s: string, pattern: string, stripChars: string): string[] => [...finditer(rx(pattern), s)].map((x) => strip(x[0], stripChars));

/** Authors (surname first) and then anything else: kept as the title of an "Other". */
function authorsAndTitle(t: string): Found | null {
  const m = match(rx(`(?P<authors>${AUTHOR_SF}(?:${SEP}${AUTHOR_SF})*)(?:\\s?(?:et\\s+al\\.))?[,.]?\\s+(?P<rest>\\S.*)$`), t);
  if (!m) return null;
  return { authors: authorsOf(m.group('authors')!, AUTHOR_SF, ' ,;'), title: strip(m.group('rest')!, ' .'), type: 'misc' };
}

/** Journal, year, volume (issue), pages at the end. */
function tail(rest: string): Record<string, string> | null {
  let m = search(rx(`(?P<journal>.*?)[\\s,]*(?P<year>${YEAR})\\s?,\\s?(?P<volume>\\d+[A-Z]?)(?:\\s?\\((?P<issue>[^)]{1,12})\\))?\\s?,\\s?(?P<pages>${PAGES})\\s*$`), rest);
  let keys = ['journal', 'year', 'volume', 'issue', 'pages'];
  if (!m) {
    m = search(rx(`(?P<journal>.*?)[\\s,]*(?P<year>${YEAR})\\s?,\\s?(?P<pages>${PAGES})\\s*$`), rest);
    keys = ['journal', 'year', 'pages'];
    if (!m) return null;
  }
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = strip(m.group(k) ?? '');
  out.journal = strip(out.journal, ' ,');
  return out;
}

const ABBREVIATION = rx(`[${UP}][a-z]{0,5}\\.`);

/** [title, journal] of "Rapid Technique … Resolution. J. Org. Chem."; a title alone → [title, ""]. */
function splitTitleJournal(beforeIn: string): [string, string] {
  const before = strip(beforeIn, ' ,');
  const m = search(rx(`(?:^|(?<=[.?!,]\\s)|(?<=[.?!,]))(?P<j>${JOURNAL_RE})\\.?$`), before);
  if (m) return [strip(before.slice(0, m.index), ' ,.'), strip(m.group('j')!)];
  // Not a known journal: the capitalised words after the title's last full stop.
  const words = before.split(' ');
  let k = words.length;
  while (k > 0) {
    const w = words[k - 1];
    if (!(fullmatch(ABBREVIATION, w) || fullmatch(rx(`[${UP}][${LOW}A-Za-z]*\\.?`), w))) break;
    k--;
    if (k && /[.?!]$/.test(words[k - 1]) && !fullmatch(ABBREVIATION, words[k - 1])) break;   // (the title's last word)
  }
  if (k === words.length || (k && !/[.?!]$/.test(words[k - 1]))) return [strip(before, ' ,.'), ''];
  return [strip(words.slice(0, k).join(' '), ' ,.'), strip(words.slice(k).join(' '), ' ,')];
}

/** ACS: "Still, W. C.; Kahn, M.; Mitra, A. Title. J. Org. Chem. 1978, 43 (14), 2923–2925". */
function acs(t: string): Found | null {
  const m = match(rx(`(?P<authors>${AUTHOR_SF}(?:${SEP}${AUTHOR_SF})*)(?:\\s?(?:et\\s+al\\.))?[,.]?\\s+(?P<rest>\\S.*)$`), t);
  if (!m) return null;
  const authors = authorsOf(m.group('authors')!, AUTHOR_SF, ' ,;');
  const rest = m.group('rest')!;
  const yearFirst = match(rx(`\\((?P<year>${YEAR})[a-z]?\\)[.,]?\\s*(?P<rest>.*)$|(?P<year2>${YEAR})[a-z]?[.,]\\s*(?P<rest2>.*)$`), rest);
  if (yearFirst) {      // "Surname, I. (2004), Title. Journal 7: 1-9"
    const year = yearFirst.group('year') ?? yearFirst.group('year2');
    const after = yearFirst.group('year') ? yearFirst.group('rest')! : yearFirst.group('rest2')!;
    const tl = search(rx(`(?P<before>.+?),?\\s(?P<volume>\\d+)(?:\\s?\\((?P<issue>[^)]+)\\))?\\s?[:,]\\s?(?P<pages>${PAGES})$`), after);
    if (tl) {
      const [title, journal] = splitTitleJournal(tl.group('before')!);
      return { authors, title, journal, year, volume: tl.group('volume'), issue: tl.group('issue') ?? '', pages: tl.group('pages') };
    }
    return { authors, year, title: strip(after, ' .'), type: 'misc' };
  }
  const tl = tail(rest);
  if (!tl) return null;                 // (perhaps Nature's style: tried next)
  const [title, journal] = splitTitleJournal(tl.journal);
  const { journal: _j, ...others } = tl;
  return { authors, title, journal, ...others };
}

/** RSC / Wiley / Elsevier: "W. C. Still, M. Kahn and A. Mitra, J. Org. Chem., 1978, 43, 2923." */
function initialsFirst(t: string): Found | null {
  const m = match(rx(`(?P<authors>${AUTHOR_IF}(?:${SEP}${AUTHOR_IF})*)(?:\\s?(?:et\\s+al\\.))?\\s?[,.:]\\s*(?P<rest>\\S.*)$`), t);
  if (!m) return null;
  const authors: string[] = [];
  for (const x of finditer(rx(AUTHOR_IF), m.group('authors')!)) {   // "W. C. Still" → "Still, W. C."
    const a = strip(x[0]);
    const name = match(rx(`(?P<given>${INITIALS})\\s?(?P<family>.+)$`), a);
    authors.push(name ? `${strip(name.group('family')!)}, ${strip(name.group('given')!)}` : a);
  }
  const tl = tail(m.group('rest')!);
  if (!tl) return null;
  let [title, journal] = splitTitleJournal(tl.journal);
  if (!journal) [journal, title] = [title, ''];         // (no title in these styles: it is the journal)
  const { journal: _j, ...others } = tl;
  return { authors, title, journal, ...others };
}

/** Nature: "Still, W. C., Kahn, M. & Mitra, A. Title. J. Org. Chem. 43, 2923–2925 (1978)". */
function nature(t: string): Found | null {
  const m = search(rx(`(?P<before>.*?)\\s(?P<volume>\\d+),\\s?(?P<pages>${PAGES})\\s?\\((?P<year>${YEAR})\\)$`), t);
  if (!m) return null;
  const head = match(rx(`(?P<authors>${AUTHOR_SF}(?:${SEP}${AUTHOR_SF})*)\\s+(?P<rest>\\S.*)$`), m.group('before')!);
  if (!head) return null;
  const authors = [...finditer(rx(AUTHOR_SF), head.group('authors')!)].map((x) => strip(x[0]));
  const [title, journal] = splitTitleJournal(head.group('rest')!);
  return { authors, title, journal, year: m.group('year'), volume: m.group('volume'), pages: m.group('pages') };
}

/** The reference list's paragraphs as imported references, each parsed. */
export const readList = (texts: string[]): ImportedReference[] =>
  splitEntries(texts).map(([number, text]) => ({ number, text, ref: parseReference(text), keep: true, looked_up: '' }));

// ---------------------------------------------------------------------- citations

/** {number as cited: [reference IDs]}: "3" cites all of 3a, 3b…; `ids` gives each kept imported reference's ID (by its index in `found`). */
export function citationMap(found: ImportedReference[], ids: Map<number, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (k: string, rid: string): void => { const l = out.get(k); if (l) l.push(rid); else out.set(k, [rid]); };
  found.forEach((r, k) => {
    const rid = ids.get(k);
    if (!rid || !r.number) return;
    add(r.number, rid);
    const m = fullmatch(rx('(\\d+)[a-z]'), r.number);
    if (m) add(m.group(1)!, rid);
  });
  return out;
}

/** "3,4" → ["3", "4"]; "3–5" → 3, 4, 5; "3a" → ["3a"]; null if it is not that. */
export function numbersOf(spec: string): string[] | null {
  const out: string[] = [];
  for (const part of split(rx('\\s*,\\s*'), strip(spec))) {
    const r = fullmatch(rx('(\\d+)\\s*[-–—]\\s*(\\d+)'), part);
    if (r) {
      const a = Number(r.group(1)), b = Number(r.group(2));
      if (!(b - a > 0 && b - a < 50)) return null;
      for (let i = a; i <= b; i++) out.push(String(i));
    } else if (fullmatch(rx('\\d+[a-z]?'), part)) out.push(part);
    else return null;
  }
  return out.length ? out : null;
}

// Words a superscript number after which is not a citation: units, substituent labels and groups, single letters.
const NOT_BEFORE = rx('(?:(?<![A-Za-z])(?:[A-Za-z]|[a-zµμ]?m|[kM]?Hz|[kmµμ]?[gL]|[mµμ]?mol|[mµ]?M|min|cm|mm|nm|Å|eV|kJ|kcal|cal|bar|Pa|ppm|Ar|Het|Nu|PG|Ln|Me|Et|Pr|Bu|Ph|Bn|Ts|Ms|Tf|Ac|Bz|Boc|Cbz|Si|Sn|Ge|Pd|Pt|Rh|Ir|Ru|Cu|Ni|Co|Fe|Zn|Mg|Li|Na|Cs|Al|Ti|Zr)\\s?)$');

/** Numbered citations in imported text (stored text format) as the program's citations of those references. */
export function linkCitations(markup: string, numbers: Map<string, string[]>): string {
  if (!numbers.size || !markup) return markup;
  const cite = (spec: string): string | null => {
    const found = numbersOf(spec);
    if (!found || found.some((n) => !numbers.has(n))) return null;
    const ids: string[] = [];
    for (const n of found) for (const rid of numbers.get(n)!) if (!ids.includes(rid)) ids.push(rid);
    return '@cite{' + ids.join(',') + '}';
  };
  let out = sub(rx('\\^\\{(\\d+[a-z]?(?:\\s*[,–—-]\\s*\\d+[a-z]?)*)\\}'), (m) => {
    const before = markup.slice(0, m.index);
    const after = markup.slice(m.end, m.end + 1);
    if (!before || isSpace(before.slice(-1)) || search(NOT_BEFORE, before) || (after && (isUpper(after) || isDigit(after)))) return m[0];   // (an isotope "^{13}C", a unit, R^{1}…)
    return cite(m.group(1)!) ?? m[0];
  }, markup);
  out = sub(rx('\\s?\\[(\\d+[a-z]?(?:\\s*[,–—-]\\s*\\d+[a-z]?)*)\\]'), (m) => cite(m.group(1)!) ?? m[0], out);
  return out;
}

