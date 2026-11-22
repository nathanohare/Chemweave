// Example rows for the pictures on the New Spreadsheet window's cards, so each template shows
// what it holds once in use (an optimization table with entries, an inventory with bottles).
// They are put into the card's own copy only: a template picked from the window starts empty.
// The values are made up to look like ordinary lab work; molecular weights are typed in, not
// worked out from structures. Structures are written as SMILES and drawn for the picture when
// the chemistry engine is ready (otherwise the SMILES shows).

import type { Workbook } from './workbook';

type Sheet = Workbook['sheets'][number];

/** Type rows of values into a sheet from (row, col); empty strings are left alone. */
function rows(sh: Sheet, row: number, col: number, values: (string | number)[][]): void {
  values.forEach((line, r) => line.forEach((v, c) => { if (v !== '') sh.setInput(row + r, col + c, String(v)); }));
}

/** Each template's example rows, by template id. */
export const TEMPLATE_SAMPLES: Record<string, (wb: Workbook) => void> = {
  'reaction-table': (wb) => rows(wb.sheets[0], 1, 1, [
    ['1a', 'Pd(OAc)2', 5, 'XPhos', 'K3PO4', 'toluene', 0.2, 110, 24, 95, 82, '', '', ''],
    ['1a', 'Pd(OAc)2', 5, 'SPhos', 'K3PO4', 'toluene', 0.2, 110, 24, 88, 71, '', '', ''],
    ['1a', 'Pd2(dba)3', 2.5, 'XPhos', 'Cs2CO3', 'dioxane', 0.2, 100, 18, 99, 91, '', '', ''],
    ['1a', 'Pd2(dba)3', 2.5, 'XPhos', 'Cs2CO3', 'dioxane', 0.1, 80, 18, 76, 64, '', '', ''],
    ['1a', 'Pd2(dba)3', 1, 'XPhos', 'Cs2CO3', 'dioxane', 0.2, 100, 36, 97, 89, '', '', 'slow'],
    ['1a', '—', '', '—', 'Cs2CO3', 'dioxane', 0.2, 100, 24, 0, 0, '', '', 'no catalyst'],
  ]),
  'substrate-scope': (wb) => rows(wb.sheets[0], 1, 1, [
    ['4-MeO', 187.04, '3a', 85, 94, '>20:1', 'NO-3-112', ''],
    ['4-CF3', 225.01, '3b', 78, 92, '>20:1', 'NO-3-113', ''],
    ['4-Cl', 191.45, '3c', 81, 95, '>20:1', 'NO-3-114', ''],
    ['2-Me', 171.04, '3d', 64, 88, '15:1', 'NO-3-115', 'ortho: slower'],
    ['3-pyridyl', 158.00, '3e', 52, 90, '>20:1', 'NO-3-118', ''],
    ['2-naphthyl', 207.07, '3f', 88, 96, '>20:1', 'NO-3-120', ''],
  ]),
  'plate-24': (wb) => plateMap(wb, 4, 6),
  'plate-96': (wb) => plateMap(wb, 8, 12),
  'reagent-sheet': (wb) => {
    const sh = wb.sheets[0];
    rows(sh, 1, 0, [['4-bromoanisole', 'COc1ccc(Br)cc1', 187.04, '', '', '', 1.494]]);
    rows(sh, 2, 0, [
      ['phenylboronic acid', 'OB(O)c1ccccc1', 121.93, 1.5],
      ['Pd(PPh3)4', '', 1155.56, 0.05],
      ['K2CO3', 'O=C([O-])[O-].[K+].[K+]', 138.21, 2],
      ['toluene', 'Cc1ccccc1', 92.14, '', '', '', 0.867],
    ]);
  },
  'inventory': (wb) => rows(wb.sheets[0], 1, 0, [
    ['Triethylamine', 'CCN(CC)CC', 101.19, 500, 'mL', 'Flammables cabinet', 'Flammable, corrosive', 'Sigma-Aldrich', 'T0886', '2026-08-04', '2026-08-11', 'NO', ''],
    ['Palladium(II) acetate', 'CC(=O)O[Pd]OC(C)=O', 224.51, 1, 'g', 'Desiccator 2', 'Irritant', 'Strem', '46-1780', '2026-07-21', '2026-07-30', 'LR', ''],
    ['Sodium borohydride', '[BH4-].[Na+]', 37.83, 25, 'g', 'Glove box', 'Water-reactive', 'Oakwood', '094138', '2026-06-02', '', 'NO', 'unopened'],
    ['Dichloromethane', 'ClCCl', 84.93, 4, 'L', 'Solvent room', 'Toxic', 'Fisher', 'D37-4', '2026-09-15', '2026-09-15', 'Group', ''],
    ['n-Butyllithium, 2.5 M', '[Li]CCCC', 64.06, 100, 'mL', 'Fridge 1', 'Pyrophoric', 'Sigma-Aldrich', '230707', '2026-10-01', '2026-10-03', 'LR', 'titrated 10-03'],
  ]),
  'stock-solution': (wb) => {
    const sh = wb.sheets[0];
    sh.setInput(1, 1, 'TBAF·3H2O');
    sh.setInput(2, 1, '315.51');
    sh.setInput(9, 1, '0.867');
    for (const [r, v] of [[14, '1.0'], [15, '0.1'], [16, '10']] as const) sh.setInput(r, 1, v);
  },
  'solvent-log': (wb) => rows(wb.sheets[0], 1, 0, [
    ['2026-11-03', 'Argon', 'AR-2211', 'Lab 112, bench 3', 1850, 'No', 'NO', ''],
    ['2026-11-10', 'Argon', 'AR-2211', 'Lab 112, bench 3', 900, 'No', 'LR', ''],
    ['2026-11-14', 'Argon', 'AR-2398', 'Lab 112, bench 3', 2200, 'Yes', 'NO', 'old one empty'],
    ['2026-11-14', 'Nitrogen', 'N2-0874', 'Glove box', 1400, 'No', 'LR', ''],
    ['2026-11-18', 'Hydrogen', 'H2-0112', 'Hood 4', 1100, 'No', 'NO', 'leak-checked'],
  ]),
  'ee-areas': (wb) => rows(wb.sheets[0], 1, 0, [
    ['rac-3a', 50412, 50188],
    ['3a, entry 3', 96120, 2945],
    ['3b', 91844, 4120],
    ['3c', 88013, 6377],
    ['3d', 74210, 10950],
  ]),
  'nmr-yield': (wb) => {
    const sh = wb.sheets[0];
    sh.setInput(2, 1, '16.8');
    sh.setInput(5, 1, '0.20');
    rows(sh, 8, 0, [
      // yields of about 85, 72, 93 and 46%
      ['NO-3-112, crude', 1.00, 1.70, 3],
      ['NO-3-113, crude', 1.00, 1.44, 3],
      ['NO-3-114, crude', 1.00, 1.86, 3],
      ['NO-3-115, crude', 1.00, 0.92, 3],
    ]);
  },
  'titration': (wb) => rows(wb.sheets[0], 7, 1, [
    [106.2, '', 0.212],
    [104.8, '', 0.208],
    [108.1, '', 0.216],
  ]),
  'orders': (wb) => rows(wb.sheets[0], 1, 0, [
    ['2026-11-02', 'NO', 'XPhos, 1 g', 'Strem', '15-1052', 1, 168, '', 'Startup', 'Received', '2026-11-03', '2026-11-07'],
    ['2026-11-05', 'LR', 'Celite 545, 1 kg', 'Fisher', 'C212-500', 2, 74.5, '', 'Group', 'Ordered', '2026-11-06', ''],
    ['2026-11-09', 'NO', 'CDCl3, 100 g', 'Cambridge Isotope', 'DLM-7-100', 3, 96, '', 'NMR', 'Backordered', '2026-11-10', ''],
    ['2026-11-12', 'JK', 'TLC plates, silica', 'MilliporeSigma', '1.05554', 1, 312, '', 'Group', 'Requested', '', ''],
  ]),
  'booking': (wb) => {
    const sh = wb.sheets[0];
    sh.setInput(0, 1, 'NMR 400');
    const slots: [number, number, string][] = [[4, 1, 'NO'], [5, 1, 'NO'], [6, 2, 'LR'], [8, 3, 'JK'], [9, 3, 'JK'], [4, 4, 'LR'], [10, 5, 'NO'], [17, 2, 'JK: 13C, 2k scans'], [17, 5, 'NO: NOESY']];
    for (const [r, c, v] of slots) sh.setInput(r, c, v);
  },
  'rota': (wb) => {
    const sh = wb.sheets[0];
    const names = ['Nate', 'Lauren', 'Jordan', 'Priya', 'Sam'];
    for (let r = 1; r <= 6; r++) for (let c = 1; c <= 7; c++) sh.setInput(r, c, names[(r + c) % names.length]);
  },
};

/** Conditions in the first wells of a plate map. */
function plateMap(wb: Workbook, nRows: number, nCols: number): void {
  const sh = wb.sheets[0];
  const ligands = ['XPhos', 'SPhos', 'RuPhos', 'BrettPhos', 'dppf', 'PPh3', 'P(tBu)3', 'Xantphos', 'DavePhos', 'JohnPhos', 'cataCXium A', 'none'];
  const bases = ['K3PO4', 'Cs2CO3', 'K2CO3', 'NaOtBu', 'Et3N', 'DBU', 'KOAc', 'LiHMDS'];
  for (let r = 0; r < nRows; r++) for (let c = 0; c < nCols; c++) sh.setInput(2 + r, 1 + c, `${ligands[c % ligands.length]}, ${bases[r % bases.length]}`);
}

/** A template's workbook with its example rows typed in (for a card's picture). */
export function withSample(id: string, wb: Workbook): Workbook {
  const fill = TEMPLATE_SAMPLES[id];
  if (fill) wb.build(() => fill(wb));
  return wb;
}

/**
 * A note on a template's enlarged picture, drawn as a comment box: on a column (`col`, pointing
 * at its heading) or one cell (`row` too), saying how what is there is worked out. Only worked-out
 * columns and cells get one (what you type is plain from the heading, Nate 2026-11-21), and the
 * text never repeats the heading.
 */
export interface Callout { col: number; row?: number; text: string }

/**
 * The notes on each template's enlarged picture, how many of its top rows it shows, and the row
 * of the column headings the column notes point at (0 when not given). A template with nothing
 * worked out has none, and its card has its description as a tooltip instead.
 */
export const TEMPLATE_CALLOUTS: Record<string, { rows: number; head?: number; notes: Callout[] }> = {
  'reagent-sheet': {
    rows: 6,
    notes: [
      { col: 2, text: 'From the structure. Type over it to use your own.' },
      { col: 4, text: 'Type the limiting reagent\'s; the others are equiv × that.' },
      { col: 5, text: '= mmol × MW' },
      { col: 8, text: '= mass ÷ density, or mmol ÷ conc.' },
    ],
  },
  'substrate-scope': {
    rows: 6,
    notes: [{ col: 2, text: 'From the substrate\'s structure' }],
  },
  'inventory': {
    rows: 6,
    notes: [{ col: 2, text: 'From the structure' }],
  },
  'stock-solution': {
    rows: 19,
    notes: [
      { col: 1, row: 3, text: 'From the structure above, or the MW typed there' },
      { col: 1, row: 6, text: '= M × mL × MW' },
      { col: 1, row: 11, text: '= mass ÷ (density × purity)' },
      { col: 1, row: 17, text: 'C₁V₁ = C₂V₂' },
      { col: 1, row: 18, text: '= final volume − stock' },
    ],
  },
  'kinetics': {
    rows: 20,
    notes: [
      { col: 2, text: '= LN([A])' },
      { col: 1, row: 17, text: '−slope of ln[A] against time' },
      { col: 1, row: 18, text: '= ln 2 ÷ k' },
      { col: 1, row: 19, text: 'Near 1 means first order' },
    ],
  },
  'calibration': {
    rows: 16,
    head: 1,
    notes: [
      { col: 6, text: '= (area − intercept) ÷ slope' },
      { col: 1, row: 13, text: 'Least-squares line through the standards: area = slope × conc. + intercept' },
    ],
  },
  'ee-areas': {
    rows: 6,
    notes: [
      { col: 3, text: 'Each area as % of the total' },
      { col: 4, text: '= |first − second| ÷ total × 100' },
      { col: 5, text: 'The larger peak' },
    ],
  },
  'nmr-yield': {
    rows: 13,
    head: 7,
    notes: [
      { col: 1, row: 4, text: '= mass ÷ MW' },
      { col: 4, text: '= mmol of standard × (integral ÷ protons) ÷ (standard integral ÷ its protons)' },
      { col: 5, text: '= product ÷ theoretical × 100' },
    ],
  },
  'titration': {
    rows: 15,
    head: 6,
    notes: [
      { col: 2, text: '= mg ÷ MW' },
      { col: 4, text: '= mmol × equiv ÷ mL' },
      { col: 1, row: 13, text: 'Mean of the runs' },
    ],
  },
};
