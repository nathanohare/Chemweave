// Where English words may be hyphenated at the end of a line (Layout > Hyphenation in Document
// mode): Frank Liang's US English patterns for TeX, as the hyphen package gives them. Words are
// looked up once and remembered.

import hyphen from 'hyphen/en-us/index.js';
import type { Hyphenation } from './layout';

const SOFT = '­';
const known = new Map<string, number[]>();

// Parts chemical names are built from (multiplying prefixes, substituents, common stems), longest
// first. A name made of them may also break between them, as chemists (and Word's dictionary)
// break "3,4-Di-methoxy-phenyl-boronic acid", where the patterns, made for ordinary words, don't.
const CHEM_PARTS = [
  'benzyloxy', 'carbonyl', 'carboxy', 'sulfonyl', 'hydroxy', 'methoxy', 'ethoxy', 'propoxy', 'butoxy', 'phenoxy',
  'methyl', 'ethyl', 'propyl', 'butyl', 'pentyl', 'hexyl', 'phenyl', 'benzyl', 'acetyl', 'formyl', 'vinyl', 'allyl',
  'amino', 'nitro', 'cyano', 'chloro', 'bromo', 'fluoro', 'iodo', 'boronic', 'tosyl', 'mesyl', 'silyl',
  'tetra', 'penta', 'hexa', 'hepta', 'octa', 'nona', 'deca', 'tris', 'bis', 'tri', 'di',
].sort((a, b) => b.length - a.length);

/** Where a chemical name may break between its parts: [] unless it starts with two or more of them ("Diode" stays whole). */
export function chemPoints(word: string): number[] {
  const w = word.toLowerCase();
  const ends: number[] = [];
  let at = 0;
  while (at < w.length) {
    const part = CHEM_PARTS.find((x) => w.startsWith(x, at));
    if (!part) break;
    at += part.length;
    ends.push(at);
  }
  return ends.length >= 2 ? ends.filter((k) => k < w.length) : [];
}

/** The places a word may be broken (offsets into it), from the patterns (and a chemical name's parts). */
export function hyphenPoints(word: string): number[] {
  let got = known.get(word);
  if (got) return got;
  got = [];
  const marked = hyphen.hyphenateSync(word.toLowerCase(), { hyphenChar: SOFT, minWordLength: 5 });
  let at = 0;
  for (const ch of marked) {
    if (ch === SOFT) got.push(at);
    else at += ch.length;
  }
  for (const k of chemPoints(word)) if (!got.includes(k)) got.push(k);
  got.sort((a, b) => a - b);
  if (known.size > 20000) known.clear();
  known.set(word, got);
  return got;
}

/** A document's hyphenation settings, as saved in Word's settings.xml. */
export interface DocHyphenation {
  /** Automatic hyphenation on (Layout > Hyphenation > Automatic). */
  auto: boolean;
  /** Hyphenation zone in points (Word's default is a quarter of an inch). */
  zone?: number;
  /** Most lines in a row ending in a hyphen (0 or none: no limit). */
  limit?: number;
  /** Hyphenate words in capitals (on in Word unless turned off). */
  caps?: boolean;
}

export const DEFAULT_ZONE = 18;

/** The layout's hyphenation for a document's settings, or undefined when it is off. */
export function hyphenation(h: DocHyphenation | undefined): Hyphenation | undefined {
  if (!h?.auto) return undefined;
  return { points: hyphenPoints, zone: h.zone ?? DEFAULT_ZONE, limit: h.limit ?? 0, caps: h.caps !== false };
}
