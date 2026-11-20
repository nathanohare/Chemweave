// The fields a compound page can have (Chem SI Assistant's field library, core/fields.py),
// and how each is stored in compound.json, so pages edited here open there unchanged.
//
//   parts        {"value": "0.20", "unit": "mmol"}: short boxes
//   richtext     <key>.txt in the compound's folder (markup.ts)
//   nmr          [{"id", "nucleus": "1H", "label": "", "text": "…"}]
//   attachments  [{"file": "3a_1H.pdf", "type": "1H", …}]: files in spectra/ or files/
//   structure    structure.mol (and a picture, when one was pasted)
//   notes        notes.txt, never printed
//   citations    {"text": "…", "refs": [reference ids]}
//   private      files kept with the compound, never printed
//
// Numbers are kept as the text typed ("0.20", not 0.2), so they print as entered.

export type FieldKind = 'parts' | 'richtext' | 'nmr' | 'attachments' | 'structure' | 'notes' | 'private' | 'citations';
export type PartKind = 'text' | 'number' | 'choice' | 'combo';

export interface Part {
  key: string;
  label?: string;
  kind: PartKind;
  choices?: readonly string[];
  choiceLabels?: Record<string, string>;
  default?: string;
  placeholder?: string;
  /** Shown after the box, such as "°C". */
  suffix?: string;
  /** The drop-down also offers every value of this part used elsewhere in the project. */
  learn?: boolean;
  /** Other fields' parts whose values this one offers too, as "field.part". */
  learnAlso?: readonly string[];
}

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  parts?: readonly Part[];
  /** Which parts must be filled for the field to count as filled (default: every text, number and combo part). */
  filledParts?: readonly string[];
  /** attachments: the folder the files are kept in. */
  subdir?: string;
  /** attachments: the boxes each file has. */
  itemParts?: readonly Part[];
  description?: string;
  removable?: boolean;
  /** A field the person made: {label, type}. */
  custom?: { label: string; type: CustomType };
}

export type CustomType = 'short_text' | 'long_text' | 'number_unit' | 'file';

export const AMOUNT_UNITS = ['mmol', 'µmol', 'mol'] as const;
export const MASS_UNITS = ['mg', 'g', 'µg'] as const;
export const IONIZATION_METHODS = ['ESI', 'APCI', 'EI', 'CI', 'APPI', 'DART', 'FAB', 'MALDI'] as const;
export const ADDUCTS = ['[M+H]+', '[M+Na]+', '[M+K]+', '[M+NH4]+', '[M]+', '[M]+•', '[M−H]−', '[M+Cl]−', '[M+HCOO]−'] as const;
export const NUCLEI = ['1H', '13C', '19F', '31P', '11B', '15N', '29Si', '2H', '77Se', '119Sn', '195Pt'] as const;
export const SPECTRUM_TYPES = ['1H', '13C', '19F', '31P', '11B', 'Other NMR', '2D NMR', 'HPLC/SFC', 'IR', 'Other'] as const;
export const SPECTRUM_TYPE_LABELS: Record<string, string> = { '1H': '¹H NMR', '13C': '¹³C NMR', '19F': '¹⁹F NMR', '31P': '³¹P NMR', '11B': '¹¹B NMR' };
/** Where an additional file goes ("appendix" is kept for older projects: it is the Spectra section). */
export const PLACEMENTS: Record<string, string> = { inline: 'Inline with compound', appendix: 'Spectra section', exclude: "Don't include in SI" };
export const PHYSICAL_STATES = ['colorless oil', 'pale yellow oil', 'yellow oil', 'white solid', 'off-white solid', 'pale yellow solid', 'yellow solid', 'orange solid', 'red solid', 'brown solid', 'colorless crystals'] as const;
export const IR_METHODS = ['ATR', 'neat', 'film', 'KBr'] as const;
export const EE_METHODS = ['HPLC', 'SFC', 'GC'] as const;
export const TLC_VISUALIZATION = ['UV (254 nm)', 'KMnO₄', 'CAM', 'p-anisaldehyde', 'vanillin', 'phosphomolybdic acid (PMA)', 'ninhydrin', 'I₂', 'UV + KMnO₄', 'UV + CAM', 'UV + p-anisaldehyde'] as const;
export const PURIFICATION_METHODS = ['flash column chromatography', 'column chromatography', 'preparative TLC', 'preparative HPLC', 'recrystallization', 'trituration', 'distillation', 'Kugelrohr distillation'] as const;
export const STATIONARY_PHASES = ['SiO₂', 'Et₃N-deactivated SiO₂', 'Al₂O₃', 'basic Al₂O₃', 'C18 (reversed phase)', 'Florisil'] as const;

const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** "13C" → "¹³C" for showing; anything not starting with digits is unchanged. */
export function nucleusLabel(nucleus: string): string {
  const m = /^\d*/.exec(nucleus)![0];
  return [...m].map((d) => SUP[d]).join('') + nucleus.slice(m.length);
}

/** "99%" → "99% ee", "97:3" → "97:3 er"; anything else is left as it is. */
export function eeWithUnit(value: string): string {
  const text = String(value ?? '').trim();
  if (/^[<>≥≤~≈]?\s*\d+(?:[.,]\d+)?\s*%$/.test(text)) return `${text} ee`;
  if (/^[<>≥≤~≈]?\s*\d+(?:[.,]\d+)?\s*:\s*\d+(?:[.,]\d+)?$/.test(text)) return `${text} er`;
  return text;
}

const num = (key: string, label = '', more: Partial<Part> = {}): Part => ({ key, label, kind: 'number', ...more });
const text = (key: string, label = '', more: Partial<Part> = {}): Part => ({ key, label, kind: 'text', ...more });

const FIGURE_LABEL_PART: Part = text('label', 'Label (empty = automatic)', { placeholder: 'automatic' });
const FILE_ITEM_PARTS: readonly Part[] = [
  text('caption', 'Caption'),
  { key: 'placement', label: 'Placement', kind: 'choice', choices: Object.keys(PLACEMENTS), default: 'inline', choiceLabels: PLACEMENTS },
  FIGURE_LABEL_PART,
];

export const CORE_FIELDS: readonly FieldDef[] = [
  { key: 'structure', label: 'Structure', kind: 'structure', description: 'SMILES, MOL file or drawing' },
  { key: 'name', label: 'Name', kind: 'parts', parts: [text('text', '', { placeholder: 'e.g. Ethyl 2-methylfuran-3-carboxylate' })], description: 'Optional' },
  { key: 'procedure', label: 'Experimental procedure', kind: 'richtext' },
  { key: 'scale', label: 'Reaction scale', kind: 'parts', parts: [num('value', '', { placeholder: '0.20' }), { key: 'unit', kind: 'choice', choices: AMOUNT_UNITS }] },
  { key: 'yield', label: 'Yield', kind: 'parts', parts: [
    num('percent', '', { placeholder: '92', suffix: '%' }), num('mass', '', { placeholder: '28.4' }),
    { key: 'mass_unit', kind: 'choice', choices: MASS_UNITS },
    text('note', 'Note', { placeholder: 'optional, e.g. over two steps' }),
  ], filledParts: ['percent', 'mass', 'mass_unit'] },
  { key: 'physical_state', label: 'Physical state', kind: 'parts', parts: [{ key: 'text', kind: 'combo', choices: PHYSICAL_STATES, learn: true }] },
  { key: 'nmr', label: 'NMR peak reports', kind: 'nmr' },
  { key: 'hrms', label: 'HRMS', kind: 'parts', parts: [
    { key: 'ionization', label: 'Ionization', kind: 'combo', choices: IONIZATION_METHODS, default: 'ESI' },
    { key: 'adduct', label: 'Adduct', kind: 'combo', choices: ADDUCTS, default: '[M+H]+' },
    num('found', 'Found m/z', { placeholder: '188.1073' }),
  ], filledParts: ['found'] },
  { key: 'spectra', label: 'Spectra', kind: 'attachments', subdir: 'spectra', itemParts: [
    { key: 'type', label: 'Type', kind: 'choice', choices: SPECTRUM_TYPES, choiceLabels: SPECTRUM_TYPE_LABELS },
    text('title', 'Header in the SI (empty = automatic)', { placeholder: 'automatic, e.g. 3a — 1H NMR (400 MHz, CDCl3)' }),
    text('struct_caption', 'Caption under the structure (empty = automatic)', { placeholder: 'automatic, e.g. 1H NMR (CDCl3, 400 MHz)' }),
  ], description: 'PDFs or images; placed in the spectra section' },
  { key: 'files', label: 'Additional files', kind: 'attachments', subdir: 'files', itemParts: FILE_ITEM_PARTS },
  { key: 'notes', label: 'Notes (private, never printed)', kind: 'notes', removable: false },
];

export const LIBRARY_FIELDS: readonly FieldDef[] = [
  { key: 'mp', label: 'Melting point', kind: 'parts', parts: [text('value', '', { placeholder: '102–104', suffix: '°C' }), text('solvent', 'Recryst. solvent', { placeholder: 'optional' })], filledParts: ['value'] },
  { key: 'rf', label: 'Rf', kind: 'parts', parts: [
    num('value', '', { placeholder: '0.35' }), text('eluent', 'Eluent', { placeholder: '30% EtOAc/hexanes' }),
    { key: 'visualization', label: 'Visualization', kind: 'combo', choices: TLC_VISUALIZATION, placeholder: 'e.g. UV, KMnO₄', learn: true },
  ], filledParts: ['value', 'eluent'] },
  { key: 'purification', label: 'Purification', kind: 'parts', parts: [
    { key: 'method', label: 'Method', kind: 'combo', choices: PURIFICATION_METHODS, placeholder: 'flash column chromatography', learn: true },
    { key: 'phase', label: 'Stationary phase', kind: 'combo', choices: STATIONARY_PHASES, placeholder: 'SiO₂', learn: true },
    { key: 'eluent', label: 'Eluent', kind: 'combo', placeholder: '10% EtOAc/hexanes', learn: true, learnAlso: ['rf.eluent'] },
    text('sentence', 'Printed as', { placeholder: 'automatic' }),
  ], filledParts: ['method'], description: 'Printed as a sentence at the end of the experimental procedure, e.g. “The crude product was purified by flash column chromatography (SiO₂, 10% EtOAc/hexanes).” Type in “Printed as” to print your own sentence instead.' },
  { key: 'ir', label: 'IR', kind: 'parts', parts: [{ key: 'method', label: 'Method', kind: 'combo', choices: IR_METHODS, default: 'ATR' }, text('bands', 'Bands (cm⁻¹)', { placeholder: '2925, 1715, 1250' })], filledParts: ['bands'] },
  { key: 'rotation', label: 'Optical rotation [α]D', kind: 'parts', parts: [
    num('value', '[α]D', { placeholder: '+23.5' }), num('temperature', 'T', { placeholder: '20', suffix: '°C' }),
    num('c', 'c', { placeholder: '1.0' }), text('solvent', 'Solvent', { placeholder: 'CHCl3' }),
  ], filledParts: ['value', 'c', 'solvent'] },
  { key: 'ee', label: 'Enantiomeric excess / ratio', kind: 'parts', parts: [
    text('value', 'ee or er', { placeholder: '94% ee  or  97:3 er' }),
    { key: 'method', label: 'Method', kind: 'combo', choices: EE_METHODS, default: 'HPLC' },
    { key: 'column', label: 'Column', kind: 'combo', placeholder: 'Chiralpak AD-H', learn: true },
    { key: 'eluent', label: 'Eluent', kind: 'combo', placeholder: '10% iPrOH/hexanes', learn: true },
    num('flow', 'Flow', { placeholder: '1.0', suffix: 'mL/min' }), num('wavelength', 'λ', { placeholder: '254', suffix: 'nm' }),
    num('t_major', 'tR major', { placeholder: '12.3', suffix: 'min' }), num('t_minor', 'tR minor', { placeholder: '14.8', suffix: 'min' }),
  ] },
  { key: 'dr', label: 'Diastereomeric ratio', kind: 'parts', parts: [text('value', 'd.r.', { placeholder: '10:1' }), text('method', 'Determined by', { placeholder: '¹H NMR of the crude mixture' })], filledParts: ['value'] },
  { key: 'ea', label: 'Elemental analysis', kind: 'parts', parts: [
    text('calcd', 'Calcd', { placeholder: 'C, 65.21; H, 5.47; N, 6.08' }), text('found', 'Found', { placeholder: 'C, 65.03; H, 5.52; N, 6.01' }),
    text('formula', 'Formula', { placeholder: 'auto: from the structure' }),
  ], filledParts: ['calcd', 'found'] },
  { key: 'xray', label: 'X-ray (CCDC number)', kind: 'parts', parts: [text('ccdc', '', { placeholder: '2345678' })] },
  { key: 'references', label: 'References (known compound)', kind: 'citations', description: 'For known compounds: a sentence such as “Spectral data matched those reported in the literature.” followed by the citations.' },
  { key: 'si_text', label: 'SI text (replaces the generated text)', kind: 'richtext', description: 'When filled in, this text is printed in the SI instead of the text made from the fields, exactly as typed.' },
  { key: 'private_files', label: 'Store additional files and folders (never printed)', kind: 'private', description: 'Raw NMR data, .mnova files, HRMS spectra, photos… kept with the compound in its private folder.' },
];

export const ALL_FIELDS: ReadonlyMap<string, FieldDef> = new Map([...CORE_FIELDS, ...LIBRARY_FIELDS].map((f) => [f.key, f]));

export interface FieldEntry { key: string; required?: boolean; custom?: { label?: string; type?: string }; [more: string]: unknown }

/** The fields a new Data section gives its compounds, and which are required. */
export const DEFAULT_SECTION_FIELDS: readonly FieldEntry[] = [
  { key: 'structure', required: true },
  { key: 'name', required: false },
  { key: 'procedure', required: true },
  { key: 'scale', required: true },
  { key: 'yield', required: true },
  { key: 'physical_state', required: true },
  { key: 'rf', required: false },
  { key: 'nmr', required: true },
  { key: 'hrms', required: true },
  { key: 'spectra', required: true },
  { key: 'files', required: false },
];

export const DEFAULT_NMR_NUCLEI = ['1H', '13C'] as const;

export const CUSTOM_TYPES: Record<CustomType, string> = { short_text: 'Short text', long_text: 'Long text', number_unit: 'Number with unit', file: 'File(s)' };

export function customFieldDef(key: string, label: string, type: string): FieldDef {
  const t = (type in CUSTOM_TYPES ? type : 'short_text') as CustomType;
  const custom = { label, type: t };
  if (t === 'long_text') return { key, label, kind: 'richtext', custom };
  if (t === 'number_unit') return { key, label, kind: 'parts', parts: [num('value'), text('unit', 'Unit', { placeholder: 'unit' })], filledParts: ['value'], custom };
  if (t === 'file') return { key, label, kind: 'attachments', subdir: 'files', itemParts: FILE_ITEM_PARTS, custom };
  return { key, label, kind: 'parts', parts: [text('text')], custom };
}

/** The definition for a field entry of compound.json or section.json (null: an unknown field, kept as it is). */
export function fieldDef(entry: { key?: unknown; custom?: unknown }): FieldDef | null {
  const key = typeof entry.key === 'string' ? entry.key : '';
  const known = ALL_FIELDS.get(key);
  if (known) return known;
  const c = entry.custom;
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const cc = c as { label?: unknown; type?: unknown };
    return customFieldDef(key, typeof cc.label === 'string' ? cc.label : key, typeof cc.type === 'string' ? cc.type : 'short_text');
  }
  return null;
}

export const KNOWN_COMPOUND_SENTENCE = 'Spectral data matched those reported in the literature.';

/** What a newly added field holds (null: nothing is stored for it). */
export function emptyValue(def: FieldDef): unknown {
  if (def.kind === 'parts') return Object.fromEntries((def.parts ?? []).map((p) => [p.key, p.default ?? '']));
  if (def.kind === 'citations') return { text: KNOWN_COMPOUND_SENTENCE, refs: [] };
  if (def.kind === 'nmr' || def.kind === 'attachments' || def.kind === 'private') return [];
  return null;
}

/** The parts that must be filled for the field to count as filled. */
export function requiredParts(def: FieldDef): readonly string[] {
  return def.filledParts ?? (def.parts ?? []).filter((p) => p.kind === 'text' || p.kind === 'number' || p.kind === 'combo').map((p) => p.key);
}

/** A stored part as the text in its box: null and anything not text show empty, numbers as written. */
export function partText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * Whether a field counts as filled in (for "9 / 9 required"). `text` is a rich-text field's
 * stored text; for a structure, `value` is true when there is one. A value of the wrong
 * form (a hand-edited file) counts as empty.
 */
export function isFilled(def: FieldDef, value: unknown, textValue = ''): boolean {
  if (def.kind === 'richtext' || def.kind === 'notes') return !!textValue.trim();
  if (def.kind === 'structure') return !!value;
  if (def.kind === 'parts') {
    const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return requiredParts(def).every((k) => partText(v[k]).trim() !== '');
  }
  if (def.kind === 'nmr') return Array.isArray(value) && value.some((r) => r && typeof r === 'object' && partText((r as Record<string, unknown>).text).trim() !== '');
  if (def.kind === 'attachments' || def.kind === 'private') return Array.isArray(value) && value.length > 0;
  if (def.kind === 'citations') return !!value && typeof value === 'object' && Array.isArray((value as { refs?: unknown }).refs) && ((value as { refs: unknown[] }).refs.length > 0);
  return false;
}

/** Non-empty values, trimmed, each once (the first spelling kept, capitals ignored). */
export function distinct(values: Iterable<unknown>): string[] {
  const out = new Map<string, string>();
  for (const v of values) {
    const t = partText(v).trim();
    if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), t);
  }
  return [...out.values()];
}

/** A learning drop-down's list: its own choices in order, then the others the project uses, A to Z. */
export function learnedChoices(part: Part, used: Iterable<unknown>): string[] {
  const builtin = distinct(part.choices ?? []);
  const known = new Set(builtin.map((c) => c.toLowerCase()));
  const extra = distinct(used).filter((v) => !known.has(v.toLowerCase()));
  return [...builtin, ...extra.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))];
}
