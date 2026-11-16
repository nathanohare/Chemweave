// The Knowledge Base's Key pKa Values: about 120 compounds an organic chemist reaches for, one per
// functional group or reagent, in water and in DMSO side by side, grouped by the kind of acid. Each
// structure is drawn with the hydrogen that comes off shown explicitly. Every value names the paper
// it comes from (Nate, 2026-11-16: no value without a reference); most come from the same checked
// compilations as the pKa Values table (Bordwell's DMSO table as compiled by Reich, Williams'
// water compilation), the rest from original papers checked against their text. Data in
// src/kb/pka-key.json, drawings in src/kb/pka-key-pics.json (build kit: the project's
// knowledge-base/pka-key folder). Loaded when the window first opens.

import type { Template, TemplateAtom, TemplateBond } from '../chem/templates';
import type { Cell, KbSource, KbTable } from './tables';
import { REICH_SOURCE, WILLIAMS_SOURCE } from './pka';
import { ACIDIC_H_COLOR } from './acidic-h';
import DATA from './pka-key.json';
import PICS from './pka-key-pics.json';

/** [group (index into `groups`), name, the compound's SMILES (a base as the neutral base), pKa in water, its papers, pKa in DMSO, its papers, acidic hydrogen, note, PubChem CID (0: none)] */
type KeyRow = [number, string, string, string, number[], string, number[], string, string, number];
const D = DATA as unknown as { groups: string[]; papers: string[]; dois: string[]; rows: KeyRow[] };
/** A drawing with its acidic hydrogen drawn: `h` is [that hydrogen's atom, its bond]. */
type KeyPic = { atoms: TemplateAtom[]; bonds: TemplateBond[]; h: [number, number] };
const P = PICS as unknown as Record<string, KeyPic>;

/** The functional groups, in the order the table shows them. */
export const KEY_PKA_GROUPS: readonly string[] = D.groups;

/** "Hall, J. Am. Chem. Soc. 1957, 79, 5441" → "Hall 1957". */
function shortCite(cite: string): string {
  const year = /\b(1[89]\d\d|20\d\d)\b/.exec(cite)?.[1] ?? '';
  const who = cite.split(/,| and | et al\./)[0].trim();
  return year ? `${who} ${year}` : who;
}

/** The drawing of a row, with the hydrogen that comes off drawn as its own atom. */
export function keyPkaPicture(row: Record<string, Cell>): Template | null {
  const p = P[String(row.name)];
  // the acidic hydrogen and its bond in red, as in pKa Values
  return p ? { id: `pka-key-${row.name}`, name: String(row.name), group: 'own', atoms: p.atoms, bonds: p.bonds, attach: 0, highlight: { atoms: [p.h[0]], bonds: [p.h[1]], color: ACIDIC_H_COLOR } } : null;
}

/** Which atom and bond of a row's drawing are the acidic hydrogen and its bond. */
export function keyPkaHydrogen(name: string): { atom: number; bond: number } | null {
  const p = P[name];
  return p ? { atom: p.h[0], bond: p.h[1] } : null;
}

const cites = (papers: number[]) => papers.map((i) => D.papers[i]);

export const KEY_PKA_ROWS: Record<string, Cell>[] = D.rows.map(([g, name, smiles, water, wp, dmso, dp, site, note, cid]) => ({
  group: D.groups[g], name, smiles, water: water || null, dmso: dmso || null, site, notes: note || null,
  refs: [...cites(wp).map((c) => (dmso ? `Water: ${c}` : c)), ...cites(dp).map((c) => (water ? `DMSO: ${c}` : c))].join('; '),
  cid: cid || null,
}));

/** Each paper's DOI, by its citation. */
const DOI_OF = new Map<string, string>(D.papers.map((p, i): [string, string] => [p, D.dois[i]]).filter(([, d]) => d));

const WATER_INFO = 'pKa in water at about 25 °C: −log Ka for losing the hydrogen drawn in the structure. Lower is more acidic. For a base the value is that of its conjugate acid, the protonated form drawn. A ~ marks an approximate value. Blank where no measured value with a paper is known to us.';
const DMSO_INFO = 'pKa in dimethyl sulfoxide at 25 °C, mostly measured by F. G. Bordwell\'s group. DMSO solvates anions less well than water, so neutral acids read higher than in water (acetic acid: 12.6 against 4.76), while protonated amines read about the same. Compare values within one solvent.';

export const KEY_PKA_TABLE: KbTable = {
  id: 'pka-key',
  title: 'Key pKa Values',
  about: `${KEY_PKA_ROWS.length} pKa values an organic chemist reaches for most, one compound for each common functional group, acid and base, in water and in DMSO side by side and grouped by the kind of acid. Each structure shows the hydrogen that comes off; bases are drawn as their conjugate acids. Every value names its paper. For more compounds, use the pKa Values table.`,
  columns: [
    { key: 'pic', label: 'Structure', picture: true },
    { key: 'name', label: 'Compound' },
    { key: 'water', label: 'pKa (water)', numeric: true, info: WATER_INFO },
    { key: 'dmso', label: 'pKa (DMSO)', numeric: true, info: DMSO_INFO },
    { key: 'site', label: 'Acidic H', narrow: true },
    { key: 'notes', label: 'Notes', prose: true },
    { key: 'refs', label: 'Sources', prose: true, info: 'The paper or book each value comes from. The links at the end of a row open the papers that have a DOI.' },
    { key: 'group', label: 'Group', filter: true, hidden: true },
    { key: 'smiles', label: 'SMILES', hidden: true },
  ],
  group: 'group',
  picture: keyPkaPicture,
  pictureSize: 64,
  fit: true,
  structure: keyPkaPicture,
  canonicalSmiles: true,
  rows: KEY_PKA_ROWS,
  sources: [REICH_SOURCE, WILLIAMS_SOURCE, { label: 'Original papers for each value: the Sources column' }, { label: 'Choice of compounds, groups, names and drawings by Chemweave' }],
  links: (row) => {
    const out: KbSource[] = row.cid ? [{ label: 'PubChem', url: `https://pubchem.ncbi.nlm.nih.gov/compound/${row.cid}` }] : [];
    for (const part of String(row.refs ?? '').split('; ')) {
      const cite = part.replace(/^(Water|DMSO): /, '');
      const doi = DOI_OF.get(cite);
      if (doi && !out.some((s) => s.url === `https://doi.org/${doi}`)) out.push({ label: shortCite(cite), url: `https://doi.org/${doi}` });
    }
    return out;
  },
};
