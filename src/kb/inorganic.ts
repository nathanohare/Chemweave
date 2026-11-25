// Two inorganic chemistry tables for the Knowledge Base: Hard and Soft Acids and Bases (Pearson's
// classification and his absolute hardness values) and Electronegativity (Pauling's early values
// and Allen's configuration-energy scale). Only facts and numbers are taken; every explanation is
// written for Chemweave.
//
// How the values were found and checked (Claude, for Nate, 2026-11-24):
// - Classification: Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed. (Pearson, 2014),
//   Tables 6.14 and 6.15, which credit R. G. Pearson, J. Chem. Educ. 1968, 45, 581. The paper is
//   real (Crossref: doi 10.1021/ed045p581, "Hard and soft acids and bases, HSAB, part 1:
//   Fundamental principles") but its own tables could not be read, so each row cites the paper as
//   the textbook tabulates it. The textbook's "[Co(CN)₅]²⁻" is left out: pentacyanocobaltate(II)
//   carries a 3− charge, so the printed charge is wrong and the entry is held back until it is
//   checked against Pearson's table.
// - Absolute hardness: the textbook's Table 6.16, from R. G. Pearson, Inorg. Chem. 1988, 27, 734
//   (doi 10.1021/ic00277a030, checked on Crossref). Every row satisfies Pearson's own definitions
//   χ = (I + A)/2 and η = (I − A)/2 (Parr and Pearson, J. Am. Chem. Soc. 1983, 105, 7512) to within
//   rounding, which tests/kb-inorganic.test.ts checks.
// - Pauling: the textbook's Table 3.3 (early values), credited there to L. Pauling, The Nature of
//   the Chemical Bond, 3rd ed. (Cornell University Press, 1960); the page was not checked.
// - Allen: the textbook's Table 3.5, from Mann, Meek and Allen, J. Am. Chem. Soc. 2000, 122, 2780
//   (main group) and Mann, Meek, Knight, Capitani and Allen, J. Am. Chem. Soc. 2000, 122, 5132
//   (d block: Zn and Cd here), both checked on Crossref; all 30 values agree with the Allen values
//   listed on Wikipedia's electronegativity data page, which cites the same two papers. The
//   rows from indium on were read from the printed Table 3.5 itself (it gives Bi, Po, At and Rn in
//   parentheses) and are not in that cross-check.
// - CO stretching ranges: the textbook's Table 13.2 (approximate ranges in neutral complexes).

import type { Cell, KbSource, KbTable } from './tables';

const TEXTBOOK = 'Miessler, G. L.; Fischer, P. J.; Tarr, D. A. Inorganic Chemistry, 5th ed.; Pearson, 2014';

export const PEARSON_1968: KbSource = { label: 'Pearson, R. G. J. Chem. Educ. 1968, 45, 581–587 (Hard and soft acids and bases, HSAB, part 1), as tabulated in ' + TEXTBOOK + ', Tables 6.14 and 6.15', url: 'https://doi.org/10.1021/ed045p581' };
export const PEARSON_1988: KbSource = { label: 'Pearson, R. G. Inorg. Chem. 1988, 27, 734–740 (absolute electronegativity and hardness), as reproduced in ' + TEXTBOOK + ', Table 6.16', url: 'https://doi.org/10.1021/ic00277a030' };
export const PARR_PEARSON_1983: KbSource = { label: 'Parr, R. G.; Pearson, R. G. J. Am. Chem. Soc. 1983, 105, 7512–7516 (the definition of absolute hardness)', url: 'https://doi.org/10.1021/ja00364a005' };
export const PAULING_1960: KbSource = { label: 'Pauling, L. The Nature of the Chemical Bond, 3rd ed.; Cornell University Press, 1960 (early values), as listed in ' + TEXTBOOK + ', Table 3.3' };
export const ALLEN_MAIN: KbSource = { label: 'Mann, J. B.; Meek, T. L.; Allen, L. C. J. Am. Chem. Soc. 2000, 122, 2780–2783 (configuration energies of the main-group elements)', url: 'https://doi.org/10.1021/ja992866e' };
export const ALLEN_D: KbSource = { label: 'Mann, J. B.; Meek, T. L.; Knight, E. T.; Capitani, J. F.; Allen, L. C. J. Am. Chem. Soc. 2000, 122, 5132–5137 (configuration energies of the d-block elements)', url: 'https://doi.org/10.1021/ja9928677' };

// ---- Hard and Soft Acids and Bases

type HsabClass = 'Hard' | 'Borderline' | 'Soft';

/** Pearson's classification as Miessler, Fischer and Tarr tabulate it: [acid or base, class, species, note]. R is an alkyl or aryl group. */
const CLASSES: ['Acid' | 'Base', HsabClass, string, string?][] = [
  ...(['H⁺', 'Li⁺', 'Na⁺', 'K⁺', 'Be²⁺', 'Mg²⁺', 'Ca²⁺', 'Sr²⁺', 'BF₃', 'BCl₃', 'B(OR)₃', 'Al³⁺', 'Al(CH₃)₃', 'AlCl₃', 'AlH₃', 'Cr³⁺', 'Mn²⁺', 'Fe³⁺', 'Co³⁺'] as const).map((s): ['Acid', 'Hard', string] => ['Acid', 'Hard', s]),
  ['Acid', 'Hard', 'Ions with oxidation state +4 or higher', 'A class, not one species'],
  ['Acid', 'Hard', 'HX', 'Molecules that form hydrogen bonds'],
  ...(['B(CH₃)₃', 'Fe²⁺', 'Co²⁺', 'Ni²⁺', 'Cu²⁺', 'Zn²⁺', 'Rh³⁺', 'Ir³⁺', 'Ru³⁺', 'Os²⁺'] as const).map((s): ['Acid', 'Borderline', string] => ['Acid', 'Borderline', s]),
  ...(['BH₃', 'Tl⁺', 'Tl(CH₃)₃', 'Cu⁺', 'Ag⁺', 'Au⁺', 'Cd²⁺', 'Hg₂²⁺', 'Hg²⁺', 'CH₃Hg⁺', 'Pd²⁺', 'Pt²⁺', 'Pt⁴⁺', 'Br₂', 'I₂'] as const).map((s): ['Acid', 'Soft', string] => ['Acid', 'Soft', s]),
  ['Acid', 'Soft', 'Metal atoms (oxidation state 0)', 'A class, not one species'],
  ['Acid', 'Soft', 'π acceptors', 'For example trinitrobenzene, quinones, tetracyanoethylene'],
  ...(['F⁻', 'Cl⁻', 'H₂O', 'OH⁻', 'O²⁻', 'ROH', 'RO⁻', 'R₂O', 'CH₃COO⁻', 'NO₃⁻', 'ClO₄⁻', 'CO₃²⁻', 'SO₄²⁻', 'PO₄³⁻', 'NH₃', 'RNH₂', 'N₂H₄'] as const).map((s): ['Base', 'Hard', string] => ['Base', 'Hard', s]),
  ...(['Br⁻', 'NO₂⁻', 'N₃⁻', 'SO₃²⁻', 'C₆H₅NH₂', 'C₅H₅N', 'N₂'] as const).map((s): ['Base', 'Borderline', string] => ['Base', 'Borderline', s]),
  ...(['H⁻', 'I⁻', 'H₂S', 'SH⁻', 'S²⁻', 'RSH', 'RS⁻', 'R₂S', 'SCN⁻', 'CN⁻', 'RNC', 'CO', 'S₂O₃²⁻', 'PR₃', 'P(OR)₃', 'AsR₃', 'C₂H₄', 'C₆H₆'] as const).map((s): ['Base', 'Soft', string] => ['Base', 'Soft', s]),
];

/**
 * Pearson 1988 as the textbook's Table 6.16 gives it: species | I | A | χ | η (eV). For the anions
 * the values are those of the neutral atom (F for F⁻), as the table notes.
 */
const HARDNESS = `Al³⁺|119.99|28.45|74.22|45.77
Li⁺|75.64|5.39|40.52|35.12
Na⁺|47.29|5.14|26.21|21.08
K⁺|31.63|4.34|17.99|13.64
Au⁺|20.5|9.23|14.90|5.6
BF₃|15.81|−3.5|6.2|9.7
H₂O|12.6|−6.4|3.1|9.5
NH₃|10.7|−5.6|2.6|8.2
PF₃|12.3|−1.0|5.7|6.7
PH₃|10.0|−1.9|4.1|6.0
F⁻|17.42|3.40|10.41|7.01
Cl⁻|13.01|3.62|8.31|4.70
Br⁻|11.84|3.36|7.60|4.24
I⁻|10.45|3.06|6.76|3.70`;

/** The kind of species a hardness row is, from Table 6.14 or 6.15 when they list it. */
const HARDNESS_KIND: Record<string, 'Acid' | 'Base'> = { 'Al³⁺': 'Acid', 'Li⁺': 'Acid', 'Na⁺': 'Acid', 'K⁺': 'Acid', 'Au⁺': 'Acid', 'BF₃': 'Acid', 'H₂O': 'Base', 'NH₃': 'Base', 'PF₃': 'Base', 'PH₃': 'Base', 'F⁻': 'Base', 'Cl⁻': 'Base', 'Br⁻': 'Base', 'I⁻': 'Base' };

const CLASS_INFO = 'Pearson\'s class. Hard acids and bases are small, hold their electrons tightly and are not easily polarized (H⁺, Al³⁺, F⁻, H₂O); soft ones are large and easily polarized (Ag⁺, Hg²⁺, I⁻, R₂S); borderline ones fall between. Hard acids bind hard bases more strongly, soft acids soft bases. A qualitative rule for comparing species, not a measured number. Source: Pearson, J. Chem. Educ. 1968, 45, 581, as tabulated by Miessler, Fischer and Tarr (Inorganic Chemistry, 5th ed., 2014, Tables 6.14 and 6.15).';
const I_INFO = 'Ionization energy I, in eV: the energy to take one electron away. For a cation it is the next ionization of the element (for Al³⁺, the fourth of aluminum). Source: Pearson, Inorg. Chem. 1988, 27, 734.';
const A_INFO = 'Electron affinity A, in eV: the energy given out when the species takes one electron. For a cation it equals the ionization energy of the species with one electron more; a negative value means the extra electron is not held. Source: Pearson, Inorg. Chem. 1988, 27, 734.';
const CHI_INFO = 'Absolute (Mulliken) electronegativity χ = (I + A)/2, in eV. Not on the Pauling scale: see the Electronegativity table for that. Source: Pearson, Inorg. Chem. 1988, 27, 734.';
const ETA_INFO = 'Absolute hardness η = (I − A)/2, in eV: half the gap between ionization energy and electron affinity (Parr and Pearson, J. Am. Chem. Soc. 1983, 105, 7512). Larger is harder. For the anions the source uses the neutral atom\'s values (F for F⁻), so their η is approximate. Source: Pearson, Inorg. Chem. 1988, 27, 734.';
const SOURCE_INFO = 'Where the row comes from. The links at the end of the row open the papers.';

const CLASS_COLUMNS = [
  { key: 'species', label: 'Species' },
  { key: 'kind', label: 'Acid or base', filter: true, narrow: true },
  { key: 'cls', label: 'Class', filter: true, narrow: true, info: CLASS_INFO },
  { key: 'note', label: 'Note', prose: true },
  { key: 'source', label: 'Source', prose: true, info: SOURCE_INFO },
];
const HARDNESS_COLUMNS = [
  { key: 'species', label: 'Species' },
  { key: 'kind', label: 'Acid or base', filter: true, narrow: true },
  { key: 'ie', label: 'I (eV)', numeric: true, info: I_INFO },
  { key: 'ea', label: 'A (eV)', numeric: true, info: A_INFO },
  { key: 'chi', label: 'χ (eV)', numeric: true, info: CHI_INFO },
  { key: 'eta', label: 'η (eV)', numeric: true, info: ETA_INFO },
  { key: 'source', label: 'Source', prose: true, info: SOURCE_INFO },
];

export const HSAB_TABLE: KbTable = {
  id: 'hsab',
  title: 'Hard and Soft Acids and Bases',
  about: 'Pearson\'s classification of Lewis acids and bases as hard, borderline or soft (R is an alkyl or aryl group), and absolute hardness η with the ionization energy, electron affinity and absolute electronegativity it comes from. Hard acids bind hard bases best, soft acids soft bases.',
  columns: [...HARDNESS_COLUMNS.slice(0, 2), CLASS_COLUMNS[2], ...HARDNESS_COLUMNS.slice(2, 6), CLASS_COLUMNS[3], CLASS_COLUMNS[4], { key: 'part', label: 'Part', hidden: true }],
  parts: [
    { key: 'class', title: 'Classification', columns: CLASS_COLUMNS },
    { key: 'hardness', title: 'Absolute hardness (eV)', columns: HARDNESS_COLUMNS },
  ],
  rows: [
    ...CLASSES.map(([kind, cls, species, note]): Record<string, Cell> => ({
      part: 'class', species, kind, cls, note: note ?? null, source: `Pearson 1968, via Miessler, Fischer and Tarr, Table ${kind === 'Acid' ? '6.15' : '6.14'}`,
    })),
    ...HARDNESS.split('\n').map((line): Record<string, Cell> => {
      const [species, ie, ea, chi, eta] = line.split('|');
      return { part: 'hardness', species, kind: HARDNESS_KIND[species], ie, ea, chi, eta, source: 'Pearson 1988, via Miessler, Fischer and Tarr, Table 6.16' };
    }),
  ],
  sources: [PEARSON_1968, PEARSON_1988, PARR_PEARSON_1983, { label: 'Notes and order by Chemweave' }],
  links: (row) => [row.part === 'hardness' ? { label: 'Pearson 1988', url: PEARSON_1988.url! } : { label: 'Pearson 1968', url: PEARSON_1968.url! }],
};

// ---- Electronegativity

/**
 * Atomic number | symbol | name | Pauling (early, one decimal; empty where Table 3.3 has none) |
 * Allen (Table 3.5, Pauling units).
 */
const EN = `1|H|Hydrogen|2.1|2.300
2|He|Helium||4.160
3|Li|Lithium||0.912
4|Be|Beryllium||1.576
5|B|Boron||2.051
6|C|Carbon|2.5|2.544
7|N|Nitrogen|3.0|3.066
8|O|Oxygen|3.5|3.610
9|F|Fluorine|4.0|4.193
10|Ne|Neon||4.787
11|Na|Sodium||0.869
12|Mg|Magnesium||1.293
13|Al|Aluminum||1.613
14|Si|Silicon|1.8|1.916
15|P|Phosphorus|2.1|2.253
16|S|Sulfur|2.5|2.589
17|Cl|Chlorine|3.0|2.869
18|Ar|Argon||3.242
19|K|Potassium||0.734
20|Ca|Calcium||1.034
30|Zn|Zinc||1.588
31|Ga|Gallium||1.756
32|Ge|Germanium|1.8|1.994
33|As|Arsenic|2.0|2.211
34|Se|Selenium|2.4|2.424
35|Br|Bromine|2.8|2.685
36|Kr|Krypton||2.966
37|Rb|Rubidium||0.706
38|Sr|Strontium||0.963
48|Cd|Cadmium||1.521
49|In|Indium||1.656
50|Sn|Tin||1.824
51|Sb|Antimony||1.984
52|Te|Tellurium||2.158
53|I|Iodine||2.359
54|Xe|Xenon||2.582
55|Cs|Cesium||0.659
56|Ba|Barium||0.881
80|Hg|Mercury||1.765
81|Tl|Thallium||1.789
82|Pb|Lead||1.854
83|Bi|Bismuth||2.01|p
84|Po|Polonium||2.19|p
85|At|Astatine||2.39|p
86|Rn|Radon||2.60|p`;

/** The d-block elements, whose Allen values come from the second paper. */
const D_BLOCK = new Set(['Zn', 'Cd', 'Hg']);

const PAULING_INFO = 'Pauling\'s scale, from bond energies: the more a bond A–B is stronger than the average of A–A and B–B, the further apart A and B are on the scale; fluorine is set at 4.0. These are Pauling\'s early one-decimal values (The Nature of the Chemical Bond, 3rd ed., 1960, as listed by Miessler, Fischer and Tarr, Table 3.3). Later revised values differ a little and are not given here. Blank where that table has no value.';
const ALLEN_INFO = 'Allen\'s scale: the average energy of an atom\'s valence electrons in the free atom (its configuration energy), from measured atomic spectra, multiplied by a constant so the numbers sit close to Pauling\'s. It covers the noble gases too. Source: Mann, Meek and Allen, J. Am. Chem. Soc. 2000, 122, 2780 (main group), and Mann et al., J. Am. Chem. Soc. 2000, 122, 5132 (zinc and cadmium), as listed by Miessler, Fischer and Tarr, Table 3.5.';

export const ELECTRONEGATIVITY_TABLE: KbTable = {
  id: 'electronegativity',
  title: 'Electronegativity',
  about: 'How strongly an atom draws the electrons of a bond toward itself, on Pauling\'s scale (from bond energies) and on Allen\'s (from atomic spectra, in Pauling units). Compare values within one scale.',
  columns: [
    { key: 'z', label: 'Atomic number', numeric: true, narrow: true },
    { key: 'symbol', label: 'Symbol', narrow: true },
    { key: 'name', label: 'Element' },
    { key: 'pauling', label: 'Pauling', numeric: true, info: PAULING_INFO },
    { key: 'allen', label: 'Allen', numeric: true, info: ALLEN_INFO },
    { key: 'source', label: 'Source', prose: true, info: 'Where each value comes from. The links at the end of the row open the papers.' },
  ],
  rows: EN.split('\n').map((line): Record<string, Cell> => {
    const [z, symbol, name, pauling, allen, paren] = line.split('|');
    const allenRef = D_BLOCK.has(symbol) ? 'Allen: Mann et al. 2000 (d block)' : 'Allen: Mann, Meek and Allen 2000';
    return {
      z: Number(z), symbol, name, pauling: pauling || null, allen,
      source: [...(pauling ? ['Pauling: Pauling 1960'] : []), allenRef].join('; ') + ' (via Miessler, Fischer and Tarr, Tables 3.3 and 3.5)' + (paren ? '. The Allen value is printed in parentheses in that table' : ''),
    };
  }),
  sources: [PAULING_1960, ALLEN_MAIN, ALLEN_D, { label: TEXTBOOK + ', Tables 3.3 and 3.5' }],
  links: (row) => [D_BLOCK.has(String(row.symbol)) ? { label: 'Mann et al. 2000', url: ALLEN_D.url! } : { label: 'Mann, Meek and Allen 2000', url: ALLEN_MAIN.url! }],
};

// ---- Carbonyl stretching bands

export const MFT_13_2: KbSource = { label: TEXTBOOK + ', Table 13.2 (bridging modes of CO)' };

/** How CO is bound | approximate ν(CO) in neutral complexes, cm⁻¹ (Table 13.2). */
const CO_BANDS: [string, string, string][] = [
  ['Free CO', '2143', 'The gas, for comparison'],
  ['Terminal M–CO', '1850–2120', 'CO on one metal'],
  ['Doubly bridging μ₂-CO (symmetric)', '1700–1860', 'CO shared evenly by two metals'],
  ['Triply bridging μ₃-CO (symmetric)', '1600–1700', 'CO capping a face of three metals'],
  ['μ₄-CO', 'Below 1700', 'CO on four metals; few examples'],
];

export const CO_STRETCH_TABLE: KbTable = {
  id: 'co-stretch',
  title: 'Carbonyl Stretching Bands',
  about: 'Where the C–O stretch of a metal carbonyl appears in the infrared, by how the CO is bound. The ranges are approximate and for neutral complexes: a negative charge on the complex moves the band lower and a positive charge higher, and CO bridging unevenly is also known.',
  columns: [
    { key: 'kind', label: 'Type of CO' },
    { key: 'range', label: 'ν(CO) (cm⁻¹)', info: 'The wavenumber of the C–O stretching band. The more a metal gives electron density back into the π* orbitals of CO, the weaker the C–O bond and the lower the band; a CO bridging more metals takes more, so its band is lower still.' },
    { key: 'note', label: 'Note', prose: true },
    { key: 'source', label: 'Source', prose: true, info: SOURCE_INFO },
  ],
  rows: CO_BANDS.map(([kind, range, note]): Record<string, Cell> => ({ kind, range, note, source: 'Miessler, Fischer and Tarr, Table 13.2' })),
  sources: [MFT_13_2, { label: 'Notes by Chemweave' }],
};
