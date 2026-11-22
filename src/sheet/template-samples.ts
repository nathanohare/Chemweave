// Example rows for the pictures on the New Spreadsheet window's cards, so each template shows
// what it holds once in use (an optimization table with entries, an inventory with bottles).
// They are put into the card's own copy only: a template picked from the window starts empty.
// The values are made up to look like ordinary lab work; molecular weights are typed in, not
// worked out from structures, so the picture needs no chemistry engine.

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
    ['Palladium(II) acetate', '', 224.51, 1, 'g', 'Desiccator 2', 'Irritant', 'Strem', '46-1780', '2026-07-21', '2026-07-30', 'LR', ''],
    ['Sodium borohydride', '[BH4-].[Na+]', 37.83, 25, 'g', 'Glove box', 'Water-reactive', 'Oakwood', '094138', '2026-06-02', '', 'NO', 'unopened'],
    ['Dichloromethane', 'ClCCl', 84.93, 4, 'L', 'Solvent room', 'Toxic', 'Fisher', 'D37-4', '2026-09-15', '2026-09-15', 'Group', ''],
    ['n-Butyllithium, 2.5 M', '', 64.06, 100, 'mL', 'Fridge 1', 'Pyrophoric', 'Sigma-Aldrich', '230707', '2026-10-01', '2026-10-03', 'LR', 'titrated 10-03'],
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
      ['NO-3-112, crude', 1.00, 1.71, 1],
      ['NO-3-113, crude', 1.00, 1.42, 1],
      ['NO-3-114, crude', 1.00, 1.88, 1],
      ['NO-3-115, crude', 1.00, 0.95, 1],
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

/** A note on a template's enlarged picture: a column (under its heading) or one cell, what goes in it or (calc) what is worked out there. */
export interface Callout { col: number; row?: number; text: string; calc?: boolean }

/** The notes on each template's enlarged picture, and how many of its top rows it shows. */
export const TEMPLATE_CALLOUTS: Record<string, { rows: number; notes: Callout[] }> = {
  'reaction-table': {
    rows: 6,
    notes: [
      { col: 0, text: 'Entry number, filled in 1 to 12' },
      { col: 1, text: 'Substrate: compound number or SMILES' },
      { col: 2, text: 'Catalyst, as text (subscripts are set for you)' },
      { col: 3, text: 'Catalyst loading, shown in mol %' },
      { col: 4, text: 'Ligand' },
      { col: 5, text: 'Additive or base' },
      { col: 6, text: 'Solvent' },
      { col: 7, text: 'Concentration, shown in M' },
      { col: 8, text: 'Temperature, shown in °C (−78 with a true minus)' },
      { col: 9, text: 'Time, shown in h' },
      { col: 10, text: 'Conversion, shown in %' },
      { col: 11, text: 'Yield, shown in %; the best is found below the table' },
      { col: 12, text: 'ee, shown in %' },
      { col: 13, text: 'dr, as text (>20:1)' },
      { col: 14, text: 'Notes' },
    ],
  },
  'reagent-sheet': {
    rows: 6,
    notes: [
      { col: 0, text: 'Reagent name' },
      { col: 1, text: 'Structure: draw it or type SMILES' },
      { col: 2, text: 'MW worked out from the structure (or type it)', calc: true },
      { col: 3, text: 'Equivalents: 1 for the limiting reagent' },
      { col: 4, text: 'mmol: type the limiting reagent\'s; the rest = equiv × that', calc: true },
      { col: 5, text: 'Mass = mmol × MW', calc: true },
      { col: 6, text: 'Density, for a liquid' },
      { col: 7, text: 'Concentration, for a solution' },
      { col: 8, text: 'Volume from the mass and density, or mmol and concentration', calc: true },
    ],
  },
  'stock-solution': {
    rows: 19,
    notes: [
      { col: 1, row: 1, text: 'Name of the solid' },
      { col: 1, row: 2, text: 'SMILES, or its MW' },
      { col: 1, row: 3, text: 'MW, from the structure', calc: true },
      { col: 1, row: 4, text: 'Concentration you want' },
      { col: 1, row: 5, text: 'Volume you want' },
      { col: 1, row: 6, text: 'Mass to weigh = M × mL × MW', calc: true },
      { col: 1, row: 9, text: 'Density of the liquid' },
      { col: 1, row: 10, text: 'Its purity' },
      { col: 1, row: 11, text: 'Volume to measure', calc: true },
      { col: 1, row: 14, text: 'Stock\'s concentration' },
      { col: 1, row: 15, text: 'Concentration you want' },
      { col: 1, row: 16, text: 'Final volume' },
      { col: 1, row: 17, text: 'Stock to take (C1V1 = C2V2)', calc: true },
      { col: 1, row: 18, text: 'Solvent to add', calc: true },
    ],
  },
};
