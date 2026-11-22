// A small line icon for each spreadsheet template, on its card in the New Spreadsheet window in
// place of a picture of the sheet (too small to read; the hover view shows the sheet itself).
// 24-unit line drawings in the current color, as the ribbon icons are.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Small wells in a grid, for the screening plates. */
const wells = (cols: number, rows: number, r: number) => {
  let out = '<rect x="2.5" y="5" width="19" height="14" rx="1.5"/>';
  const dx = 15 / (cols - 1), dy = 9 / (rows - 1);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) out += `<circle cx="${(4.5 + i * dx).toFixed(2)}" cy="${(7.5 + j * dy).toFixed(2)}" r="${r}" fill="currentColor" stroke="none"/>`;
  return out;
};

export const SHEET_TEMPLATE_ICONS: Record<string, string> = {
  // a round-bottomed flask
  'reaction-table': svg('<path d="M10 3h4M10.5 3v5.2a6.5 6.5 0 1 0 3 0V3"/><path d="M6.4 15.5h11.2"/>'),
  // a benzene ring with a group to vary on it
  'substrate-scope': svg('<path d="M10 7.5l5.6 3.25v6.5L10 20.5l-5.6-3.25v-6.5z"/><path d="M6.2 11.8v4.4M10 18.6l3.8-2.2M13.8 11.6L10 9.4"/><path d="M15.6 10.75l2.4-1.4"/><text x="17.6" y="9" font-size="7" font-weight="700" font-family="Arial, sans-serif" fill="currentColor" stroke="none">R</text>'),
  'plate-24': svg(wells(6, 4, 1.1)),
  'plate-96': svg(wells(12, 8, 0.45)),
  // concentration falling with time
  'kinetics': svg('<path d="M4 3v17h17"/><path d="M5.5 5.5c2.5 7.5 6 11 14 12.5"/><circle cx="7" cy="9" r=".9" fill="currentColor"/><circle cx="10" cy="13" r=".9" fill="currentColor"/><circle cx="14.5" cy="16" r=".9" fill="currentColor"/>'),
  // a balance: the pan on its body
  'reagent-sheet': svg('<path d="M4 20h16l-1.5-7h-13z"/><path d="M12 13V9.5"/><path d="M6.5 9.5h11"/><path d="M9 16.5h6"/>'),
  // a bottle with a label
  'inventory': svg('<path d="M9.5 3h5M10 3v3.5L7.5 9v11.5h9V9L14 6.5V3"/><rect x="9" y="12" width="6" height="5" rx=".5"/>'),
  // a volumetric flask with its mark
  'stock-solution': svg('<path d="M10.5 3h3M11 3v8.3l-4.8 6.2a2 2 0 0 0 1.6 3.2h8.4a2 2 0 0 0 1.6-3.2L13 11.3V3"/><path d="M10 7h4"/><path d="M7.6 16h8.8"/>'),
  // a gas cylinder with its valve
  'solvent-log': svg('<path d="M8.5 21V9.5a3.5 3.5 0 0 1 7 0V21z"/><path d="M12 6V3.5M10 3.5h4"/><path d="M8.5 13h7"/>'),
  // standards on a straight line
  'calibration': svg('<path d="M4 3v17h17"/><path d="M5.5 18.5L20 5"/><circle cx="8" cy="16.2" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="16.5" cy="8.3" r="1" fill="currentColor"/>'),
  // two chromatogram peaks, one larger
  'ee-areas': svg('<path d="M3 19h18"/><path d="M3.5 19c3 0 3-13 5-13s2 13 4.5 13c2 0 2-6 3.5-6s1.5 6 4 6"/>'),
  // an NMR spectrum with an integral over a peak
  'nmr-yield': svg('<path d="M3 19h18"/><path d="M6 19V9M8 19v-5M14 19V6M15.5 19v-8M19 19v-4"/><path d="M12 8c1.5 0 1.5-4 3.5-4s2 0 3 0"/>'),
  // a burette over a flask
  'titration': svg('<path d="M10.5 2.5h3v9h-3z"/><path d="M12 11.5v2.5M10 13h4"/><path d="M10.5 16h3M11 16v1.2l-3.5 3.3h9L13 17.2V16"/>'),
  // a parcel
  'orders': svg('<path d="M3.5 7.5L12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5L12 11.5l8.5-4M12 11.5v9"/><path d="M7.7 5.5l8.5 4"/>'),
  // a calendar with a slot booked
  'booking': svg('<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><rect x="7" y="12.5" width="5" height="4" rx=".5" fill="currentColor" stroke="none"/>'),
  // duties going round
  'rota': svg('<path d="M19 12a7 7 0 0 1-12.2 4.7"/><path d="M5 12a7 7 0 0 1 12.2-4.7"/><path d="M17.5 3.5v4h-4M6.5 20.5v-4h4"/>'),
};
